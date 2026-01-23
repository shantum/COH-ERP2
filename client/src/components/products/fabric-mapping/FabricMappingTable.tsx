/**
 * FabricMappingTable - Flat table with visual product grouping
 *
 * Renders product header rows (grey, collapsible) and variation rows (white, with dropdowns).
 * Handles cascading dropdown state and pending changes tracking.
 *
 * Features:
 * - Product-level Material/Fabric selection that cascades to all variations
 * - Variation-level Colour selection (creates pending changes)
 * - Products start collapsed for performance
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import {
    ProductHeaderCell,
    VariationCell,
    MaterialSelectCell,
    FabricSelectCell,
    ColourSelectCell,
    StatusCell,
} from './cells';
import type {
    FabricMappingRow,
    MaterialsLookup,
    PendingFabricChange,
    CascadingSelection,
} from './types';

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
    // Track expanded products (start collapsed for performance)
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    // Get all product IDs for expand/collapse all
    const allProductIds = useMemo(
        () => rows.filter((r) => r.rowType === 'product').map((r) => r.productId!),
        [rows]
    );

    const allExpanded = allProductIds.length > 0 && allProductIds.every((id) => expandedProducts.has(id));

    // Expand/collapse all products
    const handleExpandAll = useCallback(() => {
        setExpandedProducts(new Set(allProductIds));
    }, [allProductIds]);

    const handleCollapseAll = useCallback(() => {
        setExpandedProducts(new Set());
    }, []);

    // Track cascading selection state per variation (separate from pending changes)
    const [selectionState, setSelectionState] = useState<Map<string, CascadingSelection>>(
        new Map()
    );

    // Track product-level selection state (for cascading to variations)
    // Persisted to localStorage so users can come back later to finish
    const [productSelectionState, setProductSelectionState] = useState<
        Map<string, { materialId: string | null; fabricId: string | null }>
    >(() => {
        // Load from localStorage on mount
        try {
            const saved = localStorage.getItem('fabricMapping:productSelections');
            if (saved) {
                const parsed = JSON.parse(saved);
                return new Map(Object.entries(parsed));
            }
        } catch (e) {
            console.warn('Failed to load fabric mapping draft:', e);
        }
        return new Map();
    });

    // Persist product selections to localStorage
    useEffect(() => {
        try {
            const obj = Object.fromEntries(productSelectionState);
            localStorage.setItem('fabricMapping:productSelections', JSON.stringify(obj));
        } catch (e) {
            console.warn('Failed to save fabric mapping draft:', e);
        }
    }, [productSelectionState]);

    // Get variation IDs for a product
    const getVariationIdsForProduct = useCallback(
        (productId: string): string[] => {
            return rows
                .filter((r) => r.rowType === 'variation' && r.parentProductId === productId)
                .map((r) => r.variationId!)
                .filter(Boolean);
        },
        [rows]
    );

    // Toggle product expansion
    const toggleProduct = useCallback((productId: string) => {
        setExpandedProducts((prev) => {
            const next = new Set(prev);
            if (next.has(productId)) {
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
    }, []);

    // Get product-level selection state
    const getProductSelection = useCallback(
        (productId: string): { materialId: string | null; fabricId: string | null } => {
            return productSelectionState.get(productId) || { materialId: null, fabricId: null };
        },
        [productSelectionState]
    );

    // Get selection state for a variation (check product-level first, then variation-level)
    const getSelection = useCallback(
        (variationId: string, row: FabricMappingRow): CascadingSelection => {
            const existing = selectionState.get(variationId);
            if (existing) return existing;

            // Check if there's a product-level selection
            const productSelection = row.parentProductId
                ? productSelectionState.get(row.parentProductId)
                : null;

            if (productSelection?.materialId || productSelection?.fabricId) {
                return {
                    materialId: productSelection.materialId || row.currentMaterialId || null,
                    fabricId: productSelection.fabricId || row.currentFabricId || null,
                    colourId: row.currentColourId || null,
                };
            }

            // Default from current assignment
            return {
                materialId: row.currentMaterialId || null,
                fabricId: row.currentFabricId || null,
                colourId: row.currentColourId || null,
            };
        },
        [selectionState, productSelectionState]
    );

    // Handle product-level material change (cascades to all variations)
    const handleProductMaterialChange = useCallback(
        (productId: string, materialId: string | null) => {
            // Update product selection state
            setProductSelectionState((prev) => {
                const next = new Map(prev);
                next.set(productId, { materialId, fabricId: null }); // Reset fabric when material changes
                return next;
            });

            // Clear variation-level selections and pending changes for this product
            const variationIds = getVariationIdsForProduct(productId);
            setSelectionState((prev) => {
                const next = new Map(prev);
                for (const varId of variationIds) {
                    next.delete(varId);
                }
                return next;
            });
            for (const varId of variationIds) {
                onPendingChange(varId, null);
            }
        },
        [getVariationIdsForProduct, onPendingChange]
    );

    // Handle product-level fabric change (cascades to all variations)
    const handleProductFabricChange = useCallback(
        (productId: string, fabricId: string | null) => {
            // Update product selection state
            setProductSelectionState((prev) => {
                const next = new Map(prev);
                const current = next.get(productId) || { materialId: null, fabricId: null };
                next.set(productId, { ...current, fabricId });
                return next;
            });

            // Clear variation-level selections and pending changes for this product
            const variationIds = getVariationIdsForProduct(productId);
            setSelectionState((prev) => {
                const next = new Map(prev);
                for (const varId of variationIds) {
                    next.delete(varId);
                }
                return next;
            });
            for (const varId of variationIds) {
                onPendingChange(varId, null);
            }
        },
        [getVariationIdsForProduct, onPendingChange]
    );

    // Handle variation-level material selection change
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

    // Handle variation-level fabric selection change
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

    // Filter visible rows based on expanded state (collapsed by default)
    const visibleRows = useMemo(() => {
        const result: FabricMappingRow[] = [];
        let currentProductId: string | null = null;
        let isProductExpanded = false;

        for (const row of rows) {
            if (row.rowType === 'product') {
                currentProductId = row.productId || null;
                isProductExpanded = expandedProducts.has(currentProductId || '');
                result.push(row);
            } else if (row.rowType === 'variation') {
                if (isProductExpanded) {
                    result.push(row);
                }
            }
        }

        return result;
    }, [rows, expandedProducts]);

    if (rows.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                No products found
            </div>
        );
    }

    return (
        <div className="overflow-auto flex-1">
            <table className="w-full text-sm border-collapse min-w-[800px]">
                <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b w-64">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={allExpanded ? handleCollapseAll : handleExpandAll}
                                    className="p-1 rounded hover:bg-gray-200 text-gray-500"
                                    title={allExpanded ? 'Collapse all' : 'Expand all'}
                                >
                                    {allExpanded ? (
                                        <ChevronsDownUp size={14} />
                                    ) : (
                                        <ChevronsUpDown size={14} />
                                    )}
                                </button>
                                <span>Product / Variation</span>
                            </div>
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b w-40">
                            Material
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b w-40">
                            Fabric
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b w-40">
                            Colour
                        </th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 border-b w-16">
                            Status
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {visibleRows.map((row) => {
                        const isProductRow = row.rowType === 'product';
                        const isPending = !isProductRow && pendingChanges.has(row.variationId || '');

                        if (isProductRow) {
                            const productId = row.productId || '';
                            const productSelection = getProductSelection(productId);
                            const isExpanded = expandedProducts.has(productId);

                            // Create a pseudo-selection for product-level dropdowns
                            // Use manual selection if set, otherwise fall back to aggregated data from variations
                            const productCascadeSelection: CascadingSelection = {
                                materialId: productSelection.materialId || row.currentMaterialId || null,
                                fabricId: productSelection.fabricId || row.currentFabricId || null,
                                colourId: null,
                            };

                            return (
                                <tr key={row.id} className="bg-gray-100 hover:bg-gray-200">
                                    <td
                                        className="px-3 py-2 border-b cursor-pointer"
                                        onClick={() => toggleProduct(productId)}
                                    >
                                        <ProductHeaderCell
                                            row={row}
                                            isExpanded={isExpanded}
                                            onToggle={() => toggleProduct(productId)}
                                        />
                                    </td>
                                    <td
                                        className="px-3 py-2 border-b"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <MaterialSelectCell
                                            selection={productCascadeSelection}
                                            materials={materialsLookup.materials}
                                            currentMaterialId={row.currentMaterialId || null}
                                            currentMaterialName={row.currentMaterialName || null}
                                            onChange={(materialId) =>
                                                handleProductMaterialChange(productId, materialId)
                                            }
                                            onAddNew={onAddMaterial}
                                        />
                                    </td>
                                    <td
                                        className="px-3 py-2 border-b"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <FabricSelectCell
                                            selection={productCascadeSelection}
                                            fabrics={materialsLookup.fabrics}
                                            currentFabricId={row.currentFabricId || null}
                                            currentFabricName={row.currentFabricName || null}
                                            onChange={(fabricId) =>
                                                handleProductFabricChange(productId, fabricId)
                                            }
                                            onAddNew={
                                                productCascadeSelection.materialId
                                                    ? () => onAddFabric?.(productCascadeSelection.materialId!)
                                                    : undefined
                                            }
                                        />
                                    </td>
                                    <td className="px-3 py-2 border-b text-center text-gray-400 text-xs">
                                        -
                                    </td>
                                    <td className="px-3 py-2 border-b text-center">
                                        <StatusCell row={row} />
                                    </td>
                                </tr>
                            );
                        }

                        // Variation row
                        const selection = getSelection(row.variationId || '', row);

                        return (
                            <tr
                                key={row.id}
                                className={`hover:bg-gray-50 ${isPending ? 'bg-amber-50' : 'bg-white'}`}
                            >
                                <td className="px-3 py-2 border-b">
                                    <VariationCell row={row} />
                                </td>
                                <td className="px-3 py-2 border-b">
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
                                <td className="px-3 py-2 border-b">
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
                                <td className="px-3 py-2 border-b">
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
                                    />
                                </td>
                                <td className="px-3 py-2 border-b text-center">
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
