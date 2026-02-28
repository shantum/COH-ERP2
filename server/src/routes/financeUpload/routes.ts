/**
 * Finance Upload Route Handlers
 *
 * File upload for invoices/receipts and file download.
 * Handles all invoice types including fabric invoices with colour matching.
 * Auto-pushes uploaded files to Google Drive for CA access.
 */

import type { Request, Response } from 'express';
import type { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import logger from '../../utils/logger.js';
import { deferredExecutor } from '../../services/deferredExecutor.js';
import { uploadInvoiceFile } from '../../services/driveFinanceSync.js';
import driveFinanceSync from '../../services/driveFinanceSync.js';
import { parseInvoice, parseIndianDate, type ParsedInvoice } from '../../services/invoiceParser.js';
import { matchInvoiceLines } from '../../services/invoiceMatcher.js';
import { findPartyByNarration } from '../../services/transactionTypeResolver.js';
import { randomUUID } from 'crypto';
import * as previewCache from '../../services/invoicePreviewCache.js';
import { saveFile, buildInvoicePath, readFile } from '../../services/fileStorageService.js';
import { computeFileHash, checkExactDuplicate, checkNearDuplicates } from '../../services/invoiceDuplicateCheck.js';
import { validateInvoice } from '../../services/invoiceValidator.js';
import { enrichPartyFromInvoice, createPartyFromInvoice, type EnrichmentResult } from './partyEnricher.js';
import { previewEnrichment } from './enrichmentPreview.js';
import { createDraftInvoice } from './invoiceBuilder.js';

const log = logger.child({ module: 'financeUpload' });

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

/**
 * Register all finance upload routes on the given router.
 */
export function registerRoutes(router: Router): void {

  // ============================================
  // POST /upload — Upload file + attach to invoice
  // ============================================

  router.post('/upload', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { invoiceId } = req.body;
    if (!invoiceId) {
      res.status(400).json({ error: 'invoiceId is required' });
      return;
    }

    const { buffer, originalname, mimetype, size } = req.file;

    // Duplicate check: file hash
    const fileHash = computeFileHash(buffer);
    const duplicate = await checkExactDuplicate(req.prisma as any, fileHash);
    if (duplicate) {
      res.status(409).json({ duplicate: true, ...duplicate });
      return;
    }

    log.info({ fileName: originalname, mimeType: mimetype, size, invoiceId }, 'Finance file upload received');

    // Look up party name for file path
    const existing = await req.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { invoiceDate: true, party: { select: { name: true } } },
    });

    // Save file to disk (dual-write: disk + DB blob)
    let filePath: string | null = null;
    try {
      filePath = buildInvoicePath(
        existing?.party?.name,
        existing?.invoiceDate ?? new Date(),
        originalname,
      );
      await saveFile(filePath, buffer);
    } catch (err: unknown) {
      log.error({ error: err instanceof Error ? err.message : err }, 'Failed to save file to disk');
      filePath = null;
    }

    // Attach file to invoice
    const invoice = await req.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        fileData: buffer,
        ...(filePath ? { filePath } : {}),
        fileName: originalname,
        fileMimeType: mimetype,
        fileSizeBytes: size,
        fileHash,
      },
      select: { id: true, fileName: true, fileSizeBytes: true },
    });

    // Fire-and-forget: push to Google Drive in background
    deferredExecutor.enqueue(
      async () => { await uploadInvoiceFile(invoiceId); },
      { action: 'driveUploadInvoice' }
    );

    res.json({ success: true, invoice });
  }));

  // ============================================
  // POST /upload-and-parse — AI-parse invoice file, create draft Invoice
  // ============================================

  router.post('/upload-and-parse', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { buffer, originalname, mimetype, size } = req.file;
    log.info({ fileName: originalname, mimeType: mimetype, size }, 'Upload-and-parse invoice received');

    // 0. File hash duplicate check
    const fileHash = computeFileHash(buffer);
    const hashDuplicate = await checkExactDuplicate(req.prisma as any, fileHash);
    if (hashDuplicate) {
      res.status(409).json({ duplicate: true, ...hashDuplicate });
      return;
    }

    // 1. Parse with AI
    let parsed: ParsedInvoice | null = null;
    let rawResponse = '';
    let aiModel = '';
    let aiConfidence = 0;

    try {
      const result = await parseInvoice(buffer, mimetype);
      parsed = result.parsed;
      rawResponse = result.rawResponse;
      aiModel = result.model;
      aiConfidence = parsed.confidence;
    } catch (err: unknown) {
      log.error({ error: err instanceof Error ? err.message : err }, 'AI parsing failed, creating empty draft');
    }

    // 2. Try to match supplier to a Party (alias-based + GSTIN fallback)
    let partyId: string | undefined;
    let matchedPartyName: string | undefined;
    let matchedCategory = 'other';
    if (parsed?.supplierName || parsed?.supplierGstin) {
      const allParties = await req.prisma.party.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, aliases: true, category: true, gstin: true,
          tdsApplicable: true, tdsSection: true, tdsRate: true, invoiceRequired: true,
          transactionType: {
            select: {
              id: true, name: true, debitAccountCode: true, creditAccountCode: true,
              defaultGstRate: true, defaultTdsApplicable: true, defaultTdsSection: true,
              defaultTdsRate: true, invoiceRequired: true, expenseCategory: true,
            },
          },
        },
      });

      if (parsed?.supplierName) {
        const matched = findPartyByNarration(parsed.supplierName, allParties);
        if (matched) {
          partyId = matched.id;
          matchedPartyName = matched.name;
          matchedCategory = matched.category;
        }
      }

      if (!partyId && parsed?.supplierGstin) {
        const gstinParty = allParties.find(p => p.gstin === parsed!.supplierGstin);
        if (gstinParty) {
          partyId = gstinParty.id;
          matchedPartyName = gstinParty.name;
          matchedCategory = gstinParty.category;
        }
      }
    }

    // 3b. Invoice number + party duplicate check
    if (parsed?.invoiceNumber && partyId) {
      const numberDuplicate = await checkExactDuplicate(req.prisma as any, '', partyId, parsed.invoiceNumber);
      if (numberDuplicate) {
        res.status(409).json({ duplicate: true, ...numberDuplicate });
        return;
      }
    }

    // 4. Create draft Invoice + lines
    const { invoice: createdInvoice, supplierName } = await createDraftInvoice({
      prisma: req.prisma,
      parsed,
      partyId,
      partyName: matchedPartyName,
      category: matchedCategory,
      userId,
      file: { buffer, fileHash, originalname, mimetype, size },
      rawResponse,
      aiModel,
      aiConfidence,
    });

    let invoice = createdInvoice;
    log.info({ invoiceId: invoice.id, aiConfidence, partyMatched: !!partyId }, 'Draft invoice created from AI parse');

    // 5. Enrich party data from parsed invoice
    let enrichment: EnrichmentResult = { fieldsAdded: [], bankMismatch: false, partyCreated: false };

    if (parsed) {
      if (partyId) {
        enrichment = await enrichPartyFromInvoice(req.prisma, partyId, parsed);
      } else if (parsed.supplierName) {
        const created = await createPartyFromInvoice(req.prisma, parsed);
        if (created) {
          enrichment = created.enrichment;
          await req.prisma.invoice.update({
            where: { id: invoice.id },
            data: { partyId: created.partyId, notes: null },
          });
          invoice = { ...invoice, partyId: created.partyId, party: { id: created.partyId, name: parsed.supplierName! } };
        }
      }
    }

    // 6. Fire-and-forget: push to Google Drive
    deferredExecutor.enqueue(
      async () => { await uploadInvoiceFile(invoice.id); },
      { action: 'driveUploadInvoice' }
    );

    res.json({ success: true, invoice: { ...invoice, supplierName }, aiConfidence, enrichment });
  }));

  // ============================================
  // POST /upload-preview — Parse invoice, return preview (NO DB write)
  // ============================================

  router.post('/upload-preview', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { buffer, originalname, mimetype, size } = req.file;
    log.info({ fileName: originalname, mimeType: mimetype, size }, 'Upload-preview received');

    // 0. File hash duplicate check (before expensive AI parse)
    const fileHash = computeFileHash(buffer);
    const hashDuplicate = await checkExactDuplicate(req.prisma as any, fileHash);
    if (hashDuplicate) {
      res.status(409).json({ duplicate: true, ...hashDuplicate });
      return;
    }

    // 1. Parse with AI
    let parsed: ParsedInvoice | null = null;
    let rawResponse = '';
    let aiModel = '';
    let aiConfidence = 0;

    try {
      const result = await parseInvoice(buffer, mimetype);
      parsed = result.parsed;
      rawResponse = result.rawResponse;
      aiModel = result.model;
      aiConfidence = parsed.confidence;
    } catch (err: unknown) {
      log.error({ error: err instanceof Error ? err.message : err }, 'AI parsing failed');
    }

    // 2. Match supplier to Party (read-only)
    let partyMatch: { partyId: string; partyName: string; category: string } | null = null;
    if (parsed?.supplierName || parsed?.supplierGstin) {
      const allParties = await req.prisma.party.findMany({
        where: { isActive: true },
        select: { id: true, name: true, aliases: true, category: true, gstin: true },
      });

      if (parsed?.supplierName) {
        const matched = findPartyByNarration(parsed.supplierName, allParties as any);
        if (matched) partyMatch = { partyId: matched.id, partyName: matched.name, category: matched.category };
      }

      if (!partyMatch && parsed?.supplierGstin) {
        const gstinParty = allParties.find(p => p.gstin === parsed!.supplierGstin);
        if (gstinParty) partyMatch = { partyId: gstinParty.id, partyName: gstinParty.name, category: gstinParty.category };
      }
    }

    // 3. Invoice number + party duplicate check (after AI parse)
    if (parsed?.invoiceNumber && partyMatch?.partyId) {
      const numberDuplicate = await checkExactDuplicate(
        req.prisma as any, '', partyMatch.partyId, parsed.invoiceNumber,
      );
      if (numberDuplicate) {
        res.status(409).json({ duplicate: true, ...numberDuplicate });
        return;
      }
    }

    // 4. Near-duplicate check (soft warning)
    const invoiceDate = parsed ? parseIndianDate(parsed.invoiceDate) : null;
    const nearDuplicates = await checkNearDuplicates(
      req.prisma as any, partyMatch?.partyId, parsed?.totalAmount, invoiceDate,
    );

    // 5. Preview enrichment (read-only)
    const enrichmentPreview = parsed
      ? await previewEnrichment(req.prisma, partyMatch?.partyId, parsed)
      : { willCreateNewParty: false, fieldsWillBeAdded: [] as string[], bankMismatch: false };

    // 5b. Fabric matching removed — fabric colours must be selected manually
    const fabricMatchPreview: Awaited<ReturnType<typeof matchInvoiceLines>> = [];

    // 6. Validate invoice (buyer checks, GST checks)
    const validationWarnings = parsed ? validateInvoice(parsed) : [];

    // 7. Cache for later confirm
    const previewId = randomUUID();
    previewCache.set(previewId, {
      fileBuffer: buffer,
      fileHash,
      originalname,
      mimetype,
      size,
      parsed,
      rawResponse,
      aiModel,
      aiConfidence,
      partyMatch,
      enrichmentPreview,
      createdAt: Date.now(),
    });

    // 8. Return preview data
    res.json({
      previewId,
      parsed,
      partyMatch,
      enrichmentPreview,
      nearDuplicates,
      validationWarnings,
      fabricMatches: fabricMatchPreview,
      aiConfidence,
      aiModel,
      fileName: originalname,
    });
  }));

  // ============================================
  // POST /confirm-preview/:previewId — Save from cache
  // ============================================

  router.post('/confirm-preview/:previewId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { previewId } = req.params;
    const cached = previewCache.get(previewId as string);

    if (!cached) {
      res.status(410).json({ error: 'Preview expired, please re-upload' });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { fileBuffer: buffer, fileHash, originalname, mimetype, size, parsed, rawResponse, aiModel, aiConfidence, partyMatch } = cached;

    // Merge user overrides from request body (editable preview fields)
    const overrides = req.body ?? {};
    const mergedParsed = {
      ...parsed,
      ...(overrides.invoiceNumber !== undefined ? { invoiceNumber: overrides.invoiceNumber } : {}),
      ...(overrides.invoiceDate !== undefined ? { invoiceDate: overrides.invoiceDate } : {}),
      ...(overrides.dueDate !== undefined ? { dueDate: overrides.dueDate } : {}),
      ...(overrides.subtotal !== undefined ? { subtotal: overrides.subtotal } : {}),
      ...(overrides.gstAmount !== undefined ? { gstAmount: overrides.gstAmount } : {}),
      ...(overrides.totalAmount !== undefined ? { totalAmount: overrides.totalAmount } : {}),
      ...(overrides.billingPeriod !== undefined ? { billingPeriod: overrides.billingPeriod } : {}),
      ...(overrides.category !== undefined ? { category: overrides.category } : {}),
      ...(overrides.gstType !== undefined ? { gstType: overrides.gstType } : {}),
    };

    // Re-check for duplicates (race condition guard)
    if (fileHash) {
      const duplicate = await checkExactDuplicate(req.prisma as any, fileHash, partyMatch?.partyId, mergedParsed?.invoiceNumber);
      if (duplicate) {
        previewCache.remove(previewId as string);
        res.status(409).json({ duplicate: true, ...duplicate });
        return;
      }
    }

    // Re-fetch parties for enrichment (data may have changed since preview)
    let partyId = partyMatch?.partyId;
    let matchedCategory = partyMatch?.category ?? 'other';

    // If no party match was found at preview time, re-check
    if (!partyId && (parsed?.supplierName || parsed?.supplierGstin)) {
      const allParties = await req.prisma.party.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, aliases: true, category: true, gstin: true,
          tdsApplicable: true, tdsSection: true, tdsRate: true, invoiceRequired: true,
          transactionType: {
            select: {
              id: true, name: true, debitAccountCode: true, creditAccountCode: true,
              defaultGstRate: true, defaultTdsApplicable: true, defaultTdsSection: true,
              defaultTdsRate: true, invoiceRequired: true, expenseCategory: true,
            },
          },
        },
      });

      if (parsed?.supplierName) {
        const matched = findPartyByNarration(parsed.supplierName, allParties);
        if (matched) { partyId = matched.id; matchedCategory = matched.category; }
      }
      if (!partyId && parsed?.supplierGstin) {
        const gstinParty = allParties.find(p => p.gstin === parsed!.supplierGstin);
        if (gstinParty) { partyId = gstinParty.id; matchedCategory = gstinParty.category; }
      }
    }

    const finalCategory = overrides.category ?? matchedCategory;

    // Create draft Invoice + lines
    const { invoice: createdInvoice, supplierName } = await createDraftInvoice({
      prisma: req.prisma,
      parsed,
      mergedParsed,
      partyId,
      partyName: partyMatch?.partyName,
      category: finalCategory,
      userId,
      file: { buffer, fileHash: fileHash ?? '', originalname, mimetype, size },
      rawResponse,
      aiModel,
      aiConfidence,
    });

    let invoice = createdInvoice;
    log.info({ invoiceId: invoice.id, aiConfidence, partyMatched: !!partyId }, 'Invoice created from preview confirm');

    // Log domain event
    import('@coh/shared/services/eventLog').then(({ logEvent }) =>
      logEvent({ domain: 'finance', event: 'invoice.created', entityType: 'Invoice', entityId: invoice.id, summary: `Invoice ${invoice.invoiceNumber ?? 'draft'} — ₹${invoice.totalAmount?.toLocaleString('en-IN') ?? 0}`, meta: { category: finalCategory, totalAmount: invoice.totalAmount, aiConfidence, partyMatched: !!partyId }, actorId: userId })
    ).catch((err) => { console.error('[finance] Event log failed:', err); });

    // Enrich party data
    let enrichment: EnrichmentResult = { fieldsAdded: [], bankMismatch: false, partyCreated: false };

    if (parsed) {
      if (partyId) {
        enrichment = await enrichPartyFromInvoice(req.prisma, partyId, parsed);
      } else if (parsed.supplierName) {
        const created = await createPartyFromInvoice(req.prisma, parsed);
        if (created) {
          enrichment = created.enrichment;
          await req.prisma.invoice.update({
            where: { id: invoice.id },
            data: { partyId: created.partyId, notes: null },
          });
          invoice = { ...invoice, partyId: created.partyId, party: { id: created.partyId, name: parsed.supplierName! } };
        }
      }
    }

    // Fire-and-forget: push to Google Drive
    deferredExecutor.enqueue(
      async () => { await uploadInvoiceFile(invoice.id); },
      { action: 'driveUploadInvoice' }
    );

    // Remove from cache
    previewCache.remove(previewId as string);

    res.json({ success: true, invoice: { ...invoice, supplierName }, aiConfidence, enrichment });
  }));

  // ============================================
  // GET /:id/file — Download original file
  // ============================================

  router.get('/:id/file', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const invoice = await req.prisma.invoice.findUnique({
      where: { id: req.params.id as string },
      select: { filePath: true, fileData: true, fileName: true, fileMimeType: true },
    });

    if (!invoice || (!invoice.filePath && !invoice.fileData)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Type', invoice.fileMimeType!);
    res.setHeader('Content-Disposition', `inline; filename="${invoice.fileName}"`);

    // Prefer disk, fallback to DB blob
    if (invoice.filePath) {
      const diskBuffer = await readFile(invoice.filePath);
      if (diskBuffer) {
        res.send(diskBuffer);
        return;
      }
      log.warn({ invoiceId: req.params.id, filePath: invoice.filePath }, 'File missing on disk, falling back to DB blob');
    }

    if (invoice.fileData) {
      res.send(Buffer.from(invoice.fileData));
      return;
    }

    res.status(404).json({ error: 'File not found' });
  }));

  // ============================================
  // GET /bank-transaction/:id/file — Download bank transaction file
  // ============================================

  router.get('/bank-transaction/:id/file', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const bankTxn = await req.prisma.bankTransaction.findUnique({
      where: { id: req.params.id as string },
      select: { filePath: true, fileData: true, fileName: true, fileMimeType: true },
    });

    if (!bankTxn || (!bankTxn.filePath && !bankTxn.fileData)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Type', bankTxn.fileMimeType!);
    res.setHeader('Content-Disposition', `inline; filename="${bankTxn.fileName}"`);

    // Prefer disk, fallback to DB blob
    if (bankTxn.filePath) {
      const diskBuffer = await readFile(bankTxn.filePath);
      if (diskBuffer) {
        res.send(diskBuffer);
        return;
      }
      log.warn({ bankTxnId: req.params.id, filePath: bankTxn.filePath }, 'File missing on disk, falling back to DB blob');
    }

    if (bankTxn.fileData) {
      res.send(Buffer.from(bankTxn.fileData));
      return;
    }

    res.status(404).json({ error: 'File not found' });
  }));

  // ============================================
  // POST /drive/sync — Trigger manual sync of all pending files
  // ============================================

  router.post('/drive/sync', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    log.info('Manual Drive sync triggered');
    const result = await driveFinanceSync.triggerSync();
    res.json({ success: true, ...result });
  }));

  // ============================================
  // GET /drive/status — Drive sync status
  // ============================================

  router.get('/drive/status', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    res.json(driveFinanceSync.getStatus());
  }));
}
