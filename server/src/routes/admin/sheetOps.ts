import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import sheetOffloadWorker from '../../services/sheetOffload/index.js';

const router = Router();

/**
 * Get sheet offload worker status including pending buffer counts
 * @route GET /api/admin/sheet-offload/status
 */
router.get('/sheet-offload/status', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const status = sheetOffloadWorker.getStatus();
    const bufferCounts = await sheetOffloadWorker.getBufferCounts();

    res.json({
        ingestInward: status.ingestInward,
        ingestOutward: status.ingestOutward,
        moveShipped: status.moveShipped,
        cleanupDone: status.cleanupDone,
        migrateFormulas: status.migrateFormulas,
        pushBalances: status.pushBalances,
        schedulerActive: status.schedulerActive,
        bufferCounts,
    });
}));

/**
 * Get cycle progress for the real-time CLI modal
 * @route GET /api/admin/sheet-offload/cycle-progress
 */
router.get('/sheet-offload/cycle-progress', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    res.json(sheetOffloadWorker.getCycleProgress());
}));

/**
 * Manually trigger ingest inward
 * @route POST /api/admin/sheet-offload/trigger
 * @deprecated Use /api/admin/background-jobs/ingest_inward/trigger instead
 */
router.post('/sheet-offload/trigger', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const inwardResult = await sheetOffloadWorker.triggerIngestInward();
    const outwardResult = await sheetOffloadWorker.triggerIngestOutward();

    res.json({
        message: 'Sheet offload sync completed',
        inwardResult,
        outwardResult,
    });
}));

// ============================================
// SHEET MONITOR — INVENTORY & INGESTION STATS
// ============================================

/**
 * Get sheet monitor stats: inventory totals, ingestion counts, recent sheet transactions
 * @route GET /api/admin/sheet-monitor/stats
 */
router.get('/sheet-monitor/stats', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const prisma = req.prisma;

    const [
        totalSkus,
        balanceAgg,
        inStockCount,
        inwardLiveCount,
        outwardLiveCount,
        historicalInwardCount,
        historicalOutwardCount,
        recentTransactions,
    ] = await Promise.all([
        prisma.sku.count(),
        prisma.sku.aggregate({ _sum: { currentBalance: true } }),
        prisma.sku.count({ where: { currentBalance: { gt: 0 } } }),
        prisma.inventoryTransaction.count({ where: { referenceId: { startsWith: 'sheet:inward-live' } } }),
        prisma.inventoryTransaction.count({ where: { referenceId: { startsWith: 'sheet:outward-live' } } }),
        prisma.inventoryTransaction.count({
            where: {
                OR: [
                    { referenceId: { startsWith: 'sheet:inward-final' } },
                    { referenceId: { startsWith: 'sheet:inward-archive' } },
                ],
            },
        }),
        prisma.inventoryTransaction.count({
            where: {
                OR: [
                    { referenceId: { startsWith: 'sheet:outward:' } },
                    { referenceId: { startsWith: 'sheet:ms-outward' } },
                    { referenceId: { startsWith: 'sheet:orders-outward' } },
                ],
            },
        }),
        prisma.inventoryTransaction.findMany({
            where: {
                OR: [
                    { referenceId: { startsWith: 'sheet:inward-live' } },
                    { referenceId: { startsWith: 'sheet:outward-live' } },
                ],
            },
            select: {
                id: true,
                txnType: true,
                qty: true,
                reason: true,
                referenceId: true,
                createdAt: true,
                sku: { select: { skuCode: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        }),
    ]);

    res.json({
        inventory: {
            totalSkus,
            totalBalance: balanceAgg._sum.currentBalance ?? 0,
            inStock: inStockCount,
            outOfStock: totalSkus - inStockCount,
        },
        ingestion: {
            totalInwardLive: inwardLiveCount,
            totalOutwardLive: outwardLiveCount,
            historicalInward: historicalInwardCount,
            historicalOutward: historicalOutwardCount,
        },
        recentTransactions: recentTransactions.map(t => ({
            id: t.id,
            skuCode: t.sku.skuCode,
            txnType: t.txnType,
            quantity: t.qty,
            reason: t.reason,
            referenceId: t.referenceId,
            createdAt: t.createdAt.toISOString(),
        })),
    });
}));

export default router;
