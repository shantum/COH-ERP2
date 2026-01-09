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
import { Search, Plus, Pencil } from 'lucide-react';
import { catalogApi, productsApi } from '../services/api';
import { FormModal, ConfirmModal } from '../components/Modal';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { ColumnVisibilityDropdown, InventoryStatusBadge } from '../components/common/grid';
import { useGridState, getColumnOrderFromApi, applyColumnVisibility, applyColumnWidths, orderColumns } from '../hooks/useGridState';

// Page size options
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const; // 0 = All

// View options for data grouping
type ViewLevel = 'sku' | 'variation' | 'product';
const VIEW_OPTIONS: { value: ViewLevel; label: string }[] = [
    { value: 'sku', label: 'By SKU' },
    { value: 'variation', label: 'By Color' },
    { value: 'product', label: 'By Product' },
];

// Columns to hide for each view level
const HIDDEN_COLUMNS_BY_VIEW: Record<ViewLevel, string[]> = {
    sku: [],
    variation: ['skuCode', 'size', 'mrp', 'fabricConsumption', 'shopifyQty', 'targetStockQty'],
    product: ['skuCode', 'size', 'mrp', 'fabricConsumption', 'colorName', 'hasLining', 'fabricName', 'image', 'shopifyQty', 'targetStockQty'],
};

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
                mrp: null,
                fabricConsumption: null,
                currentBalance: 0,
                reservedBalance: 0,
                availableBalance: 0,
                shopifyQty: null,
                targetStockQty: null,
                skuCount: 0,
            });
        }

        const group = groups.get(key)!;
        group.currentBalance += item.currentBalance || 0;
        group.reservedBalance += item.reservedBalance || 0;
        group.availableBalance += item.availableBalance || 0;
        group.skuCount += 1;
    }

    // Calculate status based on aggregated values
    for (const group of groups.values()) {
        group.status = group.availableBalance === 0 ? 'out_of_stock' :
                       group.availableBalance < 10 ? 'below_target' : 'ok';
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
                imageUrl: null,
                size: '-',
                mrp: null,
                fabricConsumption: null,
                currentBalance: 0,
                reservedBalance: 0,
                availableBalance: 0,
                shopifyQty: null,
                targetStockQty: null,
                variationCount: 0,
                skuCount: 0,
            });
        }

        const group = groups.get(key)!;
        group.currentBalance += item.currentBalance || 0;
        group.reservedBalance += item.reservedBalance || 0;
        group.availableBalance += item.availableBalance || 0;
        group.skuCount += 1;
    }

    // Count unique variations per product and calculate status
    const variationCounts = new Map<string, Set<string>>();
    for (const item of items) {
        if (!variationCounts.has(item.productId)) {
            variationCounts.set(item.productId, new Set());
        }
        variationCounts.get(item.productId)!.add(item.variationId);
    }

    for (const [productId, group] of groups.entries()) {
        group.variationCount = variationCounts.get(productId)?.size || 0;
        group.status = group.availableBalance === 0 ? 'out_of_stock' :
                       group.availableBalance < 20 ? 'below_target' : 'ok';
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
    'productName', 'styleCode', 'category', 'gender', 'productType', 'fabricTypeName',
    'colorName', 'hasLining', 'fabricName', 'image',
    'skuCode', 'size', 'mrp', 'fabricConsumption',
    'currentBalance', 'reservedBalance', 'availableBalance', 'shopifyQty', 'targetStockQty', 'status',
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
    currentBalance: 'Balance',
    reservedBalance: 'Reserved',
    availableBalance: 'Available',
    shopifyQty: 'Shopify',
    targetStockQty: 'Target',
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
    });

    // View level state
    const [viewLevel, setViewLevel] = useState<ViewLevel>('sku');

    // Filter state
    const [filter, setFilter] = useState({
        gender: '',
        category: '',
        productId: '',
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
        const items = catalogData?.items || [];
        switch (viewLevel) {
            case 'variation':
                return aggregateByVariation(items);
            case 'product':
                return aggregateByProduct(items);
            default:
                return items;
        }
    }, [catalogData?.items, viewLevel]);

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

    // Column definitions
    const columnDefs: ColDef[] = useMemo(() => [
        // Product columns
        {
            colId: 'productName',
            headerName: DEFAULT_HEADERS.productName,
            field: 'productName',
            width: 180,
            pinned: 'left' as const,
            cellClass: 'font-medium',
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
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Only show fabric editor for variation and SKU views
                if (viewLevel === 'product') {
                    return <span className="text-xs text-gray-400">-</span>;
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
        {
            colId: 'image',
            headerName: DEFAULT_HEADERS.image,
            field: 'imageUrl',
            width: 50,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.value) return null;
                return (
                    <img
                        src={params.value}
                        alt=""
                        className="w-6 h-6 object-cover rounded"
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
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(2) : '-',
            cellClass: 'text-right text-xs',
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
    ], [viewLevel, filterOptions?.fabricTypes, filterOptions?.fabrics, catalogData?.items, handleUpdateFabricType, handleUpdateFabric]);

    // Apply visibility and ordering using helper functions
    const orderedColumnDefs = useMemo(() => {
        // First apply user's column visibility preferences
        const withVisibility = applyColumnVisibility(columnDefs, visibleColumns);
        // Then hide columns based on view level
        const hiddenByView = HIDDEN_COLUMNS_BY_VIEW[viewLevel];
        const withViewVisibility = withVisibility.map(col => ({
            ...col,
            hide: col.hide || hiddenByView.includes(col.colId || ''),
        }));
        // Apply saved column widths
        const withWidths = applyColumnWidths(withViewVisibility, columnWidths);
        return orderColumns(withWidths, columnOrder);
    }, [columnDefs, visibleColumns, columnOrder, columnWidths, viewLevel]);

    // Summary stats based on view level
    const stats = useMemo(() => {
        const items = displayData;
        const label = viewLevel === 'product' ? 'Products' : viewLevel === 'variation' ? 'Colors' : 'SKUs';
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

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Catalog</h1>
                    <p className="text-sm text-gray-500">Combined products and inventory view</p>
                </div>
                <div className="flex items-center gap-3 md:gap-4 text-sm">
                    <div className="text-gray-500">
                        <span className="font-medium text-gray-900">{stats.total}</span> {stats.label}
                    </div>
                    {stats.belowTarget > 0 && (
                        <div className="text-amber-600">
                            <span className="font-medium">{stats.belowTarget}</span> low stock
                        </div>
                    )}
                    {stats.outOfStock > 0 && (
                        <div className="text-red-600">
                            <span className="font-medium">{stats.outOfStock}</span> out of stock
                        </div>
                    )}
                </div>
            </div>

            {/* Analytics Bar */}
            <div className="bg-gray-50 border rounded-lg p-3 flex flex-wrap gap-6 items-center">
                {/* Total */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Total Stock</span>
                    <span className="text-lg font-bold text-gray-900">{analytics.totalUnits.toLocaleString()}</span>
                </div>

                <div className="w-px h-8 bg-gray-200 hidden sm:block" />

                {/* By Gender */}
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">By Gender</span>
                    <div className="flex gap-2">
                        {analytics.byGender.map(([gender, count]) => (
                            <div key={gender} className="flex items-center gap-1 bg-white px-2 py-1 rounded border text-sm">
                                <span className="text-gray-600 capitalize">{gender}</span>
                                <span className="font-semibold text-gray-900">{count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="w-px h-8 bg-gray-200 hidden sm:block" />

                {/* By Fabric Type */}
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">By Fabric</span>
                    <div className="flex flex-wrap gap-2">
                        {analytics.byFabricType.map(([fabricType, count]) => (
                            <div key={fabricType} className="flex items-center gap-1 bg-white px-2 py-1 rounded border text-sm">
                                <span className="text-gray-600">{fabricType}</span>
                                <span className="font-semibold text-gray-900">{count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 md:gap-3">
                {/* View level selector */}
                <select
                    value={viewLevel}
                    onChange={(e) => setViewLevel(e.target.value as ViewLevel)}
                    className="text-sm border rounded px-2 py-1.5 bg-white font-medium"
                >
                    {VIEW_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>

                <div className="w-px h-6 bg-gray-200 self-center hidden sm:block" />

                <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search SKU, product, color..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-full sm:w-48 md:w-56 focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                </div>

                <select
                    value={filter.gender}
                    onChange={(e) => setFilter(f => ({ ...f, gender: e.target.value, productId: '' }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Genders</option>
                    {filterOptions?.genders?.map((g: string) => (
                        <option key={g} value={g}>{g}</option>
                    ))}
                </select>

                <select
                    value={filter.category}
                    onChange={(e) => setFilter(f => ({ ...f, category: e.target.value, productId: '' }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Categories</option>
                    {filterOptions?.categories?.map((c: string) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>

                <select
                    value={filter.productId}
                    onChange={(e) => setFilter(f => ({ ...f, productId: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto sm:max-w-[200px]"
                >
                    <option value="">All Products</option>
                    {filteredProducts.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>

                <select
                    value={filter.status}
                    onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Status</option>
                    <option value="ok">In Stock</option>
                    <option value="below_target">Below Target</option>
                </select>

                <div className="hidden sm:block sm:flex-1" />

                {/* Page size selector */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Show:</span>
                    <select
                        value={pageSize}
                        onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                    >
                        {PAGE_SIZE_OPTIONS.map(size => (
                            <option key={size} value={size}>
                                {size === 0 ? 'All' : size}
                            </option>
                        ))}
                    </select>
                </div>

                <ColumnVisibilityDropdown
                    visibleColumns={visibleColumns}
                    onToggleColumn={handleToggleColumn}
                    onResetAll={handleResetAll}
                    columnIds={ALL_COLUMN_IDS}
                    columnHeaders={DEFAULT_HEADERS}
                />
            </div>

            {/* AG-Grid */}
            <div className="table-scroll-container border rounded">
                <div style={{ minWidth: '1100px', height: 'calc(100vh - 280px)', minHeight: '400px' }}>
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
                        suppressCellFocus={true}
                        getRowId={(params) => {
                            // Use appropriate ID based on view level
                            if (viewLevel === 'product') return params.data.productId;
                            if (viewLevel === 'variation') return params.data.variationId;
                            return params.data.skuId;
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
                        maintainColumnOrder={true}
                    />
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
