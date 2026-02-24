import type { ShopifyClientContext, ProductOptions, ShopifyProduct, ShopifyMetafield } from './types.js';
import { shopifyLogger } from '../../utils/logger.js';

/**
 * Fetch products from Shopify (useful for SKU matching)
 * NOTE: Pass status to filter by product status. Default fetches only active products.
 * Use 'any' to fetch all statuses (makes 3 API calls internally).
 */
export async function getProducts(ctx: ShopifyClientContext, options: ProductOptions = {}): Promise<ShopifyProduct[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const limit = Math.min(options.limit || 50, 250);

    // Handle 'any' status by fetching all three statuses
    if (options.status === 'any') {
        const statuses: Array<'active' | 'archived' | 'draft'> = ['active', 'archived', 'draft'];
        const allProducts: ShopifyProduct[] = [];

        for (const status of statuses) {
            const params: Record<string, string | number> = { status, limit };
            if (options.since_id) params.since_id = options.since_id;

            const response = await ctx.executeWithRetry<{ products: ShopifyProduct[] }>(
                () => ctx.client.get('/products.json', { params })
            );
            allProducts.push(...response.data.products);
        }
        return allProducts;
    }

    // Single status fetch
    const params: Record<string, string | number> = { limit };
    if (options.status) params.status = options.status;
    if (options.since_id) params.since_id = options.since_id;

    const response = await ctx.executeWithRetry<{ products: ShopifyProduct[] }>(
        () => ctx.client.get('/products.json', { params })
    );
    return response.data.products;
}

/**
 * Fetch ALL products from Shopify with pagination
 * Fetches all three statuses (active, archived, draft) to ensure complete sync.
 */
export async function getAllProducts(
    ctx: ShopifyClientContext,
    onProgress: ((fetched: number) => void) | null = null
): Promise<ShopifyProduct[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const allProducts: ShopifyProduct[] = [];
    const statuses: Array<'active' | 'archived' | 'draft'> = ['active', 'archived', 'draft'];

    // Fetch each status separately (Shopify API doesn't support 'any' for products)
    for (const status of statuses) {
        let hasMore = true;
        let pageInfo: string | null = null;
        let sinceId: string | null = null;

        while (hasMore) {
            // IMPORTANT: When using page_info, only limit is allowed (no status/filters)
            // The cursor "remembers" the original query params
            const params: Record<string, string | number> = pageInfo
                ? { page_info: pageInfo, limit: 250 }
                : sinceId
                    ? { status, since_id: sinceId, limit: 250 }
                    : { status, limit: 250 };

            const response = await ctx.executeWithRetry<{ products: ShopifyProduct[] }>(
                () => ctx.client.get('/products.json', { params })
            );
            const products = response.data.products;

            if (products.length === 0) {
                hasMore = false;
            } else {
                allProducts.push(...products);

                if (onProgress) {
                    onProgress(allProducts.length);
                }

                // Check for pagination link header
                const linkHeader = response.headers.link as string | undefined;
                if (linkHeader && linkHeader.includes('rel="next"')) {
                    const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>;\s*rel="next"/);
                    pageInfo = nextMatch ? nextMatch[1] : null;
                    hasMore = !!pageInfo;
                } else {
                    if (products.length < 250) {
                        hasMore = false;
                    } else {
                        sinceId = String(products[products.length - 1].id);
                        pageInfo = null;
                    }
                }
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return allProducts;
}

/**
 * Get product count
 */
export async function getProductCount(ctx: ShopifyClientContext): Promise<number> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const response = await ctx.executeWithRetry<{ count: number }>(
        () => ctx.client.get('/products/count.json')
    );
    return response.data.count;
}

/**
 * Fetch metafields for a product
 */
export async function getProductMetafields(ctx: ShopifyClientContext, productId: string | number): Promise<ShopifyMetafield[]> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    try {
        const response = await ctx.executeWithRetry<{ metafields: ShopifyMetafield[] }>(
            () => ctx.client.get(`/products/${productId}/metafields.json`)
        );
        return response.data.metafields || [];
    } catch (error: unknown) {
        shopifyLogger.error({ productId, error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to fetch metafields for product');
        return [];
    }
}

/**
 * Extract gender from product data
 * Priority: 1. Tags (source of truth), 2. Metafields, 3. Product Type
 */
export function extractGenderFromMetafields(
    metafields: ShopifyMetafield[] | null | undefined,
    productType: string | null = null,
    tags: string | null = null
): 'women' | 'men' | 'unisex' {
    // PRIORITY 1: Tags are the source of truth
    if (tags) {
        const tagLower = tags.toLowerCase();

        // Check for explicit _related_ tags first (most reliable)
        if (tagLower.includes('_related_women')) {
            return 'women';
        }
        if (tagLower.includes('_related_men')) {
            return 'men';
        }

        // Check for Women/Men in tags (e.g., "Women Top Wear", "Men Shirts")
        // Must check women first since "men" is substring of "women"
        if (tagLower.includes('women') || tagLower.includes('woman')) {
            return 'women';
        }
        if (tagLower.includes(' men') || tagLower.includes('men ') ||
            tagLower.startsWith('men') || tagLower.includes(',men')) {
            return 'men';
        }

        if (tagLower.includes('unisex')) {
            return 'unisex';
        }
    }

    // PRIORITY 2: Try my_fields.gender metafield
    const genderField = metafields?.find(
        mf => mf.namespace === 'my_fields' && mf.key === 'gender'
    );

    if (genderField?.value) {
        return normalizeGender(genderField.value);
    }

    // PRIORITY 3: Try custom.product_type_for_feed metafield
    const productTypeField = metafields?.find(
        mf => mf.namespace === 'custom' && mf.key === 'product_type_for_feed'
    );

    if (productTypeField?.value) {
        return normalizeGender(productTypeField.value);
    }

    // PRIORITY 4: Fallback to main product_type field
    if (productType) {
        return normalizeGender(productType);
    }

    return 'unisex';
}

/**
 * Normalize gender value to standard format
 */
export function normalizeGender(value: string): 'women' | 'men' | 'unisex' {
    if (!value) return 'unisex';

    const lowerValue = value.toLowerCase().trim();

    // Check for women/female indicators
    if (lowerValue.includes('women') || lowerValue.includes('woman') ||
        lowerValue.includes('female') || lowerValue.includes('girl') ||
        lowerValue.startsWith('w ') || lowerValue === 'f') {
        return 'women';
    }

    // Check for men/male indicators (must come after women check to avoid "women" matching "men")
    if (lowerValue.includes('men') || lowerValue.includes('man') ||
        lowerValue.includes('male') || lowerValue.includes('boy') ||
        lowerValue.startsWith('m ') || lowerValue === 'm') {
        return 'men';
    }

    if (lowerValue.includes('unisex') || lowerValue.includes('all')) {
        return 'unisex';
    }

    return 'unisex';
}
