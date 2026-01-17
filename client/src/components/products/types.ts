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
    fabricTypeName?: string;
    variationCount?: number;
    skuCount?: number;
    totalStock?: number;
    hasLining?: boolean;

    // === Variation level ===
    productId?: string;
    productName?: string;
    colorName?: string;
    colorHex?: string;
    fabricId?: string;
    fabricName?: string;

    // === SKU level ===
    variationId?: string;
    skuCode?: string;
    barcode?: string;
    size?: string;
    mrp?: number;
    fabricConsumption?: number;
    currentBalance?: number;
    availableBalance?: number;
    targetStockQty?: number;

    // === Cost fields (cascade: SKU → Variation → Product → Default) ===
    trimsCost?: number | null;
    liningCost?: number | null;
    packagingCost?: number | null;
    laborMinutes?: number | null;

    // === Calculated costs ===
    fabricCostPerUnit?: number | null;
    fabricCost?: number | null;
    laborCost?: number | null;
    totalCost?: number | null;

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
 * Main tab types for Products page
 */
export type ProductsTabType = 'products' | 'materials' | 'trims' | 'services' | 'bom';

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
