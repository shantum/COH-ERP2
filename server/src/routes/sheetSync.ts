/**
 * Sheet Sync Routes
 *
 * Admin-only endpoints for syncing ERP state from Google Sheets.
 * Supports both CSV file upload and direct Google Sheets URL fetch.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
    extractSheetId,
    fetchOrdersAndInventoryCsv,
} from '../services/googleSheetsFetcher.js';
import {
    planSync,
    executeSync,
    getJob,
    getRecentJobs,
} from '../services/sheetSyncService.js';

const router = Router();

// Multer config: memory storage, 10MB limit
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

const fileFields = upload.fields([
    { name: 'ordersFile', maxCount: 1 },
    { name: 'inventoryFile', maxCount: 1 },
]);

// ============================================
// POST /plan — Parse CSVs and run all plan functions
// ============================================

router.post('/plan', requireAdmin, fileFields, asyncHandler(async (req: Request, res: Response) => {
    let ordersCsv: string;
    let inventoryCsv: string;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    if (files && files['ordersFile'] && files['inventoryFile']) {
        // File upload mode
        ordersCsv = files['ordersFile'][0].buffer.toString('utf-8');
        inventoryCsv = files['inventoryFile'][0].buffer.toString('utf-8');
    } else if (req.body.sheetId) {
        // Google Sheets mode
        const sheetId = extractSheetId(req.body.sheetId);
        const result = await fetchOrdersAndInventoryCsv({
            sheetId,
            ordersGid: req.body.ordersGid || '0',
            inventoryGid: req.body.inventoryGid || '1',
        });
        ordersCsv = result.ordersCsv;
        inventoryCsv = result.inventoryCsv;
    } else {
        res.status(400).json({
            error: 'Provide either file uploads (ordersFile + inventoryFile) or a sheetId in the request body.',
        });
        return;
    }

    const userId = req.user!.id;
    const job = await planSync(req.prisma, ordersCsv, inventoryCsv, userId);

    res.json({ success: true, job });
}));

// ============================================
// POST /execute — Start background execution
// ============================================

router.post('/execute', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.body;

    if (!jobId || typeof jobId !== 'string') {
        res.status(400).json({ error: 'jobId is required' });
        return;
    }

    const job = getJob(jobId);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }

    if (job.userId !== req.user!.id) {
        res.status(403).json({ error: 'You can only execute your own sync jobs' });
        return;
    }

    executeSync(req.prisma, jobId);

    res.json({ success: true, jobId });
}));

// ============================================
// GET /status — Poll job progress
// ============================================

router.get('/status', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const jobId = req.query.jobId as string;

    if (!jobId) {
        // Return recent jobs list
        const recent = getRecentJobs();
        res.json({ success: true, jobs: recent });
        return;
    }

    const job = getJob(jobId);
    if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
    }

    res.json({ success: true, job });
}));

export default router;
