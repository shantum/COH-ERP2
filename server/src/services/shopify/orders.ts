import type { ShopifyClientContext, OrderOptions, ShopifyOrder } from './types.js';

/**
 * Fetch orders from Shopify
 */
export async function getOrders(ctx: ShopifyClientContext, options: OrderOptions = {}): Promise<ShopifyOrder[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const params: Record<string, string | number> = {
        status: options.status || 'any',
        limit: Math.min(options.limit || 50, 250),
    };

    // Note: Shopify doesn't allow 'order' param when using since_id
    // since_id already implies ordering by ID (ascending)
    if (options.since_id) {
        params.since_id = options.since_id;
    } else {
        // Only use order param when not using since_id
        params.order = 'created_at asc';
    }

    if (options.created_at_min) params.created_at_min = options.created_at_min;
    if (options.created_at_max) params.created_at_max = options.created_at_max;
    if (options.updated_at_min) params.updated_at_min = options.updated_at_min;
    if (options.updated_at_max) params.updated_at_max = options.updated_at_max;

    const response = await ctx.executeWithRetry<{ orders: ShopifyOrder[] }>(
        () => ctx.client.get('/orders.json', { params })
    );
    return response.data.orders;
}

/**
 * Fetch a single order by ID
 */
export async function getOrder(ctx: ShopifyClientContext, orderId: string | number): Promise<ShopifyOrder> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const response = await ctx.executeWithRetry<{ order: ShopifyOrder }>(
        () => ctx.client.get(`/orders/${orderId}.json`)
    );
    return response.data.order;
}

/**
 * Get order count for status check
 */
export async function getOrderCount(
    ctx: ShopifyClientContext,
    options: Pick<OrderOptions, 'status' | 'created_at_min'> = {}
): Promise<number> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const params: Record<string, string> = { status: options.status || 'any' };
    if (options.created_at_min) params.created_at_min = options.created_at_min;

    const response = await ctx.executeWithRetry<{ count: number }>(
        () => ctx.client.get('/orders/count.json', { params })
    );
    return response.data.count;
}

/**
 * Fetch ALL orders using pagination (for bulk sync)
 */
export async function getAllOrders(
    ctx: ShopifyClientContext,
    onProgress?: (fetched: number, total: number) => void,
    options: Pick<OrderOptions, 'status' | 'created_at_min'> = {}
): Promise<ShopifyOrder[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const allOrders: ShopifyOrder[] = [];
    let sinceId: string | null = null;
    const limit = 250; // Max allowed by Shopify
    const totalCount = await getOrderCount(ctx, options);

    // Track consecutive empty batches to detect true end of data
    let consecutiveSmallBatches = 0;
    const maxConsecutiveSmallBatches = 3;

    while (true) {
        const params: Record<string, string | number> = {
            status: options.status || 'any',
            limit,
        };
        if (sinceId) params.since_id = sinceId;
        if (options.created_at_min) params.created_at_min = options.created_at_min;

        const response = await ctx.executeWithRetry<{ orders: ShopifyOrder[] }>(
            () => ctx.client.get('/orders.json', { params })
        );
        const orders = response.data.orders;

        // True end: no orders returned
        if (orders.length === 0) break;

        allOrders.push(...orders);
        sinceId = String(orders[orders.length - 1].id);

        if (onProgress) {
            onProgress(allOrders.length, totalCount);
        }

        // Small delay to avoid rate limiting (in addition to automatic handling)
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if we should stop:
        // - If we've fetched at least totalCount, we're done
        // - If batch is small AND we've had multiple consecutive small batches, stop
        // This handles gaps in Shopify IDs (deleted orders) while still stopping eventually
        if (orders.length < limit) {
            consecutiveSmallBatches++;
            if (allOrders.length >= totalCount || consecutiveSmallBatches >= maxConsecutiveSmallBatches) {
                break;
            }
        } else {
            consecutiveSmallBatches = 0;
        }
    }

    return allOrders;
}
