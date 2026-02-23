/**
 * Products Tree Table Types
 *
 * Unified node structure for 3-tier Product hierarchy:
 * Product → Variation → SKU
 *
 * Used with TanStack Table's getSubRows for hierarchical expansion.
 */

export type ProductNodeType = 'product' | 'variation' | 'sku';

/**
 * Shopify product/variation status
 */
export type ShopifyStatus = 'active' | 'archived' | 'draft' | 'not_linked' | 'not_cached' | 'unknown';

/**
 * Unified node for tree table representation.
 * All three levels use the same structure with type-specific fields being optional.
 */
export interface ProductTreeNode {
    id: string;
    type: ProductNodeType;
    name: string;
    isActive?: boolean;

    // === Tree structure ===
    children?: ProductTreeNode[];
    _depth?: number;

    // === Product level ===
    styleCode?: string;
    category?: string;
    gender?: string;
    productType?: string;
    fabricTypeId?: string;
    fabricTypeName?: string;
    imageUrl?: string;
    variationCount?: number;
    skuCount?: number;
    totalStock?: number;
    avgMrp?: number | null;
    hasLining?: boolean;

    // === Variation level ===
    productId?: string;
    productName?: string;
    colorName?: string;
    colorHex?: string;
    fabricId?: string;
    fabricName?: string;
    // New 3-tier fabric hierarchy fields (for variations)
    fabricColourId?: string;
    fabricColourCode?: string;
    fabricColourName?: string;
    fabricColourHex?: string;
    materialId?: string;
    materialName?: string;
    hasBomFabricLine?: boolean;

    // === SKU level ===
    variationId?: string;
    skuCode?: string;
    barcode?: string;
    size?: string;
    mrp?: number;
    sellingPrice?: number;         // ERP selling price (null = same as MRP)
    currentBalance?: number;
    availableBalance?: number;
    targetStockQty?: number;

    // === Calculated costs ===
    fabricCostPerUnit?: number | null;
    fabricCost?: number | null;
    totalCost?: number | null;
    bomCost?: number | null;        // Pre-computed total BOM cost

    // === Shopify & Sales fields ===
    shopifyStatus?: ShopifyStatus;
    shopifyVariantId?: string;     // Shopify variant ID (per SKU)
    shopifyProductId?: string;     // Shopify product ID
    shopifySourceProductId?: string; // Variation's Shopify source product ID
    shopifyPrice?: number;         // Shopify original price (compare_at_price or price)
    shopifySalePrice?: number;     // Shopify sale price (only when on sale)
    shopifySalePercent?: number;   // Discount percentage
    shopifyStock?: number;         // SKU: direct from cache, Variation: sum of SKUs
    fabricStock?: number;          // From FabricColour.currentBalance
    fabricUnit?: string;           // From Fabric.unit (e.g., "m", "kg")
    sales30DayUnits?: number;      // Units sold in 30 days
    sales30DayValue?: number;      // Revenue in 30 days

    // === UI State ===
    _isExpanded?: boolean;
    _isLoading?: boolean;
}

/**
 * API response for products tree endpoint
 */
export interface ProductTreeResponse {
    items: ProductTreeNode[];
    summary: {
        products: number;
        variations: number;
        skus: number;
        totalStock: number;
    };
}

/**
 * Selection state for detail panel
 */
export interface ProductSelectionState {
    type: ProductNodeType | 'material' | 'fabric' | 'colour' | 'trim' | 'service' | null;
    id: string | null;
}

/**
 * Detail panel tab types for Product
 */
export type ProductDetailTabType = 'info' | 'bom' | 'costs' | 'skus';

/**
 * Detail panel tab types for Variation
 */
export type VariationDetailTabType = 'info' | 'bom' | 'skus';

/**
 * Detail panel tab types for SKU
 */
export type SkuDetailTabType = 'info' | 'inventory';

/**
 * Props for inline editing cell
 */
export interface InlineEditCellProps {
    value: number | null | undefined;
    inheritedValue?: number | null;
    isInherited?: boolean;
    onSave: (value: number) => void;
    format?: (value: number) => string;
    placeholder?: string;
    unit?: string;
}

/**
 * Props for tree table row actions
 */
export interface ProductRowActionsProps {
    node: ProductTreeNode;
    onEdit: (node: ProductTreeNode) => void;
    onAddChild?: (node: ProductTreeNode) => void;
    onViewDetails?: (node: ProductTreeNode) => void;
}

/**
 * Category options
 */
export const PRODUCT_CATEGORIES = [
    'Kurti', 'Shirt', 'Pants', 'Dress', 'Top', 'Blouse', 'Skirt', 'Jacket', 'Other'
] as const;
export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

/**
 * Gender options
 */
export const GENDERS = ['Women', 'Men', 'Unisex'] as const;
export type Gender = typeof GENDERS[number];

/**
 * Size order for display
 */
export const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

/**
 * Sort sizes in standard order
 */
export function sortBySizeOrder(a: string, b: string): number {
    const indexA = SIZE_ORDER.indexOf(a);
    const indexB = SIZE_ORDER.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
}

/**
 * Row type for variation view (flat table with mixed row types)
 */
export type VariationViewRowType = 'product-header' | 'variation';

/**
 * Row for variation view table.
 * Product headers are visual separators; variation rows are the primary data rows.
 */
export interface VariationViewRow {
    id: string;
    rowType: VariationViewRowType;

    // Product header fields (rowType === 'product-header')
    productId?: string;
    productName?: string;
    productImageUrl?: string;
    styleCode?: string;
    category?: string;
    gender?: string;
    materialName?: string;
    variationCount?: number;
    productTotalStock?: number;

    // Variation fields (rowType === 'variation')
    variationId?: string;
    colorName?: string;
    colorHex?: string;
    fabricName?: string;
    fabricColourId?: string;
    fabricColourName?: string;
    imageUrl?: string;
    hasLining?: boolean;
    parentProductId?: string;
    parentProductName?: string;
    parentStyleCode?: string;
    skuCount?: number;
    totalStock?: number;
    avgMrp?: number | null;
    skus?: ProductTreeNode[];

    // === Shopify & Sales fields ===
    shopifyStatus?: ShopifyStatus;
    shopifyStock?: number;
    fabricStock?: number;
    fabricUnit?: string;            // From Fabric.unit (e.g., "m", "kg")
    sales30DayUnits?: number;
    sales30DayValue?: number;

    // === Cost fields ===
    bomCost?: number | null;        // Pre-computed total BOM cost

    // Original node reference for actions
    productNode?: ProductTreeNode;
    variationNode?: ProductTreeNode;
}
