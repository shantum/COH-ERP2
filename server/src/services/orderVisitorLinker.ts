/**
 * Order → Visitor Linker
 *
 * Matches orders to StorefrontEvent visitor sessions using attribution signals.
 *
 * Matching strategy (priority order):
 *   1. fbclid exact match — Order.fbclid = StorefrontEvent.fbclid within ±7 days
 *   2. Product ATC match — Same products added to cart within 24h before order
 *
 * Sets Order.storefrontVisitorId and Order.storefrontSessionId when matched.
 */

import type { PrismaClient } from '@prisma/client';
import { syncLogger } from '../utils/logger.js';

interface LinkResult {
    visitorId: string | null;
    sessionId: string | null;
    matchType: 'fbclid' | 'product_atc' | 'none';
}

/**
 * Attempt to link an order to a pixel visitor session.
 * Safe to call multiple times — skips if already linked.
 */
export async function linkOrderToVisitor(
    prisma: PrismaClient,
    orderId: string,
): Promise<LinkResult> {
    const none: LinkResult = { visitorId: null, sessionId: null, matchType: 'none' };

    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                fbclid: true,
                orderDate: true,
                storefrontVisitorId: true,
                orderLines: {
                    select: {
                        sku: {
                            select: {
                                variation: {
                                    select: {
                                        product: { select: { shopifyProductId: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!order) return none;
        // Already linked
        if (order.storefrontVisitorId) {
            return { visitorId: order.storefrontVisitorId, sessionId: null, matchType: 'none' };
        }

        // Strategy 1: fbclid match
        if (order.fbclid) {
            const windowStart = new Date(order.orderDate.getTime() - 7 * 24 * 60 * 60 * 1000);
            const windowEnd = new Date(order.orderDate.getTime() + 7 * 24 * 60 * 60 * 1000);

            const match = await prisma.storefrontEvent.findFirst({
                where: {
                    fbclid: order.fbclid,
                    createdAt: { gte: windowStart, lte: windowEnd },
                },
                orderBy: { createdAt: 'desc' },
                select: { visitorId: true, sessionId: true },
            });

            if (match) {
                await prisma.order.update({
                    where: { id: orderId },
                    data: {
                        storefrontVisitorId: match.visitorId,
                        storefrontSessionId: match.sessionId,
                    },
                });
                return { visitorId: match.visitorId, sessionId: match.sessionId, matchType: 'fbclid' };
            }
        }

        // Strategy 2: Product ATC match (same products in cart within 24h)
        const productIds = order.orderLines
            .map(l => l.sku?.variation?.product?.shopifyProductId)
            .filter((id): id is string => id != null);

        if (productIds.length > 0) {
            const windowStart = new Date(order.orderDate.getTime() - 24 * 60 * 60 * 1000);

            const match = await prisma.storefrontEvent.findFirst({
                where: {
                    eventName: 'product_added_to_cart',
                    productId: { in: productIds },
                    createdAt: { gte: windowStart, lte: order.orderDate },
                },
                orderBy: { createdAt: 'desc' },
                select: { visitorId: true, sessionId: true },
            });

            if (match) {
                await prisma.order.update({
                    where: { id: orderId },
                    data: {
                        storefrontVisitorId: match.visitorId,
                        storefrontSessionId: match.sessionId,
                    },
                });
                return { visitorId: match.visitorId, sessionId: match.sessionId, matchType: 'product_atc' };
            }
        }

        return none;
    } catch (error: unknown) {
        syncLogger.warn(
            { orderId, error: error instanceof Error ? error.message : String(error) },
            'Failed to link order to visitor',
        );
        return none;
    }
}

/**
 * Bulk link orders to visitors. Used by backfill.
 */
export async function bulkLinkOrdersToVisitors(
    prisma: PrismaClient,
    options: { dryRun?: boolean; batchSize?: number },
): Promise<{ total: number; linked: number; byFbclid: number; byAtc: number }> {
    const { dryRun = false, batchSize = 200 } = options;
    const stats = { total: 0, linked: 0, byFbclid: 0, byAtc: 0 };

    let cursor: string | undefined;
    let batch = 0;

    while (true) {
        const orders = await prisma.order.findMany({
            where: {
                storefrontVisitorId: null,
                shopifyOrderId: { not: null },
                // Only try orders that have SOME signal to match on
                OR: [
                    { fbclid: { not: null } },
                ],
            },
            select: { id: true },
            orderBy: { orderDate: 'desc' },
            take: batchSize,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (orders.length === 0) break;
        batch++;
        cursor = orders[orders.length - 1].id;

        for (const order of orders) {
            stats.total++;
            if (dryRun) continue;

            const result = await linkOrderToVisitor(prisma, order.id);
            if (result.matchType !== 'none') {
                stats.linked++;
                if (result.matchType === 'fbclid') stats.byFbclid++;
                if (result.matchType === 'product_atc') stats.byAtc++;
            }
        }

        process.stdout.write(
            `\r  Batch ${batch}: ${stats.total} scanned, ${stats.linked} linked (fbclid: ${stats.byFbclid}, atc: ${stats.byAtc})`
        );
    }

    console.log('');
    return stats;
}
