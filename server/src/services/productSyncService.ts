/**
 * Product Sync Service
 * Shared logic for syncing products from Shopify to ERP
 * Used by both background jobs (syncWorker.ts) and direct sync routes (shopify.js)
 */

import type { PrismaClient, Fabric, Product } from '@prisma/client';
import type { ShopifyProduct, ShopifyVariant } from './shopify.js';
import shopifyClient from './shopify.js';
import { resolveProductCategory } from '../config/mappings/index.js';

// ============================================
// TYPES & INTERFACES
// ============================================

/**
 * Image object from Shopify product
 */
interface ShopifyImage {
    id: number;
    product_id: number;
    position: number;
    src: string;
    alt?: string;
    width?: number;
    height?: number;
    variant_ids?: number[];
}

/**
 * Extended Shopify product with images array
 */
interface ShopifyProductWithImages extends ShopifyProduct {
    images?: ShopifyImage[];
    image?: { src: string };
}

/**
 * Extended Shopify variant with inventory fields
 */
interface ShopifyVariantWithInventory extends ShopifyVariant {
    inventory_item_id?: number;
    inventory_quantity?: number;
}

/**
 * Map of variant ID to image URL
 */
type VariantImageMap = Record<number, string>;

/**
 * Map of color name to variants array
 */
type VariantsByColor = Record<string, ShopifyVariantWithInventory[]>;

/**
 * Sync result counts
 */
interface SyncResult {
    created: number;
    updated: number;
}

/**
 * Product cache and sync result
 */
interface CacheAndProcessResult {
    action: 'created' | 'updated' | 'error';
    productId?: string;
    created?: number;
    updated?: number;
    error?: string;
}

/**
 * Product deletion result
 */
interface ProductDeletionResult {
    action: 'deleted' | 'not_found';
    count: number;
}

/**
 * Sync all products options
 */
interface SyncAllProductsOptions {
    limit?: number;
    syncAll?: boolean;
    onProgress?: (progress: { current: number; total: number; product: string }) => void;
}

/**
 * Sync all products results
 */
interface SyncAllProductsResults {
    created: {
        products: number;
        variations: number;
        skus: number;
    };
    updated: {
        products: number;
        variations: number;
        skus: number;
    };
    skipped: number;
    errors: string[];
}

/**
 * Sync all products return value
 */
interface SyncAllProductsReturn {
    shopifyProducts: ShopifyProduct[];
    results: SyncAllProductsResults;
}

// ============================================
// EXPORTED FUNCTIONS
// ============================================

/**
 * Ensure a default fabric exists for new variations
 * NOTE: FabricType removed - fabric now links to Material directly
 * NOTE: fabricId removed from Variation - fabric assignment now via BOM
 * This function still creates a default Fabric for backward compatibility with
 * existing code that may reference it, but variations are no longer linked to fabrics directly.
 */
export async function ensureDefaultFabric(prisma: PrismaClient): Promise<Fabric> {
    let defaultFabric = await prisma.fabric.findFirst({
        where: { name: 'Default Fabric' }
    });
    if (!defaultFabric) {
        // Create or find default material
        let material = await prisma.material.findFirst({
            where: { name: 'Default' }
        });
        if (!material) {
            material = await prisma.material.create({
                data: { name: 'Default' }
            });
        }
        defaultFabric = await prisma.fabric.create({
            data: {
                materialId: material.id,
                name: 'Default Fabric',
                colorName: 'Default',
                costPerUnit: 0,
                defaultLeadTimeDays: 14,
                defaultMinOrderQty: 1
            }
        });
    }
    return defaultFabric;
}

/**
 * Normalize size values (e.g., XXL -> 2XL)
 */
export function normalizeSize(rawSize: string): string {
    return rawSize
        .replace(/^XXXXL$/i, '4XL')
        .replace(/^XXXL$/i, '3XL')
        .replace(/^XXL$/i, '2XL');
}

/**
 * Build variant-to-image mapping from Shopify product images
 */
export function buildVariantImageMap(shopifyProduct: ShopifyProductWithImages): VariantImageMap {
    const variantImageMap: VariantImageMap = {};
    for (const img of shopifyProduct.images || []) {
        for (const variantId of img.variant_ids || []) {
            variantImageMap[variantId] = img.src;
        }
    }
    return variantImageMap;
}

/**
 * Group variants by color option
 */
export function groupVariantsByColor(variants: ShopifyVariantWithInventory[]): VariantsByColor {
    const variantsByColor: VariantsByColor = {};
    for (const variant of variants || []) {
        const colorOption = variant.option1 || 'Default';
        if (!variantsByColor[colorOption]) {
            variantsByColor[colorOption] = [];
        }
        variantsByColor[colorOption].push(variant);
    }
    return variantsByColor;
}

/**
 * Sync a single product from Shopify to the database
 * Uses 3-tier matching: SKU-first → Title match → Create new
 * 
 * This prevents duplicates when multiple Shopify products share the same title
 * (e.g., each color variant is a separate Shopify product)
 */
export async function syncSingleProduct(
    prisma: PrismaClient,
    shopifyProduct: ShopifyProductWithImages,
    defaultFabricId: string
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };

    const shopifyProductId = String(shopifyProduct.id);
    const mainImageUrl = shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null;
    // Use tags as source of truth for gender
    const gender = shopifyClient.extractGenderFromMetafields(null, shopifyProduct.product_type, shopifyProduct.tags || null);
    const variantImageMap = buildVariantImageMap(shopifyProduct);

    // Extract all SKU codes from incoming Shopify variants
    const incomingSkuCodes = (shopifyProduct.variants || [])
        .map(v => v.sku?.trim())
        .filter((sku): sku is string => Boolean(sku));

    let product: Product | null = null;

    // ============================================
    // TIER 1: SKU-FIRST MATCHING (Primary)
    // Find if ANY incoming SKU already exists → trace to its Product
    // IMPORTANT: Only use if gender matches (men/women can have same SKU patterns)
    // ============================================

    if (incomingSkuCodes.length > 0) {
        const existingSku = await prisma.sku.findFirst({
            where: { skuCode: { in: incomingSkuCodes } },
            include: {
                variation: {
                    include: { product: true }
                }
            }
        });

        if (existingSku) {
            const foundProduct = existingSku.variation.product;

            // CRITICAL: Verify gender matches before using this product
            // Men's and women's products can share same title and color
            const genderMatches = foundProduct.gender === gender ||
                foundProduct.gender === 'unisex' ||
                gender === 'unisex';

            if (genderMatches) {
                product = foundProduct;

                // Add this Shopify ID to the product's linked IDs if not present
                if (!product.shopifyProductIds.includes(shopifyProductId)) {
                    await prisma.product.update({
                        where: { id: product.id },
                        data: {
                            shopifyProductIds: { push: shopifyProductId }
                        }
                    });
                    result.updated++;
                }
            }
            // If gender doesn't match, fall through to Tier 2
        }
    }

    // ============================================
    // TIER 2: TITLE + GENDER MATCHING (Fallback)
    // Find product by title AND gender (men's/women's versions should stay separate)
    // ============================================

    if (!product) {
        // First try matching by title + gender (preferred - keeps men/women separate)
        product = await prisma.product.findFirst({
            where: {
                name: shopifyProduct.title,
                gender: gender || 'unisex'
            }
        });

        // If no match with same gender, try finding any product with same title
        // but only if the existing product is 'unisex' (can absorb gendered variants)
        if (!product) {
            const existingByTitle = await prisma.product.findFirst({
                where: { name: shopifyProduct.title }
            });

            // Only merge if existing is unisex (not a specific gender product)
            if (existingByTitle && existingByTitle.gender === 'unisex') {
                product = existingByTitle;
            }
        }

        if (product) {
            // Link this Shopify product to existing
            if (!product.shopifyProductIds.includes(shopifyProductId)) {
                const updateData: { shopifyProductIds?: { push: string }; shopifyProductId?: string } = {
                    shopifyProductIds: { push: shopifyProductId }
                };

                // Set primary ID if not set
                if (!product.shopifyProductId) {
                    updateData.shopifyProductId = shopifyProductId;
                }

                await prisma.product.update({
                    where: { id: product.id },
                    data: updateData
                });
                result.updated++;
            }
        }
    }

    // ============================================
    // TIER 3: CREATE NEW PRODUCT
    // Only if no SKU or title match
    // ============================================

    if (!product) {
        product = await prisma.product.create({
            data: {
                name: shopifyProduct.title,
                shopifyProductId: shopifyProductId,
                shopifyProductIds: [shopifyProductId],
                shopifyHandle: shopifyProduct.handle,
                category: resolveProductCategory({
                    product_type: shopifyProduct.product_type,
                    tags: shopifyProduct.tags,
                }),
                productType: 'basic',
                gender: gender || 'unisex',
                baseProductionTimeMins: 60,
                imageUrl: mainImageUrl,
            },
        });
        result.created++;
    } else {
        // Product exists - refresh key fields from Shopify on every resync
        const updates: Partial<Product> = {};
        if (mainImageUrl && mainImageUrl !== product.imageUrl) updates.imageUrl = mainImageUrl;
        if (shopifyProduct.handle && shopifyProduct.handle !== product.shopifyHandle) {
            updates.shopifyHandle = shopifyProduct.handle;
        }
        if (gender && gender !== product.gender) updates.gender = gender;

        // Update category if Shopify tags changed (recalculate from current data)
        const resolvedCategory = resolveProductCategory({
            product_type: shopifyProduct.product_type,
            tags: shopifyProduct.tags,
        });
        if (resolvedCategory !== product.category) {
            updates.category = resolvedCategory;
        }

        if (Object.keys(updates).length > 0) {
            await prisma.product.update({
                where: { id: product.id },
                data: updates,
            });
        }
    }

    // ============================================
    // SYNC VARIATIONS & SKUs
    // Track which Shopify product each color came from
    // ============================================

    const variantsByColor = groupVariantsByColor(shopifyProduct.variants as ShopifyVariantWithInventory[]);

    for (const [colorName, variants] of Object.entries(variantsByColor)) {
        const firstVariantId = variants[0]?.id;
        const variationImageUrl = variantImageMap[firstVariantId] || mainImageUrl;

        // Find or create variation (with source tracking)
        let variation = await prisma.variation.findFirst({
            where: { productId: product.id, colorName },
        });

        if (!variation) {
            // NOTE: fabricId removed from Variation - fabric assignment now via BOM
            variation = await prisma.variation.create({
                data: {
                    productId: product.id,
                    colorName,
                    imageUrl: variationImageUrl,
                    shopifySourceProductId: shopifyProductId,  // Track source
                    shopifySourceHandle: shopifyProduct.handle,
                },
            });
            result.created++;
        } else {
            // Update source tracking and refresh image from Shopify
            const variationUpdates: Record<string, string | null> = {};
            if (!variation.shopifySourceProductId) {
                variationUpdates.shopifySourceProductId = shopifyProductId;
                variationUpdates.shopifySourceHandle = shopifyProduct.handle;
            }
            if (variationImageUrl && variationImageUrl !== variation.imageUrl) {
                variationUpdates.imageUrl = variationImageUrl;
            }

            if (Object.keys(variationUpdates).length > 0) {
                await prisma.variation.update({
                    where: { id: variation.id },
                    data: variationUpdates,
                });
                result.updated++;
            }
        }

        // Process SKUs for each variant
        for (const variant of variants) {
            const skuResult = await syncSingleSku(prisma, variant, variation.id, shopifyProduct.handle, colorName);
            result.created += skuResult.created;
            result.updated += skuResult.updated;
        }
    }

    return result;
}


/**
 * Sync a single SKU from Shopify variant
 */
async function syncSingleSku(
    prisma: PrismaClient,
    variant: ShopifyVariantWithInventory,
    variationId: string,
    productHandle: string,
    colorName: string
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };

    const shopifyVariantId = String(variant.id);
    const skuCode = variant.sku?.trim() ||
        `${productHandle}-${colorName}-${variant.option2 || 'OS'}`.replace(/\s+/g, '-').toUpperCase();
    const rawSize = variant.option2 || variant.option3 || 'One Size';
    const size = normalizeSize(rawSize);

    // Check if SKU exists by shopifyVariantId or skuCode
    let sku = await prisma.sku.findFirst({
        where: {
            OR: [
                { shopifyVariantId },
                { skuCode },
            ],
        },
    });

    if (sku) {
        // Update existing SKU
        // If Shopify now has a proper SKU (barcode) and our stored code is a slug fallback, update it
        const shopifySku = variant.sku?.trim();
        const shouldUpdateSkuCode = shopifySku && shopifySku !== sku.skuCode && /[a-zA-Z].*-/.test(sku.skuCode);
        const shopifyPrice = parseFloat(variant.price);
        const newMrp = shopifyPrice > 0 ? shopifyPrice : sku.mrp;
        await prisma.sku.update({
            where: { id: sku.id },
            data: {
                ...(shouldUpdateSkuCode ? { skuCode: shopifySku } : {}),
                shopifyVariantId,
                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                mrp: newMrp,
            },
        });

        // Update Shopify inventory cache
        if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
            await prisma.shopifyInventoryCache.upsert({
                where: { skuId: sku.id },
                update: {
                    shopifyInventoryItemId: String(variant.inventory_item_id),
                    availableQty: variant.inventory_quantity,
                    lastSynced: new Date(),
                },
                create: {
                    skuId: sku.id,
                    shopifyInventoryItemId: String(variant.inventory_item_id),
                    availableQty: variant.inventory_quantity,
                },
            });
        }
        result.updated++;
    } else {
        // Create new SKU
        const newSku = await prisma.sku.create({
            data: {
                variationId,
                skuCode,
                size,
                mrp: parseFloat(variant.price) || 0,
                fabricConsumption: 1.5,
                targetStockQty: 10,
                shopifyVariantId,
                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
            },
        });

        // Create Shopify inventory cache
        if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
            await prisma.shopifyInventoryCache.create({
                data: {
                    skuId: newSku.id,
                    shopifyInventoryItemId: String(variant.inventory_item_id),
                    availableQty: variant.inventory_quantity,
                },
            });
        }
        result.created++;
    }

    return result;
}

/**
 * Cache and process a single product from Shopify webhook
 * Similar to order processing: cache first, then sync to ERP
 */
export async function cacheAndProcessProduct(
    prisma: PrismaClient,
    shopifyProduct: ShopifyProductWithImages,
    webhookTopic: string = 'products/update'
): Promise<CacheAndProcessResult> {
    const shopifyProductId = String(shopifyProduct.id);

    try {
        // Cache raw product data first
        await prisma.shopifyProductCache.upsert({
            where: { id: shopifyProductId },
            update: {
                rawData: JSON.stringify(shopifyProduct),
                title: shopifyProduct.title,
                handle: shopifyProduct.handle,
                lastWebhookAt: new Date(),
                webhookTopic,
                processingError: null, // Clear previous error
            },
            create: {
                id: shopifyProductId,
                rawData: JSON.stringify(shopifyProduct),
                title: shopifyProduct.title,
                handle: shopifyProduct.handle,
                webhookTopic,
            },
        });

        // Ensure default fabric exists
        const defaultFabric = await ensureDefaultFabric(prisma);

        // Sync product to ERP
        const result = await syncSingleProduct(prisma, shopifyProduct, defaultFabric.id);

        // Mark as processed
        await prisma.shopifyProductCache.update({
            where: { id: shopifyProductId },
            data: { processedAt: new Date() },
        });

        // Find the product to return its ID
        const product = await prisma.product.findUnique({
            where: { shopifyProductId },
        });

        return {
            action: result.created > 0 ? 'created' : 'updated',
            productId: product?.id,
            created: result.created,
            updated: result.updated,
        };
    } catch (error) {
        // Store error in cache
        await prisma.shopifyProductCache.update({
            where: { id: shopifyProductId },
            data: {
                processingError: (error as Error).message,
            },
        }).catch(() => { }); // Ignore error if cache entry doesn't exist

        console.error(`Error processing product ${shopifyProduct.title}:`, error);
        return {
            action: 'error',
            error: (error as Error).message,
        };
    }
}

/**
 * Handle product deletion from Shopify
 */
export async function handleProductDeletion(
    prisma: PrismaClient,
    shopifyProductId: string | number
): Promise<ProductDeletionResult> {
    const id = String(shopifyProductId);

    // Mark product as inactive
    const result = await prisma.product.updateMany({
        where: { shopifyProductId: id },
        data: { isActive: false },
    });

    // Remove from cache
    await prisma.shopifyProductCache.deleteMany({
        where: { id },
    }).catch(() => { }); // Ignore if not in cache

    return {
        action: result.count > 0 ? 'deleted' : 'not_found',
        count: result.count,
    };
}

/**
 * Sync all products from Shopify
 */
export async function syncAllProducts(
    prisma: PrismaClient,
    options: SyncAllProductsOptions = {}
): Promise<SyncAllProductsReturn> {
    const { limit = 50, syncAll = false, onProgress } = options;

    const results: SyncAllProductsResults = {
        created: { products: 0, variations: 0, skus: 0 },
        updated: { products: 0, variations: 0, skus: 0 },
        skipped: 0,
        errors: [],
    };

    // Fetch products from Shopify (all statuses to keep cache up-to-date)
    let shopifyProducts: ShopifyProduct[];
    if (syncAll) {
        console.log('Fetching ALL products from Shopify...');
        shopifyProducts = await shopifyClient.getAllProducts();
        console.log(`Fetched ${shopifyProducts.length} products total`);
    } else {
        // Use status: 'any' to fetch active, archived, and draft products
        shopifyProducts = await shopifyClient.getProducts({ limit, status: 'any' });
    }

    // Ensure default fabric exists
    const defaultFabric = await ensureDefaultFabric(prisma);

    for (let i = 0; i < shopifyProducts.length; i++) {
        const shopifyProduct = shopifyProducts[i] as ShopifyProductWithImages;
        try {
            // Cache the product data first (for status lookup in catalog)
            const shopifyProductId = String(shopifyProduct.id);
            await prisma.shopifyProductCache.upsert({
                where: { id: shopifyProductId },
                update: {
                    rawData: JSON.stringify(shopifyProduct),
                    title: shopifyProduct.title,
                    handle: shopifyProduct.handle,
                    lastWebhookAt: new Date(),
                    webhookTopic: 'manual_sync',
                    processingError: null,
                },
                create: {
                    id: shopifyProductId,
                    rawData: JSON.stringify(shopifyProduct),
                    title: shopifyProduct.title,
                    handle: shopifyProduct.handle,
                    webhookTopic: 'manual_sync',
                },
            });

            const productResult = await syncSingleProduct(prisma, shopifyProduct, defaultFabric.id);

            // Mark as processed
            await prisma.shopifyProductCache.update({
                where: { id: shopifyProductId },
                data: { processedAt: new Date() },
            });

            // Aggregate results (simplified - counts all as products/variations/skus)
            if (productResult.created > 0) results.created.products++;
            if (productResult.updated > 0) results.updated.products++;

            // Report progress if callback provided
            if (onProgress) {
                onProgress({
                    current: i + 1,
                    total: shopifyProducts.length,
                    product: shopifyProduct.title,
                });
            }
        } catch (productError) {
            results.errors.push(`Product ${shopifyProduct.title}: ${(productError as Error).message}`);
            results.skipped++;
        }
    }

    return { shopifyProducts, results };
}
