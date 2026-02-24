/**
 * Product Sync Service
 * Shared logic for syncing products from Shopify to ERP
 * Used by both background jobs (syncWorker.ts) and direct sync routes (shopify.js)
 */

// Re-export all types
export type {
    ShopifyImage,
    ShopifyProductWithImages,
    ShopifyVariantWithInventory,
    VariantImageMap,
    VariantsByColor,
    SyncResult,
    CacheAndProcessResult,
    ProductDeletionResult,
    SyncAllProductsOptions,
    SyncAllProductsResults,
    SyncAllProductsReturn,
    DryRunProductAction,
    DryRunVariationAction,
    DryRunSkuAction,
    DryRunOrphan,
    DryRunResult,
} from './types.js';

// Re-export variant utilities
export {
    normalizeSize,
    buildVariantImageMap,
    resolveOptionPositions,
    groupVariantsByColor,
} from './variantUtils.js';

// Re-export SKU sync
export { syncSingleSku } from './skuSync.js';

// Re-export product sync
export { syncSingleProduct, copyProductBomTemplates } from './productSync.js';

// Re-export bulk sync & webhook handlers
export { cacheAndProcessProduct, handleProductDeletion, syncAllProducts } from './bulkSync.js';

// Re-export dry-run
export { dryRunSync } from './dryRun.js';
