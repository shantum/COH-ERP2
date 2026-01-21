/**
 * Archive Operations
 * Archive, unarchive, auto-archive, and release workflow
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { authenticateToken } from '../../../middleware/auth.js';
import { asyncHandler } from '../../../middleware/asyncHandler.js';
import { NotFoundError, ValidationError } from '../../../utils/errors.js';
import { recalculateAllCustomerLtvs } from '../../../utils/tierUtils.js';
import { orderLogger } from '../../../utils/logger.js';
import { enforceRulesInExpress } from '../../../rules/index.js';
import {
    ARCHIVE_TERMINAL_DAYS,
    ARCHIVE_CANCELLED_DAYS,
    AUTO_ARCHIVE_DAYS,
} from '../../../config/index.js';

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

        // Enforce archive rules using rules engine
        await enforceRulesInExpress('archiveOrder', req, {
            data: { order },
            phase: 'pre',
        });

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

        // Enforce unarchive rules using rules engine
        await enforceRulesInExpress('unarchiveOrder', req, {
            data: { order },
            phase: 'pre',
        });

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
 * Auto-archive orders based on terminal status (derived from OrderLines)
 *
 * Thresholds defined in: config/thresholds/orderTiming.ts
 *
 * An order is "terminal" when ALL lines are in terminal state:
 * - delivered: All lines have trackingStatus = 'delivered'
 * - rto_received: All lines have trackingStatus = 'rto_delivered' (rtoReceivedAt set)
 * - cancelled: All lines have lineStatus = 'cancelled'
 *
 * Rules:
 * - Prepaid delivered: Archive after ARCHIVE_TERMINAL_DAYS from last line deliveredAt
 * - COD delivered: Archive after ARCHIVE_TERMINAL_DAYS from last line deliveredAt (only if remitted)
 * - RTO received: Archive after ARCHIVE_TERMINAL_DAYS from last line rtoReceivedAt
 * - Cancelled: Archive after ARCHIVE_CANCELLED_DAYS from last line cancelledAt
 * - Legacy: Archive shipped orders after AUTO_ARCHIVE_DAYS (backward compat)
 */
export async function autoArchiveOldOrders(prisma: PrismaClient): Promise<number> {
    try {
        const terminalCutoff = new Date();
        terminalCutoff.setDate(terminalCutoff.getDate() - ARCHIVE_TERMINAL_DAYS);

        const cancelledCutoff = new Date();
        cancelledCutoff.setDate(cancelledCutoff.getDate() - ARCHIVE_CANCELLED_DAYS);

        const legacyCutoff = new Date();
        legacyCutoff.setDate(legacyCutoff.getDate() - AUTO_ARCHIVE_DAYS);

        const now = new Date();

        // Run all archive operations in a single transaction for atomicity
        const [prepaidResult, codResult, rtoResult, cancelledResult, legacyResult] = await prisma.$transaction([
            // 1. Archive delivered prepaid orders (all lines delivered)
            prisma.order.updateMany({
                where: {
                    paymentMethod: { not: 'COD' },
                    isArchived: false,
                    // All lines must be delivered (no non-delivered lines)
                    NOT: {
                        orderLines: {
                            some: {
                                trackingStatus: { not: 'delivered' },
                            },
                        },
                    },
                    // Must have at least one delivered line with deliveredAt before cutoff
                    orderLines: {
                        some: {
                            trackingStatus: 'delivered',
                            deliveredAt: { lt: terminalCutoff },
                        },
                    },
                },
                data: {
                    isArchived: true,
                    archivedAt: now,
                },
            }),
            // 2. Archive delivered COD orders (only if remitted)
            prisma.order.updateMany({
                where: {
                    paymentMethod: 'COD',
                    codRemittedAt: { not: null },
                    isArchived: false,
                    // All lines must be delivered
                    NOT: {
                        orderLines: {
                            some: {
                                trackingStatus: { not: 'delivered' },
                            },
                        },
                    },
                    // Must have at least one delivered line with deliveredAt before cutoff
                    orderLines: {
                        some: {
                            trackingStatus: 'delivered',
                            deliveredAt: { lt: terminalCutoff },
                        },
                    },
                },
                data: {
                    isArchived: true,
                    archivedAt: now,
                },
            }),
            // 3. Archive RTO received orders (all lines rto_delivered)
            prisma.order.updateMany({
                where: {
                    isArchived: false,
                    // All lines must be rto_delivered
                    NOT: {
                        orderLines: {
                            some: {
                                trackingStatus: { not: 'rto_delivered' },
                            },
                        },
                    },
                    // Must have at least one rto_delivered line with rtoReceivedAt before cutoff
                    orderLines: {
                        some: {
                            trackingStatus: 'rto_delivered',
                            rtoReceivedAt: { lt: terminalCutoff },
                        },
                    },
                },
                data: {
                    isArchived: true,
                    archivedAt: now,
                },
            }),
            // 4. Archive cancelled orders (all lines cancelled)
            prisma.order.updateMany({
                where: {
                    isArchived: false,
                    // All lines must be cancelled
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { not: 'cancelled' },
                            },
                        },
                    },
                    // Must have at least one cancelled line
                    orderLines: {
                        some: {
                            lineStatus: 'cancelled',
                        },
                    },
                    // Order must have been created before cancelled cutoff (using orderDate as proxy)
                    orderDate: { lt: cancelledCutoff },
                },
                data: {
                    isArchived: true,
                    archivedAt: now,
                },
            }),
            // 5. Legacy: Archive shipped orders after AUTO_ARCHIVE_DAYS
            prisma.order.updateMany({
                where: {
                    status: 'shipped',
                    isArchived: false,
                    // All lines must be shipped
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { notIn: ['shipped', 'cancelled'] },
                            },
                        },
                    },
                    // Must have at least one shipped line with shippedAt before cutoff
                    orderLines: {
                        some: {
                            lineStatus: 'shipped',
                            shippedAt: { lt: legacyCutoff },
                        },
                    },
                },
                data: {
                    isArchived: true,
                    archivedAt: now,
                },
            }),
        ]);

        const totalArchived = prepaidResult.count + codResult.count + rtoResult.count + cancelledResult.count + legacyResult.count;

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
// An order is "delivered" when ALL lines have trackingStatus = 'delivered'
router.post(
    '/archive-delivered-prepaid',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Find prepaid orders where all lines are delivered
        const prepaidOrders = await req.prisma.order.findMany({
            where: {
                paymentMethod: 'Prepaid',
                status: { in: ['shipped', 'delivered'] },
                isArchived: false,
                // All lines must be delivered
                NOT: {
                    orderLines: {
                        some: {
                            trackingStatus: { not: 'delivered' },
                        },
                    },
                },
                // Must have at least one delivered line
                orderLines: {
                    some: { trackingStatus: 'delivered' },
                },
            },
            select: {
                id: true,
                orderNumber: true,
                paymentMethod: true,
                orderLines: {
                    select: {
                        deliveredAt: true,
                        shippedAt: true,
                    },
                },
            },
        });

        // Find COD orders where all lines are delivered and payment is remitted
        const codOrders = await req.prisma.order.findMany({
            where: {
                paymentMethod: 'COD',
                codRemittedAt: { not: null },
                status: { in: ['shipped', 'delivered'] },
                isArchived: false,
                // All lines must be delivered
                NOT: {
                    orderLines: {
                        some: {
                            trackingStatus: { not: 'delivered' },
                        },
                    },
                },
                // Must have at least one delivered line
                orderLines: {
                    some: { trackingStatus: 'delivered' },
                },
            },
            select: {
                id: true,
                orderNumber: true,
                paymentMethod: true,
                codRemittedAt: true,
                orderLines: {
                    select: {
                        deliveredAt: true,
                        shippedAt: true,
                    },
                },
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

        // Calculate delivery stats from OrderLine data
        const deliveryStats = ordersToArchive
            .map((o) => {
                // Find lines with both deliveredAt and shippedAt
                const linesWithDates = o.orderLines.filter(
                    (line) => line.deliveredAt && line.shippedAt
                );
                if (linesWithDates.length === 0) return null;

                // Use the first line's dates (all lines typically have same dates for same shipment)
                const firstLine = linesWithDates[0];
                const daysToDeliver = Math.ceil(
                    (new Date(firstLine.deliveredAt!).getTime() - new Date(firstLine.shippedAt!).getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return { orderNumber: o.orderNumber, paymentMethod: o.paymentMethod, daysToDeliver };
            })
            .filter((stat): stat is NonNullable<typeof stat> => stat !== null);

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
 * Terminal status is now derived from OrderLines, so we just update the Order.status
 */
router.post(
    '/fix-cancelled-status',
    authenticateToken,
    asyncHandler(async (req: Request, res: Response): Promise<void> => {
        // Find orders marked as cancelled but have non-cancelled lines
        const result = await req.prisma.order.updateMany({
            where: {
                status: 'cancelled',
                isArchived: false,
                // Order has at least one non-cancelled line (meaning it shouldn't be marked cancelled)
                orderLines: {
                    some: {
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
            data: {
                status: 'open',
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
