/**
 * Catalog Page - Combined Products + Inventory + Costing View
 *
 * FOUR VIEW LEVELS (aggregation strategies):
 * - SKU (sku): Flat, 1 row per size variant (most granular)
 * - Variation (variation): Aggregate by color (product + color)
 * - Product (product): Aggregate by style (all colors/sizes per product)
 * - Consumption (consumption): Fabric matrix (sizes × fabric consumption)
 *
 * COST CASCADE LOGIC (for each view):
 * Each row shows EFFECTIVE cost (best from hierarchy):
 *   trimsCost: SKU → Variation → Product → null
 *   liningCost: SKU → Variation → Product → null (only if hasLining=true)
 *   packagingCost: SKU → Variation → Product → GlobalDefault
 *   laborMinutes: SKU → Variation → Product → 60
 *   fabricCost: Consumption * (Fabric.costPerUnit ?? FabricType.defaultCostPerUnit)
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
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Layers, Package, AlertTriangle, XCircle, ArrowLeft, X, ChevronDown, ChevronRight } from 'lucide-react';
import { catalogApi, productsApi } from '../services/api';
import { ConfirmModal } from '../components/Modal';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { useGridState, getColumnOrderFromApi, applyColumnVisibility, applyColumnWidths, orderColumns } from '../hooks/useGridState';
import { usePermissionColumns } from '../hooks/usePermissionColumns';
import {
    FabricEditPopover,
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
    const { data: catalogData, isLoading, refetch, isFetching } = useQuery({
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
    const columnDefs = useMemo(() => createColumnDefs({
        viewLevel,
        filterOptions,
        catalogData,
        uniqueFabricTypes,
        handleUpdateFabricType,
        handleUpdateFabric,
        promptLiningChange,
        openEditModal,
        setFilter,
        setViewLevel,
        FabricEditPopover,
    }), [viewLevel, filterOptions, catalogData, uniqueFabricTypes, handleUpdateFabricType, handleUpdateFabric, promptLiningChange, openEditModal]);

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
                            enableCellTextSelection={true}
                            ensureDomOrder={true}
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
