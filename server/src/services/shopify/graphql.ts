import type {
    ShopifyClientContext,
    ProductFeedGraphQLResponse,
    ProductFeedData,
    VariantFeedData,
} from './types.js';
import { shopifyLogger } from '../../utils/logger.js';

/**
 * Fetch full feed-level data for a product via GraphQL:
 * collections, publications (sales channels), variant metafields, inventory by location.
 * One API call for everything.
 */
export async function getProductFeedData(
    ctx: ShopifyClientContext,
    shopifyProductId: string | number
): Promise<ProductFeedData> {
    if (!ctx.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    const gid = `gid://shopify/Product/${shopifyProductId}`;

    const query = `
        query ProductFeedData($id: ID!) {
            product(id: $id) {
                collections(first: 50) {
                    edges {
                        node {
                            id
                            title
                            handle
                        }
                    }
                }
                resourcePublications(first: 20) {
                    edges {
                        node {
                            isPublished
                            publication {
                                name
                            }
                        }
                    }
                }
                variants(first: 100) {
                    edges {
                        node {
                            id
                            title
                            sku
                            metafields(first: 30) {
                                edges {
                                    node {
                                        namespace
                                        key
                                        value
                                        type
                                    }
                                }
                            }
                            inventoryItem {
                                id
                                inventoryLevels(first: 10) {
                                    edges {
                                        node {
                                            id
                                            location {
                                                name
                                            }
                                            quantities(names: ["available", "committed", "on_hand"]) {
                                                name
                                                quantity
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const data = await ctx.executeGraphQL<ProductFeedGraphQLResponse>(query, { id: gid });
        const product = data.product;

        // Transform collections
        const collections = (product.collections?.edges ?? []).map(e => ({
            title: e.node.title,
            handle: e.node.handle,
        }));

        // Transform publications (sales channels)
        const salesChannels = (product.resourcePublications?.edges ?? []).map(e => ({
            name: e.node.publication.name,
            isPublished: e.node.isPublished,
        }));

        // Transform variant data
        const variantEnrichments: VariantFeedData[] = (product.variants?.edges ?? []).map(e => {
            const v = e.node;
            const variantId = v.id.replace('gid://shopify/ProductVariant/', '');

            const metafields = (v.metafields?.edges ?? []).map(mf => ({
                namespace: mf.node.namespace,
                key: mf.node.key,
                value: mf.node.value,
                type: mf.node.type,
            }));

            const inventoryLevels = (v.inventoryItem?.inventoryLevels?.edges ?? []).map(il => ({
                locationName: il.node.location.name,
                quantities: (il.node.quantities ?? []).reduce((acc: Record<string, number>, q) => {
                    acc[q.name] = q.quantity;
                    return acc;
                }, {}),
            }));

            return {
                variantId,
                sku: v.sku ?? null,
                title: v.title,
                metafields,
                inventoryLevels,
            };
        });

        return { collections, salesChannels, variantEnrichments };
    } catch (error: unknown) {
        shopifyLogger.error({ shopifyProductId, error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to fetch product feed data');
        return { collections: [], salesChannels: [], variantEnrichments: [] };
    }
}
