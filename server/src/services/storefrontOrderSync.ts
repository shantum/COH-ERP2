/**
 * Storefront Order Sync — Creates synthetic checkout_completed events
 *
 * Problem: Most checkouts go through Shopflo (3rd party), so the Shopify pixel
 * never fires checkout_completed. This leaves storefront analytics with no
 * purchase/revenue data.
 *
 * Solution: After each order is created via Shopify sync, insert a synthetic
 * checkout_completed event into StorefrontEvent. If the order can be matched
 * to an existing pixel session (via product_added_to_cart events), we inherit
 * that session's attribution (UTMs, device, geo). Otherwise we fall back to
 * the order's own UTM data.
 *
 * Dedup: Uses rawData->>'shopifyOrderId' to prevent duplicate events.
 */

import type { PrismaClient } from '@prisma/client';
import { syncLogger } from '../utils/logger.js';

interface OrderForSync {
    id: string;
    shopifyOrderId: string | null;
    orderNumber: string;
    orderDate: Date;
    totalAmount: number;
    customerEmail: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
}

interface MatchedSession {
    sessionId: string;
    visitorId: string;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    deviceType: string | null;
    screenWidth: number | null;
    country: string | null;
    region: string | null;
    city: string | null;
    referrer: string | null;
    pageUrl: string | null;
}

/**
 * Create a synthetic checkout_completed StorefrontEvent for an order.
 *
 * Called via deferredExecutor after order creation. Safe to call multiple times
 * — deduplicates on shopifyOrderId in rawData.
 */
export async function syncOrderToStorefront(
    prisma: PrismaClient,
    orderId: string,
): Promise<{ action: 'created' | 'skipped' | 'error'; sessionMatched: boolean }> {
    try {
        // Load order with line items to get product IDs
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                shopifyOrderId: true,
                orderNumber: true,
                orderDate: true,
                totalAmount: true,
                customerEmail: true,
                utmSource: true,
                utmMedium: true,
                utmCampaign: true,
                utmContent: true,
                utmTerm: true,
                orderLines: {
                    select: {
                        sku: {
                            select: {
                                variation: {
                                    select: {
                                        product: {
                                            select: { shopifyProductId: true, name: true },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!order || !order.shopifyOrderId) {
            return { action: 'skipped', sessionMatched: false };
        }

        // Dedup: check if any checkout_completed already exists for this order
        // Could be a synthetic (order_sync) event OR a pixel-native event
        // (international customers who go through native Shopify checkout)
        const existingSynthetic = await prisma.storefrontEvent.findFirst({
            where: {
                eventName: 'checkout_completed',
                rawData: { path: ['shopifyOrderId'], equals: order.shopifyOrderId },
            },
            select: { id: true },
        });

        if (existingSynthetic) {
            return { action: 'skipped', sessionMatched: false };
        }

        // Also check for pixel-native checkout_completed (orderId format: gid://shopify/Order/...)
        const shopifyGid = `gid://shopify/Order/${order.shopifyOrderId}`;
        const existingPixel = await prisma.storefrontEvent.findFirst({
            where: {
                eventName: 'checkout_completed',
                rawData: { path: ['orderId'], equals: shopifyGid },
            },
            select: { id: true },
        });

        if (existingPixel) {
            return { action: 'skipped', sessionMatched: false };
        }

        // Get Shopify product IDs from order lines
        const productIds = order.orderLines
            .map(l => l.sku?.variation?.product?.shopifyProductId)
            .filter((id): id is string => id != null);

        // Try to match to a pixel session
        const session = await findMatchingSession(prisma, order, productIds);

        // Build the synthetic event
        const eventData = buildSyntheticEvent(order, session, productIds);

        await prisma.storefrontEvent.create({ data: eventData });

        syncLogger.info(
            { orderId, orderNumber: order.orderNumber, sessionMatched: !!session },
            'Created synthetic checkout_completed event',
        );

        return { action: 'created', sessionMatched: !!session };
    } catch (error: unknown) {
        syncLogger.warn(
            { orderId, error: error instanceof Error ? error.message : String(error) },
            'Failed to sync order to storefront events',
        );
        return { action: 'error', sessionMatched: false };
    }
}

/**
 * Find a pixel session that likely belongs to this order.
 *
 * Strategy (in priority order):
 * 1. Sessions with product_added_to_cart for the same products within 24h before orderDate
 * 2. Sessions with product_viewed for the same products within 24h before orderDate
 * 3. No match — fall back to order UTMs
 *
 * When multiple sessions match, pick the most recent one (closest to purchase).
 */
async function findMatchingSession(
    prisma: PrismaClient,
    order: OrderForSync,
    productIds: string[],
): Promise<MatchedSession | null> {
    if (productIds.length === 0) return null;

    const windowStart = new Date(order.orderDate.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = order.orderDate;

    // Try ATC events first (stronger signal)
    const atcMatch = await prisma.storefrontEvent.findFirst({
        where: {
            eventName: 'product_added_to_cart',
            productId: { in: productIds },
            createdAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { createdAt: 'desc' },
        select: {
            sessionId: true,
            visitorId: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            utmContent: true,
            utmTerm: true,
            deviceType: true,
            screenWidth: true,
            country: true,
            region: true,
            city: true,
            referrer: true,
            pageUrl: true,
        },
    });

    if (atcMatch) return atcMatch;

    // Fall back to product_viewed
    const viewMatch = await prisma.storefrontEvent.findFirst({
        where: {
            eventName: 'product_viewed',
            productId: { in: productIds },
            createdAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { createdAt: 'desc' },
        select: {
            sessionId: true,
            visitorId: true,
            utmSource: true,
            utmMedium: true,
            utmCampaign: true,
            utmContent: true,
            utmTerm: true,
            deviceType: true,
            screenWidth: true,
            country: true,
            region: true,
            city: true,
            referrer: true,
            pageUrl: true,
        },
    });

    return viewMatch;
}

/**
 * Build the StorefrontEvent data for a synthetic checkout_completed.
 *
 * If a session was matched, inherit its attribution. Otherwise use order UTMs.
 */
function buildSyntheticEvent(
    order: OrderForSync,
    session: MatchedSession | null,
    productIds: string[],
) {
    // Build line items for rawData
    const items = order.orderNumber ? [] : []; // placeholder, actual items below

    return {
        eventName: 'checkout_completed' as const,
        eventTime: order.orderDate,
        sessionId: session?.sessionId ?? `order-sync-${order.shopifyOrderId}`,
        visitorId: session?.visitorId ?? `order-sync-${order.shopifyOrderId}`,
        // Attribution: prefer session data, fall back to order UTMs
        utmSource: session?.utmSource ?? order.utmSource ?? null,
        utmMedium: session?.utmMedium ?? order.utmMedium ?? null,
        utmCampaign: session?.utmCampaign ?? order.utmCampaign ?? null,
        utmContent: session?.utmContent ?? order.utmContent ?? null,
        utmTerm: session?.utmTerm ?? order.utmTerm ?? null,
        // Device/geo from session (unavailable for unmatched)
        deviceType: session?.deviceType ?? null,
        screenWidth: session?.screenWidth ?? null,
        country: session?.country ?? null,
        region: session?.region ?? null,
        city: session?.city ?? null,
        referrer: session?.referrer ?? null,
        // Product info (first product in order)
        ...(productIds[0] ? { productId: productIds[0] } : {}),
        // Order value
        orderValue: order.totalAmount,
        // Metadata
        rawData: {
            source: 'order_sync',
            shopifyOrderId: order.shopifyOrderId,
            orderNumber: order.orderNumber,
            productIds,
            items,
        },
    };
}

/**
 * Bulk sync: create synthetic events for orders missing checkout_completed.
 * Used by the backfill script.
 */
export async function bulkSyncOrdersToStorefront(
    prisma: PrismaClient,
    options: { since?: Date; dryRun?: boolean; batchSize?: number },
): Promise<{ total: number; created: number; matched: number; skipped: number; errors: number }> {
    const { since, dryRun = false, batchSize = 100 } = options;

    const stats = { total: 0, created: 0, matched: 0, skipped: 0, errors: 0 };

    // Get all shopifyOrderIds that already have synthetic events
    const existingRaw = await prisma.storefrontEvent.findMany({
        where: {
            eventName: 'checkout_completed',
            rawData: { path: ['source'], equals: 'order_sync' },
        },
        select: { rawData: true },
    });

    const existingOrderIds = new Set(
        existingRaw
            .map(e => {
                const data = e.rawData as Record<string, unknown> | null;
                return data?.shopifyOrderId as string | undefined;
            })
            .filter((id): id is string => id != null),
    );

    // Also get shopifyOrderIds from pixel-native checkout_completed events
    const pixelNativeRaw = await prisma.storefrontEvent.findMany({
        where: {
            eventName: 'checkout_completed',
            rawData: { path: ['source'], not: 'order_sync' },
        },
        select: { rawData: true },
    });

    for (const e of pixelNativeRaw) {
        const data = e.rawData as Record<string, unknown> | null;
        const orderId = data?.orderId as string | undefined;
        if (orderId) existingOrderIds.add(orderId);
    }

    console.log(`Found ${existingOrderIds.size} orders with existing checkout_completed events`);

    // Process orders in batches
    let cursor: string | undefined;
    let batch = 0;

    while (true) {
        const orders = await prisma.order.findMany({
            where: {
                shopifyOrderId: { not: null },
                ...(since ? { orderDate: { gte: since } } : {}),
            },
            select: { id: true, shopifyOrderId: true },
            orderBy: { orderDate: 'desc' },
            take: batchSize,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (orders.length === 0) break;

        batch++;
        cursor = orders[orders.length - 1].id;

        for (const order of orders) {
            stats.total++;

            if (existingOrderIds.has(order.shopifyOrderId!)) {
                stats.skipped++;
                continue;
            }

            if (dryRun) {
                stats.created++;
                continue;
            }

            const result = await syncOrderToStorefront(prisma, order.id);
            if (result.action === 'created') {
                stats.created++;
                if (result.sessionMatched) stats.matched++;
            } else if (result.action === 'skipped') {
                stats.skipped++;
            } else {
                stats.errors++;
            }
        }

        console.log(`Batch ${batch}: processed ${orders.length} orders (total: ${stats.total}, created: ${stats.created}, matched: ${stats.matched})`);
    }

    return stats;
}
