/**
 * Inventory Reconciliation Routes
 *
 * Physical inventory count reconciliation workflow:
 * 1. Start count - creates reconciliation with all active SKUs + system balances
 * 2. Enter physical quantities (manual or CSV upload)
 * 3. Save progress
 * 4. Submit - creates InventoryTransaction for each variance
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { calculateAllInventoryBalances } from '../utils/queryPatterns.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface ReconciliationUpdateItem {
    id: string;
    physicalQty: number | null;
    systemQty: number;
    adjustmentReason?: string | null;
    notes?: string | null;
}

interface CSVUploadResults {
    total: number;
    matched: number;
    updated: number;
    notFound: string[];
    errors: Array<{ skuCode?: string; record?: Record<string, string>; error: string }>;
    delimiter: string;
    columns: string[];
    reconItemCount: number;
    updates?: Array<{ id: string; physicalQty: number; variance: number }>;
}

interface CSVRecord {
    [key: string]: string;
}

// ============================================
// PRISMA INCLUDE CONFIGURATIONS
// ============================================

/**
 * Include configuration for reconciliation items with full SKU details
 */
const reconciliationItemsInclude = {
    items: {
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    },
} as const satisfies Prisma.InventoryReconciliationInclude;

/**
 * Include configuration for reconciliation items with basic SKU
 */
const reconciliationItemsBasicInclude = {
    items: {
        include: { sku: true },
    },
} as const satisfies Prisma.InventoryReconciliationInclude;

// Configure multer for CSV upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});

// ============================================
// RECONCILIATION ENDPOINTS
// ============================================

/**
 * GET /reconciliation/history
 * Get history of past reconciliations
 */
router.get('/reconciliation/history', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { limit = 10 } = req.query;

    const reconciliations = await req.prisma.inventoryReconciliation.findMany({
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
    });

    const history = reconciliations.map(r => ({
        id: r.id,
        date: r.reconcileDate,
        status: r.status,
        itemsCount: r.items.length,
        adjustments: r.items.filter(i => i.variance !== 0 && i.variance !== null).length,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
    }));

    res.json(history);
}));

/**
 * POST /reconciliation/start
 * Start a new reconciliation with all active, non-custom SKUs
 */
router.post('/reconciliation/start', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    // Get all active, non-custom SKUs
    const skus = await req.prisma.sku.findMany({
        where: {
            isActive: true,
            isCustomSku: false,
        },
        include: {
            variation: {
                include: { product: true },
            },
        },
        orderBy: { skuCode: 'asc' },
    });

    // Calculate all balances efficiently in one query
    const balanceMap = await calculateAllInventoryBalances(
        req.prisma,
        skus.map(s => s.id),
        { excludeCustomSkus: true }
    );

    // Create reconciliation with items
    const reconciliation = await req.prisma.inventoryReconciliation.create({
        data: {
            createdBy: req.user?.id || null,
            items: {
                create: skus.map(sku => ({
                    skuId: sku.id,
                    systemQty: balanceMap.get(sku.id)?.currentBalance || 0,
                })),
            },
        },
        include: reconciliationItemsInclude,
    });

    // Format response
    const response = {
        id: reconciliation.id,
        status: reconciliation.status,
        createdAt: reconciliation.createdAt,
        items: reconciliation.items.map(item => ({
            id: item.id,
            skuId: item.skuId,
            skuCode: item.sku.skuCode,
            productName: item.sku.variation?.product?.name || '',
            colorName: item.sku.variation?.colorName || '',
            size: item.sku.size,
            systemQty: item.systemQty,
            physicalQty: item.physicalQty,
            variance: item.variance,
            adjustmentReason: item.adjustmentReason,
            notes: item.notes,
        })),
    };

    res.status(201).json(response);
}));

/**
 * GET /reconciliation/:id
 * Get a specific reconciliation with items
 */
router.get('/reconciliation/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
        include: reconciliationItemsInclude,
    });

    if (!reconciliation) {
        return res.status(404).json({ error: 'Reconciliation not found' });
    }

    const response = {
        id: reconciliation.id,
        status: reconciliation.status,
        notes: reconciliation.notes,
        createdAt: reconciliation.createdAt,
        items: reconciliation.items.map(item => ({
            id: item.id,
            skuId: item.skuId,
            skuCode: item.sku.skuCode,
            productName: item.sku.variation?.product?.name || '',
            colorName: item.sku.variation?.colorName || '',
            size: item.sku.size,
            systemQty: item.systemQty,
            physicalQty: item.physicalQty,
            variance: item.variance,
            adjustmentReason: item.adjustmentReason,
            notes: item.notes,
        })),
    };

    res.json(response);
}));

/**
 * PUT /reconciliation/:id
 * Update reconciliation items (physical quantities, reasons, notes)
 */
router.put('/reconciliation/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { items } = req.body as { items: ReconciliationUpdateItem[] };

    const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
    });

    if (!reconciliation) {
        return res.status(404).json({ error: 'Reconciliation not found' });
    }

    if (reconciliation.status !== 'draft') {
        return res.status(400).json({ error: 'Cannot update submitted reconciliation' });
    }

    // Update each item
    for (const item of items) {
        const variance = item.physicalQty !== null && item.physicalQty !== undefined
            ? item.physicalQty - item.systemQty
            : null;

        await req.prisma.inventoryReconciliationItem.update({
            where: { id: item.id },
            data: {
                physicalQty: item.physicalQty,
                variance,
                adjustmentReason: item.adjustmentReason || null,
                notes: item.notes || null,
            },
        });
    }

    // Return updated reconciliation
    const updated = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
        include: reconciliationItemsInclude,
    });

    if (!updated) {
        return res.status(404).json({ error: 'Reconciliation not found after update' });
    }

    res.json({
        id: updated.id,
        status: updated.status,
        items: updated.items.map(item => ({
            id: item.id,
            skuId: item.skuId,
            skuCode: item.sku.skuCode,
            productName: item.sku.variation?.product?.name || '',
            colorName: item.sku.variation?.colorName || '',
            size: item.sku.size,
            systemQty: item.systemQty,
            physicalQty: item.physicalQty,
            variance: item.variance,
            adjustmentReason: item.adjustmentReason,
            notes: item.notes,
        })),
    });
}));

/**
 * POST /reconciliation/:id/submit
 * Submit reconciliation and create adjustment transactions
 */
router.post('/reconciliation/:id/submit', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
        include: reconciliationItemsInclude,
    });

    if (!reconciliation) {
        return res.status(404).json({ error: 'Reconciliation not found' });
    }

    if (reconciliation.status !== 'draft') {
        return res.status(400).json({ error: 'Reconciliation already submitted' });
    }

    // Collect all items with variances for batch processing
    const itemsToProcess: Array<{
        itemId: string;
        skuId: string;
        skuCode: string;
        txnType: 'inward' | 'outward';
        qty: number;
        reason: string;
        notes: string;
        adjustmentReason: string;
    }> = [];

    for (const item of reconciliation.items) {
        if (item.variance === null || item.variance === 0) continue;

        if (item.physicalQty === null) {
            return res.status(400).json({
                error: `Physical quantity not entered for ${item.sku.skuCode}`,
            });
        }

        const adjustmentReason = item.adjustmentReason || 'count_adjustment';
        const txnType = item.variance > 0 ? 'inward' : 'outward';
        const qty = Math.abs(item.variance);

        itemsToProcess.push({
            itemId: item.id,
            skuId: item.skuId,
            skuCode: item.sku.skuCode,
            txnType,
            qty,
            reason: `reconciliation_${adjustmentReason}`,
            notes: item.notes || `Reconciliation adjustment: ${adjustmentReason}`,
            adjustmentReason,
        });
    }

    console.log(`Reconciliation Submit: Processing ${itemsToProcess.length} adjustments...`);

    // Batch create all transactions in a single database transaction
    const transactions: Array<{
        skuId: string;
        skuCode: string;
        txnType: string;
        qty: number;
        reason: string;
    }> = [];
    const BATCH_SIZE = 100;

    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
        const batch = itemsToProcess.slice(i, i + BATCH_SIZE);

        await req.prisma.$transaction(async (tx) => {
            for (const item of batch) {
                const txn = await tx.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        txnType: item.txnType,
                        qty: item.qty,
                        reason: item.reason,
                        referenceId: reconciliation.id,
                        notes: item.notes,
                        createdById: req.user!.id,
                    },
                });

                // Link transaction to reconciliation item
                await tx.inventoryReconciliationItem.update({
                    where: { id: item.itemId },
                    data: { txnId: txn.id },
                });

                transactions.push({
                    skuId: item.skuId,
                    skuCode: item.skuCode,
                    txnType: item.txnType,
                    qty: item.qty,
                    reason: item.adjustmentReason,
                });
            }
        }, { timeout: 60000 }); // 60 second timeout for batch

        console.log(`Reconciliation Submit: Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(itemsToProcess.length / BATCH_SIZE)} complete`);
    }

    // Mark reconciliation as submitted
    await req.prisma.inventoryReconciliation.update({
        where: { id },
        data: { status: 'submitted' },
    });

    console.log(`Reconciliation Submit: Complete - ${transactions.length} adjustments created`);

    res.json({
        id: reconciliation.id,
        status: 'submitted',
        adjustmentsMade: transactions.length,
        // Limit response size - only return first 50 transactions
        transactions: transactions.slice(0, 50),
    });
}));

/**
 * DELETE /reconciliation/:id
 * Delete a draft reconciliation
 */
router.delete('/reconciliation/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
    });

    if (!reconciliation) {
        return res.status(404).json({ error: 'Reconciliation not found' });
    }

    if (reconciliation.status !== 'draft') {
        return res.status(400).json({ error: 'Cannot delete submitted reconciliation' });
    }

    await req.prisma.inventoryReconciliation.delete({
        where: { id },
    });

    res.json({ message: 'Reconciliation deleted' });
}));

/**
 * POST /reconciliation/:id/upload-csv
 * Upload CSV with physical counts to update reconciliation items
 * Expected format: SKU Code, Physical Qty
 */
router.post('/reconciliation/:id/upload-csv', authenticateToken, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const file = req.file as Express.Multer.File | undefined;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
        include: reconciliationItemsBasicInclude,
    });

    if (!reconciliation) {
        return res.status(404).json({ error: 'Reconciliation not found' });
    }

    if (reconciliation.status !== 'draft') {
        return res.status(400).json({ error: 'Cannot update submitted reconciliation' });
    }

    // Parse CSV - handle BOM
    let csvContent = file.buffer.toString('utf-8');
    if (csvContent.charCodeAt(0) === 0xFEFF) {
        csvContent = csvContent.slice(1);
    }

    // Debug: log file size and first few hundred chars
    console.log(`CSV Upload: File size ${file.buffer.length} bytes, content length ${csvContent.length} chars`);
    console.log(`CSV Upload: First 500 chars: ${JSON.stringify(csvContent.slice(0, 500))}`);

    // Count lines in raw content
    const rawLines = csvContent.split(/\r?\n/).filter(line => line.trim());
    console.log(`CSV Upload: Raw line count: ${rawLines.length}`);

    // Auto-detect delimiter by checking first line
    const firstLine = csvContent.split(/\r?\n/)[0] || '';
    let delimiter = ',';
    if (firstLine.includes('\t')) {
        delimiter = '\t';
    } else if (firstLine.includes(';') && !firstLine.includes(',')) {
        delimiter = ';';
    }

    let records: CSVRecord[];
    try {
        records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            delimiter,
        });
    } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parse error';
        return res.status(400).json({ error: `CSV parsing error: ${errorMessage}` });
    }

    // Log parsed column headers for debugging
    if (records.length > 0) {
        const columns = Object.keys(records[0]);
        console.log(`CSV Upload: Parsed ${records.length} rows with columns: ${columns.join(', ')}`);
    } else {
        console.log('CSV Upload: No records parsed from file');
    }

    // Build SKU code -> item mapping (case-insensitive)
    const skuMap = new Map<string, (typeof reconciliation.items)[number]>();
    for (const item of reconciliation.items) {
        skuMap.set(item.sku.skuCode.toLowerCase(), item);
    }

    const results: CSVUploadResults = {
        total: records.length,
        matched: 0,
        updated: 0,
        notFound: [],
        errors: [],
        delimiter: delimiter === '\t' ? 'tab' : delimiter,
        columns: records.length > 0 ? Object.keys(records[0]) : [],
        reconItemCount: reconciliation.items.length,
    };

    // Process each row - flexible column name matching
    for (const record of records) {
        const skuCode = (
            record['SKU Code'] ||
            record['skuCode'] ||
            record['sku_code'] ||
            record['SKU'] ||
            record['sku'] ||
            ''
        ).trim();

        const physicalQtyStr = (
            record['Physical Qty'] ||
            record['physicalQty'] ||
            record['physical_qty'] ||
            record['Qty'] ||
            record['qty'] ||
            record['Quantity'] ||
            record['quantity'] ||
            ''
        ).toString().trim();

        if (!skuCode) {
            results.errors.push({ record, error: 'Missing SKU Code' });
            continue;
        }

        const item = skuMap.get(skuCode.toLowerCase());
        if (!item) {
            results.notFound.push(skuCode);
            continue;
        }

        results.matched++;

        const physicalQty = parseInt(physicalQtyStr, 10);
        if (isNaN(physicalQty) || physicalQty < 0) {
            results.errors.push({ skuCode, error: 'Invalid physical quantity' });
            continue;
        }

        const variance = physicalQty - item.systemQty;

        // Collect updates for batch processing
        results.updates = results.updates || [];
        results.updates.push({
            id: item.id,
            physicalQty,
            variance,
        });
    }

    // Bulk update using raw SQL for performance
    if (results.updates && results.updates.length > 0) {
        console.log(`CSV Upload: Bulk updating ${results.updates.length} items...`);

        // Use VALUES clause for efficient bulk update
        const BATCH_SIZE = 1000;
        for (let i = 0; i < results.updates.length; i += BATCH_SIZE) {
            const batch = results.updates.slice(i, i + BATCH_SIZE);

            // Build VALUES list: ('id', physicalQty, variance), ...
            const values = batch.map(u =>
                `('${u.id}', ${u.physicalQty}, ${u.variance})`
            ).join(',');

            // Single UPDATE using FROM VALUES
            await req.prisma.$executeRawUnsafe(`
                UPDATE "InventoryReconciliationItem" AS t
                SET "physicalQty" = v.pq::integer, "variance" = v.var::integer
                FROM (VALUES ${values}) AS v(id, pq, var)
                WHERE t."id" = v.id
            `);

            console.log(`CSV Upload: Updated batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(results.updates.length / BATCH_SIZE)}`);
        }
        results.updated = results.updates.length;
        console.log(`CSV Upload: Bulk update complete`);
    }

    // Clean up internal field before response
    delete results.updates;

    // Log summary for debugging
    console.log(`CSV Upload Summary: ${results.total} rows, ${results.matched} matched, ${results.updated} updated, ${results.notFound.length} not found, ${results.errors.length} errors`);
    if (results.notFound.length > 0) {
        console.log(`CSV Upload: First 20 not found SKUs: ${results.notFound.slice(0, 20).join(', ')}`);
    }

    // Limit arrays in response to prevent frontend crash
    const responseResults = {
        ...results,
        notFoundCount: results.notFound.length,
        notFound: results.notFound.slice(0, 50), // Limit to first 50
        errorsCount: results.errors.length,
        errors: results.errors.slice(0, 20), // Limit to first 20
    };

    res.json({
        success: true,
        message: `Processed ${results.total} rows from CSV`,
        results: responseResults,
    });
}));

export default router;
