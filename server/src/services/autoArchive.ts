/**
 * Auto-Archive Service
 *
 * Standalone service for auto-archiving orders based on terminal status.
 * Extracted from routes/orders/mutations/archive.ts for use by index.js scheduler.
 *
 * Thresholds defined in: config/thresholds/orderTiming.ts
 */

import type { PrismaClient } from '@prisma/client';
import { orderLogger } from '../utils/logger.js';
import {
    ARCHIVE_TERMINAL_DAYS,
    ARCHIVE_CANCELLED_DAYS,
    AUTO_ARCHIVE_DAYS,
} from '../config/index.js';

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
                    NOT: {
                        orderLines: {
                            some: {
                                trackingStatus: { not: 'delivered' },
                            },
                        },
                    },
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
                    NOT: {
                        orderLines: {
                            some: {
                                trackingStatus: { not: 'delivered' },
                            },
                        },
                    },
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
                    NOT: {
                        orderLines: {
                            some: {
                                trackingStatus: { not: 'rto_delivered' },
                            },
                        },
                    },
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
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { not: 'cancelled' },
                            },
                        },
                    },
                    orderLines: {
                        some: {
                            lineStatus: 'cancelled',
                        },
                    },
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
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { notIn: ['shipped', 'cancelled'] },
                            },
                        },
                    },
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
