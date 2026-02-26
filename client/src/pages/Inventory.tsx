/**
 * Inventory Page - Fast SKU Lookup with Analytics
 *
 * PURPOSE: Quick inventory lookup by SKU code, product name, or variation
 * Simpler than Catalog page - focused on finding stock levels quickly
 *
 * FEATURES:
 * - Server-side search with debounce (400ms)
 * - Server-side pagination (~100 items per page)
 * - Server-side analytics (stats computed from ALL matching SKUs)
 * - AG-Grid with compact display
 * - Stock status filters (All | In Stock | Low Stock | Out of Stock)
 * - Auto-focus search on page load
 * - Analytics: Total pieces, most stocked products, highest demand products
 *
 * DATA SOURCE: Server Function getInventoryAll + /reports/top-products
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, CellClassParams, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Package, Search, TrendingUp, Warehouse, ChevronDown, ChevronUp, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { getInventoryAll } from '../server/functions/inventory';
import { getTopProducts } from '../server/functions/reports';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { getOptimizedImageUrl } from '../utils/imageOptimization';
import { Route } from '../routes/_authenticated/inventory';
import { useDebounce } from '../hooks/useDebounce';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
type DemandPeriod = 14 | 30 | 60 | 90;

const DEFAULT_COL_DEF = {
    sortable: true,
    resizable: true,
    suppressMovable: false,
};

export default function Inventory() {
    const gridRef = useRef<AgGridReact>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Get loader data from route (SSR pre-fetched data)
    const loaderData = Route.useLoaderData();
    const search = Route.useSearch();
    const navigate = useNavigate();

    // Pagination from URL
    const page = search.page;
    const limit = search.limit;

    // Stock filter from URL (URL-persisted for bookmarking/sharing)
    const stockFilter = (search.stockFilter || 'all') as StockFilter;

    // Local state for search input (syncs to URL with debounce)
    const [searchInput, setSearchInput] = useState(search.search || '');
    const debouncedSearch = useDebounce(searchInput, 400);

    // Local state (not persisted to URL)
    const [demandDays, setDemandDays] = useState<DemandPeriod>(30);
    const [analyticsExpanded, setAnalyticsExpanded] = useState(false);

    // Auto-focus search on page load
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    // Sync debounced search to URL (resets to page 1)
    useEffect(() => {
        // Only update URL if debounced value differs from URL search param
        const currentUrlSearch = search.search || '';
        if (debouncedSearch !== currentUrlSearch) {
            navigate({
                to: '/inventory',
                search: {
                    ...search,
                    search: debouncedSearch || undefined,
                    page: 1, // Reset to page 1 on search change
                },
                replace: true,
            });
        }
    }, [debouncedSearch, search, navigate]);

    // Page navigation
    const setPage = useCallback((newPage: number) => {
        navigate({
            to: '/inventory',
            search: { ...search, page: newPage },
            replace: true,
        });
    }, [navigate, search]);

    const setStockFilter = useCallback((value: StockFilter) => {
        navigate({
            to: '/inventory',
            search: {
                ...search,
                stockFilter: value === 'all' ? undefined : value,
                page: 1, // Reset to page 1 on filter change
            },
            replace: true,
        });
    }, [navigate, search]);

    // Get Server Function reference
    const getInventoryAllFn = useServerFn(getInventoryAll);

    // Calculate offset from page
    const offset = (page - 1) * limit;

    // Query for inventory data using Server Function
    // Uses loader data as initialData when available for instant hydration
    const { data: inventoryData, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['inventory', 'all', 'getInventoryAll', {
            includeCustomSkus: false,
            search: search.search,
            stockFilter: search.stockFilter,
            limit,
            offset,
        }],
        queryFn: () => getInventoryAllFn({
            data: {
                includeCustomSkus: false,
                search: search.search || undefined,
                stockFilter: search.stockFilter as StockFilter | undefined,
                limit,
                offset,
            },
        }),
        // Use loader data for instant display, query will refetch in background if stale
        initialData: loaderData?.inventory ?? undefined,
        // Don't refetch on mount if we have fresh loader data
        staleTime: loaderData?.inventory ? 30000 : 0,
    });

    // Pagination info from server
    const pagination = inventoryData?.pagination;
    const total = pagination?.total ?? 0;
    const totalPages = pagination ? Math.ceil(pagination.total / limit) : 1;

    // Items from server (already filtered and paginated)
    const items = inventoryData?.items || [];

    // Stats from server (computed from ALL matching SKUs, not just current page)
    const stats = inventoryData?.stats;

    // Fetch demand data (top products by units sold)
    const getTopProductsFn = useServerFn(getTopProducts);
    const { data: demandData, isLoading: demandLoading } = useQuery({
        queryKey: ['topProducts', demandDays],
        queryFn: () =>
            getTopProductsFn({
                data: { days: demandDays, level: 'product', limit: 5 },
            }),
        staleTime: 60000,
    });

    // Column definitions
    const columnDefs = useMemo(() => [
        {
            headerName: 'SKU Code',
            field: 'skuCode',
            width: 140,
            pinned: 'left' as const,
            cellStyle: { fontWeight: 600, fontSize: '12px' },
        },
        {
            headerName: 'Product',
            field: 'productName',
            width: 220,
            cellStyle: { fontWeight: 500 },
        },
        {
            headerName: 'Color',
            field: 'colorName',
            width: 120,
        },
        {
            headerName: 'Size',
            field: 'size',
            width: 80,
            cellStyle: { textAlign: 'center' as const },
        },
        {
            headerName: 'Available',
            field: 'availableBalance',
            width: 100,
            type: 'numericColumn' as const,
            cellStyle: (params: CellClassParams) => {
                if (params.value === 0) {
                    return { color: '#dc2626', fontWeight: 600 };
                }
                if (params.data?.status === 'below_target') {
                    return { color: '#f59e0b', fontWeight: 600 };
                }
                return { color: '#059669', fontWeight: 600 };
            },
        },
        {
            headerName: 'Balance',
            field: 'currentBalance',
            width: 100,
            type: 'numericColumn' as const,
            cellStyle: { fontWeight: 500 },
        },
        {
            headerName: 'Target',
            field: 'targetStockQty',
            width: 90,
            type: 'numericColumn' as const,
            cellStyle: { color: '#6b7280' },
            valueFormatter: (params: ValueFormatterParams) => params.value || '-',
        },
        {
            headerName: 'Status',
            field: 'status',
            width: 100,
            cellRenderer: (params: ICellRendererParams) => {
                if (params.data?.availableBalance === 0) {
                    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Out of Stock</span>;
                }
                if (params.value === 'below_target') {
                    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Low Stock</span>;
                }
                return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">In Stock</span>;
            },
        },
        {
            headerName: 'Category',
            field: 'category',
            width: 120,
        },
        {
            headerName: 'Gender',
            field: 'gender',
            width: 100,
            cellStyle: { textTransform: 'capitalize' },
        },
    ] as ColDef[], []);

    // Calculate display range for pagination
    const displayStart = total > 0 ? offset + 1 : 0;
    const displayEnd = Math.min(offset + items.length, total);

    // Most stocked products from server stats
    const mostStockedProducts = stats?.topStockedProducts || [];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                {/* Title Section */}
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center shadow-lg">
                        <Package size={24} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Inventory</h1>
                        <p className="text-sm text-gray-500">Quick SKU lookup and stock levels</p>
                    </div>
                </div>

                {/* Stats Cards - using server-computed stats from ALL matching SKUs */}
                <div className="flex flex-wrap gap-3">
                    {/* Total Pieces */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 rounded-xl border border-blue-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-blue-700 leading-none">{(stats?.totalPieces ?? 0).toLocaleString()}</div>
                            <div className="text-xs text-blue-600 mt-0.5">Total Pcs</div>
                        </div>
                    </div>

                    {/* Total SKUs */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-gray-900 leading-none">{(stats?.totalSkus ?? total).toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5">SKUs</div>
                        </div>
                    </div>

                    {/* In Stock */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-green-50 rounded-xl border border-green-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-green-700 leading-none">{(stats?.inStockCount ?? 0).toLocaleString()}</div>
                            <div className="text-xs text-green-600 mt-0.5">In Stock</div>
                        </div>
                    </div>

                    {/* Low Stock */}
                    {(stats?.lowStockCount ?? 0) > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
                            <div>
                                <div className="text-2xl font-bold text-amber-700 leading-none">{(stats?.lowStockCount ?? 0).toLocaleString()}</div>
                                <div className="text-xs text-amber-600 mt-0.5">Low Stock</div>
                            </div>
                        </div>
                    )}

                    {/* Out of Stock */}
                    {(stats?.outOfStockCount ?? 0) > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 rounded-xl border border-red-200 shadow-sm">
                            <div>
                                <div className="text-2xl font-bold text-red-700 leading-none">{(stats?.outOfStockCount ?? 0).toLocaleString()}</div>
                                <div className="text-xs text-red-600 mt-0.5">Out of Stock</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Analytics Section (Collapsible) */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Collapse Header */}
                <button
                    onClick={() => setAnalyticsExpanded(!analyticsExpanded)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <Warehouse size={16} className="text-blue-600" />
                            <TrendingUp size={16} className="text-green-600" />
                        </div>
                        <span className="text-sm font-medium text-gray-900">Analytics</span>
                        <span className="text-xs text-gray-500">Most stocked & highest demand products</span>
                    </div>
                    {analyticsExpanded ? (
                        <ChevronUp size={18} className="text-gray-400" />
                    ) : (
                        <ChevronDown size={18} className="text-gray-400" />
                    )}
                </button>

                {/* Collapsible Content */}
                {analyticsExpanded && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 pt-0 border-t border-gray-100">
                        {/* Most Stocked Products Card - using server-computed data */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Warehouse size={18} className="text-blue-600" />
                                <h2 className="text-sm font-semibold text-gray-900">Most Stocked Products</h2>
                                <span className="text-xs text-gray-500 ml-auto">by available inventory</span>
                            </div>

                            {isLoading ? (
                                <div className="space-y-2">
                                    {[...Array(5)].map((_, i) => (
                                        <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
                                    ))}
                                </div>
                            ) : mostStockedProducts.length === 0 ? (
                                <p className="text-gray-500 text-center py-6 text-sm">No inventory data</p>
                            ) : (
                                <div className="space-y-2">
                                    {mostStockedProducts.map((product, index) => (
                                        <div key={product.productId} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-100 bg-white">
                                            {/* Rank Badge */}
                                            <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${index === 0 ? 'bg-amber-100 text-amber-700' :
                                                index === 1 ? 'bg-gray-200 text-gray-600' :
                                                    index === 2 ? 'bg-orange-100 text-orange-700' :
                                                        'bg-gray-100 text-gray-500'
                                                }`}>
                                                {index + 1}
                                            </div>

                                            {/* Product Image - optimized for 40x40 display */}
                                            {product.imageUrl ? (
                                                <img src={getOptimizedImageUrl(product.imageUrl, 'sm') || product.imageUrl} alt={product.productName} className="w-10 h-10 rounded object-cover flex-shrink-0" loading="lazy" />
                                            ) : (
                                                <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                                                    <Package size={16} className="text-gray-400" />
                                                </div>
                                            )}

                                            {/* Product Details */}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-gray-900 text-sm truncate">{product.productName}</div>
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    {product.colors.map((c, i) => (
                                                        <span key={c.colorName}>
                                                            {i > 0 && ' · '}
                                                            {c.colorName}: {c.available}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Total Count */}
                                            <div className="text-right flex-shrink-0">
                                                <div className="text-sm font-semibold text-blue-600">{product.totalAvailable.toLocaleString()}</div>
                                                <div className="text-xs text-gray-500">pcs</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Highest Demand Card */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <TrendingUp size={18} className="text-green-600" />
                                <h2 className="text-sm font-semibold text-gray-900">Highest Demand</h2>
                                <select
                                    value={demandDays}
                                    onChange={(e) => setDemandDays(Number(e.target.value) as DemandPeriod)}
                                    className="ml-auto text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value={14}>14 days</option>
                                    <option value={30}>30 days</option>
                                    <option value={60}>60 days</option>
                                    <option value={90}>90 days</option>
                                </select>
                            </div>

                            {demandLoading ? (
                                <div className="space-y-2">
                                    {[...Array(5)].map((_, i) => (
                                        <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
                                    ))}
                                </div>
                            ) : !demandData?.length ? (
                                <p className="text-gray-500 text-center py-6 text-sm">No sales data for this period</p>
                            ) : (
                                <div className="space-y-2">
                                    {demandData.map((product, index) => (
                                        <div key={product.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-100 bg-white">
                                            {/* Rank Badge */}
                                            <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${index === 0 ? 'bg-green-100 text-green-700' :
                                                index === 1 ? 'bg-gray-200 text-gray-600' :
                                                    index === 2 ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-gray-100 text-gray-500'
                                                }`}>
                                                {index + 1}
                                            </div>

                                            {/* Product Image - optimized for 40x40 display */}
                                            {product.imageUrl ? (
                                                <img src={getOptimizedImageUrl(product.imageUrl, 'sm') || product.imageUrl} alt={product.name} className="w-10 h-10 rounded object-cover flex-shrink-0" loading="lazy" />
                                            ) : (
                                                <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                                                    <Package size={16} className="text-gray-400" />
                                                </div>
                                            )}

                                            {/* Product Details */}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-gray-900 text-sm truncate">{product.name}</div>
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    {product.category || 'uncategorized'}
                                                </div>
                                            </div>

                                            {/* Units Sold */}
                                            <div className="text-right flex-shrink-0">
                                                <div className="text-sm font-semibold text-green-600">{product.unitsSold.toLocaleString()}</div>
                                                <div className="text-xs text-gray-500">sold</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Search and Filters Bar */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="flex flex-col sm:flex-row gap-3">
                    {/* Search Input */}
                    <div className="flex-1 relative">
                        <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search by SKU code, product name, color..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                    </div>

                    {/* Stock Status Filter */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setStockFilter('all')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${stockFilter === 'all'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setStockFilter('in_stock')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${stockFilter === 'in_stock'
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            In Stock
                        </button>
                        <button
                            onClick={() => setStockFilter('low_stock')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${stockFilter === 'low_stock'
                                ? 'bg-amber-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            Low Stock
                        </button>
                        <button
                            onClick={() => setStockFilter('out_of_stock')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${stockFilter === 'out_of_stock'
                                ? 'bg-red-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            Out of Stock
                        </button>

                        {/* Refresh Button */}
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 transition-all"
                            title="Refresh table data"
                        >
                            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
                            {isFetching ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {/* Result count and Pagination */}
                <div className="mt-3 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        Showing {displayStart.toLocaleString()}–{displayEnd.toLocaleString()} of {total.toLocaleString()} SKUs
                    </div>

                    {/* Pagination Controls */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage(page - 1)}
                            disabled={page === 1 || isFetching}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronLeft size={16} />
                            Prev
                        </button>
                        <span className="px-3 py-1.5 text-sm font-medium text-gray-700">
                            {page} / {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(page + 1)}
                            disabled={page >= totalPages || isFetching}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            Next
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* AG-Grid Container */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="table-scroll-container">
                    <div style={{ minWidth: '1000px', height: analyticsExpanded ? 'calc(100vh - 620px)' : 'calc(100vh - 380px)', minHeight: '400px' }}>
                        <AgGridReact
                            ref={gridRef}
                            theme={compactThemeSmall}
                            rowData={items}
                            columnDefs={columnDefs}
                            loading={isLoading}
                            defaultColDef={DEFAULT_COL_DEF}
                            animateRows={false}
                            suppressCellFocus={false}
                            getRowId={(params) => params.data.skuId}
                            pagination={false}
                            enableCellTextSelection={true}
                            ensureDomOrder={true}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
