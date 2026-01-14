/**
 * FabricEditPopover Component
 *
 * A popover for editing fabric types and fabrics at different aggregation levels.
 * Supports product-level (fabric type), variation-level (fabric), and SKU-level editing.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';

export type ViewLevel = 'sku' | 'variation' | 'product' | 'consumption';

export interface FabricEditPopoverProps {
    row: any;
    viewLevel: ViewLevel;
    columnType: 'fabricType' | 'fabric'; // Which column this popover is for
    fabricTypes: Array<{ id: string; name: string }>;
    fabrics: Array<{ id: string; name: string; colorName: string; fabricTypeId: string; displayName: string }>;
    onUpdateFabricType: (productId: string, fabricTypeId: string | null, affectedCount: number) => void;
    onUpdateFabric: (variationId: string, fabricId: string, affectedCount: number) => void;
    rawItems: any[];
}

// Common select styling for fabric popovers
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
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    // Local filter state for variation level - allows browsing all fabric types
    const [filterFabricTypeId, setFilterFabricTypeId] = useState<string>('');

    // Reset filter when popover opens
    useEffect(() => {
        if (isOpen) {
            // Default to current fabric's type, or empty to show all
            const currentFabric = fabrics.find(f => f.id === row.fabricId);
            setFilterFabricTypeId(currentFabric?.fabricTypeId || '');
        }
    }, [isOpen, row.fabricId, fabrics]);

    // Close on click outside
    useEffect(() => {
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

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
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

    // Calculate affected items count for cascading updates
    const getAffectedCount = (type: 'fabricType' | 'fabric') => {
        if (type === 'fabricType') {
            // Count all SKUs under this product
            return rawItems.filter(item => item.productId === row.productId).length;
        } else {
            // Count all SKUs under this variation
            return rawItems.filter(item => item.variationId === row.variationId).length;
        }
    };

    // Check if values are mixed (for aggregated views)
    const hasMixedFabricTypes = useMemo(() => {
        if (viewLevel === 'sku') return false;
        const productItems = rawItems.filter(item => item.productId === row.productId);
        const uniqueTypes = new Set(productItems.map(i => i.fabricTypeId));
        return uniqueTypes.size > 1;
    }, [viewLevel, rawItems, row.productId]);

    const hasMixedFabrics = useMemo(() => {
        if (viewLevel === 'sku') return false;
        const variationItems = rawItems.filter(item => item.variationId === row.variationId);
        const uniqueFabrics = new Set(variationItems.map(i => i.fabricId));
        return uniqueFabrics.size > 1;
    }, [viewLevel, rawItems, row.variationId]);

    // Filter fabrics by selected fabric type
    // For variation level: use local filter state (allows browsing all types)
    // For product/sku level: use product's fabric type
    const filteredFabrics = useMemo(() => {
        const typeIdToFilter = viewLevel === 'variation' ? filterFabricTypeId : row.fabricTypeId;
        if (!typeIdToFilter) return fabrics;
        return fabrics.filter(f => f.fabricTypeId === typeIdToFilter);
    }, [fabrics, viewLevel, filterFabricTypeId, row.fabricTypeId]);

    const handleFabricTypeChange = (fabricTypeId: string) => {
        const affectedCount = getAffectedCount('fabricType');
        if (affectedCount > 1) {
            const confirmed = window.confirm(
                `This will update the fabric type for ${affectedCount} SKU${affectedCount > 1 ? 's' : ''}. Continue?`
            );
            if (!confirmed) return;
        }
        onUpdateFabricType(row.productId, fabricTypeId || null, affectedCount);
        setIsOpen(false);
    };

    const handleFabricChange = (fabricId: string) => {
        if (!fabricId) return;
        const affectedCount = getAffectedCount('fabric');
        if (affectedCount > 1) {
            const confirmed = window.confirm(
                `This will update the fabric for ${affectedCount} SKU${affectedCount > 1 ? 's' : ''}. Continue?`
            );
            if (!confirmed) return;
        }
        onUpdateFabric(row.variationId, fabricId, affectedCount);
        setIsOpen(false);
    };

    // Display text - based on column type and view level
    // For fabric type column:
    //   - Product view: show product's fabricTypeName (matches the dropdown value)
    //   - Variation/SKU views: show variation's fabric type (variationFabricTypeName) for clarity
    const displayText = columnType === 'fabricType'
        ? (hasMixedFabricTypes
            ? 'Multiple'
            : viewLevel === 'product'
                ? (row.fabricTypeName || 'Not set')
                : (row.variationFabricTypeName || row.fabricTypeName || 'Not set'))
        : (hasMixedFabrics ? 'Multiple' : row.fabricName || 'Not set');

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
                title="Edit fabric"
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
                    <div className="text-xs font-medium text-gray-500 mb-2">
                        Edit Fabric - {viewLevel === 'product' ? 'Product Level' : viewLevel === 'variation' ? 'Color Level' : 'SKU Level'}
                    </div>

                    {/* Fabric Type dropdown - for product/sku level: updates product, for variation: filters fabrics */}
                    {(viewLevel === 'product' || viewLevel === 'sku') && (
                        <div className="mb-3">
                            <label className="block text-xs text-gray-600 mb-1">Fabric Type</label>
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
                            {viewLevel === 'product' && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Affects {getAffectedCount('fabricType')} SKU(s)
                                </p>
                            )}
                        </div>
                    )}

                    {/* Fabric Type filter - for variation level only (filters fabric dropdown, doesn't update product) */}
                    {viewLevel === 'variation' && (
                        <div className="mb-3">
                            <label className="block text-xs text-gray-600 mb-1">
                                Filter by Fabric Type
                            </label>
                            <select
                                value={filterFabricTypeId}
                                onChange={(e) => setFilterFabricTypeId(e.target.value)}
                                className={SELECT_CLASS}
                            >
                                <option value="">All fabric types</option>
                                {fabricTypes.map(ft => (
                                    <option key={ft.id} value={ft.id}>{ft.name}</option>
                                ))}
                            </select>
                            <p className="text-xs text-gray-400 mt-1">
                                Filters fabric list below. Edit fabric type in Product view.
                            </p>
                        </div>
                    )}

                    {/* Fabric dropdown - for variation and SKU levels */}
                    {(viewLevel === 'variation' || viewLevel === 'sku') && (
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
                            {viewLevel === 'variation' && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Affects {getAffectedCount('fabric')} SKU(s)
                                </p>
                            )}
                            {filteredFabrics.length === 0 && (viewLevel === 'variation' ? filterFabricTypeId : row.fabricTypeId) && (
                                <p className="text-xs text-amber-600 mt-1">
                                    No fabrics for this type
                                </p>
                            )}
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
