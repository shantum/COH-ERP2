/**
 * Catalog Page - Combined Products + Inventory + Costing View
 *
 * FOUR VIEW LEVELS (aggregation strategies):
 * - SKU (sku): Flat, 1 row per size variant (most granular)
 * - Variation (variation): Aggregate by color (product + color)
 * - Product (product): Aggregate by style (all colors/sizes per product)
 * - Consumption (consumption): Fabric matrix (sizes × fabric consumption)
 *
 * COST FORMULA:
 *   totalCost = bomCost (from BOM lines: fabric + trims + services)
 *
 * EDITING & BULK UPDATES:
 * - Inline cell editing for costs
 * - Variation/Product views: Updates applied to all SKU IDs in that group
 * - Save dialog with confirmation before persisting
 *
 * FILTERING:
 * - Gender, Category, Product dropdowns
 * - Stock status (below_target, ok)
 * - Free-form search (SKU, product name, color)
 * - Pagination (100/500/1000/All)
 *
 * INVENTORY DISPLAY:
 * - currentBalance: SUM(inward) - SUM(outward)
 * - availableBalance: currentBalance - SUM(reserved)
 * - shopifyQty: External stock sync status
 *
 * @component
 * @example
 * // Displayed as a main dashboard tab
 * <Catalog />
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { ColumnResizedEvent, GridReadyEvent, Column } from 'ag-grid-community';
import { Layers, Package, AlertTriangle, XCircle, ArrowLeft, X, ChevronDown, ChevronRight } from 'lucide-react';
import { getCatalogProducts, getCatalogCategories } from '@/server/functions/catalog';
import type { CatalogSkuItem, CatalogProductsResponse } from '@/server/functions/catalog';
import { updateProduct, updateVariation, updateSku } from '@/server/functions/productsMutations';
import BomEditorPanel from '../components/bom/BomEditorPanel';
import { ConfirmModal } from '../components/Modal';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { useGridState, getColumnOrderFromApi, applyColumnVisibility, applyColumnWidths, orderColumns } from '../hooks/useGridState';
import { usePermissionColumns } from '../hooks/usePermissionColumns';
import {
    EditModal,
    CatalogFilters,
    type ViewLevel,
} from '../components/catalog';
import {
    aggregateByVariation,
    aggregateByProduct,
    aggregateByConsumption,
    CONSUMPTION_SIZES,
} from '../utils/catalogAggregations';
import {
    createColumnDefs,
    createConsumptionColumnDefs,
    ALL_COLUMN_IDS,
    DEFAULT_HEADERS,
    HIDDEN_COLUMNS_BY_VIEW,
} from '../utils/catalogColumns';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

export default function Catalog() {
    // Grid ref for API access
    const gridRef = useRef<AgGridReact>(null);
    const queryClient = useQueryClient();

    // Server Function wrappers
    const getCatalogProductsFn = useServerFn(getCatalogProducts);
    const getCatalogCategoriesFn = useServerFn(getCatalogCategories);
    const updateProductFn = useServerFn(updateProduct);
    const updateVariationFn = useServerFn(updateVariation);
    const updateSkuFn = useServerFn(updateSku);

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
        isManager,
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        savePreferencesToServer,
    } = useGridState({
        gridId: 'catalogGrid',
        allColumnIds: ALL_COLUMN_IDS,
        defaultPageSize: 100,
        // Hide cost calculation columns by default (users can enable via Columns dropdown)
        defaultHiddenColumns: ['bomCost', 'totalCost', 'exGstPrice', 'gstAmount', 'costMultiple'],
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
        data: Record<string, unknown> | null;
    }>({ isOpen: false, level: 'sku', data: null });

    // BOM editor panel state
    const [bomEditor, setBomEditor] = useState<{
        isOpen: boolean;
        productId: string;
        productName: string;
    }>({ isOpen: false, productId: '', productName: '' });

    // Open BOM editor for a product
    const openBomEditor = useCallback((row: Record<string, unknown>) => {
        setBomEditor({
            isOpen: true,
            productId: String(row.productId ?? ''),
            productName: String(row.productName ?? ''),
        });
    }, []);

    // Apply quick filter when search input changes (client-side, instant)
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 150); // Short debounce for typing
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch catalog data (without search - that's done client-side via quick filter)
    const { data: catalogData, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['catalog', filter.gender, filter.category, filter.productId, filter.status],
        queryFn: () => getCatalogProductsFn({
            data: {
                gender: filter.gender || undefined,
                category: filter.category || undefined,
                productId: filter.productId || undefined,
                status: (filter.status as 'below_target' | 'ok') || undefined,
            }
        }),
    });

    // Fetch filter options
    const { data: filterOptions } = useQuery({
        queryKey: ['catalogFilters'],
        queryFn: () => getCatalogCategoriesFn(),
        staleTime: 5 * 60 * 1000,
    });

    // NOTE: Fabric type and fabric mutations removed - fabric is now managed via BOM Editor

    const updateLiningMutation = useMutation({
        mutationFn: async ({ variationId, hasLining }: { variationId: string; hasLining: boolean }) => {
            const result = await updateVariationFn({ data: { id: variationId, hasLining } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update lining');
            }
            return result.data;
        },
        onMutate: async ({ variationId, hasLining }) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({ queryKey: ['catalog'] });

            // Snapshot the previous value
            const previousData = queryClient.getQueryData(['catalog', filter.gender, filter.category, filter.productId, filter.status]);

            // Optimistically update the cache
            queryClient.setQueryData(
                ['catalog', filter.gender, filter.category, filter.productId, filter.status],
                (old: CatalogProductsResponse | undefined) => {
                    if (!old?.items) return old;
                    return {
                        ...old,
                        items: old.items.map((item: CatalogSkuItem) =>
                            item.variationId === variationId
                                ? { ...item, hasLining }
                                : item
                        ),
                    };
                }
            );

            return { previousData };
        },
        onError: (err: Error, _variables, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(
                    ['catalog', filter.gender, filter.category, filter.productId, filter.status],
                    context.previousData
                );
            }
            alert(err.message || 'Failed to update lining');
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

    // Show confirmation dialog for lining change
    const promptLiningChange = useCallback((row: Record<string, unknown>) => {
        setLiningConfirm({
            isOpen: true,
            variationId: String(row.variationId ?? ''),
            colorName: String(row.colorName ?? ''),
            productName: String(row.productName ?? ''),
            currentValue: Boolean(row.hasLining),
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
        mutationFn: async ({ skuId, data }: { skuId: string; data: { mrp?: number; targetStockQty?: number } }) => {
            const result = await updateSkuFn({ data: { id: skuId, ...data } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update SKU');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
            setEditModal({ isOpen: false, level: 'sku', data: null });
        },
        onError: (err: Error) => {
            alert(err.message || 'Failed to update SKU');
        },
    });

    // Full variation update mutation (for edit modal)
    // NOTE: fabricId removed - fabric is now managed via BOM Editor
    const updateVariationFullMutation = useMutation({
        mutationFn: async ({ variationId, data }: { variationId: string; data: { colorName?: string; hasLining?: boolean } }) => {
            const result = await updateVariationFn({ data: { id: variationId, ...data } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update variation');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
            setEditModal({ isOpen: false, level: 'variation', data: null });
        },
        onError: (err: Error) => {
            alert(err.message || 'Failed to update variation');
        },
    });

    // Full product update mutation (for edit modal)
    // NOTE: fabricTypeId removed - fabric is now managed via BOM Editor
    const updateProductFullMutation = useMutation({
        mutationFn: async ({ productId, data }: { productId: string; data: { name?: string; styleCode?: string | null; category?: string; gender?: string; productType?: string } }) => {
            const result = await updateProductFn({ data: { id: productId, ...data } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update product');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['catalog'], refetchType: 'all' });
            setEditModal({ isOpen: false, level: 'product', data: null });
        },
        onError: (err: Error) => {
            alert(err.message || 'Failed to update product');
        },
    });

    // Handle edit modal submit
    // NOTE: fabricId and fabricTypeId removed - fabric is now managed via BOM Editor
    const handleEditSubmit = useCallback((formData: Record<string, unknown>) => {
        if (!editModal.data) return;

        if (editModal.level === 'sku') {
            updateSkuMutation.mutate({
                skuId: String(editModal.data.skuId),
                data: {
                    mrp: parseFloat(String(formData.mrp)) || undefined,
                    targetStockQty: parseInt(String(formData.targetStockQty)) || undefined,
                },
            });
        } else if (editModal.level === 'variation') {
            updateVariationFullMutation.mutate({
                variationId: String(editModal.data.variationId),
                data: {
                    colorName: String(formData.colorName),
                    hasLining: formData.hasLining === 'true' || formData.hasLining === true,
                },
            });
        } else if (editModal.level === 'product') {
            updateProductFullMutation.mutate({
                productId: String(editModal.data.productId),
                data: {
                    name: String(formData.name),
                    styleCode: String(formData.styleCode) || null,
                    category: String(formData.category),
                    gender: String(formData.gender),
                    productType: String(formData.productType),
                },
            });
        }
    }, [editModal, updateSkuMutation, updateVariationFullMutation, updateProductFullMutation]);

    // Open edit modal
    const openEditModal = useCallback((row: Record<string, unknown>, level: EditLevel) => {
        setEditModal({ isOpen: true, level, data: row });
    }, []);

    // Filtered products based on selected gender/category
    const filteredProducts = useMemo(() => {
        if (!filterOptions?.products) return [];
        return filterOptions.products.filter((p: { id: string; name: string; gender: string | null; category: string | null }) => {
            if (filter.gender && p.gender !== filter.gender) return false;
            if (filter.category && p.category !== filter.category) return false;
            return true;
        });
    }, [filterOptions?.products, filter.gender, filter.category]);

    // NOTE: uniqueFabricTypes removed - fabric type no longer editable from catalog
    // Fabric is now set via BOM Editor

    // Aggregate data based on view level
    const displayData = useMemo(() => {
        let items = catalogData?.items || [];

        // Filter by variationId if set (when drilling down to SKU level for a specific color)
        if (filter.variationId && viewLevel === 'sku') {
            items = items.filter((item: CatalogSkuItem) => item.variationId === filter.variationId);
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
    const onColumnResized = (event: ColumnResizedEvent) => {
        // Only save when resize is complete (finished=true) and it's a user resize
        if (event.finished && event.columns?.length) {
            event.columns.forEach((col: Column) => {
                const colId = col.getColId();
                const width = col.getActualWidth();
                if (colId && width) {
                    handleColumnResized(colId, width);
                }
            });
        }
    };

    // Set default filter for shopifyStatus to "active" when grid is ready
    const onGridReady = useCallback((params: GridReadyEvent) => {
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
    // NOTE: Fabric editing removed - now handled via BOM Editor
    const columnDefs = useMemo(() => createColumnDefs({
        viewLevel,
        promptLiningChange,
        openEditModal,
        openBomEditor,
        setFilter,
        setViewLevel,
    }), [viewLevel, promptLiningChange, openEditModal, openBomEditor]);

    // Column definitions for consumption matrix view
    const consumptionColumnDefs = useMemo(() => createConsumptionColumnDefs(CONSUMPTION_SIZES), []);

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
            belowTarget: items.filter((i: Record<string, unknown>) => i.status === 'below_target' || i.status === 'out_of_stock').length,
            outOfStock: items.filter((i: Record<string, unknown>) => i.availableBalance === 0).length,
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
            <CatalogFilters
                viewLevel={viewLevel}
                setViewLevel={setViewLevel}
                searchInput={searchInput}
                setSearchInput={setSearchInput}
                filter={filter}
                setFilter={setFilter}
                filterOptions={filterOptions}
                filteredProducts={filteredProducts}
                pageSize={pageSize}
                handlePageSizeChange={handlePageSizeChange}
                visibleColumns={visibleColumns}
                onToggleColumn={handleToggleColumn}
                onResetAll={handleResetAll}
                availableColumnIds={availableColumnIds}
                columnHeaders={DEFAULT_HEADERS}
                isManager={isManager}
                hasUserCustomizations={hasUserCustomizations}
                differsFromAdminDefaults={differsFromAdminDefaults}
                isSavingPrefs={isSavingPrefs}
                resetToDefaults={resetToDefaults}
                savePreferencesToServer={savePreferencesToServer}
                hiddenColumnsByView={HIDDEN_COLUMNS_BY_VIEW[viewLevel]}
                onRefresh={() => refetch()}
                isRefreshing={isFetching}
            />

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
                                        {filterOptions?.products?.find((p: { id: string; name: string }) => p.id === filter.productId)?.name || 'Product'}
                                    </button>
                                ) : (
                                    <span className="font-semibold text-gray-900">
                                        {filterOptions?.products?.find((p: { id: string; name: string }) => p.id === filter.productId)?.name || 'Selected Product'}
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
                            enableCellTextSelection={true}
                            ensureDomOrder={true}
                            getRowId={(params) => {
                                // Use appropriate ID based on view level
                                if (viewLevel === 'product' || viewLevel === 'consumption') return params.data.productId;
                                if (viewLevel === 'variation') return params.data.variationId;
                                return params.data.skuId;
                            }}
                            // Handle cell edits (MRP inline editing)
                            onCellValueChanged={(_params) => {
                                // Inline edits handled by individual column editable callbacks
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

            {/* Edit Modal - fabric editing removed, now via BOM Editor */}
            <EditModal
                isOpen={editModal.isOpen}
                level={editModal.level}
                data={editModal.data}
                onClose={() => setEditModal({ isOpen: false, level: 'sku', data: null })}
                onSubmit={handleEditSubmit}
                isLoading={updateSkuMutation.isPending || updateVariationFullMutation.isPending || updateProductFullMutation.isPending}
            />

            {/* BOM Editor Slide-out Panel */}
            <BomEditorPanel
                productId={bomEditor.productId}
                productName={bomEditor.productName}
                isOpen={bomEditor.isOpen}
                onClose={() => setBomEditor({ isOpen: false, productId: '', productName: '' })}
            />
        </div>
    );
}
