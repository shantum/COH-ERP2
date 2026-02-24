/**
 * Product Sync Service — Type Definitions
 */

import type { ShopifyProduct, ShopifyVariant } from '../shopify/index.js';

/**
 * Image object from Shopify product
 */
export interface ShopifyImage {
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
export interface ShopifyProductWithImages extends ShopifyProduct {
    images?: ShopifyImage[];
    image?: { src: string };
}

/**
 * Extended Shopify variant with inventory fields
 */
export interface ShopifyVariantWithInventory extends ShopifyVariant {
    inventory_item_id?: number;
    inventory_quantity?: number;
    compare_at_price?: string | null;
}

/**
 * Map of variant ID to image URL
 */
export type VariantImageMap = Record<number, string>;

/**
 * Map of color name to variants array
 */
export type VariantsByColor = Record<string, ShopifyVariantWithInventory[]>;

/**
 * Sync result counts
 */
export interface SyncResult {
    created: number;
    updated: number;
    productId?: string;
}

/**
 * Product cache and sync result
 */
export interface CacheAndProcessResult {
    action: 'created' | 'updated' | 'error';
    productId?: string;
    created?: number;
    updated?: number;
    error?: string;
}

/**
 * Product deletion result
 */
export interface ProductDeletionResult {
    action: 'deleted' | 'not_found';
    count: number;
}

/**
 * Sync all products options
 */
export interface SyncAllProductsOptions {
    limit?: number;
    syncAll?: boolean;
    onProgress?: (progress: { current: number; total: number; product: string }) => void;
}

/**
 * Sync all products results
 */
export interface SyncAllProductsResults {
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
export interface SyncAllProductsReturn {
    shopifyProducts: ShopifyProduct[];
    results: SyncAllProductsResults;
}

// Dry-run types

export interface DryRunProductAction {
    shopifyProductId: string;
    title: string;
    handle: string;
    action: 'create' | 'update';
    fieldChanges?: Record<string, { from: string | null; to: string | null }>;
}

export interface DryRunVariationAction {
    shopifyProductId: string;
    colorName: string;
    action: 'create' | 'exists' | 'move';
    productTitle: string;
    fromProductId?: string;
}

export interface DryRunSkuAction {
    shopifyVariantId: string;
    skuCode: string;
    action: 'create' | 'update' | 'move';
    fromVariationId?: string;
    toVariationId?: string;
}

export interface DryRunOrphan {
    variationId: string;
    colorName: string;
    productName: string;
    productId: string;
    skuCount: number;
}

export interface DryRunResult {
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
