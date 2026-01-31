/**
 * FabricMappingTable - Flat variation table with cascading dropdowns
 *
 * Renders a flat list of variations with Material → Fabric → Colour cascading dropdowns.
 * Each variation row shows the product name and variation color for context.
 */

import { useState, useCallback, useMemo } from 'react';
import {
    VariationCell,
    MaterialSelectCell,
    FabricSelectCell,
    ColourSelectCell,
    StatusCell,
    ShopifyStatusCell,
} from './cells';
import type {
    FabricMappingRow,
    MaterialsLookup,
    PendingFabricChange,
    CascadingSelection,
} from './types';
import { CLEAR_FABRIC_VALUE } from './types';

interface FabricMappingTableProps {
    rows: FabricMappingRow[];
    materialsLookup: MaterialsLookup;
    pendingChanges: Map<string, PendingFabricChange>;
    onPendingChange: (variationId: string, change: PendingFabricChange | null) => void;
    onAddMaterial?: () => void;
    onAddFabric?: (materialId: string) => void;
    onAddColour?: (fabricId: string) => void;
}

export function FabricMappingTable({
    rows,
    materialsLookup,
    pendingChanges,
    onPendingChange,
    onAddMaterial,
    onAddFabric,
    onAddColour,
}: FabricMappingTableProps) {
    // Track cascading selection state per variation
    const [selectionState, setSelectionState] = useState<Map<string, CascadingSelection>>(
        new Map()
    );

    // Get selection state for a variation
    const getSelection = useCallback(
        (variationId: string, row: FabricMappingRow): CascadingSelection => {
            const existing = selectionState.get(variationId);
            if (existing) return existing;

            // Default from current assignment
            return {
                materialId: row.currentMaterialId || null,
                fabricId: row.currentFabricId || null,
                colourId: row.currentColourId || null,
            };
        },
        [selectionState]
    );

    // Handle material selection change
    const handleMaterialChange = useCallback(
        (variationId: string, materialId: string | null) => {
            setSelectionState((prev) => {
                const next = new Map(prev);
                next.set(variationId, {
                    materialId,
                    fabricId: null, // Reset fabric
                    colourId: null, // Reset colour
                });
                return next;
            });
            // Clear pending change since cascade is incomplete
            onPendingChange(variationId, null);
        },
        [onPendingChange]
    );

    // Handle fabric selection change
    const handleFabricChange = useCallback(
        (variationId: string, fabricId: string | null, currentMaterialId: string | null) => {
            setSelectionState((prev) => {
                const next = new Map(prev);
                const current = next.get(variationId) || {
                    materialId: currentMaterialId,
                    fabricId: null,
                    colourId: null,
                };
                next.set(variationId, {
                    ...current,
                    fabricId,
                    colourId: null, // Reset colour
                });
                return next;
            });
            // Clear pending change since cascade is incomplete
            onPendingChange(variationId, null);
        },
        [onPendingChange]
    );

    // Handle colour selection change - this creates a pending change
    const handleColourChange = useCallback(
        (variationId: string, colourId: string | null, row: FabricMappingRow) => {
            const selection = getSelection(variationId, row);

            setSelectionState((prev) => {
                const next = new Map(prev);
                next.set(variationId, {
                    ...selection,
                    colourId,
                });
                return next;
            });

            if (!colourId) {
                onPendingChange(variationId, null);
                return;
            }

            // Find the colour to get fabric and material IDs
            const colour = materialsLookup.colours.find((c) => c.id === colourId);
            if (!colour) {
                onPendingChange(variationId, null);
                return;
            }

            const fabric = materialsLookup.fabrics.find((f) => f.id === colour.fabricId);
            const material = materialsLookup.materials.find(
                (m) => m.id === fabric?.materialId
            );

            onPendingChange(variationId, {
                variationId,
                colourId,
                fabricId: colour.fabricId,
                materialId: fabric?.materialId || '',
                materialName: material?.name || '',
                fabricName: fabric?.name || '',
                colourName: colour.name,
                colourHex: colour.colourHex,
            });
        },
        [getSelection, materialsLookup, onPendingChange]
    );

    // Handle clear fabric assignment - creates a pending clear change
    const handleClearFabric = useCallback(
        (variationId: string, row: FabricMappingRow) => {
            const selection = getSelection(variationId, row);

            // Update selection state to show cleared
            setSelectionState((prev) => {
                const next = new Map(prev);
                next.set(variationId, {
                    ...selection,
                    colourId: null,
                });
                return next;
            });

            // Create a pending change with isClear flag
            onPendingChange(variationId, {
                variationId,
                colourId: CLEAR_FABRIC_VALUE,
                fabricId: '',
                materialId: '',
                materialName: '',
                fabricName: '',
                colourName: 'Clear',
                isClear: true,
            });
        },
        [getSelection, onPendingChange]
    );

    // Filter to only variation rows (data hook should only return variations now, but be safe)
    const variationRows = useMemo(
        () => rows.filter((row) => row.rowType === 'variation'),
        [rows]
    );

    if (variationRows.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                No variations found
            </div>
        );
    }

    return (
        <div className="overflow-auto flex-1">
            <table className="w-full text-sm border-collapse min-w-[900px]">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr className="border-b border-gray-200">
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '280px' }}>
                            Variation
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '160px' }}>
                            Material
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '180px' }}>
                            Fabric
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '180px' }}>
                            Colour
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '70px' }}>
                            Shopify
                        </th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '60px' }}>
                            Mapped
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {variationRows.map((row) => {
                        const isPending = pendingChanges.has(row.variationId || '');
                        const selection = getSelection(row.variationId || '', row);

                        return (
                            <tr
                                key={row.id}
                                className={`transition-colors ${
                                    isPending
                                        ? 'bg-amber-50/60 hover:bg-amber-50'
                                        : 'bg-white hover:bg-gray-50/50'
                                }`}
                            >
                                <td className="px-3 py-1.5 border-b border-gray-100">
                                    <VariationCell row={row} />
                                </td>
                                <td className="px-3 py-1.5 border-b border-gray-100">
                                    <MaterialSelectCell
                                        selection={selection}
                                        materials={materialsLookup.materials}
                                        currentMaterialId={row.currentMaterialId || null}
                                        currentMaterialName={row.currentMaterialName || null}
                                        onChange={(materialId) =>
                                            handleMaterialChange(row.variationId || '', materialId)
                                        }
                                        onAddNew={onAddMaterial}
                                    />
                                </td>
                                <td className="px-3 py-1.5 border-b border-gray-100">
                                    <FabricSelectCell
                                        selection={selection}
                                        fabrics={materialsLookup.fabrics}
                                        currentFabricId={row.currentFabricId || null}
                                        currentFabricName={row.currentFabricName || null}
                                        onChange={(fabricId) =>
                                            handleFabricChange(
                                                row.variationId || '',
                                                fabricId,
                                                selection.materialId
                                            )
                                        }
                                        onAddNew={
                                            selection.materialId
                                                ? () => onAddFabric?.(selection.materialId!)
                                                : undefined
                                        }
                                    />
                                </td>
                                <td className="px-3 py-1.5 border-b border-gray-100">
                                    <ColourSelectCell
                                        selection={selection}
                                        colours={materialsLookup.colours}
                                        currentColourId={row.currentColourId || null}
                                        currentColourName={row.currentColourName || null}
                                        currentColourHex={row.currentColourHex || null}
                                        onChange={(colourId) =>
                                            handleColourChange(row.variationId || '', colourId, row)
                                        }
                                        onAddNew={
                                            selection.fabricId
                                                ? () => onAddColour?.(selection.fabricId!)
                                                : undefined
                                        }
                                        onClear={() => handleClearFabric(row.variationId || '', row)}
                                    />
                                </td>
                                <td className="px-3 py-1.5 border-b border-gray-100 text-center">
                                    <ShopifyStatusCell status={row.shopifyStatus} />
                                </td>
                                <td className="px-3 py-1.5 border-b border-gray-100 text-center">
                                    <StatusCell row={row} isPending={isPending} />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
