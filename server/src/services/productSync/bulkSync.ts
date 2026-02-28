/**
 * Product Sync Service — Bulk Sync & Webhooks
 */

import type { PrismaClient } from '@prisma/client';
import type { ShopifyProduct } from '../shopify/index.js';
import type {
    CacheAndProcessResult,
    ProductDeletionResult,
    ShopifyProductWithImages,
    SyncAllProductsOptions,
    SyncAllProductsResults,
    SyncAllProductsReturn,
} from './types.js';
import shopifyClient from '../shopify/index.js';
import logger from '../../utils/logger.js';
import { syncSingleProduct } from './productSync.js';

const log = logger.child({ module: 'product-sync' });

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
    } catch (error: unknown) {
        // Store error in cache
        await prisma.shopifyProductCache.update({
            where: { id: shopifyProductId },
            data: {
                processingError: error instanceof Error ? error.message : String(error),
            },
        }).catch(() => { }); // Ignore error if cache entry doesn't exist

        log.error({ product: shopifyProduct.title, err: error }, 'Error processing product');
        return {
            action: 'error',
            error: error instanceof Error ? error.message : String(error),
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
        } catch (productError: unknown) {
            console.error(`[productSync] Failed to sync product "${shopifyProduct.title}":`, productError);
            results.errors.push(`Product ${shopifyProduct.title}: ${productError instanceof Error ? productError.message : String(productError)}`);
            results.skipped++;
        }
    }

    return { shopifyProducts, results };
}
