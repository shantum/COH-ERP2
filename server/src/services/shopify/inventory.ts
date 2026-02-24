import type {
    ShopifyClientContext,
    ShopifyLocation,
    InventoryItemInfo,
    SetInventoryResult,
} from './types.js';
import { shopifyLogger } from '../../utils/logger.js';

/**
 * Get all active inventory locations
 */
export async function getLocations(ctx: ShopifyClientContext): Promise<ShopifyLocation[]> {
    const query = `
        query GetLocations($first: Int!) {
            locations(first: $first) {
                edges {
                    node {
                        id
                        name
                        address {
                            address1
                            city
                            country
                        }
                    }
                }
            }
        }
    `;

    interface LocationsResponse {
        locations: {
            edges: Array<{
                node: {
                    id: string;
                    name: string;
                    address?: {
                        address1?: string;
                        city?: string;
                        country?: string;
                    };
                };
            }>;
        };
    }

    const data = await ctx.executeGraphQL<LocationsResponse>(query, { first: 50 });
    return data.locations.edges.map(edge => edge.node);
}

/**
 * Get inventory item info by SKU
 * Returns the inventory item ID needed for setting quantity
 */
export async function getInventoryItemBySku(ctx: ShopifyClientContext, sku: string): Promise<InventoryItemInfo | null> {
    const query = `
        query GetVariantBySku($query: String!) {
            productVariants(first: 1, query: $query) {
                edges {
                    node {
                        id
                        sku
                        title
                        inventoryQuantity
                        inventoryItem {
                            id
                        }
                        product {
                            id
                        }
                    }
                }
            }
        }
    `;

    interface VariantResponse {
        productVariants: {
            edges: Array<{
                node: {
                    id: string;
                    sku: string;
                    title: string;
                    inventoryQuantity: number;
                    inventoryItem: { id: string };
                    product: { id: string };
                };
            }>;
        };
    }

    const data = await ctx.executeGraphQL<VariantResponse>(query, { query: `sku:${sku}` });

    if (data.productVariants.edges.length === 0) {
        return null;
    }

    const variant = data.productVariants.edges[0].node;
    return {
        inventoryItemId: variant.inventoryItem.id,
        sku: variant.sku,
        variantId: variant.id,
        productId: variant.product.id,
        title: variant.title,
        inventoryQuantity: variant.inventoryQuantity,
    };
}

/**
 * Get inventory items for multiple SKUs (batch lookup)
 * More efficient than individual lookups
 */
export async function getInventoryItemsBySkus(ctx: ShopifyClientContext, skus: string[]): Promise<Map<string, InventoryItemInfo>> {
    if (skus.length === 0) return new Map();

    // Shopify query format: sku:SKU1 OR sku:SKU2 OR ...
    // Note: There's a query length limit, so we batch in groups of 50
    const results = new Map<string, InventoryItemInfo>();
    const batchSize = 50;

    for (let i = 0; i < skus.length; i += batchSize) {
        const batch = skus.slice(i, i + batchSize);
        const queryString = batch.map(s => `sku:${s}`).join(' OR ');

        const query = `
            query GetVariantsBySkus($query: String!, $first: Int!) {
                productVariants(first: $first, query: $query) {
                    edges {
                        node {
                            id
                            sku
                            title
                            inventoryQuantity
                            inventoryItem {
                                id
                            }
                            product {
                                id
                            }
                        }
                    }
                }
            }
        `;

        interface VariantsResponse {
            productVariants: {
                edges: Array<{
                    node: {
                        id: string;
                        sku: string;
                        title: string;
                        inventoryQuantity: number;
                        inventoryItem: { id: string };
                        product: { id: string };
                    };
                }>;
            };
        }

        const data = await ctx.executeGraphQL<VariantsResponse>(query, {
            query: queryString,
            first: batch.length,
        });

        for (const edge of data.productVariants.edges) {
            const variant = edge.node;
            results.set(variant.sku, {
                inventoryItemId: variant.inventoryItem.id,
                sku: variant.sku,
                variantId: variant.id,
                productId: variant.product.id,
                title: variant.title,
                inventoryQuantity: variant.inventoryQuantity,
            });
        }

        // Small delay between batches
        if (i + batchSize < skus.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return results;
}

/**
 * Set inventory quantity for a specific inventory item at a location
 * Uses the newer inventorySetQuantities mutation (not deprecated)
 *
 * @param inventoryItemId - The GraphQL ID of the inventory item (gid://shopify/InventoryItem/xxx)
 * @param locationId - The GraphQL ID of the location (gid://shopify/Location/xxx)
 * @param quantity - The absolute quantity to set
 */
export async function setInventoryQuantity(
    ctx: ShopifyClientContext,
    inventoryItemId: string,
    locationId: string,
    quantity: number
): Promise<SetInventoryResult> {
    const mutation = `
        mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
                inventoryAdjustmentGroup {
                    id
                    reason
                }
                userErrors {
                    field
                    message
                }
            }
        }
    `;

    interface SetQuantitiesResponse {
        inventorySetQuantities: {
            inventoryAdjustmentGroup?: {
                id: string;
                reason?: string;
            };
            userErrors: Array<{ field?: string; message: string }>;
        };
    }

    try {
        const data = await ctx.executeGraphQL<SetQuantitiesResponse>(mutation, {
            input: {
                name: 'available',
                reason: 'correction',
                ignoreCompareQuantity: true,
                quantities: [
                    {
                        inventoryItemId,
                        locationId,
                        quantity,
                    }
                ],
            },
        });

        if (data.inventorySetQuantities.userErrors.length > 0) {
            const errorMessages = data.inventorySetQuantities.userErrors.map(e => e.message).join(', ');
            shopifyLogger.error({ inventoryItemId, locationId, quantity, errors: data.inventorySetQuantities.userErrors }, 'Failed to set inventory quantity');
            return { success: false, error: errorMessages };
        }

        shopifyLogger.info({ inventoryItemId, locationId, quantity }, 'Inventory quantity set successfully');
        return {
            success: true,
            inventoryItemId,
            locationId,
            quantity,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shopifyLogger.error({ inventoryItemId, locationId, quantity, error: message }, 'Exception setting inventory quantity');
        return { success: false, error: message };
    }
}

/**
 * Set inventory quantity by SKU (convenience method)
 * Looks up the inventory item ID from SKU, then sets quantity
 *
 * @param sku - The product variant SKU
 * @param locationId - The GraphQL ID of the location
 * @param quantity - The absolute quantity to set
 */
export async function setInventoryQuantityBySku(
    ctx: ShopifyClientContext,
    sku: string,
    locationId: string,
    quantity: number
): Promise<SetInventoryResult> {
    // Look up inventory item by SKU
    const inventoryItem = await getInventoryItemBySku(ctx, sku);

    if (!inventoryItem) {
        shopifyLogger.warn({ sku }, 'SKU not found in Shopify');
        return { success: false, error: `SKU not found in Shopify: ${sku}` };
    }

    return setInventoryQuantity(ctx, inventoryItem.inventoryItemId, locationId, quantity);
}

/**
 * Set inventory to zero for multiple SKUs (batch operation)
 * Useful for zeroing out archived product stock
 *
 * @param skus - Array of SKUs to zero out
 * @param locationId - The GraphQL ID of the location
 * @returns Results for each SKU
 */
export async function zeroOutInventoryForSkus(
    ctx: ShopifyClientContext,
    skus: string[],
    locationId: string
): Promise<{ sku: string; result: SetInventoryResult }[]> {
    const results: { sku: string; result: SetInventoryResult }[] = [];

    // Batch lookup all SKUs
    const inventoryItems = await getInventoryItemsBySkus(ctx, skus);

    for (const sku of skus) {
        const item = inventoryItems.get(sku);

        if (!item) {
            results.push({ sku, result: { success: false, error: `SKU not found: ${sku}` } });
            continue;
        }

        // Only set to zero if current quantity > 0
        if (item.inventoryQuantity <= 0) {
            results.push({
                sku,
                result: {
                    success: true,
                    inventoryItemId: item.inventoryItemId,
                    locationId,
                    quantity: 0,
                }
            });
            continue;
        }

        const result = await setInventoryQuantity(ctx, item.inventoryItemId, locationId, 0);
        results.push({ sku, result });

        // Small delay between mutations
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    return results;
}
