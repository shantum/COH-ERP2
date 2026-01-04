/**
 * Product Sync Service
 * Shared logic for syncing products from Shopify to ERP
 * Used by both background jobs (syncWorker.js) and direct sync routes (shopify.js)
 */

import shopifyClient from './shopify.js';

/**
 * Ensure a default fabric exists for new variations
 * @param {PrismaClient} prisma - Prisma client instance
 * @returns {Object} Default fabric record
 */
export async function ensureDefaultFabric(prisma) {
    let defaultFabric = await prisma.fabric.findFirst();
    if (!defaultFabric) {
        let fabricType = await prisma.fabricType.findFirst();
        if (!fabricType) {
            fabricType = await prisma.fabricType.create({
                data: { name: 'Default', composition: 'Unknown', unit: 'meter', avgShrinkagePct: 0 }
            });
        }
        defaultFabric = await prisma.fabric.create({
            data: {
                fabricTypeId: fabricType.id,
                name: 'Default Fabric',
                colorName: 'Default',
                costPerUnit: 0,
                leadTimeDays: 14,
                minOrderQty: 1
            }
        });
    }
    return defaultFabric;
}

/**
 * Normalize size values (e.g., XXL -> 2XL)
 * @param {string} rawSize - Raw size string from Shopify
 * @returns {string} Normalized size
 */
export function normalizeSize(rawSize) {
    return rawSize
        .replace(/^XXXXL$/i, '4XL')
        .replace(/^XXXL$/i, '3XL')
        .replace(/^XXL$/i, '2XL');
}

/**
 * Build variant-to-image mapping from Shopify product images
 * @param {Object} shopifyProduct - Shopify product object
 * @returns {Object} Map of variantId -> imageUrl
 */
export function buildVariantImageMap(shopifyProduct) {
    const variantImageMap = {};
    for (const img of shopifyProduct.images || []) {
        for (const variantId of img.variant_ids || []) {
            variantImageMap[variantId] = img.src;
        }
    }
    return variantImageMap;
}

/**
 * Group variants by color option
 * @param {Array} variants - Shopify variants array
 * @returns {Object} Map of colorName -> variants[]
 */
export function groupVariantsByColor(variants) {
    const variantsByColor = {};
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
 * Uses ID matching: shopifyProductId first, fallback to name
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} shopifyProduct - Shopify product data
 * @param {string} defaultFabricId - ID of default fabric for new variations
 * @returns {Object} Results { created, updated }
 */
export async function syncSingleProduct(prisma, shopifyProduct, defaultFabricId) {
    const result = { created: 0, updated: 0 };

    const shopifyProductId = String(shopifyProduct.id);
    const mainImageUrl = shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null;
    const gender = shopifyClient.normalizeGender(shopifyProduct.product_type);
    const variantImageMap = buildVariantImageMap(shopifyProduct);

    // Find product by shopifyProductId first (preferred), then by name (fallback)
    let product = await prisma.product.findUnique({
        where: { shopifyProductId },
    });

    if (!product) {
        // Fallback: find by name and gender
        product = await prisma.product.findFirst({
            where: { name: shopifyProduct.title, gender: gender || 'unisex' },
        });

        // If found by name, link to Shopify ID
        if (product && !product.shopifyProductId) {
            product = await prisma.product.update({
                where: { id: product.id },
                data: {
                    shopifyProductId,
                    shopifyHandle: shopifyProduct.handle,
                    imageUrl: mainImageUrl || product.imageUrl,
                },
            });
            result.updated++;
        }
    }

    if (!product) {
        // Try finding by name only (without gender)
        const existingByName = await prisma.product.findFirst({
            where: { name: shopifyProduct.title },
        });

        if (existingByName && !existingByName.shopifyProductId) {
            product = await prisma.product.update({
                where: { id: existingByName.id },
                data: {
                    shopifyProductId,
                    shopifyHandle: shopifyProduct.handle,
                    gender: gender || 'unisex',
                    imageUrl: mainImageUrl || existingByName.imageUrl,
                    category: shopifyProduct.product_type?.toLowerCase() || existingByName.category,
                },
            });
            result.updated++;
        } else {
            product = await prisma.product.create({
                data: {
                    name: shopifyProduct.title,
                    shopifyProductId,
                    shopifyHandle: shopifyProduct.handle,
                    category: shopifyProduct.product_type?.toLowerCase() || 'dress',
                    productType: 'basic',
                    gender: gender || 'unisex',
                    baseProductionTimeMins: 60,
                    imageUrl: mainImageUrl,
                },
            });
            result.created++;
        }
    } else {
        // Product exists - update if needed
        const updates = {};
        if (mainImageUrl && product.imageUrl !== mainImageUrl) updates.imageUrl = mainImageUrl;
        if (shopifyProduct.handle && product.shopifyHandle !== shopifyProduct.handle) updates.shopifyHandle = shopifyProduct.handle;

        if (Object.keys(updates).length > 0) {
            await prisma.product.update({
                where: { id: product.id },
                data: updates,
            });
            result.updated++;
        }
    }

    // Group variants by color and process
    const variantsByColor = groupVariantsByColor(shopifyProduct.variants);

    for (const [colorName, variants] of Object.entries(variantsByColor)) {
        const firstVariantId = variants[0]?.id;
        const variationImageUrl = variantImageMap[firstVariantId] || mainImageUrl;

        // Find or create variation
        let variation = await prisma.variation.findFirst({
            where: { productId: product.id, colorName },
        });

        if (!variation) {
            variation = await prisma.variation.create({
                data: {
                    productId: product.id,
                    colorName,
                    fabricId: defaultFabricId,
                    imageUrl: variationImageUrl,
                },
            });
            result.created++;
        } else if (variationImageUrl && variation.imageUrl !== variationImageUrl) {
            await prisma.variation.update({
                where: { id: variation.id },
                data: { imageUrl: variationImageUrl },
            });
            result.updated++;
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
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} variant - Shopify variant data
 * @param {string} variationId - Parent variation ID
 * @param {string} productHandle - Product handle for SKU code generation
 * @param {string} colorName - Color name for SKU code generation
 * @returns {Object} Results { created, updated }
 */
async function syncSingleSku(prisma, variant, variationId, productHandle, colorName) {
    const result = { created: 0, updated: 0 };

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
        await prisma.sku.update({
            where: { id: sku.id },
            data: {
                shopifyVariantId,
                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                mrp: parseFloat(variant.price) || sku.mrp,
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
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} shopifyProduct - Shopify product data
 * @param {string} webhookTopic - The webhook topic (products/create, products/update)
 * @returns {Object} Results { action, productId, error }
 */
export async function cacheAndProcessProduct(prisma, shopifyProduct, webhookTopic = 'products/update') {
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
                processingError: error.message,
            },
        }).catch(() => {}); // Ignore error if cache entry doesn't exist

        console.error(`Error processing product ${shopifyProduct.title}:`, error);
        return {
            action: 'error',
            error: error.message,
        };
    }
}

/**
 * Handle product deletion from Shopify
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string} shopifyProductId - Shopify product ID
 * @returns {Object} Results { action, productId }
 */
export async function handleProductDeletion(prisma, shopifyProductId) {
    const id = String(shopifyProductId);

    // Mark product as inactive
    const result = await prisma.product.updateMany({
        where: { shopifyProductId: id },
        data: { isActive: false },
    });

    // Remove from cache
    await prisma.shopifyProductCache.deleteMany({
        where: { id },
    }).catch(() => {}); // Ignore if not in cache

    return {
        action: result.count > 0 ? 'deleted' : 'not_found',
        count: result.count,
    };
}

/**
 * Sync all products from Shopify
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} options - Options { limit, syncAll, onProgress }
 * @returns {Object} Results { created, updated, skipped, errors }
 */
export async function syncAllProducts(prisma, options = {}) {
    const { limit = 50, syncAll = false, onProgress } = options;

    const results = {
        created: { products: 0, variations: 0, skus: 0 },
        updated: { products: 0, variations: 0, skus: 0 },
        skipped: 0,
        errors: [],
    };

    // Fetch products from Shopify
    let shopifyProducts;
    if (syncAll) {
        console.log('Fetching ALL products from Shopify...');
        shopifyProducts = await shopifyClient.getAllProducts();
        console.log(`Fetched ${shopifyProducts.length} products total`);
    } else {
        shopifyProducts = await shopifyClient.getProducts({ limit });
    }

    // Ensure default fabric exists
    const defaultFabric = await ensureDefaultFabric(prisma);

    for (let i = 0; i < shopifyProducts.length; i++) {
        const shopifyProduct = shopifyProducts[i];
        try {
            const productResult = await syncSingleProduct(prisma, shopifyProduct, defaultFabric.id);

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
            results.errors.push(`Product ${shopifyProduct.title}: ${productError.message}`);
            results.skipped++;
        }
    }

    return { shopifyProducts, results };
}
