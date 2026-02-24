/**
 * Query routes for COD remittance data (pending, summary, failed, history)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router: Router = Router();

/**
 * Get COD orders awaiting remittance (delivered, COD, not yet remitted)
 * @route GET /api/remittance/pending?limit=100
 * @param {number} [query.limit=100] - Max orders
 * @returns {Object} { orders: [{ id, orderNumber, customerName, totalAmount, deliveredAt, awbNumber, courier }], total, pendingAmount }
 */
router.get('/pending', asyncHandler(async (req: Request, res: Response) => {
    const { limit = 100 } = req.query;

    // Find COD orders where ALL lines are delivered and not yet remitted
    const orders = await req.prisma.order.findMany({
        where: {
            paymentMethod: 'COD',
            codRemittedAt: null,
            isArchived: false,
            // All lines must be delivered
            orderLines: {
                every: {
                    OR: [
                        { trackingStatus: 'delivered' },
                        { lineStatus: 'cancelled' }
                    ]
                },
                some: {
                    trackingStatus: 'delivered'
                }
            }
        },
        select: {
            id: true,
            orderNumber: true,
            customerName: true,
            totalAmount: true,
            orderLines: {
                select: {
                    deliveredAt: true,
                    awbNumber: true,
                    courier: true,
                },
                where: { trackingStatus: 'delivered' },
                take: 1
            }
        },
        orderBy: { orderDate: 'asc' },
        take: Number(limit),
    });

    const total = await req.prisma.order.count({
        where: {
            paymentMethod: 'COD',
            codRemittedAt: null,
            isArchived: false,
            orderLines: {
                every: {
                    OR: [
                        { trackingStatus: 'delivered' },
                        { lineStatus: 'cancelled' }
                    ]
                },
                some: {
                    trackingStatus: 'delivered'
                }
            }
        },
    });

    // Flatten to include line-level tracking data
    const flattenedOrders = orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        totalAmount: o.totalAmount,
        deliveredAt: o.orderLines[0]?.deliveredAt || null,
        awbNumber: o.orderLines[0]?.awbNumber || null,
        courier: o.orderLines[0]?.courier || null,
    }));

    res.json({
        orders: flattenedOrders,
        total,
        pendingAmount: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
    });
}));

/**
 * Get remittance summary stats
 * @route GET /api/remittance/summary?days=30
 * @param {number} [query.days=30] - Period for 'paid' stats
 * @returns {Object} { pending: { count, amount }, paid: { count, amount, periodDays }, processedRange: { earliest, latest } }
 */
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
    const { days = 30 } = req.query;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - Number(days));

    // Get counts - use line-level trackingStatus
    const deliveredCodWhere = {
        paymentMethod: 'COD',
        codRemittedAt: null,
        isArchived: false,
        orderLines: {
            every: {
                OR: [
                    { trackingStatus: 'delivered' },
                    { lineStatus: 'cancelled' }
                ]
            },
            some: {
                trackingStatus: 'delivered'
            }
        }
    };

    const [pendingCount, paidCount, pendingAmount, paidAmount] = await Promise.all([
        req.prisma.order.count({
            where: deliveredCodWhere,
        }),
        req.prisma.order.count({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { gte: fromDate },
            },
        }),
        req.prisma.order.aggregate({
            where: deliveredCodWhere,
            _sum: { totalAmount: true },
        }),
        req.prisma.order.aggregate({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { gte: fromDate },
            },
            _sum: { codRemittedAmount: true },
        }),
    ]);

    // Get processed date range from SystemSetting
    const [earliestSetting, latestSetting] = await Promise.all([
        req.prisma.systemSetting.findUnique({ where: { key: 'cod_remittance_earliest_date' } }),
        req.prisma.systemSetting.findUnique({ where: { key: 'cod_remittance_latest_date' } }),
    ]);

    res.json({
        pending: {
            count: pendingCount,
            amount: pendingAmount._sum?.totalAmount || 0,
        },
        paid: {
            count: paidCount,
            amount: paidAmount._sum?.codRemittedAmount || 0,
            periodDays: Number(days),
        },
        processedRange: {
            earliest: earliestSetting?.value || null,
            latest: latestSetting?.value || null,
        },
    });
}));

/**
 * Get orders with failed/pending Shopify sync
 * @route GET /api/remittance/failed?limit=100
 * @param {number} [query.limit=100] - Max orders
 * @returns {Object} { orders: [...], counts: { failed, pending, manual_review }, total }
 */
router.get('/failed', asyncHandler(async (req: Request, res: Response) => {
    const { limit = 100 } = req.query;

    const orders = await req.prisma.order.findMany({
        where: {
            paymentMethod: 'COD',
            codRemittedAt: { not: null },
            codShopifySyncStatus: { in: ['failed', 'pending', 'manual_review'] },
        },
        select: {
            id: true,
            orderNumber: true,
            shopifyOrderId: true,
            customerName: true,
            totalAmount: true,
            codRemittedAt: true,
            codRemittanceUtr: true,
            codRemittedAmount: true,
            codShopifySyncStatus: true,
            codShopifySyncError: true,
        },
        orderBy: { codRemittedAt: 'desc' },
        take: Number(limit),
    });

    const counts = await req.prisma.order.groupBy({
        by: ['codShopifySyncStatus'],
        where: {
            paymentMethod: 'COD',
            codRemittedAt: { not: null },
            codShopifySyncStatus: { in: ['failed', 'pending', 'manual_review'] },
        },
        _count: true,
    });

    const statusCounts: Record<string, number> = {};
    for (const c of counts) {
        if (c.codShopifySyncStatus) {
            statusCounts[c.codShopifySyncStatus] = c._count;
        }
    }

    res.json({
        orders,
        counts: statusCounts,
        total: orders.length,
    });
}));

/**
 * Get remittance history with aggregated totals
 * @route GET /api/remittance/history?days=30
 * @param {number} [query.days=30] - Period
 * @returns {Object} { remittances, totals }
 */
router.get('/history', asyncHandler(async (req: Request, res: Response) => {
    const days = Number(req.query.days) || 30;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const remittances = await req.prisma.codRemittance.findMany({
        where: { remittanceDate: { gte: fromDate } },
        orderBy: { remittanceDate: 'desc' },
    });

    // Aggregate totals
    const totals = remittances.reduce(
        (acc, r) => ({
            codGenerated: acc.codGenerated + r.codGenerated,
            codRemitted: acc.codRemitted + r.codRemitted,
            transactionCharges: acc.transactionCharges + r.transactionCharges,
            transactionGstCharges: acc.transactionGstCharges + r.transactionGstCharges,
            orderCount: acc.orderCount + r.orderCount,
            ordersProcessed: acc.ordersProcessed + r.ordersProcessed,
            bankMatched: acc.bankMatched + (r.bankTransactionId ? 1 : 0),
        }),
        {
            codGenerated: 0,
            codRemitted: 0,
            transactionCharges: 0,
            transactionGstCharges: 0,
            orderCount: 0,
            ordersProcessed: 0,
            bankMatched: 0,
        },
    );

    res.json({ remittances, totals, days });
}));

export default router;
