/**
 * Product Sync Service
 * Shared logic for syncing products from Shopify to ERP
 * Used by both background jobs (syncWorker.ts) and direct sync routes (shopify.js)
 */

import type { PrismaClient, Product } from '@prisma/client';
import type { ShopifyProduct, ShopifyVariant } from './shopify.js';
import shopifyClient from './shopify.js';
import { resolveProductCategory } from '../config/mappings/index.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'product-sync' });

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
    compare_at_price?: string | null;
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
    productId?: string;
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
 * Resolve which option position holds "Color" and which holds "Size".
 * Shopify products have options like [{name:"Color", position:1}, {name:"Size", position:2}]
 * but the order isn't guaranteed — some products put Size first.
 * Returns the option key (option1/option2/option3) for color and size.
 */
function resolveOptionPositions(options: Array<{ name: string; position: number }>): {
    colorKey: 'option1' | 'option2' | 'option3';
    sizeKey: 'option1' | 'option2' | 'option3';
} {
    const positionMap = { 1: 'option1', 2: 'option2', 3: 'option3' } as const;
    let colorKey: 'option1' | 'option2' | 'option3' = 'option1';
    let sizeKey: 'option1' | 'option2' | 'option3' = 'option2';

    for (const opt of options) {
        const key = positionMap[opt.position as 1 | 2 | 3];
        if (!key) continue;
        const name = opt.name.toLowerCase();
        if (name === 'color' || name === 'colour') colorKey = key;
        if (name === 'size') sizeKey = key;
    }

    return { colorKey, sizeKey };
}

/**
 * Group variants by color option.
 * Uses product options array to determine which option holds color (not assumed to be option1).
 */
export function groupVariantsByColor(
    variants: ShopifyVariantWithInventory[],
    options?: Array<{ name: string; position: number }>,
): VariantsByColor {
    const { colorKey } = options?.length
        ? resolveOptionPositions(options)
        : { colorKey: 'option1' as const };

    const variantsByColor: VariantsByColor = {};
    for (const variant of variants || []) {
        const colorOption = variant[colorKey] || 'Default';
        if (!variantsByColor[colorOption]) {
            variantsByColor[colorOption] = [];
        }
        variantsByColor[colorOption].push(variant);
    }
    return variantsByColor;
}

/**
 * Copy ProductBomTemplate records from source product to target product.
 * Only copies if target has no templates yet. Uses skipDuplicates for idempotency.
 */
async function copyProductBomTemplates(
    prisma: PrismaClient,
    sourceProductId: string,
    targetProductId: string,
): Promise<number> {
    // Check if target already has templates
    const existingCount = await prisma.productBomTemplate.count({
        where: { productId: targetProductId },
    });
    if (existingCount > 0) return 0;

    // Fetch source templates
    const sourceTemplates = await prisma.productBomTemplate.findMany({
        where: { productId: sourceProductId },
    });
    if (sourceTemplates.length === 0) return 0;

    // Copy to target product
    const result = await prisma.productBomTemplate.createMany({
        data: sourceTemplates.map(t => ({
            productId: targetProductId,
            roleId: t.roleId,
            trimItemId: t.trimItemId,
            serviceItemId: t.serviceItemId,
            defaultQuantity: t.defaultQuantity,
            quantityUnit: t.quantityUnit,
            wastagePercent: t.wastagePercent,
            notes: t.notes,
        })),
        skipDuplicates: true,
    });

    if (result.count > 0) {
        log.info({ from: sourceProductId, to: targetProductId, count: result.count }, 'Copied ProductBomTemplate records');
    }
    return result.count;
}

/**
 * Sync a single product from Shopify to the database
 * 1:1 mapping: one Shopify product = one ERP product.
 * Matches by shopifyProductId (unique). Creates new if not found.
 */
export async function syncSingleProduct(
    prisma: PrismaClient,
    shopifyProduct: ShopifyProductWithImages,
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };

    const shopifyProductId = String(shopifyProduct.id);
    const mainImageUrl = shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null;
    const gender = shopifyClient.extractGenderFromMetafields(null, shopifyProduct.product_type, shopifyProduct.tags || null);
    const variantImageMap = buildVariantImageMap(shopifyProduct);

    // ============================================
    // FIND OR CREATE PRODUCT (1:1 by shopifyProductId)
    // ============================================

    let product = await prisma.product.findUnique({
        where: { shopifyProductId },
    });

    if (!product) {
        product = await prisma.product.create({
            data: {
                name: shopifyProduct.title,
                shopifyProductId,
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
        // Product exists — refresh key fields from Shopify
        const updates: Record<string, string | number | boolean> = {};
        if (mainImageUrl && mainImageUrl !== product.imageUrl) updates.imageUrl = mainImageUrl;
        if (shopifyProduct.handle && shopifyProduct.handle !== product.shopifyHandle) {
            updates.shopifyHandle = shopifyProduct.handle;
        }
        if (gender && gender !== product.gender) updates.gender = gender;
        if (shopifyProduct.title !== product.name) updates.name = shopifyProduct.title;

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

    result.productId = product.id;

    // ============================================
    // SYNC VARIATIONS & SKUs
    // ============================================

    const variantsByColor = groupVariantsByColor(
        shopifyProduct.variants as ShopifyVariantWithInventory[],
        shopifyProduct.options,
    );
    const { sizeKey } = shopifyProduct.options?.length
        ? resolveOptionPositions(shopifyProduct.options)
        : { sizeKey: 'option2' as const };

    for (const [colorName, variants] of Object.entries(variantsByColor)) {
        const firstVariantId = variants[0]?.id;
        const variationImageUrl = variantImageMap[firstVariantId] || mainImageUrl;

        // Priority 1: match by shopifySourceProductId (handles color renames on Shopify)
        // Priority 2: match by colorName
        let variation = await prisma.variation.findFirst({
            where: { productId: product.id, shopifySourceProductId: shopifyProductId },
        });

        if (variation && variation.colorName !== colorName) {
            log.info({ variationId: variation.id, old: variation.colorName, new: colorName }, 'Shopify color renamed, updating variation');
            await prisma.variation.update({
                where: { id: variation.id },
                data: { colorName },
            });
            variation = { ...variation, colorName };
            result.updated++;
        }

        if (!variation) {
            variation = await prisma.variation.findFirst({
                where: { productId: product.id, colorName },
            });
        }

        // Priority 3: variation ANYWHERE by shopifySourceProductId → MOVE to this product
        if (!variation) {
            variation = await prisma.variation.findFirst({
                where: { shopifySourceProductId: shopifyProductId },
            });
            if (variation) {
                const sourceProductId = variation.productId;
                await prisma.variation.update({
                    where: { id: variation.id },
                    data: { productId: product.id },
                });
                log.info({ variationId: variation.id, from: sourceProductId, to: product.id, colorName }, 'Moved variation to correct product');

                // Copy ProductBomTemplate from source product if new product has none
                await copyProductBomTemplates(prisma, sourceProductId, product.id);

                variation = { ...variation, productId: product.id };
                result.updated++;
            }
        }

        // Priority 4: create new variation
        if (!variation) {
            variation = await prisma.variation.create({
                data: {
                    productId: product.id,
                    colorName,
                    imageUrl: variationImageUrl,
                    shopifySourceProductId: shopifyProductId,
                    shopifySourceHandle: shopifyProduct.handle,
                },
            });
            result.created++;
        } else {
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
            const skuResult = await syncSingleSku(prisma, variant, variation.id, shopifyProduct.handle, colorName, sizeKey);
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
    colorName: string,
    sizeKey: 'option1' | 'option2' | 'option3' = 'option2'
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0 };

    const shopifyVariantId = String(variant.id);
    const sizeValue = variant[sizeKey];
    const skuCode = variant.sku?.trim() ||
        `${productHandle}-${colorName}-${sizeValue || 'OS'}`.replace(/\s+/g, '-').toUpperCase();
    const rawSize = sizeValue || 'One Size';
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
        // MRP = compare_at_price (original retail) if set, otherwise selling price
        const sellingPrice = parseFloat(variant.price) || 0;
        const compareAtPrice = parseFloat(variant.compare_at_price || '') || 0;
        const shopifyMrp = compareAtPrice > 0 ? compareAtPrice : sellingPrice;
        const newMrp = shopifyMrp > 0 ? shopifyMrp : sku.mrp;
        // sellingPrice only stored when discounted (compare_at_price is set and price < compare_at_price)
        const isDiscounted = compareAtPrice > 0 && sellingPrice > 0 && sellingPrice < compareAtPrice;
        await prisma.sku.update({
            where: { id: sku.id },
            data: {
                ...(shouldUpdateSkuCode ? { skuCode: shopifySku } : {}),
                // Fix variationId if SKU was stuck on wrong variation from old syncs
                ...(sku.variationId !== variationId ? { variationId } : {}),
                shopifyVariantId,
                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                mrp: newMrp,
                sellingPrice: isDiscounted ? sellingPrice : null,
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
        const createSellingPrice = parseFloat(variant.price) || 0;
        const createCompareAtPrice = parseFloat(variant.compare_at_price || '') || 0;
        const createMrp = createCompareAtPrice > 0 ? createCompareAtPrice : createSellingPrice;
        const createIsDiscounted = createCompareAtPrice > 0 && createSellingPrice > 0 && createSellingPrice < createCompareAtPrice;
        const newSku = await prisma.sku.create({
            data: {
                variationId,
                skuCode,
                size,
                mrp: createMrp,
                ...(createIsDiscounted ? { sellingPrice: createSellingPrice } : {}),
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

        // Sync product to ERP
        const result = await syncSingleProduct(prisma, shopifyProduct);

        // Mark as processed
        await prisma.shopifyProductCache.update({
            where: { id: shopifyProductId },
            data: { processedAt: new Date() },
        });

        return {
            action: result.created > 0 ? 'created' : 'updated',
            productId: result.productId,
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

        log.error({ product: shopifyProduct.title, err: error }, 'Error processing product');
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
        log.info('Fetching ALL products from Shopify');
        shopifyProducts = await shopifyClient.getAllProducts();
        log.info({ count: shopifyProducts.length }, 'Fetched all products');
    } else {
        // Use status: 'any' to fetch active, archived, and draft products
        shopifyProducts = await shopifyClient.getProducts({ limit, status: 'any' });
    }

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

            const productResult = await syncSingleProduct(prisma, shopifyProduct);

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

// ============================================
// DRY-RUN SYNC (read-only preview)
// ============================================

interface DryRunProductAction {
    shopifyProductId: string;
    title: string;
    handle: string;
    action: 'create' | 'update';
    fieldChanges?: Record<string, { from: string | null; to: string | null }>;
}

interface DryRunVariationAction {
    shopifyProductId: string;
    colorName: string;
    action: 'create' | 'exists' | 'move';
    productTitle: string;
    fromProductId?: string;
}

interface DryRunSkuAction {
    shopifyVariantId: string;
    skuCode: string;
    action: 'create' | 'update' | 'move';
    fromVariationId?: string;
    toVariationId?: string;
}

interface DryRunOrphan {
    variationId: string;
    colorName: string;
    productName: string;
    productId: string;
    skuCount: number;
}

interface DryRunResult {
    summary: {
        products: { create: number; update: number };
        variations: { create: number; existing: number; move: number };
        skus: { create: number; update: number; move: number };
        bomTemplateCopies: number;
        orphanedVariations: number;
    };
    products: DryRunProductAction[];
    variations: DryRunVariationAction[];
    skuMoves: DryRunSkuAction[];
    orphanedVariations: DryRunOrphan[];
}

/**
 * Dry-run: simulate the 1:1 sync and return what WOULD change.
 * All read-only — no writes to the database.
 */
export async function dryRunSync(
    prisma: PrismaClient,
    shopifyProducts: ShopifyProductWithImages[],
): Promise<DryRunResult> {
    const products: DryRunProductAction[] = [];
    const variations: DryRunVariationAction[] = [];
    const skuMoves: DryRunSkuAction[] = [];
    // Track which variations get "claimed" by a Shopify product
    const claimedVariationIds = new Set<string>();
    let bomTemplateCopyCount = 0;

    for (const sp of shopifyProducts) {
        const shopifyProductId = String(sp.id);
        const gender = shopifyClient.extractGenderFromMetafields(null, sp.product_type, sp.tags || null);
        const mainImageUrl = sp.image?.src || sp.images?.[0]?.src || null;

        // 1. Would we find or create the product?
        const existing = await prisma.product.findUnique({
            where: { shopifyProductId },
        });

        if (existing) {
            const fieldChanges: Record<string, { from: string | null; to: string | null }> = {};
            if (sp.title !== existing.name) fieldChanges.name = { from: existing.name, to: sp.title };
            if (gender && gender !== existing.gender) fieldChanges.gender = { from: existing.gender, to: gender };
            if (sp.handle && sp.handle !== existing.shopifyHandle) fieldChanges.handle = { from: existing.shopifyHandle, to: sp.handle };
            const resolvedCat = resolveProductCategory({ product_type: sp.product_type, tags: sp.tags });
            if (resolvedCat !== existing.category) fieldChanges.category = { from: existing.category, to: resolvedCat };
            if (mainImageUrl && mainImageUrl !== existing.imageUrl) fieldChanges.imageUrl = { from: existing.imageUrl, to: mainImageUrl };

            products.push({
                shopifyProductId, title: sp.title, handle: sp.handle,
                action: 'update',
                ...(Object.keys(fieldChanges).length > 0 ? { fieldChanges } : {}),
            });
        } else {
            products.push({
                shopifyProductId, title: sp.title, handle: sp.handle,
                action: 'create',
            });
        }

        // 2. Check variations
        const variantsByColor = groupVariantsByColor(
            sp.variants as ShopifyVariantWithInventory[],
            sp.options,
        );
        const { sizeKey } = sp.options?.length
            ? resolveOptionPositions(sp.options)
            : { sizeKey: 'option2' as const };

        for (const [colorName, variants] of Object.entries(variantsByColor)) {
            // Would we find a variation?
            let variation = existing
                ? await prisma.variation.findFirst({
                    where: { productId: existing.id, shopifySourceProductId: shopifyProductId },
                })
                : null;
            if (!variation && existing) {
                variation = await prisma.variation.findFirst({
                    where: { productId: existing.id, colorName },
                });
            }

            if (variation) {
                claimedVariationIds.add(variation.id);
                variations.push({
                    shopifyProductId, colorName, action: 'exists', productTitle: sp.title,
                });
            }

            // Priority 3: variation ANYWHERE by shopifySourceProductId → would MOVE
            if (!variation) {
                variation = await prisma.variation.findFirst({
                    where: { shopifySourceProductId: shopifyProductId },
                });
                if (variation) {
                    claimedVariationIds.add(variation.id);
                    variations.push({
                        shopifyProductId, colorName, action: 'move', productTitle: sp.title,
                        fromProductId: variation.productId,
                    });
                    // Check if BOM templates would be copied
                    if (existing) {
                        const targetTemplateCount = await prisma.productBomTemplate.count({ where: { productId: existing.id } });
                        if (targetTemplateCount === 0) {
                            const sourceTemplateCount = await prisma.productBomTemplate.count({ where: { productId: variation.productId } });
                            if (sourceTemplateCount > 0) bomTemplateCopyCount++;
                        }
                    }
                }
            }

            // Priority 4: create
            if (!variation) {
                variations.push({
                    shopifyProductId, colorName, action: 'create', productTitle: sp.title,
                });
            }

            // 3. Check SKUs — would any move?
            for (const variant of variants) {
                const shopifyVariantId = String(variant.id);
                const sizeValue = variant[sizeKey];
                const skuCode = variant.sku?.trim() ||
                    `${sp.handle}-${colorName}-${sizeValue || 'OS'}`.replace(/\s+/g, '-').toUpperCase();

                const existingSku = await prisma.sku.findFirst({
                    where: {
                        OR: [{ shopifyVariantId }, { skuCode }],
                    },
                });

                if (existingSku) {
                    if (variation && existingSku.variationId !== variation.id) {
                        skuMoves.push({
                            shopifyVariantId, skuCode: existingSku.skuCode,
                            action: 'move',
                            fromVariationId: existingSku.variationId,
                            toVariationId: variation.id,
                        });
                    }
                    // If product is new (no existing), the SKU will also move
                    if (!existing) {
                        skuMoves.push({
                            shopifyVariantId, skuCode: existingSku.skuCode,
                            action: 'move',
                            fromVariationId: existingSku.variationId,
                            toVariationId: '(new variation)',
                        });
                    }
                } else {
                    skuMoves.push({
                        shopifyVariantId, skuCode,
                        action: 'create',
                    });
                }
            }
        }
    }

    // 4. Find orphaned variations (on products with multiple shopifyProductIds, variations whose
    //    shopifySourceProductId doesn't match the product's primary shopifyProductId)
    const orphanedVariations: DryRunOrphan[] = [];
    const consolidatedProducts = await prisma.product.findMany({
        where: { shopifyProductIds: { isEmpty: false } },
        select: { id: true, name: true, shopifyProductId: true, shopifyProductIds: true },
    });

    for (const p of consolidatedProducts) {
        if (p.shopifyProductIds.length <= 1) continue;
        // Variations on this product that belong to a DIFFERENT Shopify product
        const vars = await prisma.variation.findMany({
            where: {
                productId: p.id,
                shopifySourceProductId: { not: p.shopifyProductId ?? undefined },
            },
            select: { id: true, colorName: true, _count: { select: { skus: true } } },
        });
        for (const v of vars) {
            if (!claimedVariationIds.has(v.id)) {
                orphanedVariations.push({
                    variationId: v.id,
                    colorName: v.colorName,
                    productName: p.name,
                    productId: p.id,
                    skuCount: v._count.skus,
                });
            }
        }
    }

    const summary = {
        products: {
            create: products.filter(p => p.action === 'create').length,
            update: products.filter(p => p.action === 'update').length,
        },
        variations: {
            create: variations.filter(v => v.action === 'create').length,
            existing: variations.filter(v => v.action === 'exists').length,
            move: variations.filter(v => v.action === 'move').length,
        },
        skus: {
            create: skuMoves.filter(s => s.action === 'create').length,
            update: skuMoves.filter(s => s.action === 'update').length,
            move: skuMoves.filter(s => s.action === 'move').length,
        },
        bomTemplateCopies: bomTemplateCopyCount,
        orphanedVariations: orphanedVariations.length,
    };

    return { summary, products, variations, skuMoves, orphanedVariations };
}
