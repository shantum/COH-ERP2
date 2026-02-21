/**
 * flattenToVariationRows - Transform product tree into flat variation rows
 *
 * Creates a flat array of variation rows with product info embedded.
 * Each row represents a variation, expandable to show SKUs.
 */

import type { ProductTreeNode, VariationViewRow } from '../types';

/**
 * Transform ProductTreeNode[] into VariationViewRow[]
 * Returns only variation rows with product info embedded.
 */
export function flattenToVariationRows(products: ProductTreeNode[]): VariationViewRow[] {
    const rows: VariationViewRow[] = [];

    for (const product of products) {
        const variations = product.children || [];

        for (const variation of variations) {
            rows.push({
                id: `variation-${variation.id}`,
                rowType: 'variation',
                variationId: variation.id,
                colorName: variation.colorName || variation.name,
                colorHex: variation.colorHex,
                fabricName: variation.fabricName,
                fabricColourId: variation.fabricColourId,
                fabricColourName: variation.fabricColourName,
                imageUrl: variation.imageUrl,
                hasLining: variation.hasLining,
                parentProductId: product.id,
                parentProductName: product.name,
                parentStyleCode: product.styleCode,
                productImageUrl: product.imageUrl,
                skuCount: variation.children?.length || 0,
                totalStock: variation.totalStock || 0,
                avgMrp: variation.avgMrp,
                skus: variation.children,
                // Shopify & Sales fields
                shopifyStatus: variation.shopifyStatus,
                shopifyStock: variation.shopifyStock,
                fabricStock: variation.fabricStock,
                fabricUnit: variation.fabricUnit,
                sales30DayUnits: variation.sales30DayUnits,
                sales30DayValue: variation.sales30DayValue,
                // Cost fields
                bomCost: variation.bomCost,
                variationNode: variation,
                productNode: product,
            });
        }
    }

    return rows;
}

/**
 * Filter variation rows by search query.
 */
export function filterVariationRows(
    rows: VariationViewRow[],
    searchQuery: string
): VariationViewRow[] {
    if (!searchQuery.trim()) return rows;

    const query = searchQuery.toLowerCase();

    return rows.filter((row) => {
        return (
            row.colorName?.toLowerCase().includes(query) ||
            row.fabricName?.toLowerCase().includes(query) ||
            row.parentProductName?.toLowerCase().includes(query) ||
            row.parentStyleCode?.toLowerCase().includes(query)
        );
    });
}
