/**
 * Catalog page - Combined Products + Inventory view
 * Flat AG-Grid table with 1 row per SKU showing all product and inventory data
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Search, Plus, Pencil, ChevronDown, ChevronRight, Package, AlertTriangle, XCircle, X, Layers, ArrowLeft } from 'lucide-react';
import { catalogApi, productsApi } from '../services/api';
import { FormModal, ConfirmModal } from '../components/Modal';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { ColumnVisibilityDropdown, InventoryStatusBadge } from '../components/common/grid';
import { useGridState, getColumnOrderFromApi, applyColumnVisibility, applyColumnWidths, orderColumns } from '../hooks/useGridState';
import { usePermissionColumns, type PermissionColDef } from '../hooks/usePermissionColumns';

// Page size options
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const; // 0 = All

// View options for data grouping
type ViewLevel = 'sku' | 'variation' | 'product' | 'consumption';
const VIEW_OPTIONS: { value: ViewLevel; label: string }[] = [
    { value: 'product', label: 'By Product' },
    { value: 'variation', label: 'By Color' },
    { value: 'sku', label: 'By SKU' },
    { value: 'consumption', label: 'Fabric Consumption' },
];

// Columns to hide for each view level
// All views share the same columns for consistency (user request)
const HIDDEN_COLUMNS_BY_VIEW: Record<ViewLevel, string[]> = {
    sku: [],
    variation: [],
    product: [],
    consumption: [], // Uses completely different columns
};

// Standard sizes for consumption matrix
const CONSUMPTION_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

// Aggregate SKU data by variation (product + color)
function aggregateByVariation(items: any[]): any[] {
    const groups = new Map<string, any>();

    for (const item of items) {
        const key = item.variationId;
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                ...item,
                skuCode: `${item.styleCode}-${item.colorName}`,
                size: '-',
                currentBalance: 0,
                reservedBalance: 0,
                availableBalance: 0,
                shopifyQty: null,
                targetStockQty: null,
                skuCount: 0,
                skuIds: [], // Track all SKU IDs for bulk updates
                // Use variation-level costs for editing
                trimsCost: item.variationTrimsCost ?? item.productTrimsCost ?? null,
                liningCost: item.hasLining ? (item.variationLiningCost ?? item.productLiningCost ?? null) : null,
                packagingCost: item.variationPackagingCost ?? item.productPackagingCost ?? item.globalPackagingCost ?? null,
                laborMinutes: item.variationLaborMinutes ?? item.productLaborMinutes ?? null,
                // Track sums for averaging
                _mrpSum: 0,
                _fabricConsumptionSum: 0,
                _fabricCostSum: 0,
                _laborCostSum: 0,
                _liningCostSum: 0,
                _liningCostCount: 0, // Only count items with lining
                _totalCostSum: 0,
                _exGstPriceSum: 0,
                _gstAmountSum: 0,
            });
        }

        const group = groups.get(key)!;
        group.skuIds.push(item.skuId); // Collect SKU IDs
        group.currentBalance += item.currentBalance || 0;
        group.reservedBalance += item.reservedBalance || 0;
        group.availableBalance += item.availableBalance || 0;
        group.skuCount += 1;
        // Sum values for averaging
        group._mrpSum += item.mrp || 0;
        group._fabricConsumptionSum += item.fabricConsumption || 0;
        group._fabricCostSum += item.fabricCost || 0;
        group._laborCostSum += item.laborCost || 0;
        if (item.hasLining && item.liningCost != null) {
            group._liningCostSum += item.liningCost;
            group._liningCostCount += 1;
        }
        group._totalCostSum += item.totalCost || 0;
        group._exGstPriceSum += item.exGstPrice || 0;
        group._gstAmountSum += item.gstAmount || 0;
    }

    // Calculate averages and status
    for (const group of groups.values()) {
        // Show SKU count in SKU Code column at variation level
        group.skuCode = group.skuCount === 1 ? '1 SKU' : `${group.skuCount} SKUs`;
        group.status = group.availableBalance === 0 ? 'out_of_stock' :
                       group.availableBalance < 10 ? 'below_target' : 'ok';
        // Calculate averages
        if (group.skuCount > 0) {
            group.mrp = Math.round(group._mrpSum / group.skuCount);
            group.fabricConsumption = Math.round((group._fabricConsumptionSum / group.skuCount) * 100) / 100;
            group.fabricCost = Math.round(group._fabricCostSum / group.skuCount);
            group.laborCost = Math.round(group._laborCostSum / group.skuCount);
            if (group._liningCostCount > 0) {
                group.liningCost = Math.round(group._liningCostSum / group._liningCostCount);
            }
            group.totalCost = Math.round(group._totalCostSum / group.skuCount);
            group.exGstPrice = Math.round(group._exGstPriceSum / group.skuCount);
            group.gstAmount = Math.round(group._gstAmountSum / group.skuCount);
            // Calculate cost multiple from averaged values
            group.costMultiple = group.totalCost > 0 ? Math.round((group.mrp / group.totalCost) * 100) / 100 : null;
            // GST rate based on averaged MRP (threshold-based)
            group.gstRate = group.mrp >= 2500 ? 18 : 5;
        }
        // Clean up temp fields
        delete group._mrpSum;
        delete group._fabricConsumptionSum;
        delete group._fabricCostSum;
        delete group._laborCostSum;
        delete group._liningCostSum;
        delete group._liningCostCount;
        delete group._totalCostSum;
        delete group._exGstPriceSum;
        delete group._gstAmountSum;
    }

    return Array.from(groups.values());
}

// Aggregate SKU data by product
function aggregateByProduct(items: any[]): any[] {
    const groups = new Map<string, any>();

    for (const item of items) {
        const key = item.productId;
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                ...item,
                skuCode: item.styleCode,
                colorName: '-',
                fabricName: '-',
                // Keep first image URL for product thumbnail
                imageUrl: item.imageUrl || null,
                size: '-',
                currentBalance: 0,
                reservedBalance: 0,
                availableBalance: 0,
                shopifyQty: null,
                targetStockQty: null,
                variationCount: 0,
                skuCount: 0,
                skuIds: [], // Track all SKU IDs for bulk updates
                _uniqueFabricIds: new Set<string>(), // Track unique fabric IDs
                // Use product-level costs for editing
                trimsCost: item.productTrimsCost ?? null,
                liningCost: item.productLiningCost ?? null,
                packagingCost: item.productPackagingCost ?? item.globalPackagingCost ?? null,
                laborMinutes: item.productLaborMinutes ?? null,
                hasLining: false, // Will be set to true if any variation has lining
                // Track sums for averaging
                _mrpSum: 0,
                _fabricConsumptionSum: 0,
                _fabricCostSum: 0,
                _laborCostSum: 0,
                _liningCostSum: 0,
                _liningCostCount: 0,
                _totalCostSum: 0,
                _exGstPriceSum: 0,
                _gstAmountSum: 0,
            });
        }

        const group = groups.get(key)!;
        group.skuIds.push(item.skuId); // Collect SKU IDs
        if (item.fabricId) group._uniqueFabricIds.add(item.fabricId); // Track unique fabrics
        group.currentBalance += item.currentBalance || 0;
        group.reservedBalance += item.reservedBalance || 0;
        group.availableBalance += item.availableBalance || 0;
        group.skuCount += 1;
        // Track if any variation has lining
        if (item.hasLining) group.hasLining = true;
        // Sum values for averaging
        group._mrpSum += item.mrp || 0;
        group._fabricConsumptionSum += item.fabricConsumption || 0;
        group._fabricCostSum += item.fabricCost || 0;
        group._laborCostSum += item.laborCost || 0;
        if (item.hasLining && item.liningCost != null) {
            group._liningCostSum += item.liningCost;
            group._liningCostCount += 1;
        }
        group._totalCostSum += item.totalCost || 0;
        group._exGstPriceSum += item.exGstPrice || 0;
        group._gstAmountSum += item.gstAmount || 0;
    }

    // Count unique variations per product and calculate status/averages
    const variationCounts = new Map<string, Set<string>>();
    for (const item of items) {
        if (!variationCounts.has(item.productId)) {
            variationCounts.set(item.productId, new Set());
        }
        variationCounts.get(item.productId)!.add(item.variationId);
    }

    for (const [productId, group] of groups.entries()) {
        group.variationCount = variationCounts.get(productId)?.size || 0;
        // Show color count, fabric count, and SKU count at product level
        const colorCount = group.variationCount;
        const fabricCount = group._uniqueFabricIds?.size || 0;
        group.colorName = colorCount === 1 ? '1 color' : `${colorCount} colors`;
        group.fabricName = fabricCount === 1 ? '1 fabric' : `${fabricCount} fabrics`;
        group.skuCode = group.skuCount === 1 ? '1 SKU' : `${group.skuCount} SKUs`;
        group.status = group.availableBalance === 0 ? 'out_of_stock' :
                       group.availableBalance < 20 ? 'below_target' : 'ok';
        // Calculate averages
        if (group.skuCount > 0) {
            group.mrp = Math.round(group._mrpSum / group.skuCount);
            group.fabricConsumption = Math.round((group._fabricConsumptionSum / group.skuCount) * 100) / 100;
            group.fabricCost = Math.round(group._fabricCostSum / group.skuCount);
            group.laborCost = Math.round(group._laborCostSum / group.skuCount);
            if (group._liningCostCount > 0) {
                group.liningCost = Math.round(group._liningCostSum / group._liningCostCount);
            }
            group.totalCost = Math.round(group._totalCostSum / group.skuCount);
            group.exGstPrice = Math.round(group._exGstPriceSum / group.skuCount);
            group.gstAmount = Math.round(group._gstAmountSum / group.skuCount);
            // Calculate cost multiple from averaged values
            group.costMultiple = group.totalCost > 0 ? Math.round((group.mrp / group.totalCost) * 100) / 100 : null;
            // GST rate based on averaged MRP (threshold-based)
            group.gstRate = group.mrp >= 2500 ? 18 : 5;
        }
        // Clean up temp fields
        delete group._mrpSum;
        delete group._fabricConsumptionSum;
        delete group._fabricCostSum;
        delete group._laborCostSum;
        delete group._liningCostSum;
        delete group._liningCostCount;
        delete group._totalCostSum;
        delete group._exGstPriceSum;
        delete group._gstAmountSum;
        delete group._uniqueFabricIds;
    }

    return Array.from(groups.values());
}

// Aggregate SKU data by product for consumption matrix view
// Creates one row per product with size columns showing fabric consumption
function aggregateByConsumption(items: any[]): any[] {
    const groups = new Map<string, any>();

    for (const item of items) {
        const key = item.productId;
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                productId: item.productId,
                productName: item.productName,
                styleCode: item.styleCode,
                category: item.category,
                gender: item.gender,
                // Initialize size columns
                ...Object.fromEntries(CONSUMPTION_SIZES.map(size => [`consumption_${size}`, null])),
                // Track SKU IDs for each size (for updates)
                ...Object.fromEntries(CONSUMPTION_SIZES.map(size => [`skuIds_${size}`, []])),
            });
        }

        const group = groups.get(key)!;
        const sizeKey = `consumption_${item.size}`;
        const skuIdsKey = `skuIds_${item.size}`;

        // Set consumption value (should be same for all colors of same product+size)
        if (group[sizeKey] === null && item.fabricConsumption != null) {
            group[sizeKey] = item.fabricConsumption;
        }
        // Collect SKU IDs for this size
        if (group[skuIdsKey]) {
            group[skuIdsKey].push(item.skuId);
        }
    }

    return Array.from(groups.values());
}

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Fabric edit popover props
interface FabricEditPopoverProps {
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

// Fabric edit popover component
function FabricEditPopover({
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

    // Display text - based on column type, not view level
    // For fabric type: prefer the fabric's type (variationFabricTypeName) over product's type (fabricTypeName)
    // This ensures the column shows the actual fabric type when a fabric is selected
    const displayText = columnType === 'fabricType'
        ? (hasMixedFabricTypes ? 'Multiple' : row.variationFabricTypeName || row.fabricTypeName || 'Not set')
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

                    {/* Fabric Type filter - for variation level only (filters, doesn't update) */}
                    {viewLevel === 'variation' && (
                        <div className="mb-3">
                            <label className="block text-xs text-gray-600 mb-1">Fabric Type</label>
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

// All column IDs in display order
const ALL_COLUMN_IDS = [
    'image', 'productName', 'styleCode', 'category', 'gender', 'productType', 'fabricTypeName',
    'colorName', 'hasLining', 'fabricName',
    'skuCode', 'size', 'mrp', 'fabricConsumption', 'fabricCost', 'laborMinutes', 'laborCost', 'trimsCost', 'liningCost', 'packagingCost', 'totalCost',
    'exGstPrice', 'gstAmount', 'costMultiple',
    'currentBalance', 'reservedBalance', 'availableBalance', 'shopifyQty', 'targetStockQty', 'shopifyStatus', 'status',
    'actions'
];

// Default headers
const DEFAULT_HEADERS: Record<string, string> = {
    productName: 'Product',
    styleCode: 'Style',
    category: 'Category',
    gender: 'Gender',
    productType: 'Type',
    fabricTypeName: 'Fabric Type',
    colorName: 'Color',
    hasLining: 'Lining',
    fabricName: 'Fabric',
    image: 'Img',
    skuCode: 'SKU Code',
    size: 'Size',
    mrp: 'MRP',
    fabricConsumption: 'Fab (m)',
    fabricCost: 'Fab ₹',
    laborMinutes: 'Labor (min)',
    laborCost: 'Labor ₹',
    trimsCost: 'Trims ₹',
    liningCost: 'Lin ₹',
    packagingCost: 'Pkg ₹',
    totalCost: 'Cost ₹',
    exGstPrice: 'Ex-GST',
    gstAmount: 'GST',
    costMultiple: 'Multiple',
    currentBalance: 'Balance',
    reservedBalance: 'Reserved',
    availableBalance: 'Available',
    shopifyQty: 'Shopify',
    targetStockQty: 'Target',
    shopifyStatus: 'Shop Status',
    status: 'Status',
    actions: '',
};

export default function Catalog() {
    // Grid ref for API access
    const gridRef = useRef<AgGridReact>(null);
    const queryClient = useQueryClient();

    // Use shared grid state hook for column visibility, order, widths, and page size
    const {
        visibleColumns,
        columnOrder,
        columnWidths,
        pageSize,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
        handleColumnResized,
        handlePageSizeChange,
    } = useGridState({
        gridId: 'catalogGrid',
        allColumnIds: ALL_COLUMN_IDS,
        defaultPageSize: 100,
        // Hide cost calculation columns by default (users can enable via Columns dropdown)
        // fabricConsumption remains visible as it's a key data field
        defaultHiddenColumns: ['fabricCost', 'laborMinutes', 'laborCost', 'trimsCost', 'liningCost', 'packagingCost', 'totalCost', 'exGstPrice', 'gstAmount', 'costMultiple'],
    });

    // View level state
    const [viewLevel, setViewLevel] = useState<ViewLevel>('product');

    // Filter state
    const [filter, setFilter] = useState({
        gender: '',
        category: '',
        productId: '',
        variationId: '', // For drilling down to specific color
        colorName: '', // Store color name for breadcrumb display
        status: '',
    });
    const [searchInput, setSearchInput] = useState('');

    // Edit modal state
    type EditLevel = 'sku' | 'variation' | 'product';
    const [editModal, setEditModal] = useState<{
        isOpen: boolean;
        level: EditLevel;
        data: any;
    }>({ isOpen: false, level: 'sku', data: null });

    // Apply quick filter when search input changes (client-side, instant)
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 150); // Short debounce for typing
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch catalog data (without search - that's done client-side via quick filter)
    const { data: catalogData, isLoading } = useQuery({
        queryKey: ['catalog', filter.gender, filter.category, filter.productId, filter.status],
        queryFn: () => catalogApi.getSkuInventory({
            gender: filter.gender || undefined,
            category: filter.category || undefined,
            productId: filter.productId || undefined,
            status: filter.status || undefined,
        }).then(r => r.data),
    });

    // Fetch filter options
    const { data: filterOptions } = useQuery({
        queryKey: ['catalogFilters'],
        queryFn: () => catalogApi.getFilters().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Mutations for updating fabric type and fabric
    const updateProductMutation = useMutation({
        mutationFn: ({ productId, fabricTypeId }: { productId: string; fabricTypeId: string | null }) =>
            productsApi.update(productId, { fabricTypeId }),
        onSuccess: () => {
            // Force refetch all catalog queries to ensure data consistency across views
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update fabric type');
        },
    });

    const updateVariationMutation = useMutation({
        mutationFn: ({ variationId, fabricId }: { variationId: string; fabricId: string }) =>
            productsApi.updateVariation(variationId, { fabricId }),
        onSuccess: () => {
            // Force refetch all catalog queries to ensure data consistency across views
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update fabric');
        },
    });

    const updateLiningMutation = useMutation({
        mutationFn: ({ variationId, hasLining }: { variationId: string; hasLining: boolean }) =>
            productsApi.updateVariation(variationId, { hasLining }),
        onMutate: async ({ variationId, hasLining }) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({ queryKey: ['catalog'] });

            // Snapshot the previous value
            const previousData = queryClient.getQueryData(['catalog', filter.gender, filter.category, filter.productId, filter.status]);

            // Optimistically update the cache
            queryClient.setQueryData(
                ['catalog', filter.gender, filter.category, filter.productId, filter.status],
                (old: any) => {
                    if (!old?.items) return old;
                    return {
                        ...old,
                        items: old.items.map((item: any) =>
                            item.variationId === variationId
                                ? { ...item, hasLining }
                                : item
                        ),
                    };
                }
            );

            return { previousData };
        },
        onError: (err: any, _variables, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(
                    ['catalog', filter.gender, filter.category, filter.productId, filter.status],
                    context.previousData
                );
            }
            alert(err.response?.data?.error || 'Failed to update lining');
        },
        onSettled: () => {
            // Refetch to ensure we're in sync
            queryClient.invalidateQueries({ queryKey: ['catalog'] });
        },
    });

    // Lining confirmation dialog state
    const [liningConfirm, setLiningConfirm] = useState<{
        isOpen: boolean;
        variationId: string;
        colorName: string;
        productName: string;
        currentValue: boolean;
    } | null>(null);

    const handleUpdateFabricType = useCallback((productId: string, fabricTypeId: string | null) => {
        updateProductMutation.mutate({ productId, fabricTypeId });
    }, [updateProductMutation]);

    const handleUpdateFabric = useCallback((variationId: string, fabricId: string) => {
        updateVariationMutation.mutate({ variationId, fabricId });
    }, [updateVariationMutation]);

    // Show confirmation dialog for lining change
    const promptLiningChange = useCallback((row: any) => {
        setLiningConfirm({
            isOpen: true,
            variationId: row.variationId,
            colorName: row.colorName,
            productName: row.productName,
            currentValue: row.hasLining,
        });
    }, []);

    // Confirm lining change
    const confirmLiningChange = useCallback(() => {
        if (liningConfirm) {
            updateLiningMutation.mutate({
                variationId: liningConfirm.variationId,
                hasLining: !liningConfirm.currentValue,
            });
            setLiningConfirm(null);
        }
    }, [liningConfirm, updateLiningMutation]);

    // SKU update mutation
    const updateSkuMutation = useMutation({
        mutationFn: ({ skuId, data }: { skuId: string; data: any }) =>
            productsApi.updateSku(skuId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
            setEditModal({ isOpen: false, level: 'sku', data: null });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update SKU');
        },
    });

    // Full variation update mutation (for edit modal)
    const updateVariationFullMutation = useMutation({
        mutationFn: ({ variationId, data }: { variationId: string; data: any }) =>
            productsApi.updateVariation(variationId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
            setEditModal({ isOpen: false, level: 'variation', data: null });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update variation');
        },
    });

    // Full product update mutation (for edit modal)
    const updateProductFullMutation = useMutation({
        mutationFn: ({ productId, data }: { productId: string; data: any }) =>
            productsApi.update(productId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
            setEditModal({ isOpen: false, level: 'product', data: null });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update product');
        },
    });

    // Inline cost update mutation (trimsCost, liningCost, packagingCost, or laborMinutes)
    const updateCostMutation = useMutation({
        mutationFn: ({ level, id, field, value }: { level: 'product' | 'variation' | 'sku'; id: string; field: 'trimsCost' | 'liningCost' | 'packagingCost' | 'laborMinutes'; value: number | null }) => {
            const data = { [field]: value };
            if (level === 'product') {
                return productsApi.update(id, data);
            } else if (level === 'variation') {
                return productsApi.updateVariation(id, data);
            } else {
                return productsApi.updateSku(id, data);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update cost');
        },
    });

    // Handle edit modal submit
    const handleEditSubmit = useCallback((formData: any) => {
        if (!editModal.data) return;

        if (editModal.level === 'sku') {
            updateSkuMutation.mutate({
                skuId: editModal.data.skuId,
                data: {
                    fabricConsumption: parseFloat(formData.fabricConsumption) || undefined,
                    mrp: parseFloat(formData.mrp) || undefined,
                    targetStockQty: parseInt(formData.targetStockQty) || undefined,
                },
            });
        } else if (editModal.level === 'variation') {
            updateVariationFullMutation.mutate({
                variationId: editModal.data.variationId,
                data: {
                    colorName: formData.colorName,
                    hasLining: formData.hasLining === 'true' || formData.hasLining === true,
                    fabricId: formData.fabricId || undefined,
                },
            });
        } else if (editModal.level === 'product') {
            updateProductFullMutation.mutate({
                productId: editModal.data.productId,
                data: {
                    name: formData.name,
                    styleCode: formData.styleCode || null,
                    category: formData.category,
                    gender: formData.gender,
                    productType: formData.productType,
                    fabricTypeId: formData.fabricTypeId || null,
                },
            });
        }
    }, [editModal, updateSkuMutation, updateVariationFullMutation, updateProductFullMutation]);

    // Open edit modal
    const openEditModal = useCallback((row: any, level: EditLevel) => {
        setEditModal({ isOpen: true, level, data: row });
    }, []);

    // Filtered products based on selected gender/category
    const filteredProducts = useMemo(() => {
        if (!filterOptions?.products) return [];
        return filterOptions.products.filter((p: any) => {
            if (filter.gender && p.gender !== filter.gender) return false;
            if (filter.category && p.category !== filter.category) return false;
            return true;
        });
    }, [filterOptions?.products, filter.gender, filter.category]);

    // Deduplicate fabric types by name (database may have duplicates with same name)
    const uniqueFabricTypes = useMemo(() => {
        if (!filterOptions?.fabricTypes) return [];
        const seen = new Map<string, { id: string; name: string }>();
        for (const ft of filterOptions.fabricTypes) {
            if (!seen.has(ft.name)) {
                seen.set(ft.name, ft);
            }
        }
        return Array.from(seen.values());
    }, [filterOptions?.fabricTypes]);

    // Aggregate data based on view level
    const displayData = useMemo(() => {
        let items = catalogData?.items || [];

        // Filter by variationId if set (when drilling down to SKU level for a specific color)
        if (filter.variationId && viewLevel === 'sku') {
            items = items.filter((item: any) => item.variationId === filter.variationId);
        }

        switch (viewLevel) {
            case 'variation':
                return aggregateByVariation(items);
            case 'product':
                return aggregateByProduct(items);
            case 'consumption':
                return aggregateByConsumption(items);
            default:
                return items;
        }
    }, [catalogData?.items, viewLevel, filter.variationId]);

    // Grid column moved handler
    const onColumnMoved = () => {
        const api = gridRef.current?.api;
        if (api) {
            handleColumnMoved(getColumnOrderFromApi(api));
        }
    };

    // Handle column resize - save width when user finishes resizing
    const onColumnResized = (event: any) => {
        // Only save when resize is complete (finished=true) and it's a user resize
        if (event.finished && event.columns?.length) {
            event.columns.forEach((col: any) => {
                const colId = col.getColId();
                const width = col.getActualWidth();
                if (colId && width) {
                    handleColumnResized(colId, width);
                }
            });
        }
    };

    // Set default filter for shopifyStatus to "active" when grid is ready
    const onGridReady = useCallback((params: any) => {
        // Only apply default filter for SKU view (not consumption view)
        if (viewLevel !== 'consumption') {
            params.api.setFilterModel({
                shopifyStatus: {
                    filterType: 'text',
                    type: 'equals',
                    filter: 'active',
                },
            });
        }
    }, [viewLevel]);

    // Column definitions with permission-aware cost columns
    const columnDefs: PermissionColDef[] = useMemo(() => [
        // Image column - first for visual identification
        {
            colId: 'image',
            headerName: DEFAULT_HEADERS.image,
            field: 'imageUrl',
            width: 50,
            pinned: 'left' as const,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.value) return <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-xs">-</div>;
                return (
                    <img
                        src={params.value}
                        alt=""
                        className="w-8 h-8 object-cover rounded"
                    />
                );
            },
        },
        // Product columns
        {
            colId: 'productName',
            headerName: DEFAULT_HEADERS.productName,
            field: 'productName',
            width: 180,
            pinned: 'left' as const,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Clickable in product view to drill down to colors
                if (viewLevel === 'product') {
                    return (
                        <button
                            onClick={() => {
                                setFilter(f => ({ ...f, productId: row.productId, variationId: '', colorName: '' }));
                                setViewLevel('variation');
                            }}
                            className="font-medium text-left text-blue-600 hover:text-blue-800 hover:underline truncate w-full"
                            title={`View colors for ${row.productName}`}
                        >
                            {row.productName}
                        </button>
                    );
                }
                // In variation view, clicking product name drills to that color's SKUs
                if (viewLevel === 'variation') {
                    return (
                        <button
                            onClick={() => {
                                setFilter(f => ({
                                    ...f,
                                    productId: row.productId,
                                    variationId: row.variationId,
                                    colorName: row.colorName,
                                }));
                                setViewLevel('sku');
                            }}
                            className="font-medium text-left text-blue-600 hover:text-blue-800 hover:underline truncate w-full"
                            title={`View SKUs for ${row.productName} - ${row.colorName}`}
                        >
                            {row.productName}
                        </button>
                    );
                }
                return <span className="font-medium truncate">{row.productName}</span>;
            },
        },
        {
            colId: 'styleCode',
            headerName: DEFAULT_HEADERS.styleCode,
            field: 'styleCode',
            width: 70,
            cellClass: 'text-xs text-gray-500 font-mono',
        },
        {
            colId: 'category',
            headerName: DEFAULT_HEADERS.category,
            field: 'category',
            width: 90,
            cellClass: 'capitalize',
        },
        {
            colId: 'gender',
            headerName: DEFAULT_HEADERS.gender,
            field: 'gender',
            width: 70,
            cellClass: 'capitalize',
        },
        {
            colId: 'productType',
            headerName: DEFAULT_HEADERS.productType,
            field: 'productType',
            width: 80,
            cellClass: 'capitalize text-xs',
        },
        {
            colId: 'fabricTypeName',
            headerName: DEFAULT_HEADERS.fabricTypeName,
            width: 120,
            // Use valueGetter for filtering (returns displayed text)
            valueGetter: (params: any) => {
                const row = params.data;
                if (!row) return '';
                return row.variationFabricTypeName || row.fabricTypeName || '';
            },
            filter: 'agTextColumnFilter',
            floatingFilter: true,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                return (
                    <FabricEditPopover
                        row={row}
                        viewLevel={viewLevel}
                        columnType="fabricType"
                        fabricTypes={uniqueFabricTypes}
                        fabrics={filterOptions?.fabrics || []}
                        onUpdateFabricType={handleUpdateFabricType}
                        onUpdateFabric={handleUpdateFabric}
                        rawItems={catalogData?.items || []}
                    />
                );
            },
        },
        // Variation columns
        {
            colId: 'colorName',
            headerName: DEFAULT_HEADERS.colorName,
            field: 'colorName',
            width: 110,
        },
        {
            colId: 'hasLining',
            headerName: DEFAULT_HEADERS.hasLining,
            field: 'hasLining',
            width: 65,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || viewLevel === 'product') return null;
                return (
                    <button
                        onClick={() => promptLiningChange(row)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                            row.hasLining
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={row.hasLining ? 'Has lining - click to remove' : 'No lining - click to add'}
                    >
                        {row.hasLining ? 'Yes' : 'No'}
                    </button>
                );
            },
        },
        {
            colId: 'fabricName',
            headerName: DEFAULT_HEADERS.fabricName,
            width: 140,
            // Use valueGetter for filtering (returns displayed text)
            valueGetter: (params: any) => {
                const row = params.data;
                if (!row) return '';
                return row.fabricName || '';
            },
            filter: 'agTextColumnFilter',
            floatingFilter: true,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Show fabric count at product level, editor for variation and SKU views
                if (viewLevel === 'product') {
                    return <span className="text-xs text-gray-500">{row.fabricName || '-'}</span>;
                }
                return (
                    <FabricEditPopover
                        row={row}
                        viewLevel={viewLevel}
                        columnType="fabric"
                        fabricTypes={uniqueFabricTypes}
                        fabrics={filterOptions?.fabrics || []}
                        onUpdateFabricType={handleUpdateFabricType}
                        onUpdateFabric={handleUpdateFabric}
                        rawItems={catalogData?.items || []}
                    />
                );
            },
        },
        // SKU columns
        {
            colId: 'skuCode',
            headerName: DEFAULT_HEADERS.skuCode,
            field: 'skuCode',
            width: 130,
            cellClass: 'text-xs font-mono',
        },
        {
            colId: 'size',
            headerName: DEFAULT_HEADERS.size,
            field: 'size',
            width: 55,
            cellClass: 'text-center font-medium',
        },
        {
            colId: 'mrp',
            headerName: DEFAULT_HEADERS.mrp,
            field: 'mrp',
            width: 70,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${params.value.toLocaleString()}` : '-',
            cellClass: 'text-right',
        },
        {
            colId: 'fabricConsumption',
            headerName: DEFAULT_HEADERS.fabricConsumption,
            field: 'fabricConsumption',
            width: 65,
            viewPermission: 'products:view:consumption',
            editPermission: 'products:edit:consumption',
            editable: () => viewLevel !== 'consumption', // Editable in all views except consumption matrix
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(2) : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'fabricCost',
            headerName: DEFAULT_HEADERS.fabricCost,
            field: 'fabricCost',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs text-blue-600',
        },
        {
            colId: 'laborMinutes',
            headerName: DEFAULT_HEADERS.laborMinutes,
            field: 'laborMinutes',
            width: 75,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(0) : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'laborCost',
            headerName: DEFAULT_HEADERS.laborCost,
            field: 'laborCost',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs text-purple-600',
        },
        {
            colId: 'trimsCost',
            headerName: DEFAULT_HEADERS.trimsCost,
            field: 'trimsCost',
            width: 70,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'liningCost',
            headerName: DEFAULT_HEADERS.liningCost,
            field: 'liningCost',
            width: 65,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: (params: any) => params.data?.hasLining === true, // Only editable if hasLining
            valueFormatter: (params: ValueFormatterParams) => {
                // Show "-" if no lining
                if (!params.data?.hasLining) return '-';
                return params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-';
            },
            cellClass: (params: CellClassParams) => {
                if (!params.data?.hasLining) return 'text-right text-xs text-gray-300';
                return 'text-right text-xs cursor-pointer hover:bg-blue-50';
            },
            cellStyle: (params: any) => params.data?.hasLining ? { backgroundColor: '#f0f9ff' } : undefined,
        },
        {
            colId: 'packagingCost',
            headerName: DEFAULT_HEADERS.packagingCost,
            field: 'packagingCost',
            width: 65,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'totalCost',
            headerName: DEFAULT_HEADERS.totalCost,
            field: 'totalCost',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs font-medium text-emerald-700',
        },
        // GST & Pricing columns
        {
            colId: 'exGstPrice',
            headerName: DEFAULT_HEADERS.exGstPrice,
            field: 'exGstPrice',
            width: 75,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs',
        },
        {
            colId: 'gstAmount',
            headerName: DEFAULT_HEADERS.gstAmount,
            field: 'gstAmount',
            width: 65,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null) return '-';
                const rate = params.data?.gstRate || 0;
                return `₹${Number(params.value).toFixed(0)} (${rate}%)`;
            },
            cellClass: 'text-right text-xs text-gray-600',
        },
        {
            colId: 'costMultiple',
            headerName: DEFAULT_HEADERS.costMultiple,
            field: 'costMultiple',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `${Number(params.value).toFixed(1)}x` : '-',
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val >= 3) return 'text-right text-xs font-medium text-green-600';
                if (val >= 2) return 'text-right text-xs font-medium text-amber-600';
                return 'text-right text-xs font-medium text-red-600';
            },
        },
        // Inventory columns
        {
            colId: 'currentBalance',
            headerName: DEFAULT_HEADERS.currentBalance,
            field: 'currentBalance',
            width: 70,
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-gray-400';
                return 'text-right font-medium';
            },
        },
        {
            colId: 'reservedBalance',
            headerName: DEFAULT_HEADERS.reservedBalance,
            field: 'reservedBalance',
            width: 70,
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-gray-300';
                return 'text-right text-amber-600';
            },
        },
        {
            colId: 'availableBalance',
            headerName: DEFAULT_HEADERS.availableBalance,
            field: 'availableBalance',
            width: 75,
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-red-400 font-medium';
                if (val < (params.data?.targetStockQty || 0)) return 'text-right text-amber-600 font-medium';
                return 'text-right text-green-600 font-medium';
            },
        },
        {
            colId: 'shopifyQty',
            headerName: DEFAULT_HEADERS.shopifyQty,
            field: 'shopifyQty',
            width: 70,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value : '-',
            cellClass: 'text-right text-xs text-blue-600',
        },
        {
            colId: 'targetStockQty',
            headerName: DEFAULT_HEADERS.targetStockQty,
            field: 'targetStockQty',
            width: 60,
            cellClass: 'text-right text-xs text-gray-500',
        },
        {
            colId: 'shopifyStatus',
            headerName: DEFAULT_HEADERS.shopifyStatus,
            field: 'shopifyStatus',
            width: 100,
            filter: 'agTextColumnFilter',
            floatingFilter: true,
            cellRenderer: (params: ICellRendererParams) => {
                const status = params.value;
                if (!status || status === 'not_linked') return <span className="text-xs text-gray-300">-</span>;
                const statusStyles: Record<string, string> = {
                    active: 'bg-green-100 text-green-700',
                    draft: 'bg-yellow-100 text-yellow-700',
                    archived: 'bg-gray-200 text-gray-600',
                    not_cached: 'bg-gray-100 text-gray-400',
                    unknown: 'bg-gray-100 text-gray-400',
                };
                return (
                    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${statusStyles[status] || statusStyles.unknown}`}>
                        {status.replace('_', ' ')}
                    </span>
                );
            },
        },
        {
            colId: 'status',
            headerName: DEFAULT_HEADERS.status,
            field: 'status',
            width: 70,
            cellRenderer: (params: ICellRendererParams) => (
                <InventoryStatusBadge status={params.value} />
            ),
        },
        // Actions
        {
            colId: 'actions',
            headerName: '',
            width: 80,
            pinned: 'right' as const,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Determine edit level based on current view
                const editLevel = viewLevel === 'product' ? 'product' : viewLevel === 'variation' ? 'variation' : 'sku';
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => openEditModal(row, editLevel)}
                            className="p-1 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                            title={`Edit ${editLevel}`}
                        >
                            <Pencil size={14} />
                        </button>
                        <button
                            onClick={() => {
                                // TODO: Open quick inward modal
                                console.log('Add inward:', row.skuCode);
                            }}
                            className="p-1 rounded hover:bg-green-100 text-green-500 hover:text-green-700"
                            title="Add inward"
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                );
            },
        },
    ], [viewLevel, filterOptions?.fabrics, catalogData?.items, handleUpdateFabricType, handleUpdateFabric, uniqueFabricTypes]);

    // Mutation for updating fabric consumption by SKU IDs
    const updateConsumption = useMutation({
        mutationFn: async ({ skuIds, fabricConsumption }: { skuIds: string[]; fabricConsumption: number }) => {
            // Batch updates to prevent server overload (5 concurrent requests at a time)
            const batchSize = 5;
            const results: any[] = [];

            for (let i = 0; i < skuIds.length; i += batchSize) {
                const batch = skuIds.slice(i, i + batchSize);
                const batchResults = await Promise.all(
                    batch.map(skuId =>
                        productsApi.updateSku(skuId, { fabricConsumption })
                    )
                );
                results.push(...batchResults);
            }

            return results;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalogSkuInventory'] });
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to update fabric consumption');
        },
    });

    // Handle consumption cell value change (called by AG-Grid)
    const handleConsumptionChange = useCallback((params: any) => {
        const { data, colDef, newValue } = params;
        const size = colDef.field?.replace('consumption_', '');
        if (!size) return;

        const skuIds = data[`skuIds_${size}`] || [];
        const newConsumption = parseFloat(newValue);

        if (!isNaN(newConsumption) && newConsumption > 0 && skuIds.length > 0) {
            updateConsumption.mutate({ skuIds, fabricConsumption: newConsumption });
        }
    }, [updateConsumption]);

    // Handle cost cell value change (trimsCost, liningCost, packagingCost, or laborMinutes)
    const handleCostChange = useCallback((params: any) => {
        const { data, colDef, newValue } = params;
        const field = colDef.field as 'trimsCost' | 'liningCost' | 'packagingCost' | 'laborMinutes';
        if (field !== 'trimsCost' && field !== 'liningCost' && field !== 'packagingCost' && field !== 'laborMinutes') return;

        const newCost = newValue === '' || newValue === null ? null : parseFloat(newValue);
        if (newValue !== '' && newValue !== null && isNaN(newCost as number)) return;

        // Determine which level to update based on current view
        if (viewLevel === 'product') {
            updateCostMutation.mutate({ level: 'product', id: data.productId, field, value: newCost });
        } else if (viewLevel === 'variation') {
            updateCostMutation.mutate({ level: 'variation', id: data.variationId, field, value: newCost });
        } else {
            updateCostMutation.mutate({ level: 'sku', id: data.skuId, field, value: newCost });
        }
    }, [viewLevel, updateCostMutation]);

    // Column definitions for consumption matrix view
    const consumptionColumnDefs: ColDef[] = useMemo(() => [
        {
            colId: 'productName',
            headerName: 'Product',
            field: 'productName',
            width: 200,
            pinned: 'left' as const,
            cellClass: 'font-medium',
        },
        {
            colId: 'styleCode',
            headerName: 'Style',
            field: 'styleCode',
            width: 80,
            cellClass: 'text-xs text-gray-500 font-mono',
        },
        {
            colId: 'category',
            headerName: 'Category',
            field: 'category',
            width: 90,
            cellClass: 'capitalize',
        },
        // Size columns with editable consumption values
        ...CONSUMPTION_SIZES.map(size => ({
            colId: `consumption_${size}`,
            headerName: size,
            field: `consumption_${size}`,
            width: 65,
            editable: (params: any) => {
                // Only editable if there are SKUs for this size
                const skuIds = params.data?.[`skuIds_${size}`] || [];
                return skuIds.length > 0;
            },
            cellClass: (params: any) => {
                const skuIds = params.data?.[`skuIds_${size}`] || [];
                if (skuIds.length === 0) return 'text-center text-gray-300';
                return 'text-right text-xs cursor-pointer hover:bg-blue-50';
            },
            valueFormatter: (params: ValueFormatterParams) => {
                const skuIds = params.data?.[`skuIds_${params.colDef.field?.replace('consumption_', '')}`] || [];
                if (skuIds.length === 0) return '-';
                return params.value != null ? Number(params.value).toFixed(2) : '1.50';
            },
            valueParser: (params: any) => {
                const val = parseFloat(params.newValue);
                return isNaN(val) ? params.oldValue : val;
            },
            cellStyle: (params: any) => {
                const skuIds = params.data?.[`skuIds_${size}`] || [];
                if (skuIds.length === 0) return { backgroundColor: '#f9fafb' };
                return { backgroundColor: '#f0f9ff' }; // Light blue for editable
            },
        })),
    ], []);

    // Filter columns based on user permissions
    const permissionFilteredColumns = usePermissionColumns(columnDefs);

    // Apply visibility and ordering using helper functions
    const orderedColumnDefs = useMemo(() => {
        // Use consumption-specific columns for consumption view
        if (viewLevel === 'consumption') {
            return consumptionColumnDefs;
        }

        // First apply user's column visibility preferences
        const withVisibility = applyColumnVisibility(permissionFilteredColumns, visibleColumns);
        // Then hide columns based on view level
        const hiddenByView = HIDDEN_COLUMNS_BY_VIEW[viewLevel];
        const withViewVisibility = withVisibility.map(col => ({
            ...col,
            hide: col.hide || hiddenByView.includes(col.colId || ''),
        }));
        // Apply saved column widths
        const withWidths = applyColumnWidths(withViewVisibility, columnWidths);
        return orderColumns(withWidths, columnOrder);
    }, [permissionFilteredColumns, consumptionColumnDefs, visibleColumns, columnOrder, columnWidths, viewLevel]);

    // Column IDs available after permission filtering (for ColumnVisibilityDropdown)
    const availableColumnIds = useMemo(() => {
        return permissionFilteredColumns.map(col => col.colId || col.field || '').filter(Boolean);
    }, [permissionFilteredColumns]);

    // Summary stats based on view level
    const stats = useMemo(() => {
        const items = displayData;
        const label = viewLevel === 'product' ? 'Products' :
                      viewLevel === 'variation' ? 'Colors' :
                      viewLevel === 'consumption' ? 'Products' : 'SKUs';
        return {
            total: items.length,
            label,
            belowTarget: items.filter((i: any) => i.status === 'below_target' || i.status === 'out_of_stock').length,
            outOfStock: items.filter((i: any) => i.availableBalance === 0).length,
        };
    }, [displayData, viewLevel]);

    // Analytics: total units in stock by gender and fabric type
    const analytics = useMemo(() => {
        const items = catalogData?.items || [];

        let totalUnits = 0;
        const byGender: Record<string, number> = {};
        const byFabricType: Record<string, number> = {};

        for (const item of items) {
            const balance = item.currentBalance || 0;
            totalUnits += balance;

            // By gender
            const gender = item.gender || 'Unknown';
            byGender[gender] = (byGender[gender] || 0) + balance;

            // By fabric type
            const fabricType = item.fabricTypeName || 'Unknown';
            byFabricType[fabricType] = (byFabricType[fabricType] || 0) + balance;
        }

        // Sort by value descending
        const genderEntries = Object.entries(byGender).sort((a, b) => b[1] - a[1]);
        const fabricTypeEntries = Object.entries(byFabricType).sort((a, b) => b[1] - a[1]);

        return { totalUnits, byGender: genderEntries, byFabricType: fabricTypeEntries };
    }, [catalogData?.items]);

    // State for analytics panel expansion
    const [showFabricBreakdown, setShowFabricBreakdown] = useState(false);
    const fabricDropdownRef = useRef<HTMLDivElement>(null);

    // Close fabric dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (fabricDropdownRef.current && !fabricDropdownRef.current.contains(e.target as Node)) {
                setShowFabricBreakdown(false);
            }
        };
        if (showFabricBreakdown) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showFabricBreakdown]);

    return (
        <div className="space-y-4">
            {/* Header with Stats Cards */}
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                {/* Title Section */}
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-lg">
                        <Layers size={24} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Catalog</h1>
                        <p className="text-sm text-gray-500">Products & Inventory Overview</p>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="flex flex-wrap gap-3">
                    {/* Total Items */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                            <Package size={18} className="text-slate-600" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-gray-900 leading-none">{stats.total.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{stats.label}</div>
                        </div>
                    </div>

                    {/* Low Stock */}
                    {stats.belowTarget > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
                            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                                <AlertTriangle size={18} className="text-amber-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-amber-700 leading-none">{stats.belowTarget.toLocaleString()}</div>
                                <div className="text-xs text-amber-600 mt-0.5">Low Stock</div>
                            </div>
                        </div>
                    )}

                    {/* Out of Stock */}
                    {stats.outOfStock > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 rounded-xl border border-red-200 shadow-sm">
                            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
                                <XCircle size={18} className="text-red-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-red-700 leading-none">{stats.outOfStock.toLocaleString()}</div>
                                <div className="text-xs text-red-600 mt-0.5">Out of Stock</div>
                            </div>
                        </div>
                    )}

                    {/* Total Units (Stock Summary) */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-emerald-700 leading-none">{analytics.totalUnits.toLocaleString()}</div>
                            <div className="text-xs text-emerald-600 mt-0.5">Units in Stock</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Compact Analytics Summary */}
            <div className="bg-gradient-to-r from-slate-50 to-gray-50 border border-gray-200 rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Gender Breakdown - Compact */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Stock by Gender:</span>
                        <div className="flex gap-1.5">
                            {analytics.byGender.map(([gender, count]) => (
                                <span key={gender} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-gray-200 text-xs">
                                    <span className="text-gray-600 capitalize">{gender}</span>
                                    <span className="font-bold text-gray-900">{count.toLocaleString()}</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="w-px h-6 bg-gray-300 hidden sm:block" />

                    {/* Fabric Breakdown - Expandable */}
                    <div className="relative" ref={fabricDropdownRef}>
                        <button
                            onClick={() => setShowFabricBreakdown(!showFabricBreakdown)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors text-xs"
                        >
                            <span className="font-medium text-gray-500 uppercase tracking-wider">By Fabric</span>
                            <span className="font-bold text-gray-900">{analytics.byFabricType.length} types</span>
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${showFabricBreakdown ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Fabric Dropdown */}
                        {showFabricBreakdown && (
                            <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-xl border border-gray-200 shadow-xl p-3 min-w-[280px] max-h-[300px] overflow-y-auto">
                                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 px-1">Stock by Fabric Type</div>
                                <div className="space-y-1">
                                    {analytics.byFabricType.map(([fabricType, count]) => (
                                        <div key={fabricType} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50">
                                            <span className="text-sm text-gray-700">{fabricType}</span>
                                            <span className="text-sm font-semibold text-gray-900">{count.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    {/* View Level Selector - Segmented Control Style */}
                    <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                        {VIEW_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setViewLevel(opt.value)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                                    viewLevel === opt.value
                                        ? 'bg-white text-gray-900 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-7 bg-gray-200 hidden sm:block" />

                    {/* Search */}
                    <div className="relative flex-1 sm:flex-initial">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search products, SKUs..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full sm:w-56 pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition-all"
                        />
                    </div>

                    <div className="w-px h-7 bg-gray-200 hidden lg:block" />

                    {/* Filter Dropdowns Group */}
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={filter.gender}
                            onChange={(e) => setFilter(f => ({ ...f, gender: e.target.value, productId: '' }))}
                            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                        >
                            <option value="">All Genders</option>
                            {filterOptions?.genders?.map((g: string) => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>

                        <select
                            value={filter.category}
                            onChange={(e) => setFilter(f => ({ ...f, category: e.target.value, productId: '' }))}
                            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                        >
                            <option value="">All Categories</option>
                            {filterOptions?.categories?.map((c: string) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        <select
                            value={filter.productId}
                            onChange={(e) => setFilter(f => ({ ...f, productId: e.target.value }))}
                            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all max-w-[180px]"
                        >
                            <option value="">All Products</option>
                            {filteredProducts.map((p: any) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>

                        <select
                            value={filter.status}
                            onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))}
                            className={`text-sm border rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all ${
                                filter.status === 'below_target' ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                            }`}
                        >
                            <option value="">All Status</option>
                            <option value="ok">In Stock</option>
                            <option value="below_target">Below Target</option>
                        </select>
                    </div>

                    <div className="hidden lg:block lg:flex-1" />

                    {/* Right Side Controls */}
                    <div className="flex items-center gap-2">
                        {/* Page Size */}
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded-lg">
                            <span className="text-xs text-gray-500">Show</span>
                            <select
                                value={pageSize}
                                onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
                                className="text-xs font-medium bg-transparent border-none focus:outline-none cursor-pointer"
                            >
                                {PAGE_SIZE_OPTIONS.map(size => (
                                    <option key={size} value={size}>
                                        {size === 0 ? 'All' : size}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Column Visibility - filter out columns hidden by view level and permissions */}
                        <ColumnVisibilityDropdown
                            visibleColumns={visibleColumns}
                            onToggleColumn={handleToggleColumn}
                            onResetAll={handleResetAll}
                            columnIds={availableColumnIds.filter(id => !HIDDEN_COLUMNS_BY_VIEW[viewLevel].includes(id))}
                            columnHeaders={DEFAULT_HEADERS}
                        />
                    </div>
                </div>
            </div>

            {/* Active Product Filter Breadcrumb - appears when drilling down */}
            {filter.productId && (
                <div className="relative overflow-hidden">
                    {/* Subtle gradient background */}
                    <div className="absolute inset-0 bg-gradient-to-r from-slate-50 via-blue-50/50 to-slate-50" />
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left,_var(--tw-gradient-stops))] from-blue-100/30 via-transparent to-transparent" />

                    <div className="relative flex items-center justify-between px-4 py-3 border border-blue-100 rounded-xl">
                        {/* Left: Breadcrumb path */}
                        <div className="flex items-center gap-2">
                            {/* Back button - goes back one level */}
                            <button
                                onClick={() => {
                                    if (filter.variationId) {
                                        // At SKU level with color filter → go back to Color view
                                        setFilter(f => ({ ...f, variationId: '', colorName: '' }));
                                        setViewLevel('variation');
                                    } else {
                                        // At Color level → go back to Product view
                                        setFilter(f => ({ ...f, productId: '', variationId: '', colorName: '' }));
                                        setViewLevel('product');
                                    }
                                }}
                                className="flex items-center justify-center w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm"
                                title={filter.variationId ? 'Back to colors' : 'Back to all products'}
                            >
                                <ArrowLeft size={16} />
                            </button>

                            {/* Breadcrumb trail */}
                            <nav className="flex items-center gap-1.5 text-sm">
                                {/* All Products - always clickable */}
                                <button
                                    onClick={() => {
                                        setFilter(f => ({ ...f, productId: '', variationId: '', colorName: '' }));
                                        setViewLevel('product');
                                    }}
                                    className="text-gray-500 hover:text-blue-600 transition-colors font-medium"
                                >
                                    All Products
                                </button>

                                <ChevronRight size={14} className="text-gray-300" />

                                {/* Product Name - clickable if we're at SKU level to go back to Color view */}
                                {filter.variationId ? (
                                    <button
                                        onClick={() => {
                                            setFilter(f => ({ ...f, variationId: '', colorName: '' }));
                                            setViewLevel('variation');
                                        }}
                                        className="text-gray-500 hover:text-blue-600 transition-colors font-medium"
                                    >
                                        {filterOptions?.products?.find((p: any) => p.id === filter.productId)?.name || 'Product'}
                                    </button>
                                ) : (
                                    <span className="font-semibold text-gray-900">
                                        {filterOptions?.products?.find((p: any) => p.id === filter.productId)?.name || 'Selected Product'}
                                    </span>
                                )}

                                {/* Color Name - shown when at SKU level */}
                                {filter.variationId && filter.colorName && (
                                    <>
                                        <ChevronRight size={14} className="text-gray-300" />
                                        <span className="font-semibold text-gray-900">
                                            {filter.colorName}
                                        </span>
                                    </>
                                )}
                            </nav>

                            {/* View level indicator */}
                            <span className="ml-3 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                {viewLevel === 'variation' ? 'Viewing Colors' : viewLevel === 'sku' ? 'Viewing SKUs' : 'Filtered'}
                            </span>
                        </div>

                        {/* Right: Clear all / Back button */}
                        <div className="flex items-center gap-2">
                            {/* Show "Back" when at SKU level with color filter */}
                            {filter.variationId && (
                                <button
                                    onClick={() => {
                                        setFilter(f => ({ ...f, variationId: '', colorName: '' }));
                                        setViewLevel('variation');
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm text-sm text-gray-600 hover:text-blue-600"
                                >
                                    <ArrowLeft size={14} />
                                    Back to Colors
                                </button>
                            )}

                            {/* Clear all filters */}
                            <button
                                onClick={() => {
                                    setFilter(f => ({ ...f, productId: '', variationId: '', colorName: '' }));
                                    setViewLevel('product');
                                }}
                                className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:border-red-300 hover:bg-red-50 transition-all shadow-sm"
                            >
                                <span className="text-sm text-gray-600 group-hover:text-red-600 transition-colors">Clear all</span>
                                <X size={14} className="text-gray-400 group-hover:text-red-500 transition-colors" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AG-Grid Container */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="table-scroll-container">
                    <div style={{ minWidth: '1100px', height: 'calc(100vh - 320px)', minHeight: '400px' }}>
                    <AgGridReact
                        ref={gridRef}
                        theme={compactThemeSmall}
                        rowData={displayData}
                        columnDefs={orderedColumnDefs}
                        loading={isLoading}
                        defaultColDef={{
                            sortable: true,
                            resizable: true,
                            suppressMovable: false,
                        }}
                        animateRows={false}
                        suppressCellFocus={false}
                        singleClickEdit={true}
                        stopEditingWhenCellsLoseFocus={true}
                        getRowId={(params) => {
                            // Use appropriate ID based on view level
                            if (viewLevel === 'product' || viewLevel === 'consumption') return params.data.productId;
                            if (viewLevel === 'variation') return params.data.variationId;
                            return params.data.skuId;
                        }}
                        // Handle cell edits (consumption and cost fields)
                        onCellValueChanged={(params) => {
                            if (viewLevel === 'consumption') {
                                handleConsumptionChange(params);
                            } else if (params.colDef.field === 'trimsCost' || params.colDef.field === 'liningCost' || params.colDef.field === 'packagingCost' || params.colDef.field === 'laborMinutes') {
                                handleCostChange(params);
                            } else if (params.colDef.field === 'fabricConsumption') {
                                // Handle fabric consumption edit
                                const newConsumption = parseFloat(params.newValue);
                                if (!isNaN(newConsumption) && newConsumption > 0) {
                                    if (viewLevel === 'sku') {
                                        // Single SKU update
                                        updateSkuMutation.mutate({
                                            skuId: params.data.skuId,
                                            data: { fabricConsumption: newConsumption },
                                        });
                                    } else {
                                        // Bulk update all SKUs in this product/variation
                                        const skuIds = params.data.skuIds || [];
                                        if (skuIds.length > 0) {
                                            updateConsumption.mutate({ skuIds, fabricConsumption: newConsumption });
                                        }
                                    }
                                }
                            }
                        }}
                        // Pagination
                        pagination={true}
                        paginationPageSize={pageSize === 0 ? 999999 : pageSize}
                        paginationPageSizeSelector={false}
                        // Quick filter for fast search
                        cacheQuickFilter={true}
                        // Column order and width persistence
                        onColumnMoved={onColumnMoved}
                        onColumnResized={onColumnResized}
                        onGridReady={onGridReady}
                        maintainColumnOrder={true}
                    />
                    </div>
                </div>
            </div>

            {/* Lining Confirmation Dialog */}
            <ConfirmModal
                isOpen={!!liningConfirm?.isOpen}
                onClose={() => setLiningConfirm(null)}
                onConfirm={confirmLiningChange}
                title="Change Lining Status"
                message={liningConfirm ?
                    `${liningConfirm.currentValue ? 'Remove' : 'Add'} lining for "${liningConfirm.colorName}" (${liningConfirm.productName})?` :
                    ''
                }
                confirmText={liningConfirm?.currentValue ? 'Remove Lining' : 'Add Lining'}
                cancelText="Cancel"
                variant={liningConfirm?.currentValue ? 'warning' : 'primary'}
                isLoading={updateLiningMutation.isPending}
            />

            {/* Edit Modal */}
            <EditModal
                isOpen={editModal.isOpen}
                level={editModal.level}
                data={editModal.data}
                onClose={() => setEditModal({ isOpen: false, level: 'sku', data: null })}
                onSubmit={handleEditSubmit}
                fabricTypes={uniqueFabricTypes}
                fabrics={filterOptions?.fabrics || []}
                isLoading={updateSkuMutation.isPending || updateVariationFullMutation.isPending || updateProductFullMutation.isPending}
            />
        </div>
    );
}

// Edit Modal Component
interface EditModalProps {
    isOpen: boolean;
    level: 'sku' | 'variation' | 'product';
    data: any;
    onClose: () => void;
    onSubmit: (formData: any) => void;
    fabricTypes: Array<{ id: string; name: string }>;
    fabrics: Array<{ id: string; name: string; colorName: string; fabricTypeId: string; displayName: string }>;
    isLoading: boolean;
}

function EditModal({ isOpen, level, data, onClose, onSubmit, fabricTypes, fabrics, isLoading }: EditModalProps) {
    const [formData, setFormData] = useState<any>({});

    // Reset form when data changes
    useEffect(() => {
        if (data) {
            if (level === 'sku') {
                setFormData({
                    fabricConsumption: data.fabricConsumption || '',
                    mrp: data.mrp || '',
                    targetStockQty: data.targetStockQty || '',
                });
            } else if (level === 'variation') {
                setFormData({
                    colorName: data.colorName || '',
                    hasLining: data.hasLining || false,
                    fabricId: data.fabricId || '',
                });
            } else if (level === 'product') {
                setFormData({
                    name: data.productName || '',
                    styleCode: data.styleCode || '',
                    category: data.category || '',
                    gender: data.gender || '',
                    productType: data.productType || '',
                    fabricTypeId: data.fabricTypeId || '',
                });
            }
        }
    }, [data, level]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    const handleChange = (field: string, value: any) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
    };

    const getTitle = () => {
        if (level === 'sku') return `Edit SKU: ${data?.skuCode}`;
        if (level === 'variation') return `Edit Color: ${data?.colorName}`;
        return `Edit Product: ${data?.productName}`;
    };

    const getSubtitle = () => {
        if (level === 'sku') return `${data?.productName} - ${data?.colorName} - ${data?.size}`;
        if (level === 'variation') return data?.productName;
        return data?.styleCode || '';
    };

    // Filter fabrics by selected fabric type
    const filteredFabrics = useMemo(() => {
        if (!data?.fabricTypeId) return fabrics;
        return fabrics.filter(f => f.fabricTypeId === data.fabricTypeId);
    }, [fabrics, data?.fabricTypeId]);

    return (
        <FormModal
            isOpen={isOpen}
            onClose={onClose}
            onSubmit={handleSubmit}
            title={getTitle()}
            subtitle={getSubtitle()}
            size="md"
            isLoading={isLoading}
        >
            <div className="space-y-4">
                {level === 'sku' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Fabric Consumption (m)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.fabricConsumption}
                                onChange={(e) => handleChange('fabricConsumption', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">MRP (₹)</label>
                            <input
                                type="number"
                                step="1"
                                value={formData.mrp}
                                onChange={(e) => handleChange('mrp', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Stock Qty</label>
                            <input
                                type="number"
                                step="1"
                                value={formData.targetStockQty}
                                onChange={(e) => handleChange('targetStockQty', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                    </>
                )}

                {level === 'variation' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Color Name</label>
                            <input
                                type="text"
                                value={formData.colorName}
                                onChange={(e) => handleChange('colorName', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Has Lining</label>
                            <div className="flex items-center gap-4 mt-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="hasLining"
                                        checked={formData.hasLining === true}
                                        onChange={() => handleChange('hasLining', true)}
                                        className="text-blue-600"
                                    />
                                    <span className="text-sm">Yes</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="hasLining"
                                        checked={formData.hasLining === false}
                                        onChange={() => handleChange('hasLining', false)}
                                        className="text-blue-600"
                                    />
                                    <span className="text-sm">No</span>
                                </label>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Fabric</label>
                            <select
                                value={formData.fabricId}
                                onChange={(e) => handleChange('fabricId', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            >
                                <option value="">Select fabric...</option>
                                {filteredFabrics.map((f) => (
                                    <option key={f.id} value={f.id}>{f.displayName}</option>
                                ))}
                            </select>
                        </div>
                    </>
                )}

                {level === 'product' && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Style Code</label>
                            <input
                                type="text"
                                value={formData.styleCode}
                                onChange={(e) => handleChange('styleCode', e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                                <select
                                    value={formData.category}
                                    onChange={(e) => handleChange('category', e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="dress">Dress</option>
                                    <option value="top">Top</option>
                                    <option value="bottom">Bottom</option>
                                    <option value="outerwear">Outerwear</option>
                                    <option value="accessory">Accessory</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                                <select
                                    value={formData.gender}
                                    onChange={(e) => handleChange('gender', e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="womens">Womens</option>
                                    <option value="mens">Mens</option>
                                    <option value="unisex">Unisex</option>
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Product Type</label>
                                <select
                                    value={formData.productType}
                                    onChange={(e) => handleChange('productType', e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="basic">Basic</option>
                                    <option value="seasonal">Seasonal</option>
                                    <option value="limited">Limited</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Fabric Type</label>
                                <select
                                    value={formData.fabricTypeId}
                                    onChange={(e) => handleChange('fabricTypeId', e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    <option value="">Not set</option>
                                    {fabricTypes.map((ft) => (
                                        <option key={ft.id} value={ft.id}>{ft.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </FormModal>
    );
}
