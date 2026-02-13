/**
 * Fabric Invoice Routes
 *
 * Upload fabric supplier invoices (PDF/photo), AI-parse them,
 * review/edit extracted data, match to fabric receipts, and confirm.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parseInvoice, parseIndianDate } from '../services/invoiceParser.js';
import { matchInvoiceLines } from '../services/invoiceMatcher.js';
import { createLedgerEntry, dateToPeriod } from '../services/ledgerService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'fabricInvoices' });
const router = Router();

// ============================================
// MULTER CONFIG
// ============================================

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}. Use PDF, JPEG, PNG, or WebP.`));
        }
    },
});

// ============================================
// POST /upload — Upload + AI parse → save draft
// ============================================

router.post('/upload', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }

    const userId = req.user!.id;
    const { buffer, originalname, mimetype, size } = req.file;

    log.info({ fileName: originalname, mimeType: mimetype, size }, 'Invoice upload received');

    // Step 1: AI parse
    const { parsed, rawResponse, model } = await parseInvoice(buffer, mimetype);

    // Step 2: Try to match party (supplier)
    let partyId: string | null = null;
    if (parsed.supplierName) {
        const party = await req.prisma.party.findFirst({
            where: {
                name: { contains: parsed.supplierName, mode: 'insensitive' },
                isActive: true,
            },
        });
        if (party) partyId = party.id;
    }

    // Step 3: Try to match lines to fabric colours + existing transactions
    const matches = await matchInvoiceLines(parsed.lines, partyId, req.prisma);

    // Step 4: Save draft invoice
    const invoice = await req.prisma.fabricInvoice.create({
        data: {
            invoiceNumber: parsed.invoiceNumber ?? null,
            invoiceDate: parseIndianDate(parsed.invoiceDate),
            partyId,
            supplierName: parsed.supplierName ?? null,
            subtotal: parsed.subtotal ?? null,
            gstAmount: parsed.gstAmount ?? null,
            totalAmount: parsed.totalAmount ?? null,
            fileData: buffer,
            fileName: originalname,
            fileMimeType: mimetype,
            fileSizeBytes: size,
            status: 'draft',
            aiRawResponse: rawResponse,
            aiModel: model,
            aiConfidence: parsed.confidence,
            createdById: userId,
            lines: {
                create: parsed.lines.map((line, i) => {
                    const match = matches[i];
                    return {
                        description: line.description ?? null,
                        hsnCode: line.hsnCode ?? null,
                        qty: line.qty ?? null,
                        unit: normalizeUnit(line.unit),
                        rate: line.rate ?? null,
                        amount: line.amount ?? null,
                        gstPercent: line.gstPercent ?? null,
                        gstAmount: line.gstAmount ?? null,
                        fabricColourId: match?.fabricColourId ?? null,
                        matchedTxnId: match?.matchedTxnId ?? null,
                        matchType: match?.matchType ?? null,
                    };
                }),
            },
        },
        include: {
            lines: {
                include: {
                    fabricColour: {
                        select: { id: true, colourName: true, code: true, fabric: { select: { name: true } } },
                    },
                    matchedTxn: {
                        select: { id: true, qty: true, createdAt: true },
                    },
                },
            },
            party: { select: { id: true, name: true } },
        },
    });

    log.info({ invoiceId: invoice.id, lineCount: invoice.lines.length }, 'Draft invoice created');

    res.json({ success: true, invoice });
}));

// ============================================
// GET / — List invoices (paginated, filterable)
// ============================================

const ListQuerySchema = z.object({
    status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
    partyId: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});

router.get('/', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) {
        res.status(400).json({ error: query.error.issues[0]?.message || 'Invalid query' });
        return;
    }

    const { status, partyId, page, limit } = query.data;
    const skip = (page - 1) * limit;

    const where = {
        ...(status ? { status } : {}),
        ...(partyId ? { partyId } : {}),
    };

    const [invoices, total] = await Promise.all([
        req.prisma.fabricInvoice.findMany({
            where,
            select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                supplierName: true,
                totalAmount: true,
                status: true,
                fileName: true,
                fileSizeBytes: true,
                aiConfidence: true,
                createdAt: true,
                party: { select: { id: true, name: true } },
                _count: { select: { lines: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        req.prisma.fabricInvoice.count({ where }),
    ]);

    res.json({ success: true, invoices, total, page, limit });
}));

// ============================================
// GET /:id — Single invoice with lines
// ============================================

router.get('/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const invoice = await req.prisma.fabricInvoice.findUnique({
        where: { id: req.params.id as string },
        include: {
            lines: {
                include: {
                    fabricColour: {
                        select: {
                            id: true,
                            colourName: true,
                            code: true,
                            fabric: { select: { id: true, name: true } },
                        },
                    },
                    matchedTxn: {
                        select: { id: true, qty: true, unit: true, costPerUnit: true, createdAt: true },
                    },
                },
            },
            party: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
        },
    });

    if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
    }

    // Strip fileData from response (it's binary, use /file endpoint to download)
    const { fileData: _, ...invoiceWithoutFile } = invoice;

    res.json({ success: true, invoice: invoiceWithoutFile });
}));

// ============================================
// GET /:id/file — Download original file
// ============================================

router.get('/:id/file', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const invoice = await req.prisma.fabricInvoice.findUnique({
        where: { id: req.params.id as string },
        select: { fileData: true, fileName: true, fileMimeType: true },
    });

    if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
    }

    res.setHeader('Content-Type', invoice.fileMimeType);
    res.setHeader('Content-Disposition', `inline; filename="${invoice.fileName}"`);
    res.send(Buffer.from(invoice.fileData));
}));

// ============================================
// PUT /:id/lines — Edit parsed data + set matches
// ============================================

const UpdateLineSchema = z.object({
    id: z.string().uuid(),
    description: z.string().nullable().optional(),
    hsnCode: z.string().nullable().optional(),
    qty: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    rate: z.number().nullable().optional(),
    amount: z.number().nullable().optional(),
    gstPercent: z.number().nullable().optional(),
    gstAmount: z.number().nullable().optional(),
    fabricColourId: z.string().uuid().nullable().optional(),
    matchedTxnId: z.string().uuid().nullable().optional(),
    matchType: z.enum(['auto_matched', 'manual_matched', 'new_entry']).nullable().optional(),
});

const UpdateLinesBodySchema = z.object({
    lines: z.array(UpdateLineSchema).min(1),
    // Also allow updating invoice-level fields
    invoiceNumber: z.string().nullable().optional(),
    invoiceDate: z.string().nullable().optional(),
    partyId: z.string().uuid().nullable().optional(),
    subtotal: z.number().nullable().optional(),
    gstAmount: z.number().nullable().optional(),
    totalAmount: z.number().nullable().optional(),
});

router.put('/:id/lines', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const body = UpdateLinesBodySchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.issues[0]?.message || 'Invalid request body' });
        return;
    }

    const invoice = await req.prisma.fabricInvoice.findUnique({
        where: { id: req.params.id as string },
        select: { id: true, status: true },
    });

    if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
    }

    if (invoice.status !== 'draft') {
        res.status(400).json({ error: 'Can only edit draft invoices' });
        return;
    }

    const { lines, invoiceNumber, invoiceDate, partyId, subtotal, gstAmount: gstAmt, totalAmount } = body.data;

    // Update invoice-level fields if provided
    await req.prisma.fabricInvoice.update({
        where: { id: req.params.id as string },
        data: {
            ...(invoiceNumber !== undefined ? { invoiceNumber } : {}),
            ...(invoiceDate !== undefined ? { invoiceDate: parseIndianDate(invoiceDate) } : {}),
            ...(partyId !== undefined ? { partyId } : {}),
            ...(subtotal !== undefined ? { subtotal } : {}),
            ...(gstAmt !== undefined ? { gstAmount: gstAmt } : {}),
            ...(totalAmount !== undefined ? { totalAmount } : {}),
        },
    });

    // Update each line
    for (const line of lines) {
        const { id: lineId, ...updateData } = line;
        await req.prisma.fabricInvoiceLine.update({
            where: { id: lineId },
            data: {
                ...(updateData.description !== undefined ? { description: updateData.description } : {}),
                ...(updateData.hsnCode !== undefined ? { hsnCode: updateData.hsnCode } : {}),
                ...(updateData.qty !== undefined ? { qty: updateData.qty } : {}),
                ...(updateData.unit !== undefined ? { unit: updateData.unit } : {}),
                ...(updateData.rate !== undefined ? { rate: updateData.rate } : {}),
                ...(updateData.amount !== undefined ? { amount: updateData.amount } : {}),
                ...(updateData.gstPercent !== undefined ? { gstPercent: updateData.gstPercent } : {}),
                ...(updateData.gstAmount !== undefined ? { gstAmount: updateData.gstAmount } : {}),
                ...(updateData.fabricColourId !== undefined ? { fabricColourId: updateData.fabricColourId } : {}),
                ...(updateData.matchedTxnId !== undefined ? { matchedTxnId: updateData.matchedTxnId } : {}),
                ...(updateData.matchType !== undefined ? { matchType: updateData.matchType } : {}),
            },
        });
    }

    // Return updated invoice
    const updated = await req.prisma.fabricInvoice.findUnique({
        where: { id: req.params.id as string },
        include: {
            lines: {
                include: {
                    fabricColour: {
                        select: { id: true, colourName: true, code: true, fabric: { select: { name: true } } },
                    },
                    matchedTxn: {
                        select: { id: true, qty: true, createdAt: true },
                    },
                },
            },
            party: { select: { id: true, name: true } },
        },
    });

    res.json({ success: true, invoice: updated });
}));

// ============================================
// POST /:id/confirm — Create/link transactions, mark confirmed
// ============================================

router.post('/:id/confirm', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const invoice = await req.prisma.fabricInvoice.findUnique({
        where: { id: req.params.id as string },
        include: {
            lines: true,
        },
    });

    if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
    }

    if (invoice.status !== 'draft') {
        res.status(400).json({ error: 'Can only confirm draft invoices' });
        return;
    }

    const userId = req.user!.id;

    // Process each line: create new transactions for any line that has a fabric colour but no linked transaction
    for (const line of invoice.lines) {
        if (!line.fabricColourId) continue; // Skip unmatched lines

        if (!line.matchedTxnId) {
            // No existing transaction linked — create a new inward transaction
            const newTxn = await req.prisma.fabricColourTransaction.create({
                data: {
                    fabricColourId: line.fabricColourId,
                    txnType: 'inward',
                    qty: line.qty ?? 0,
                    unit: line.unit ?? 'meter',
                    reason: 'supplier_receipt',
                    costPerUnit: line.rate ?? undefined,
                    partyId: invoice.partyId ?? undefined,
                    referenceId: `invoice:${invoice.id}`,
                    notes: `From invoice ${invoice.invoiceNumber ?? invoice.id}${line.description ? ` — ${line.description}` : ''}`,
                    createdById: userId,
                },
            });

            // Link the transaction to the invoice line
            await req.prisma.fabricInvoiceLine.update({
                where: { id: line.id },
                data: { matchedTxnId: newTxn.id },
            });
        }
        // If matchedTxnId is already set, the transaction link exists — nothing to do
    }

    // Mark invoice as confirmed
    const confirmed = await req.prisma.fabricInvoice.update({
        where: { id: req.params.id as string },
        data: { status: 'confirmed' },
        include: {
            lines: {
                include: {
                    fabricColour: {
                        select: { id: true, colourName: true, code: true, fabric: { select: { name: true } } },
                    },
                    matchedTxn: {
                        select: { id: true, qty: true, createdAt: true },
                    },
                },
            },
            party: { select: { id: true, name: true } },
        },
    });

    const newTxnCount = invoice.lines.filter(l => l.matchType === 'new_entry' && !l.matchedTxnId).length;
    log.info({ invoiceId: invoice.id, newTransactions: newTxnCount }, 'Invoice confirmed');

    // --- Create Finance Invoice + Ledger Entry ---
    try {
        const totalAmount = invoice.totalAmount ?? 0;
        const gstAmount = invoice.gstAmount ?? 0;
        const netAmount = totalAmount - gstAmount;

        if (totalAmount > 0) {
            // Build ledger lines: Dr FABRIC_INVENTORY (net), Dr GST_INPUT (gst), Cr ACCOUNTS_PAYABLE (total)
            const ledgerLines = [
                { accountCode: 'FABRIC_INVENTORY', debit: netAmount, description: `Fabric: ${invoice.invoiceNumber ?? ''}` },
                { accountCode: 'ACCOUNTS_PAYABLE', credit: totalAmount, description: `Payable: ${invoice.supplierName ?? ''}` },
            ];
            if (gstAmount > 0) {
                ledgerLines.push({ accountCode: 'GST_INPUT', debit: gstAmount, description: 'GST input credit' });
            }

            const fabricEntryDate = invoice.invoiceDate ?? new Date();
            const entry = await createLedgerEntry(req.prisma, {
                entryDate: fabricEntryDate,
                period: dateToPeriod(fabricEntryDate),
                description: `Fabric invoice ${invoice.invoiceNumber ?? invoice.id} — ${invoice.supplierName ?? 'Unknown'}`,
                sourceType: 'fabric_inward',
                sourceId: invoice.id,
                lines: ledgerLines,
                createdById: userId,
            });

            // Create finance Invoice record linked to fabric invoice + ledger entry
            await req.prisma.invoice.create({
                data: {
                    type: 'payable',
                    category: 'fabric',
                    status: 'confirmed',
                    invoiceNumber: invoice.invoiceNumber ?? null,
                    invoiceDate: invoice.invoiceDate ?? null,
                    ...(invoice.partyId ? { partyId: invoice.partyId } : {}),
                    counterpartyName: invoice.supplierName ?? null,
                    subtotal: invoice.subtotal ?? null,
                    gstAmount: invoice.gstAmount ?? null,
                    totalAmount,
                    balanceDue: totalAmount,
                    fabricInvoiceId: invoice.id,
                    ledgerEntryId: entry.id,
                    createdById: userId,
                    lines: {
                        create: invoice.lines.map(l => ({
                            description: l.description ?? null,
                            hsnCode: l.hsnCode ?? null,
                            qty: l.qty ?? null,
                            unit: l.unit ?? null,
                            rate: l.rate ?? null,
                            amount: l.amount ?? null,
                            gstPercent: l.gstPercent ?? null,
                            gstAmount: l.gstAmount ?? null,
                        })),
                    },
                },
            });

            log.info({ invoiceId: invoice.id, ledgerEntryId: entry.id }, 'Finance invoice + ledger entry created');
        }
    } catch (financeError) {
        // Don't fail the fabric confirm if finance creation fails — log and continue
        log.error({ err: financeError, invoiceId: invoice.id }, 'Failed to create finance invoice (fabric confirm still succeeded)');
    }

    res.json({ success: true, invoice: confirmed });
}));

// ============================================
// DELETE /:id — Delete draft invoice
// ============================================

router.delete('/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const invoice = await req.prisma.fabricInvoice.findUnique({
        where: { id: req.params.id as string },
        select: { id: true, status: true },
    });

    if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
    }

    if (invoice.status !== 'draft') {
        res.status(400).json({ error: 'Can only delete draft invoices' });
        return;
    }

    // Lines cascade-deleted via onDelete: Cascade
    await req.prisma.fabricInvoice.delete({
        where: { id: req.params.id as string },
    });

    res.json({ success: true });
}));

// ============================================
// HELPERS
// ============================================

/**
 * Normalize unit strings from AI output to standard values.
 */
function normalizeUnit(unit: string | null | undefined): string | null {
    if (!unit) return null;
    const lower = unit.toLowerCase().trim();
    if (['m', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres'].includes(lower)) return 'meter';
    if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(lower)) return 'kg';
    if (['yd', 'yds', 'yard', 'yards'].includes(lower)) return 'yard';
    return lower;
}

export default router;
