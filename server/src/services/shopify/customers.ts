import type { ShopifyClientContext, CustomerOptions, ShopifyCustomer } from './types.js';

/**
 * Fetch customers from Shopify
 */
export async function getCustomers(ctx: ShopifyClientContext, options: CustomerOptions = {}): Promise<ShopifyCustomer[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const params: Record<string, string | number> = {
        limit: Math.min(options.limit || 50, 250),
    };

    if (options.since_id) params.since_id = options.since_id;
    if (options.created_at_min) params.created_at_min = options.created_at_min;
    if (options.updated_at_min) params.updated_at_min = options.updated_at_min;

    const response = await ctx.executeWithRetry<{ customers: ShopifyCustomer[] }>(
        () => ctx.client.get('/customers.json', { params })
    );
    return response.data.customers;
}

/**
 * Fetch a single customer by ID
 */
export async function getCustomer(ctx: ShopifyClientContext, customerId: string | number): Promise<ShopifyCustomer> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const response = await ctx.executeWithRetry<{ customer: ShopifyCustomer }>(
        () => ctx.client.get(`/customers/${customerId}.json`)
    );
    return response.data.customer;
}

/**
 * Get customer count
 */
export async function getCustomerCount(ctx: ShopifyClientContext): Promise<number> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const response = await ctx.executeWithRetry<{ count: number }>(
        () => ctx.client.get('/customers/count.json')
    );
    return response.data.count;
}

/**
 * Fetch ALL customers using pagination (for bulk sync)
 */
export async function getAllCustomers(
    ctx: ShopifyClientContext,
    onProgress?: (fetched: number, total: number) => void
): Promise<ShopifyCustomer[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const allCustomers: ShopifyCustomer[] = [];
    let sinceId: string | null = null;
    const limit = 250; // Max allowed by Shopify
    const totalCount = await getCustomerCount(ctx);

    while (true) {
        const params: Record<string, string | number> = { limit };
        if (sinceId) params.since_id = sinceId;

        const response = await ctx.executeWithRetry<{ customers: ShopifyCustomer[] }>(
            () => ctx.client.get('/customers.json', { params })
        );
        const customers = response.data.customers;

        if (customers.length === 0) break;

        allCustomers.push(...customers);
        sinceId = String(customers[customers.length - 1].id);

        if (onProgress) {
            onProgress(allCustomers.length, totalCount);
        }

        // Small delay to avoid rate limiting (in addition to automatic handling)
        await new Promise(resolve => setTimeout(resolve, 100));

        if (customers.length < limit) break;
    }

    return allCustomers;
}
