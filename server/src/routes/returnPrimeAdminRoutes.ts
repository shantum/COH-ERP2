/**
 * Return Prime Admin Routes
 *
 * Administrative endpoints for managing Return Prime local data sync.
 * - GET /api/returnprime/admin/sync-status - Get current sync status
 * - POST /api/returnprime/admin/sync - Trigger manual sync
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
    syncReturnPrimeRequests,
    getSyncStatus,
    getDetailedSyncStatus,
} from '../services/returnPrimeInboundSync.js';
import {
    importReturnPrimeCsvEnrichment,
    parseReturnPrimeCsvFromString,
    previewReturnPrimeCsvRows,
    importReturnPrimeCsvEnrichmentFromRows,
} from '../services/returnPrimeCsvEnrichment.js';
import {
    cleanReturnPrimeCsvCache,
    setReturnPrimeCsvCache,
    getReturnPrimeCsvCache,
    deleteReturnPrimeCsvCache,
} from './returnPrimeCsvCache.js';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
            return;
        }
        cb(new Error('Only CSV files are allowed'));
    },
});

// All routes require admin access
router.use(requireAdmin);

// ============================================
// INPUT SCHEMAS
// ============================================

const SyncOptionsSchema = z.object({
    dateFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    dateTo: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    fullSync: z.boolean().optional(),
});

const CsvEnrichmentImportSchema = z.object({
    csvPath: z.string().min(1),
    dryRun: z.boolean().optional().default(false),
    enrichOrderLines: z.boolean().optional().default(true),
});

const CsvEnrichmentExecuteSchema = z.object({
    cacheKey: z.string().min(1),
    enrichOrderLines: z.boolean().optional().default(true),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/returnprime/admin/sync-status
 *
 * Get the current sync status including:
 * - Total records in local database
 * - Last sync timestamp
 * - Date range of stored data
 * - Breakdown by type and status
 */
router.get('/sync-status', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const status = await getDetailedSyncStatus();
        res.json({
            success: true,
            data: status,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] Error getting sync status:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returnprime/admin/sync
 *
 * Trigger a manual sync from Return Prime API.
 *
 * Body options:
 * - dateFrom: YYYY-MM-DD (optional, defaults to last 30 days)
 * - dateTo: YYYY-MM-DD (optional, defaults to today)
 * - fullSync: boolean (optional, if true syncs 12 months of history)
 */
router.post('/sync', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const validation = SyncOptionsSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: validation.error.issues,
            });
            return;
        }

        const { dateFrom, dateTo, fullSync } = validation.data;

        console.log('[ReturnPrimeAdmin] Manual sync triggered:', { dateFrom, dateTo, fullSync });

        // Get status before sync
        const statusBefore = await getSyncStatus();

        // Run the sync
        const result = await syncReturnPrimeRequests({ dateFrom, dateTo, fullSync });

        // Get status after sync
        const statusAfter = await getSyncStatus();

        res.json({
            success: result.success,
            data: {
                ...result,
                statusBefore: {
                    totalRecords: statusBefore.totalRecords,
                    lastSyncedAt: statusBefore.lastSyncedAt?.toISOString() || null,
                },
                statusAfter: {
                    totalRecords: statusAfter.totalRecords,
                    lastSyncedAt: statusAfter.lastSyncedAt?.toISOString() || null,
                },
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] Error during sync:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * GET /api/returnprime/admin/sync-status/simple
 *
 * Get a simple sync status (faster, fewer queries)
 */
router.get('/sync-status/simple', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const status = await getSyncStatus();
        res.json({
            success: true,
            data: {
                totalRecords: status.totalRecords,
                lastSyncedAt: status.lastSyncedAt?.toISOString() || null,
                oldestRecord: status.oldestRecord?.toISOString() || null,
                newestRecord: status.newestRecord?.toISOString() || null,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] Error getting worker status:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returnprime/admin/csv-enrichment/import
 *
 * Upsert Return Prime CSV export data keyed by request number (RET/EXC serial),
 * then optionally enrich OrderLine fields where data is missing.
 */
router.post('/csv-enrichment/import', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const validation = CsvEnrichmentImportSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: validation.error.issues,
            });
            return;
        }

        const { csvPath, dryRun, enrichOrderLines } = validation.data;
        const result = await importReturnPrimeCsvEnrichment({
            csvPath,
            dryRun,
            enrichOrderLines,
        });

        res.json({
            success: true,
            data: result,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] CSV enrichment import failed:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returnprime/admin/csv-enrichment/preview-upload
 *
 * Upload CSV, parse it, and return a preview with create/update/unchanged counts.
 * Stores parsed rows in server cache for confirm step.
 */
router.post('/csv-enrichment/preview-upload', upload.single('file'), asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const file = req.file as Express.Multer.File | undefined;
        if (!file) {
            res.status(400).json({
                success: false,
                error: 'No file uploaded',
            });
            return;
        }

        const rawCsv = file.buffer.toString('utf-8');
        const parsed = parseReturnPrimeCsvFromString(rawCsv);
        const preview = await previewReturnPrimeCsvRows(parsed);

        cleanReturnPrimeCsvCache();
        const cacheKey = randomUUID();
        setReturnPrimeCsvCache(cacheKey, file.originalname, parsed);

        res.json({
            success: true,
            data: {
                cacheKey,
                sourceFile: file.originalname,
                ...preview,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] CSV enrichment preview failed:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

/**
 * POST /api/returnprime/admin/csv-enrichment/execute-import
 *
 * Confirm and execute the upsert using cached preview rows.
 */
router.post('/csv-enrichment/execute-import', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    try {
        const validation = CsvEnrichmentExecuteSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: validation.error.issues,
            });
            return;
        }

        const { cacheKey, enrichOrderLines } = validation.data;
        const cached = getReturnPrimeCsvCache(cacheKey);
        if (!cached) {
            res.status(400).json({
                success: false,
                error: 'Preview expired or not found. Please upload and preview the CSV again.',
            });
            return;
        }

        const result = await importReturnPrimeCsvEnrichmentFromRows({
            rows: cached.rows,
            sourceFile: cached.sourceFile,
            parsedRows: cached.parsed.parsedRows,
            skippedRows: cached.parsed.skippedRows,
            duplicateRequestNumbers: cached.parsed.duplicateRequestNumbers,
            enrichOrderLines,
            dryRun: false,
        });

        deleteReturnPrimeCsvCache(cacheKey);

        res.json({
            success: true,
            data: result,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ReturnPrimeAdmin] CSV enrichment execute import failed:', message);
        res.status(500).json({
            success: false,
            error: message,
        });
    }
}));

export default router;
