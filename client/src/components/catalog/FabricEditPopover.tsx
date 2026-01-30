/**
 * FabricDisplayCell Component
 *
 * Read-only display for fabric info in catalog grid columns.
 * Fabric assignment is now managed via BOM Editor, not inline editing.
 *
 * NOTE: This component was previously FabricEditPopover with inline editing.
 * As part of the fabric system consolidation, fabric fields are now derived
 * from VariationBomLine.fabricColourId (BOM as single source of truth).
 */

export type ViewLevel = 'sku' | 'variation' | 'product' | 'consumption';

export interface FabricDisplayCellProps {
    row: any;
    viewLevel: ViewLevel;
    columnType: 'fabricType' | 'fabric';
}

/**
 * Simple read-only display of fabric information.
 * Shows fabric type name or fabric name from row data.
 */
export function FabricDisplayCell({
    row,
    columnType,
}: FabricDisplayCellProps) {
    // Display text - fabric info is now derived from BOM
    const displayText = columnType === 'fabricType'
        ? (row.fabricTypeName || row.materialName || '-')
        : (row.fabricName || row.fabricColourName || '-');

    const isNotSet = displayText === '-' || displayText === 'Not set';

    return (
        <span
            className={`text-xs px-1.5 py-0.5 rounded truncate ${
                isNotSet
                    ? 'text-gray-400'
                    : 'text-gray-700'
            }`}
            title={columnType === 'fabricType'
                ? 'Fabric type (set via BOM Editor)'
                : 'Fabric colour (set via BOM Editor)'
            }
        >
            {displayText}
        </span>
    );
}

// Legacy export for backward compatibility during migration
// TODO: Remove after all usages are updated
export interface FabricEditPopoverProps {
    row: any;
    viewLevel: ViewLevel;
    columnType: 'fabricType' | 'fabric';
    fabricTypes?: Array<{ id: string; name: string }>;
    fabrics?: Array<{ id: string; name: string; colorName: string; fabricTypeId: string | null; displayName: string }>;
    onUpdateFabricType?: (productId: string, fabricTypeId: string | null, affectedCount: number) => void;
    onUpdateFabric?: (variationId: string, fabricId: string, affectedCount: number) => void;
    rawItems?: any[];
}

/**
 * @deprecated Use FabricDisplayCell instead. Fabric editing is now done via BOM Editor.
 */
export function FabricEditPopover({
    row,
    viewLevel,
    columnType,
}: FabricEditPopoverProps) {
    return <FabricDisplayCell row={row} viewLevel={viewLevel} columnType={columnType} />;
}
