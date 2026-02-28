/**
 * Inventory Reconciliation Routes (Express)
 *
 * CSV upload endpoint only - requires multer for multipart/form-data handling.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { reconciliationLogger } from '../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

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
// MULTER CONFIGURATION
// ============================================

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
// CSV UPLOAD ENDPOINT
// ============================================

/**
 * POST /reconciliation/:id/upload-csv
 * Upload CSV with physical counts to update reconciliation items
 * Expected format: SKU Code, Physical Qty
 *
 * This endpoint requires multer middleware for multipart/form-data handling,
 * which is why it remains in Express rather than tRPC.
 */
router.post('/reconciliation/:id/upload-csv', authenticateToken, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const file = req.file as Express.Multer.File | undefined;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const reconciliation = await req.prisma.inventoryReconciliation.findUnique({
        where: { id },
        include: {
            items: {
                include: { sku: true },
            },
        },
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
    reconciliationLogger.debug({ fileSize: file.buffer.length, contentLength: csvContent.length }, 'CSV file received');

    // Count lines in raw content
    const rawLines = csvContent.split(/\r?\n/).filter(line => line.trim());
    reconciliationLogger.debug({ rawLineCount: rawLines.length }, 'CSV raw line count');

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
        console.error('[inventory-reconciliation] CSV parse error:', parseError);
        return res.status(400).json({ error: `CSV parsing error: ${errorMessage}` });
    }

    // Log parsed column headers for debugging
    if (records.length > 0) {
        const columns = Object.keys(records[0]);
        reconciliationLogger.debug({ recordCount: records.length, columns }, 'CSV parsed');
    } else {
        reconciliationLogger.debug('No records parsed from CSV file');
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
        reconciliationLogger.debug({ count: results.updates.length }, 'CSV bulk updating items');

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

            reconciliationLogger.debug({ batch: Math.floor(i / BATCH_SIZE) + 1, totalBatches: Math.ceil(results.updates.length / BATCH_SIZE) }, 'CSV batch updated');
        }
        results.updated = results.updates.length;
        reconciliationLogger.debug('CSV bulk update complete');
    }

    // Clean up internal field before response
    delete results.updates;

    // Log summary for debugging
    reconciliationLogger.info({
        total: results.total,
        matched: results.matched,
        updated: results.updated,
        notFound: results.notFound.length,
        errors: results.errors.length
    }, 'CSV upload complete');
    if (results.notFound.length > 0) {
        reconciliationLogger.debug({ notFoundSkus: results.notFound.slice(0, 20) }, 'CSV SKUs not found');
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
