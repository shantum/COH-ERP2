/**
 * PayU Settlement Routes
 *
 * Admin-only endpoints for PayU settlement sync, status, backfill, and history.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import payuSettlementSync from '../services/payuSettlementSync.js';
import payuClient from '../services/payuClient.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAdmin } from '../middleware/auth.js';

const router: Router = Router();

router.use(requireAdmin);

// ============================================
// VALIDATION SCHEMAS
// ============================================

const backfillSchema = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
}).refine(d => d.startDate <= d.endDate, { message: 'startDate must be before endDate' })
  .refine(d => {
      const diffDays = (Date.parse(d.endDate) - Date.parse(d.startDate)) / 86400000;
      return diffDays <= 365;
  }, { message: 'Date range cannot exceed 365 days' });

const credentialsSchema = z.object({
    key: z.string().min(1).optional(),
    salt: z.string().min(1).optional(),
    mid: z.string().min(1).optional(),
}).refine(d => d.key || d.salt || d.mid, { message: 'Provide at least one of: key, salt, mid' });

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/payu-settlement/sync-status
 * Worker status + recent PayuSettlement records
 */
router.get('/sync-status', asyncHandler(async (req: Request, res: Response) => {
    const status = payuSettlementSync.getStatus();

    const recentSettlements = await req.prisma.payuSettlement.findMany({
        orderBy: { settlementCompletedDate: 'desc' },
        take: 10,
    });

    res.json({ status, recentSettlements });
}));

/**
 * POST /api/payu-settlement/trigger-sync
 * Manually trigger PayU settlement sync (fire-and-forget)
 */
router.post('/trigger-sync', asyncHandler(async (_req: Request, res: Response) => {
    payuSettlementSync.triggerSync().catch((err) => console.error('[payuSettlement] Trigger sync failed:', err));
    res.json({ success: true, message: 'PayU settlement sync triggered. Check /sync-status for progress.' });
}));

/**
 * POST /api/payu-settlement/backfill
 * Backfill settlements for a date range (fire-and-forget)
 * Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
 */
router.post('/backfill', asyncHandler(async (req: Request, res: Response) => {
    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
    }
    const { startDate, endDate } = parsed.data;
    payuSettlementSync.triggerBackfill(startDate, endDate).catch((err) => console.error('[payuSettlement] Trigger backfill failed:', err));
    res.json({ success: true, message: `PayU backfill triggered for ${startDate} to ${endDate}. Check /sync-status for progress.` });
}));

/**
 * GET /api/payu-settlement/history?days=30
 * All settlements for period with aggregated totals
 */
router.get('/history', asyncHandler(async (req: Request, res: Response) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const settlements = await req.prisma.payuSettlement.findMany({
        where: { settlementCompletedDate: { gte: fromDate } },
        orderBy: { settlementCompletedDate: 'desc' },
    });

    const totals = settlements.reduce(
        (acc, s) => ({
            settlementAmount: acc.settlementAmount + s.settlementAmount,
            transactionCount: acc.transactionCount + s.transactionCount,
            bankMatched: acc.bankMatched + (s.bankTransactionId ? 1 : 0),
        }),
        { settlementAmount: 0, transactionCount: 0, bankMatched: 0 },
    );

    res.json({ settlements, totals, days });
}));

/**
 * POST /api/payu-settlement/save-credentials
 * Save PayU API credentials
 * Body: { key?: string, salt?: string, mid?: string }
 */
router.post('/save-credentials', asyncHandler(async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
    }
    await payuClient.saveCredentials(parsed.data);
    res.json({ success: true, message: 'PayU credentials saved' });
}));

export default router;
