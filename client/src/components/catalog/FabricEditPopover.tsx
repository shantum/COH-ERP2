/**
 * FabricEditPopover Component
 *
 * Inline editor for fabric type (product-level) and fabric (variation-level).
 * Used in catalog grid columns.
 *
 * IMPORTANT: Uses same Zod schema pattern as other inline edit cells for consistent validation.
 * Backend remains agnostic to save method (popover select vs form).
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, AlertCircle } from 'lucide-react';
import {
    UpdateProductFabricTypeSchema,
    UpdateVariationFabricSchema,
} from '@coh/shared';

export type ViewLevel = 'sku' | 'variation' | 'product' | 'consumption';

export interface FabricEditPopoverProps {
    row: any;
    viewLevel: ViewLevel;
    columnType: 'fabricType' | 'fabric';
    fabricTypes: Array<{ id: string; name: string }>;
    fabrics: Array<{ id: string; name: string; colorName: string; fabricTypeId: string; displayName: string }>;
    onUpdateFabricType: (productId: string, fabricTypeId: string | null, affectedCount: number) => void;
    onUpdateFabric: (variationId: string, fabricId: string, affectedCount: number) => void;
    rawItems: any[];
}

const SELECT_CLASS = "w-full text-sm border rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100";

export function FabricEditPopover({
    row,
    viewLevel,
    columnType,
    fabricTypes,
    fabrics,
    onUpdateFabricType,
    onUpdateFabric,
    rawItems,
}: FabricEditPopoverProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const [validationError, setValidationError] = useState<string | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [filterFabricTypeId, setFilterFabricTypeId] = useState<string>('');

    // Reset filter and validation error when popover opens
    useEffect(() => {
        if (isOpen) {
            const currentFabric = fabrics.find(f => f.id === row.fabricId);
            setFilterFabricTypeId(currentFabric?.fabricTypeId || '');
            setValidationError(null);
        }
    }, [isOpen, row.fabricId, fabrics]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPopoverPosition({
                top: rect.bottom + window.scrollY + 4,
                left: Math.min(rect.left + window.scrollX, window.innerWidth - 320),
            });
        }
        setIsOpen(!isOpen);
    };

    // Count affected SKUs
    const skuCountForProduct = useMemo(() =>
        rawItems.filter(item => item.productId === row.productId).length,
        [rawItems, row.productId]
    );

    const skuCountForVariation = useMemo(() =>
        rawItems.filter(item => item.variationId === row.variationId).length,
        [rawItems, row.variationId]
    );

    // Check if variation has mixed fabrics (for aggregated views)
    const hasMixedFabrics = useMemo(() => {
        if (viewLevel === 'sku') return false;
        const variationItems = rawItems.filter(item => item.variationId === row.variationId);
        const uniqueFabrics = new Set(variationItems.map(i => i.fabricId));
        return uniqueFabrics.size > 1;
    }, [viewLevel, rawItems, row.variationId]);

    // Filter fabrics by type
    const filteredFabrics = useMemo(() => {
        const typeId = viewLevel === 'variation' ? filterFabricTypeId : row.fabricTypeId;
        if (!typeId) return fabrics;
        return fabrics.filter(f => f.fabricTypeId === typeId);
    }, [fabrics, viewLevel, filterFabricTypeId, row.fabricTypeId]);

    const handleFabricTypeChange = (fabricTypeId: string) => {
        // Validate using Zod schema - ensures consistency with backend expectations
        const payload = {
            productId: row.productId,
            fabricTypeId: fabricTypeId || null,
        };

        const validation = UpdateProductFabricTypeSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        setValidationError(null);

        if (skuCountForProduct > 1) {
            if (!window.confirm(`Update fabric type for ${skuCountForProduct} SKUs?`)) return;
        }
        onUpdateFabricType(row.productId, fabricTypeId || null, skuCountForProduct);
        setIsOpen(false);
    };

    const handleFabricChange = (fabricId: string) => {
        if (!fabricId) return;

        // Validate using Zod schema - ensures consistency with backend expectations
        const payload = {
            variationId: row.variationId,
            fabricId: fabricId,
        };

        const validation = UpdateVariationFabricSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        setValidationError(null);

        if (skuCountForVariation > 1) {
            if (!window.confirm(`Update fabric for ${skuCountForVariation} SKUs?`)) return;
        }
        onUpdateFabric(row.variationId, fabricId, skuCountForVariation);
        setIsOpen(false);
    };

    // Display text
    const displayText = columnType === 'fabricType'
        ? (row.fabricTypeName || 'Not set')
        : (hasMixedFabrics ? 'Multiple' : row.fabricName || 'Not set');

    // Determine if editing is available
    const canEditFabricType = columnType === 'fabricType' && (viewLevel === 'product' || viewLevel === 'sku');
    const canEditFabric = columnType === 'fabric' && (viewLevel === 'variation' || viewLevel === 'sku');

    return (
        <div className="inline-block">
            <button
                ref={buttonRef}
                onClick={handleOpen}
                className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors max-w-full ${
                    displayText === 'Not set' || displayText === 'Multiple'
                        ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-blue-50'
                }`}
                title={columnType === 'fabricType' ? 'Edit fabric type' : 'Edit fabric'}
            >
                <span className="truncate">{displayText}</span>
                <Pencil size={10} className="flex-shrink-0 opacity-50" />
            </button>

            {isOpen && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-72"
                    style={{ top: popoverPosition.top, left: popoverPosition.left }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Fabric Type Editor */}
                    {columnType === 'fabricType' && (
                        <>
                            <div className="text-xs font-medium text-gray-500 mb-2">
                                Edit Fabric Type
                            </div>
                            {canEditFabricType ? (
                                <div>
                                    <select
                                        value={row.fabricTypeId || ''}
                                        onChange={(e) => handleFabricTypeChange(e.target.value)}
                                        className={SELECT_CLASS}
                                    >
                                        <option value="">Not set</option>
                                        {fabricTypes.map(ft => (
                                            <option key={ft.id} value={ft.id}>{ft.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Affects {skuCountForProduct} SKU(s)
                                    </p>
                                </div>
                            ) : (
                                <p className="text-xs text-gray-500">
                                    Switch to Product view to edit fabric type.
                                </p>
                            )}
                        </>
                    )}

                    {/* Fabric Editor */}
                    {columnType === 'fabric' && (
                        <>
                            <div className="text-xs font-medium text-gray-500 mb-2">
                                Edit Fabric
                            </div>
                            {canEditFabric ? (
                                <>
                                    {/* Filter dropdown */}
                                    <div className="mb-3">
                                        <label className="block text-xs text-gray-600 mb-1">
                                            Filter by Type
                                        </label>
                                        <select
                                            value={viewLevel === 'variation' ? filterFabricTypeId : (row.fabricTypeId || '')}
                                            onChange={(e) => setFilterFabricTypeId(e.target.value)}
                                            disabled={viewLevel === 'sku'}
                                            className={SELECT_CLASS}
                                        >
                                            <option value="">All types</option>
                                            {fabricTypes.map(ft => (
                                                <option key={ft.id} value={ft.id}>{ft.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* Fabric dropdown */}
                                    <div>
                                        <label className="block text-xs text-gray-600 mb-1">Fabric</label>
                                        <select
                                            value={row.fabricId || ''}
                                            onChange={(e) => handleFabricChange(e.target.value)}
                                            className={SELECT_CLASS}
                                        >
                                            <option value="">Select fabric...</option>
                                            {filteredFabrics.map(f => (
                                                <option key={f.id} value={f.id}>{f.displayName}</option>
                                            ))}
                                        </select>
                                        {skuCountForVariation > 1 && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Affects {skuCountForVariation} SKU(s)
                                            </p>
                                        )}
                                        {filteredFabrics.length === 0 && (filterFabricTypeId || row.fabricTypeId) && (
                                            <p className="text-xs text-amber-600 mt-1">
                                                No fabrics for this type
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <p className="text-xs text-gray-500">
                                    Switch to Color view to edit fabric.
                                </p>
                            )}
                        </>
                    )}

                    {/* Validation error display */}
                    {validationError && (
                        <div className="flex items-center gap-1 text-[10px] text-red-500 mt-2 pt-2 border-t border-gray-100">
                            <AlertCircle size={10} />
                            <span>{validationError}</span>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
