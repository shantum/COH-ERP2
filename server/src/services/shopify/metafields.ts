/**
 * Shopify Metafields — Push Operations
 *
 * GraphQL mutations for pushing metafields and product category from ERP to Shopify.
 * Follows the same pattern as inventory.ts: receives ShopifyClientContext, returns structured results.
 */

import type { ShopifyClientContext } from './types.js';
import { shopifyLogger } from '../../utils/logger.js';
import { METAFIELD_SYNC_FIELDS } from '@coh/shared/config/shopifyMetafieldSync';

// ============================================
// RESULT TYPES
// ============================================

export interface MetafieldSetResult {
    success: boolean;
    error?: string;
    updatedFields: string[];
}

export interface CategorySetResult {
    success: boolean;
    error?: string;
    appliedCategoryId?: string;
}

// ============================================
// SET METAFIELDS (metafieldsSet mutation)
// ============================================

const METAFIELDS_SET_MUTATION = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
            metafields {
                id
                namespace
                key
                value
            }
            userErrors {
                field
                message
            }
        }
    }
`;

/**
 * Push metafield values from ERP to Shopify for a single product.
 * Only pushes fields explicitly listed in fieldKeys — caller decides what to push.
 *
 * @param shopifyProductId - Numeric Shopify product ID (not GID)
 * @param fieldKeys - Which sync field keys to push (e.g. ['washcare', 'fabric'])
 * @param values - Map of field key → value string to push
 */
export async function setProductMetafields(
    ctx: ShopifyClientContext,
    shopifyProductId: string,
    fieldKeys: string[],
    values: Record<string, string>,
): Promise<MetafieldSetResult> {
    const productGid = `gid://shopify/Product/${shopifyProductId}`;

    const metafields: Array<{
        ownerId: string;
        namespace: string;
        key: string;
        value: string;
        type: string;
    }> = [];

    for (const fieldKey of fieldKeys) {
        const config = METAFIELD_SYNC_FIELDS[fieldKey];
        if (!config) {
            shopifyLogger.warn({ fieldKey }, 'Unknown metafield sync key, skipping');
            continue;
        }

        const value = values[fieldKey];
        if (value === undefined || value === null || value === '') continue;

        metafields.push({
            ownerId: productGid,
            namespace: config.shopifyNamespace,
            key: config.shopifyKey,
            value: String(value),
            type: config.shopifyType,
        });
    }

    if (metafields.length === 0) {
        return { success: true, updatedFields: [] };
    }

    interface MetafieldsSetResponse {
        metafieldsSet: {
            metafields: Array<{ id: string; namespace: string; key: string; value: string }>;
            userErrors: Array<{ field?: string; message: string }>;
        };
    }

    try {
        const data = await ctx.executeGraphQL<MetafieldsSetResponse>(
            METAFIELDS_SET_MUTATION,
            { metafields },
        );

        if (data.metafieldsSet.userErrors.length > 0) {
            const errors = data.metafieldsSet.userErrors.map(e => e.message).join(', ');
            shopifyLogger.error({ shopifyProductId, errors }, 'Failed to set metafields');
            return { success: false, error: errors, updatedFields: [] };
        }

        const updatedFields = data.metafieldsSet.metafields.map(m => `${m.namespace}.${m.key}`);
        shopifyLogger.info({ shopifyProductId, updatedFields }, 'Metafields set successfully');
        return { success: true, updatedFields };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ shopifyProductId, error: message }, 'Exception setting metafields');
        return { success: false, error: message, updatedFields: [] };
    }
}

// ============================================
// SET PRODUCT CATEGORY (productUpdate mutation)
// ============================================

const PRODUCT_UPDATE_CATEGORY_MUTATION = `
    mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
            product {
                id
                productCategory {
                    productTaxonomyNode {
                        id
                        fullName
                    }
                }
            }
            userErrors {
                field
                message
            }
        }
    }
`;

/**
 * Set the Google Product Category on a Shopify product.
 * Uses Shopify's taxonomy node GID derived from the Google category ID.
 *
 * Note: Shopify's taxonomy node IDs may not be a 1:1 map to Google category IDs.
 * Verify with a test call. If mapping differs, add a lookup table to the config.
 *
 * @param shopifyProductId - Numeric Shopify product ID
 * @param googleCategoryId - Google product taxonomy ID (e.g. 212 for Shirts & Tops)
 */
export async function setProductCategory(
    ctx: ShopifyClientContext,
    shopifyProductId: string,
    googleCategoryId: number,
): Promise<CategorySetResult> {
    const productGid = `gid://shopify/Product/${shopifyProductId}`;

    interface ProductUpdateResponse {
        productUpdate: {
            product?: {
                id: string;
                productCategory?: {
                    productTaxonomyNode?: { id: string; fullName: string };
                };
            };
            userErrors: Array<{ field?: string; message: string }>;
        };
    }

    try {
        const data = await ctx.executeGraphQL<ProductUpdateResponse>(
            PRODUCT_UPDATE_CATEGORY_MUTATION,
            {
                input: {
                    id: productGid,
                    productCategory: {
                        productTaxonomyNodeId: `gid://shopify/TaxonomyCategory/${googleCategoryId}`,
                    },
                },
            },
        );

        if (data.productUpdate.userErrors.length > 0) {
            const errors = data.productUpdate.userErrors.map(e => e.message).join(', ');
            shopifyLogger.error({ shopifyProductId, googleCategoryId, errors }, 'Failed to set product category');
            return { success: false, error: errors };
        }

        const appliedId = data.productUpdate.product?.productCategory?.productTaxonomyNode?.id;
        shopifyLogger.info({ shopifyProductId, googleCategoryId, appliedId }, 'Product category set');
        return { success: true, appliedCategoryId: appliedId };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ shopifyProductId, googleCategoryId, error: message }, 'Exception setting product category');
        return { success: false, error: message };
    }
}

// ============================================
// READ METAFIELDS (for pull sync)
// ============================================

/**
 * Extract ERP attribute values from Shopify metafields using the sync config.
 * Only extracts pull-enabled fields that live in attributes JSONB.
 *
 * @param metafields - Raw metafields from Shopify API
 * @returns Map of attribute keys → values to merge into Product.attributes
 */
export function extractMetafieldAttributes(
    metafields: Array<{ namespace: string; key: string; value: string; type: string }>,
): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};

    for (const [, config] of Object.entries(METAFIELD_SYNC_FIELDS)) {
        if (!config.pullEnabled) continue;
        if (!config.erpPath.startsWith('attributes.')) continue;

        const mf = metafields.find(
            m => m.namespace === config.shopifyNamespace && m.key === config.shopifyKey,
        );
        if (!mf?.value) continue;

        const attrKey = config.erpPath.replace('attributes.', '');

        // Parse JSON arrays for list types
        if (config.shopifyType.startsWith('list.')) {
            try {
                const parsed: unknown = JSON.parse(mf.value);
                if (Array.isArray(parsed)) {
                    result[attrKey] = parsed.map(String);
                }
            } catch {
                // If parsing fails, store as-is
                result[attrKey] = mf.value;
            }
        } else {
            result[attrKey] = mf.value;
        }
    }

    return result;
}
