/**
 * Razorpay Prepaid Settlement Routes
 *
 * Upload Razorpay settlement CSV reports, preview parsed data, and confirm reconciliation.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import logger from '../utils/logger.js';
import { parseRazorpayReport } from '../services/razorpaySettlement/parseRazorpayReport.js';
import { previewReport, confirmReport } from '../services/razorpaySettlement/reconcile.js';
// prisma accessed via req.prisma (request-scoped)

const log = logger.child({ module: 'razorpaySettlement' });
const router = Router();

// ============================================
// MULTER CONFIG — CSV only, memory storage, 10MB limit
// ============================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are allowed'));
    }
  },
});

// ============================================
// POST /upload-preview — Parse report and return preview
// ============================================

router.post('/upload-preview', requireAdmin, upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  log.info({ fileName: req.file.originalname, size: req.file.size }, 'Razorpay settlement upload received');

  const csvContent = req.file.buffer.toString('utf-8');
  const parsed = parseRazorpayReport(csvContent);
  const preview = await previewReport(parsed, req.file.originalname);

  log.info({ fileName: req.file.originalname, lineItems: parsed.lines.length }, 'Razorpay settlement report parsed');
  res.json({ success: true, ...preview });
}));

// ============================================
// POST /confirm/:reportId — Confirm and reconcile a previewed report
// ============================================

router.post('/confirm/:reportId', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { reportId } = req.params;
  if (!reportId) {
    res.status(400).json({ error: 'Report ID is required' });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId: string = (req as any).user.id;
  log.info({ reportId, userId }, 'Confirming Razorpay settlement report');

  const result = await confirmReport(reportId as string, userId);

  log.info({ reportId, revenueInvoiceId: result.revenueInvoiceId }, 'Razorpay settlement report confirmed');
  res.json({ success: true, ...result });
}));

// ============================================
// GET /reports — List all Razorpay settlement reports
// ============================================

router.get('/reports', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const reports = await req.prisma.marketplacePayoutReport.findMany({
    where: { marketplace: 'razorpay' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      marketplace: true,
      fileName: true,
      reportPeriod: true,
      grossRevenue: true,
      netPayout: true,
      status: true,
      createdAt: true,
      revenueInvoiceId: true,
      commissionInvoiceId: true,
    },
  });

  res.json(reports);
}));

export default router;
