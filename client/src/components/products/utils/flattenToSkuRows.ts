/**
 * flattenToSkuRows - Transform product tree into flat SKU rows
 *
 * Creates a flat array where every row is a single SKU (size).
 * Sorted: Product > Variation > Size (standard size order).
 * Includes flags for first-of-product and first-of-variation for border styling.
 */

import type { ProductTreeNode, ShopifyStatus } from '../types';
import { sortBySizeOrder } from '../types';

/**
 * A single SKU row for the flat SKU view.
 */
export interface SkuViewRow {
    id: string;

    // IDs
    skuId: string;
    variationId: string;
    productId: string;

    // Product-level
    productName: string;
    productStatus?: string;
    styleCode?: string;
    category?: string;
    garmentGroup?: string;
    gender?: string;
    productImageUrl?: string;
    variationImageUrl?: string;

    // Variation-level
    colorName?: string;
    colorHex?: string;
    fabricName?: string;
    fabricColourCode?: string;
    fabricColourName?: string;

    // SKU-level
    size?: string;
    skuCode?: string;
    mrp?: number;
    sellingPrice?: number;
    bomCost?: number | null;
    currentBalance?: number;

    // Shopify & Sales
    shopifyStatus?: ShopifyStatus;
    shopifyVariantId?: string;
    shopifyProductId?: string;
    shopifyPrice?: number;
    shopifySalePrice?: number;
    shopifySalePercent?: number;
    shopifyStock?: number;
    fabricStock?: number;
    fabricUnit?: string;
    sales30DayUnits?: number;

    // Grouping flags for border/display logic
    isFirstOfProduct: boolean;
    isFirstOfVariation: boolean;
    variationSkuCount: number;

    // Original node references for actions
    productNode: ProductTreeNode;
    variationNode: ProductTreeNode;
    skuNode: ProductTreeNode;
}

/**
 * Transform ProductTreeNode[] into flat SkuViewRow[].
 * Skips products with no variations and variations with no SKUs.
 */
export function flattenToSkuRows(products: ProductTreeNode[]): SkuViewRow[] {
    const rows: SkuViewRow[] = [];

    for (const product of products) {
        const variations = product.children || [];
        if (variations.length === 0) continue;

        let isFirstProduct = true;

        for (const variation of variations) {
            const skus = variation.children || [];
            if (skus.length === 0) continue;

            // Sort SKUs by size order
            const sortedSkus = [...skus].sort((a, b) =>
                sortBySizeOrder(a.size || '', b.size || '')
            );

            let isFirstVariation = true;

            for (const sku of sortedSkus) {
                rows.push({
                    id: `sku-${sku.id}`,
                    skuId: sku.id,
                    variationId: variation.id,
                    productId: product.id,

                    productName: product.name,
                    productStatus: product.status,
                    styleCode: product.styleCode,
                    category: product.category,
                    garmentGroup: product.garmentGroup,
                    gender: product.gender,
                    productImageUrl: product.imageUrl,
                    variationImageUrl: variation.imageUrl,

                    colorName: variation.colorName || variation.name,
                    colorHex: variation.colorHex,
                    fabricName: variation.fabricName,
                    fabricColourCode: variation.fabricColourCode,
                    fabricColourName: variation.fabricColourName,

                    size: sku.size,
                    skuCode: sku.skuCode,
                    mrp: sku.mrp,
                    sellingPrice: sku.sellingPrice,
                    bomCost: sku.bomCost,
                    currentBalance: sku.currentBalance,

                    shopifyStatus: variation.shopifyStatus,
                    shopifyVariantId: sku.shopifyVariantId,
                    shopifyProductId: sku.shopifyProductId || variation.shopifySourceProductId,
                    shopifyPrice: sku.shopifyPrice,
                    shopifySalePrice: sku.shopifySalePrice,
                    shopifySalePercent: sku.shopifySalePercent,
                    shopifyStock: sku.shopifyStock,
                    fabricStock: variation.fabricStock,
                    fabricUnit: variation.fabricUnit,
                    sales30DayUnits: sku.sales30DayUnits,

                    isFirstOfProduct: isFirstProduct,
                    isFirstOfVariation: isFirstVariation || isFirstProduct,
                    variationSkuCount: sortedSkus.length,

                    productNode: product,
                    variationNode: variation,
                    skuNode: sku,
                });

                isFirstProduct = false;
                isFirstVariation = false;
            }
        }
    }

    return rows;
}

/**
 * Filter SKU rows by search query.
 * Searches across product name, color, SKU code, style code, and fabric name.
 */
export function filterSkuRows(
    rows: SkuViewRow[],
    searchQuery: string
): SkuViewRow[] {
    if (!searchQuery.trim()) return rows;

    const query = searchQuery.toLowerCase();

    // First pass: find matching product/variation IDs and individual SKU matches
    const matchingProductIds = new Set<string>();
    const matchingVariationIds = new Set<string>();
    const matchingSkuIds = new Set<string>();

    for (const row of rows) {
        const matchesProduct =
            row.productName.toLowerCase().includes(query) ||
            row.styleCode?.toLowerCase().includes(query);

        const matchesVariation =
            row.colorName?.toLowerCase().includes(query) ||
            row.fabricName?.toLowerCase().includes(query) ||
            row.fabricColourName?.toLowerCase().includes(query);

        const matchesSku =
            row.skuCode?.toLowerCase().includes(query) ||
            row.size?.toLowerCase().includes(query);

        if (matchesProduct) matchingProductIds.add(row.productId);
        if (matchesVariation) matchingVariationIds.add(row.variationId);
        if (matchesSku) matchingSkuIds.add(row.skuId);
    }

    // Filter rows: include if product, variation, or individual SKU matches
    const filtered = rows.filter(
        (row) =>
            matchingProductIds.has(row.productId) ||
            matchingVariationIds.has(row.variationId) ||
            matchingSkuIds.has(row.skuId)
    );

    // Recompute grouping flags for filtered results
    return recomputeGroupFlags(filtered);
}

/**
 * Recompute isFirstOfProduct, isFirstOfVariation, and variationSkuCount after filtering.
 */
function recomputeGroupFlags(rows: SkuViewRow[]): SkuViewRow[] {
    // First pass: count SKUs per variation in filtered set
    const variationCounts = new Map<string, number>();
    for (const row of rows) {
        variationCounts.set(row.variationId, (variationCounts.get(row.variationId) || 0) + 1);
    }

    let lastProductId = '';
    let lastVariationId = '';

    return rows.map((row) => {
        const isFirstOfProduct = row.productId !== lastProductId;
        const isFirstOfVariation =
            isFirstOfProduct || row.variationId !== lastVariationId;
        const variationSkuCount = variationCounts.get(row.variationId) || 1;

        lastProductId = row.productId;
        lastVariationId = row.variationId;

        if (
            row.isFirstOfProduct === isFirstOfProduct &&
            row.isFirstOfVariation === isFirstOfVariation &&
            row.variationSkuCount === variationSkuCount
        ) {
            return row;
        }

        return { ...row, isFirstOfProduct, isFirstOfVariation, variationSkuCount };
    });
}
