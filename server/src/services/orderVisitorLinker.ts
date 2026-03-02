/**
 * Order → Visitor Linker
 *
 * Matches orders to StorefrontEvent visitor sessions using the shared
 * matching cascade from storefrontOrderSync:
 *   1. fbclid exact match (±7 days)
 *   2. gclid exact match (±7 days)
 *   3. product_added_to_cart for same products (24h before order)
 *   4. product_viewed for same products (24h before order)
 *
 * Sets Order.storefrontVisitorId and Order.storefrontSessionId when matched.
 */

import type { PrismaClient } from '@prisma/client';
import { syncLogger } from '../utils/logger.js';
import { findMatchingSession, type MatchType } from './storefrontOrderSync.js';

interface LinkResult {
    visitorId: string | null;
    sessionId: string | null;
    matchType: MatchType;
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
                gclid: true,
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

        const productIds = order.orderLines
            .map(l => l.sku?.variation?.product?.shopifyProductId)
            .filter((id): id is string => id != null);

        // Use the shared matching cascade
        const { session, matchType } = await findMatchingSession(prisma, order, productIds);

        if (session) {
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    storefrontVisitorId: session.visitorId,
                    storefrontSessionId: session.sessionId,
                },
            });
            return { visitorId: session.visitorId, sessionId: session.sessionId, matchType };
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
): Promise<{ total: number; linked: number; byType: Record<string, number> }> {
    const { dryRun = false, batchSize = 200 } = options;
    const stats = { total: 0, linked: 0, byType: {} as Record<string, number> };

    let cursor: string | undefined;
    let batch = 0;

    while (true) {
        const orders = await prisma.order.findMany({
            where: {
                storefrontVisitorId: null,
                shopifyOrderId: { not: null },
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
                stats.byType[result.matchType] = (stats.byType[result.matchType] || 0) + 1;
            }
        }

        process.stdout.write(
            `\r  Batch ${batch}: ${stats.total} scanned, ${stats.linked} linked (${JSON.stringify(stats.byType)})`
        );
    }

    console.log('');
    return stats;
}
