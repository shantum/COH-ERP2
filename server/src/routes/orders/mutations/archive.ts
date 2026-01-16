/**
 * Archive Operations
 * Archive, unarchive, auto-archive, and release workflow
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { NotFoundError, ValidationError, BusinessLogicError } from '../../../utils/errors.js';
import { recalculateAllCustomerLtvs } from '../../../utils/tierUtils.js';
import { orderLogger } from '../../../utils/logger.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface ArchiveBeforeDateBody {
    beforeDate: string;
    status?: string;
}

// ============================================
// HELPER FUNCTION
// ============================================

function getParamString(param: string | string[] | undefined): string {
    if (Array.isArray(param)) return param[0];
    return param ?? '';
}

// ============================================
// ARCHIVE OPERATIONS
// ============================================

// Archive order
router.post(
    '/:id/archive',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, orderNumber: true, isArchived: true, status: true },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (order.isArchived) {
            throw new BusinessLogicError('Order is already archived', 'ALREADY_ARCHIVED');
        }

        // Only terminal states can be archived
        const terminalStatuses = ['shipped', 'delivered', 'cancelled'];
        if (!terminalStatuses.includes(order.status)) {
            throw new BusinessLogicError(
                `Order must be in a terminal state to archive (current: ${order.status})`,
                'INVALID_STATUS_FOR_ARCHIVE'
            );
        }

        const updated = await req.prisma.order.update({
            where: { id: orderId },
            data: {
                status: 'archived',
                isArchived: true,
                archivedAt: new Date(),
            },
            include: { orderLines: true },
        });

        orderLogger.info({ orderNumber: order.orderNumber }, 'Order manually archived');
        res.json(updated);
    })
);

// Unarchive order
router.post(
    '/:id/unarchive',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const orderId = getParamString(req.params.id);
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (!order.isArchived) {
            throw new BusinessLogicError('Order is not archived', 'NOT_ARCHIVED');
        }

        const updated = await req.prisma.order.update({
            where: { id: orderId },
            data: {
                isArchived: false,
                archivedAt: null,
            },
            include: { orderLines: true },
        });

        res.json(updated);
    })
);

/**
 * Auto-archive orders based on terminal status (Zen Philosophy)
 *
 * Rules:
 * - Prepaid delivered: Archive after 15 days from terminalAt
 * - COD delivered: Archive after 15 days from terminalAt (only if remitted)
 * - RTO received: Archive after 15 days from terminalAt
 * - Cancelled: Archive after 1 day from terminalAt
 * - Legacy: Also archive shipped orders >90 days (backward compat)
 */
export async function autoArchiveOldOrders(prisma: PrismaClient): Promise<number> {
    try {
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const now = new Date();
        let totalArchived = 0;

        // 1. Archive delivered prepaid orders (15 days)
        const prepaidResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'delivered',
                paymentMethod: { not: 'COD' },
                terminalAt: { lt: fifteenDaysAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += prepaidResult.count;

        // 2. Archive delivered COD orders (15 days, only if remitted)
        const codResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'delivered',
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
                terminalAt: { lt: fifteenDaysAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += codResult.count;

        // 3. Archive RTO received orders (15 days)
        const rtoResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'rto_received',
                terminalAt: { lt: fifteenDaysAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += rtoResult.count;

        // 4. Archive cancelled orders (1 day grace)
        const cancelledResult = await prisma.order.updateMany({
            where: {
                terminalStatus: 'cancelled',
                terminalAt: { lt: oneDayAgo },
                isArchived: false,
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += cancelledResult.count;

        // 5. Legacy: Archive shipped orders >90 days (backward compat for orders without terminalStatus)
        const legacyResult = await prisma.order.updateMany({
            where: {
                status: 'shipped',
                terminalStatus: null,
                isArchived: false,
                shippedAt: { lt: ninetyDaysAgo },
            },
            data: {
                isArchived: true,
                archivedAt: now,
            },
        });
        totalArchived += legacyResult.count;

        if (totalArchived > 0) {
            orderLogger.info({
                total: totalArchived,
                prepaid: prepaidResult.count,
                cod: codResult.count,
                rto: rtoResult.count,
                cancelled: cancelledResult.count,
                legacy: legacyResult.count
            }, 'Auto-archive completed');
        }

        return totalArchived;
    } catch (error) {
        orderLogger.error({ error: (error as Error).message }, 'Auto-archive error');
        return 0;
    }
}

// Manual trigger for auto-archive (admin endpoint)
router.post(
    '/auto-archive',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const count = await autoArchiveOldOrders(req.prisma);
        res.json({ message: `Archived ${count} orders`, count });
    })
);

// Archive orders before a specific date
router.post(
    '/archive-before-date',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const { beforeDate, status } = req.body as ArchiveBeforeDateBody;
        if (!beforeDate) {
            throw new ValidationError('beforeDate is required (ISO format)');
        }

        const cutoffDate = new Date(beforeDate);

        const where: Prisma.OrderWhereInput = {
            orderDate: { lt: cutoffDate },
            isArchived: false,
        };

        if (status) {
            where.status = status;
        }

        const result = await req.prisma.order.updateMany({
            where,
            data: {
                isArchived: true,
                status: 'archived',
                archivedAt: new Date(),
            },
        });

        res.json({
            message: `Archived ${result.count} orders before ${beforeDate}`,
            count: result.count,
        });
    })
);

// Archive delivered orders (prepaid and paid COD)
router.post(
    '/archive-delivered-prepaid',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const prepaidOrders = await req.prisma.order.findMany({
            where: {
                trackingStatus: 'delivered',
                paymentMethod: 'Prepaid',
                status: { in: ['shipped', 'delivered'] },
                isArchived: false,
            },
            select: {
                id: true,
                orderNumber: true,
                paymentMethod: true,
                deliveredAt: true,
                shippedAt: true,
            },
        });

        const codOrders = await req.prisma.order.findMany({
            where: {
                trackingStatus: 'delivered',
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
                status: { in: ['shipped', 'delivered'] },
                isArchived: false,
            },
            select: {
                id: true,
                orderNumber: true,
                paymentMethod: true,
                deliveredAt: true,
                shippedAt: true,
                codRemittedAt: true,
            },
        });

        const ordersToArchive = [...prepaidOrders, ...codOrders];

        if (ordersToArchive.length === 0) {
            res.json({
                message: 'No delivered orders ready to archive',
                archived: 0,
                prepaid: 0,
                cod: 0,
            });
            return;
        }

        const result = await req.prisma.order.updateMany({
            where: {
                id: { in: ordersToArchive.map((o) => o.id) },
            },
            data: {
                status: 'archived',
                isArchived: true,
                archivedAt: new Date(),
            },
        });

        const deliveryStats = ordersToArchive
            .filter((o) => o.deliveredAt && o.shippedAt)
            .map((o) => {
                const daysToDeliver = Math.ceil(
                    (new Date(o.deliveredAt!).getTime() - new Date(o.shippedAt!).getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return { orderNumber: o.orderNumber, paymentMethod: o.paymentMethod, daysToDeliver };
            });

        const avgDaysToDeliver =
            deliveryStats.length > 0
                ? (deliveryStats.reduce((sum, s) => sum + s.daysToDeliver, 0) / deliveryStats.length).toFixed(
                    1
                )
                : null;

        orderLogger.info({
            archived: result.count,
            prepaid: prepaidOrders.length,
            cod: codOrders.length,
            avgDaysToDeliver
        }, 'Auto-archive before-date completed');

        res.json({
            message: `Archived ${result.count} delivered orders`,
            archived: result.count,
            prepaid: prepaidOrders.length,
            cod: codOrders.length,
            avgDaysToDeliver,
            deliveryStats: deliveryStats.slice(0, 10),
        });
    })
);

// ============================================
// RELEASE WORKFLOW
// ============================================

/**
 * Release shipped orders to the shipped view
 * Shipped orders stay in open view until explicitly released
 */
router.post(
    '/release-to-shipped',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const { orderIds } = req.body as { orderIds?: string[] };

        // Build where clause - either specific orders or all unreleased shipped orders
        const whereClause: Prisma.OrderWhereInput = {
            releasedToShipped: false,
            // Only release orders where all non-cancelled lines are shipped
            NOT: {
                orderLines: {
                    some: {
                        lineStatus: { notIn: ['shipped', 'cancelled'] },
                    },
                },
            },
            // Must have at least one shipped line
            orderLines: {
                some: { lineStatus: 'shipped' },
            },
        };

        if (orderIds && orderIds.length > 0) {
            whereClause.id = { in: orderIds };
        }

        const result = await req.prisma.order.updateMany({
            where: whereClause,
            data: { releasedToShipped: true },
        });

        orderLogger.info({ orderIds, count: result.count }, 'Released orders to shipped');
        res.json({
            message: `Released ${result.count} orders to shipped view`,
            count: result.count,
        });
    })
);

/**
 * Release cancelled orders to the cancelled view
 * Cancelled orders stay in open view until explicitly released
 */
router.post(
    '/release-to-cancelled',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const { orderIds } = req.body as { orderIds?: string[] };

        // Build where clause - either specific orders or all unreleased cancelled orders
        const whereClause: Prisma.OrderWhereInput = {
            releasedToCancelled: false,
            // Only release orders where all lines are cancelled
            NOT: {
                orderLines: {
                    some: {
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
            // Must have at least one cancelled line
            orderLines: {
                some: { lineStatus: 'cancelled' },
            },
        };

        if (orderIds && orderIds.length > 0) {
            whereClause.id = { in: orderIds };
        }

        const result = await req.prisma.order.updateMany({
            where: whereClause,
            data: { releasedToCancelled: true },
        });

        orderLogger.info({ orderIds, count: result.count }, 'Released orders to cancelled');
        res.json({
            message: `Released ${result.count} orders to cancelled view`,
            count: result.count,
        });
    })
);

/**
 * Fix orders incorrectly marked as cancelled
 * Restores orders with status='cancelled' back to 'open' status
 */
router.post(
    '/fix-cancelled-status',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const result = await req.prisma.order.updateMany({
            where: {
                status: 'cancelled',
                terminalStatus: 'cancelled',
                isArchived: false,
            },
            data: {
                status: 'open',
                terminalStatus: null,
                terminalAt: null,
            },
        });

        orderLogger.info({ count: result.count }, 'Fixed cancelled orders');
        res.json({
            message: `Restored ${result.count} orders to open status`,
            count: result.count,
        });
    })
);

// ============================================
// BACKFILL UTILITIES
// ============================================

/**
 * Backfill all customer LTVs from orders
 * Run once after adding ltv field to Customer
 */
router.post(
    '/backfill-customer-ltvs',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const result = await recalculateAllCustomerLtvs(req.prisma);
        res.json({
            message: `Recalculated LTV for ${result.updated} customers`,
            ...result,
        });
    })
);

export default router;
