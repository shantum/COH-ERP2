/**
 * Fabric Mapping View Types
 *
 * Types for the flat table view that allows assigning main fabrics
 * to product variations using cascading Material → Fabric → Colour dropdowns.
 */

/**
 * Row type discriminator
 * - 'product': Header row showing product name with variation count
 * - 'variation': Data row with cascading dropdown selectors
 */
export type FabricMappingRowType = 'product' | 'variation';

/**
 * Shopify product/variation status
 */
export type ShopifyStatus = 'active' | 'archived' | 'draft' | 'not_linked' | 'not_cached' | 'unknown';

/**
 * Unified row for the fabric mapping table.
 * Product rows are visual grouping headers, variation rows have the actual dropdowns.
 */
export interface FabricMappingRow {
    /** Unique row ID (product or variation ID) */
    id: string;
    /** Discriminator for row type */
    rowType: FabricMappingRowType;

    // === Product Header Fields (rowType === 'product') ===
    productId?: string;
    productName?: string;
    productImageUrl?: string;
    styleCode?: string;
    category?: string;
    gender?: string;
    /** Number of variations under this product */
    variationCount?: number;
    /** Number of variations with fabric mapped */
    mappedCount?: number;

    // === Variation Fields (rowType === 'variation') ===
    variationId?: string;
    variationName?: string;  // Usually the color name
    colorHex?: string;
    parentProductId?: string;
    parentProductName?: string;
    /** Variation active status */
    isActive?: boolean;

    // === Shopify Status ===
    /** Shopify product status (active, archived, draft, etc.) */
    shopifyStatus?: ShopifyStatus;

    // === Current Fabric Assignment (variation rows only) ===
    currentMaterialId?: string | null;
    currentMaterialName?: string | null;
    currentFabricId?: string | null;
    currentFabricName?: string | null;
    currentColourId?: string | null;
    currentColourName?: string | null;
    currentColourHex?: string | null;
}

/**
 * Special value indicating a clear/reset operation
 */
export const CLEAR_FABRIC_VALUE = '__clear__';

/**
 * Pending change for a variation's fabric assignment.
 * Stored in a Map keyed by variationId.
 * When colourId is CLEAR_FABRIC_VALUE, it represents a clear operation.
 */
export interface PendingFabricChange {
    variationId: string;
    /** The fabric colour being assigned, or CLEAR_FABRIC_VALUE for clear */
    colourId: string;
    /** The fabric (parent of colour) - derived from selection */
    fabricId: string;
    /** The material (grandparent) - derived from selection */
    materialId: string;
    /** Display names for UI */
    materialName: string;
    fabricName: string;
    colourName: string;
    colourHex?: string;
    /** Whether this is a clear operation */
    isClear?: boolean;
}

/**
 * Cascading selection state for a single variation row.
 * Material → Fabric → Colour (each selection filters the next dropdown)
 */
export interface CascadingSelection {
    materialId: string | null;
    fabricId: string | null;
    colourId: string | null;
}

/**
 * Filter state for the fabric mapping view
 */
export type FabricMappingFilter = 'all' | 'unmapped' | 'mapped';

/**
 * Summary statistics for the view footer
 */
export interface FabricMappingSummary {
    totalVariations: number;
    mappedVariations: number;
    unmappedVariations: number;
    totalProducts: number;
}

/**
 * Material option for dropdown (from materials tree)
 */
export interface MaterialOption {
    id: string;
    name: string;
    fabricCount: number;
}

/**
 * Fabric option for dropdown (filtered by selected material)
 */
export interface FabricOption {
    id: string;
    name: string;
    materialId: string;
    constructionType?: 'knit' | 'woven';
    colourCount: number;
}

/**
 * Colour option for dropdown (filtered by selected fabric)
 */
export interface ColourOption {
    id: string;
    name: string;
    fabricId: string;
    materialId: string;
    colourHex?: string;
}

/**
 * Lookup maps for efficient dropdown filtering
 */
export interface MaterialsLookup {
    materials: MaterialOption[];
    fabrics: FabricOption[];
    colours: ColourOption[];
    /** Map from fabricId to materialId for quick lookup */
    fabricToMaterial: Map<string, string>;
    /** Map from colourId to fabricId for quick lookup */
    colourToFabric: Map<string, string>;
}
