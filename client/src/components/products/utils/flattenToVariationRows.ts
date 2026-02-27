/**
 * flattenToVariationRows - Transform product tree into variation-level rows
 *
 * Each row is a variation (product + colour combination).
 * Shows sizes inline with per-size stock counts.
 * Grouped by product with visual separators.
 */

import type { ProductTreeNode, ShopifyStatus } from '../types';
import { sortBySizeOrder } from '../types';

export interface SizeInfo {
    size: string;
    stock: number;
    skuCode: string;
    skuId: string;
    mrp: number | null;
    shopifyPrice: number | null;
    shopifySalePrice: number | null;
}

export interface VariationRow {
    id: string;
    productId: string;
    variationId: string;

    // Display
    displayName: string;
    productName: string;
    colorName: string;
    colorHex?: string;
    imageUrl?: string;

    // Sizes with per-size data
    sizes: SizeInfo[];

    // Aggregates
    totalStock: number;
    mrp: number | null;           // Representative MRP (most common or first)
    sellingPrice: number | null;

    // Shopify
    shopifyStatus?: ShopifyStatus;
    shopifyPrice: number | null;
    shopifySalePrice: number | null;
    shopifySalePercent: number | null;

    // Fabric
    fabricName?: string;
    fabricColourName?: string;

    // Metadata
    styleCode?: string;
    category?: string;
    gender?: string;

    // Grouping
    isFirstOfProduct: boolean;
    productVariationCount: number;

    // Nodes for navigation
    productNode: ProductTreeNode;
    variationNode: ProductTreeNode;
}

/**
 * Transform ProductTreeNode[] into flat VariationRow[].
 */
export function flattenToVariationRows(products: ProductTreeNode[]): VariationRow[] {
    const rows: VariationRow[] = [];

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

            const sizes: SizeInfo[] = sortedSkus.map(sku => ({
                size: sku.size || '?',
                stock: sku.currentBalance || 0,
                skuCode: sku.skuCode || '',
                skuId: sku.id,
                mrp: sku.mrp ?? null,
                shopifyPrice: sku.shopifyPrice ?? null,
                shopifySalePrice: sku.shopifySalePrice ?? null,
            }));

            const totalStock = sizes.reduce((sum, s) => sum + s.stock, 0);

            // Representative MRP — first SKU with an MRP
            const firstWithMrp = sizes.find(s => s.mrp != null);
            const mrp = firstWithMrp?.mrp ?? null;

            // Shopify prices
            const firstWithShopifyPrice = sizes.find(s => s.shopifyPrice != null);
            const shopifyPrice = firstWithShopifyPrice?.shopifyPrice ?? null;
            const firstWithSalePrice = sizes.find(s => s.shopifySalePrice != null);
            const shopifySalePrice = firstWithSalePrice?.shopifySalePrice ?? null;
            const shopifySalePercent = shopifyPrice && shopifySalePrice
                ? Math.round(((shopifyPrice - shopifySalePrice) / shopifyPrice) * 100)
                : null;

            const colorName = variation.colorName || variation.name;
            const displayName = `${product.name} - ${colorName}`;

            rows.push({
                id: `var-${variation.id}`,
                productId: product.id,
                variationId: variation.id,

                displayName,
                productName: product.name,
                colorName,
                colorHex: variation.colorHex,
                imageUrl: variation.imageUrl || product.imageUrl,

                sizes,
                totalStock,
                mrp,
                sellingPrice: sortedSkus[0]?.sellingPrice ?? null,

                shopifyStatus: variation.shopifyStatus,
                shopifyPrice,
                shopifySalePrice,
                shopifySalePercent,

                fabricName: variation.fabricName,
                fabricColourName: variation.fabricColourName,

                styleCode: product.styleCode,
                category: product.category,
                gender: product.gender,

                isFirstOfProduct: isFirstProduct,
                productVariationCount: variations.filter(v => (v.children?.length || 0) > 0).length,

                productNode: product,
                variationNode: variation,
            });

            isFirstProduct = false;
        }
    }

    return rows;
}

/**
 * Filter variation rows by search query.
 */
export function filterVariationRows(
    rows: VariationRow[],
    searchQuery: string
): VariationRow[] {
    if (!searchQuery.trim()) return rows;

    const query = searchQuery.toLowerCase();

    const matchingProductIds = new Set<string>();
    const matchingVariationIds = new Set<string>();

    for (const row of rows) {
        const matchesProduct =
            row.productName.toLowerCase().includes(query) ||
            row.styleCode?.toLowerCase().includes(query);

        const matchesVariation =
            row.colorName.toLowerCase().includes(query) ||
            row.displayName.toLowerCase().includes(query) ||
            row.fabricName?.toLowerCase().includes(query) ||
            row.fabricColourName?.toLowerCase().includes(query) ||
            row.sizes.some(s => s.skuCode.toLowerCase().includes(query));

        if (matchesProduct) matchingProductIds.add(row.productId);
        if (matchesVariation) matchingVariationIds.add(row.variationId);
    }

    const filtered = rows.filter(
        row => matchingProductIds.has(row.productId) || matchingVariationIds.has(row.variationId)
    );

    return recomputeGroupFlags(filtered);
}

function recomputeGroupFlags(rows: VariationRow[]): VariationRow[] {
    // Count variations per product in filtered set
    const productVarCounts = new Map<string, number>();
    for (const row of rows) {
        productVarCounts.set(row.productId, (productVarCounts.get(row.productId) || 0) + 1);
    }

    let lastProductId = '';

    return rows.map(row => {
        const isFirstOfProduct = row.productId !== lastProductId;
        const productVariationCount = productVarCounts.get(row.productId) || 1;
        lastProductId = row.productId;

        if (row.isFirstOfProduct === isFirstOfProduct && row.productVariationCount === productVariationCount) {
            return row;
        }

        return { ...row, isFirstOfProduct, productVariationCount };
    });
}
