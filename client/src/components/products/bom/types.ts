/**
 * BOM (Bill of Materials) Types
 *
 * Unified type definitions for the BOM editor that combines
 * fabrics, trims, and services into a single "lines" view.
 */

export type BomComponentType = 'FABRIC' | 'TRIM' | 'SERVICE';

/**
 * Unified BOM line for display in the combined table.
 * Normalizes fabric, trim, and service lines into a single structure.
 */
export interface UnifiedBomLine {
    /** Unique identifier (template ID, variation line ID, or generated) */
    id: string;
    /** Component type for visual differentiation */
    type: BomComponentType;
    /** Role code (e.g., 'main', 'lining', 'button') */
    roleCode: string;
    /** Human-readable role name */
    roleName: string;
    /** Role ID for API operations */
    roleId: string;
    /** Component name (null = not assigned, "Per variation" for fabrics at product level) */
    componentName: string | null;
    /** Component ID (fabric colour, trim item, or service item) */
    componentId: string | null;
    /** Hex color for fabric swatches */
    colourHex?: string | null;
    /** Quantity (null = inherited from template) */
    quantity: number | null;
    /** Unit of measurement */
    quantityUnit: string;
    /** Cost per unit */
    costPerUnit: number | null;
    /** Calculated total cost (quantity * costPerUnit) */
    totalCost: number;
    /** Where this line is defined */
    source: 'template' | 'variation' | 'sku';
    /** Whether this line inherits values from a higher level */
    isInherited?: boolean;
    /** Original data for mutations */
    _raw?: {
        templateId?: string;
        variationLineId?: string;
        skuLineId?: string;
        trimItem?: { id: string; name: string; code: string; costPerUnit: number } | null;
        serviceItem?: { id: string; name: string; code: string; costPerJob: number } | null;
        fabricColour?: { id: string; name: string; colourHex?: string | null } | null;
    };
}

/**
 * Cost breakdown by component type
 */
export interface BomCostBreakdown {
    fabricCost: number;
    trimCost: number;
    serviceCost: number;
    total: number;
}

/**
 * Type-specific styling configuration
 */
export const BOM_TYPE_CONFIG: Record<BomComponentType, {
    label: string;
    bgColor: string;
    textColor: string;
    borderColor: string;
    icon: string;
}> = {
    FABRIC: {
        label: 'Fabric',
        bgColor: 'bg-purple-50',
        textColor: 'text-purple-700',
        borderColor: 'border-purple-200',
        icon: 'Scissors',
    },
    TRIM: {
        label: 'Trim',
        bgColor: 'bg-amber-50',
        textColor: 'text-amber-700',
        borderColor: 'border-amber-200',
        icon: 'Package',
    },
    SERVICE: {
        label: 'Service',
        bgColor: 'bg-teal-50',
        textColor: 'text-teal-700',
        borderColor: 'border-teal-200',
        icon: 'Wrench',
    },
};

/**
 * Available component for selection in AddBomLineModal
 */
export interface AvailableComponent {
    id: string;
    type: BomComponentType;
    name: string;
    category?: string;
    costPerUnit?: number | null;
    costPerJob?: number | null;
    unit?: string;
    colourHex?: string | null;
}

/**
 * Component role from the API
 */
export interface ComponentRole {
    id: string;
    code: string;
    name: string;
    type: {
        code: string;
        name: string;
    };
}

/**
 * Props for BomLinesTable component
 */
export interface BomLinesTableProps {
    lines: UnifiedBomLine[];
    isLoading?: boolean;
    onAddLine?: () => void;
    onDeleteLine?: (line: UnifiedBomLine) => void;
    onRowClick?: (line: UnifiedBomLine) => void;
    emptyMessage?: string;
    context: 'product' | 'variation' | 'sku';
}

/**
 * Props for AddBomLineModal component
 */
export interface AddBomLineModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (line: {
        roleId: string;
        componentType: BomComponentType;
        componentId?: string;
        quantity?: number;
    }) => void;
    existingRoles: string[];
    context: 'product' | 'variation';
    productId?: string;
    variationId?: string;
}

/**
 * Props for BomCostSummary component
 */
export interface BomCostSummaryProps {
    costs: BomCostBreakdown;
    compact?: boolean;
}
