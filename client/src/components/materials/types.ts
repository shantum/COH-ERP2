/**
 * Materials Tree Table Types
 *
 * Unified node structure for 3-tier Material hierarchy:
 * Material → Fabric → FabricColour
 *
 * Used with TanStack Table's getSubRows for hierarchical expansion.
 */

export type MaterialNodeType = 'material' | 'fabric' | 'colour';

/**
 * Unified node for tree table representation.
 * All three levels use the same structure with type-specific fields being optional.
 */
export interface MaterialNode {
    id: string;
    type: MaterialNodeType;
    name: string;
    isActive?: boolean;

    // === Hierarchy Navigation ===
    parentId?: string | null;  // materialId for fabric, fabricId for colour
    children?: MaterialNode[]; // Nested children for tree expansion

    // === Aggregated Counts (Material/Fabric levels) ===
    fabricCount?: number;      // Material only: number of fabrics
    colourCount?: number;      // Material/Fabric: number of colours

    // === Fabric Properties (Fabric/Colour levels) ===
    materialId?: string;
    materialName?: string;
    constructionType?: 'knit' | 'woven';
    pattern?: string;
    weight?: number | null;
    weightUnit?: string;
    composition?: string;
    avgShrinkagePct?: number;
    /** Quantity unit: 'kg' for knit fabrics, 'm' for woven fabrics */
    unit?: 'kg' | 'm' | string;

    // === Colour Properties (Colour level only) ===
    code?: string;
    fabricId?: string;
    fabricName?: string;
    colourName?: string;
    standardColour?: string;
    colourHex?: string;
    isOutOfStock?: boolean; // Manual out-of-stock flag

    // === Cost/Lead/Min Order (Fabric/Colour - with inheritance) ===
    costPerUnit?: number | null;
    leadTimeDays?: number | null;
    minOrderQty?: number | null;

    // Inherited values (for display/editing logic)
    inheritedCostPerUnit?: number | null;
    inheritedLeadTimeDays?: number | null;
    inheritedMinOrderQty?: number | null;

    // Effective values (own or inherited)
    effectiveCostPerUnit?: number | null;
    effectiveLeadTimeDays?: number | null;
    effectiveMinOrderQty?: number | null;

    // Inheritance flags
    costInherited?: boolean;
    leadTimeInherited?: boolean;
    minOrderInherited?: boolean;

    // === Supplier (Fabric/Colour) ===
    supplierId?: string | null;
    supplierName?: string | null;

    // === Inventory (Colour level only) ===
    currentBalance?: number;
    totalInward?: number;
    totalOutward?: number;
    avgDailyConsumption?: number;
    daysOfStock?: number;
    stockStatus?: 'order_now' | 'order_soon' | 'ok';

    // === Aggregated Stock (Material/Fabric levels) ===
    totalStock?: number;

    // === 30-Day Sales & Consumption (Colour level, aggregated to Fabric) ===
    /** Revenue in last 30 days (SUM of qty × unitPrice) */
    sales30DayValue?: number;
    /** Units sold in last 30 days */
    sales30DayUnits?: number;
    /** Fabric consumed in last 30 days (meters/kg) */
    consumption30Day?: number;

    // === Connected Products (Fabric/Colour levels) ===
    productCount?: number;
    connectedProducts?: Array<{
        id: string;
        name: string;
        styleCode?: string;
    }>;

    // === UI State (managed by component, not from server) ===
    _isExpanded?: boolean;
    _isLoading?: boolean;
    _depth?: number;
}

/**
 * API response for tree endpoint
 */
export interface MaterialTreeResponse {
    items: MaterialNode[];
    summary: {
        total: number;
        materials: number;
        fabrics: number;
        colours: number;
        orderNow: number;
        orderSoon: number;
        ok: number;
    };
}

/**
 * Response for lazy-loaded children
 */
export interface MaterialChildrenResponse {
    items: MaterialNode[];
    parentId: string;
    parentType: MaterialNodeType;
}

/**
 * Standard colors with hex values
 */
export const STANDARD_COLOR_HEX: Record<string, string> = {
    Red: '#DC2626',
    Orange: '#EA580C',
    Yellow: '#CA8A04',
    Green: '#16A34A',
    Blue: '#2563EB',
    Purple: '#9333EA',
    Pink: '#DB2777',
    Brown: '#92400E',
    Black: '#171717',
    White: '#FAFAFA',
    Grey: '#6B7280',
    Beige: '#D4B896',
    Navy: '#1E3A5F',
    Teal: '#0D9488',
    Indigo: '#4F46E5',
    Coral: '#F97316',
    Cream: '#FEF3C7',
    Natural: '#E7E5E4',
};

export const STANDARD_COLORS = Object.keys(STANDARD_COLOR_HEX);

/**
 * Construction types for fabrics
 */
export const CONSTRUCTION_TYPES = ['knit', 'woven'] as const;
export type ConstructionType = typeof CONSTRUCTION_TYPES[number];

/**
 * Trim categories
 */
export const TRIM_CATEGORIES = [
    'button', 'zipper', 'label', 'thread', 'elastic',
    'tape', 'hook', 'drawstring', 'other'
] as const;
export type TrimCategory = typeof TRIM_CATEGORIES[number];

/**
 * Service categories
 */
export const SERVICE_CATEGORIES = [
    'printing', 'embroidery', 'washing', 'dyeing', 'pleating', 'other'
] as const;
export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

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
export interface RowActionsProps {
    node: MaterialNode;
    onEdit: (node: MaterialNode) => void;
    onAddChild?: (node: MaterialNode) => void;
    onViewDetails?: (node: MaterialNode) => void;
    onAddInward?: (node: MaterialNode) => void;
}
