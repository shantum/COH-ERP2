/**
 * Inventory Page - Fast SKU Lookup with Analytics
 *
 * PURPOSE: Quick inventory lookup by SKU code, product name, or variation
 * Simpler than Catalog page - focused on finding stock levels quickly
 *
 * FEATURES:
 * - Fast debounced search (200ms)
 * - AG-Grid with compact display
 * - Stock status filters (All | In Stock | Low Stock | Out of Stock)
 * - Auto-focus search on page load
 * - Analytics: Total pieces, most stocked products, highest demand products
 *
 * DATA SOURCE: tRPC inventory.getAllBalances + /reports/top-products
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Package, Search, TrendingUp, Warehouse } from 'lucide-react';
import { trpc } from '../services/trpc';
import { reportsApi } from '../services/api';
import { compactThemeSmall } from '../utils/agGridHelpers';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
type DemandPeriod = 14 | 30 | 60 | 90;

// Type for aggregated product data
interface ProductStock {
    productId: string;
    productName: string;
    category: string;
    imageUrl: string | null;
    totalAvailable: number;
    colors: { colorName: string; available: number }[];
}

export default function Inventory() {
    const gridRef = useRef<AgGridReact>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // State
    const [searchInput, setSearchInput] = useState('');
    const [stockFilter, setStockFilter] = useState<StockFilter>('all');
    const [demandDays, setDemandDays] = useState<DemandPeriod>(30);

    // Auto-focus search on page load
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    // Fetch inventory data via tRPC
    const { data: inventoryData, isLoading } = trpc.inventory.getAllBalances.useQuery({
        includeCustomSkus: false,
        limit: 10000,
    });

    // Fetch demand data (top products by units sold)
    const { data: demandData, isLoading: demandLoading } = useQuery({
        queryKey: ['topProducts', demandDays],
        queryFn: async () => {
            const res = await reportsApi.getTopProducts({ days: demandDays, level: 'product', limit: 5 });
            return res.data;
        },
        staleTime: 60000,
    });

    // Apply quick filter when search input changes (client-side, instant)
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 200);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Filter data by stock status
    const filteredData = useMemo(() => {
        const items = inventoryData?.items || [];

        switch (stockFilter) {
            case 'in_stock':
                return items.filter(item => item.availableBalance > 0);
            case 'low_stock':
                return items.filter(item => item.status === 'below_target' && item.availableBalance > 0);
            case 'out_of_stock':
                return items.filter(item => item.availableBalance === 0);
            default:
                return items;
        }
    }, [inventoryData?.items, stockFilter]);

    // Stats for header cards (including total pieces)
    const stats = useMemo(() => {
        const items = inventoryData?.items || [];
        const totalPieces = items.reduce((sum, i) => sum + (i.availableBalance || 0), 0);
        return {
            total: items.length,
            totalPieces,
            inStock: items.filter(i => i.availableBalance > 0).length,
            lowStock: items.filter(i => i.status === 'below_target' && i.availableBalance > 0).length,
            outOfStock: items.filter(i => i.availableBalance === 0).length,
        };
    }, [inventoryData?.items]);

    // Aggregate inventory by product (for "Most Stocked Products")
    const mostStockedProducts = useMemo(() => {
        const items = inventoryData?.items || [];
        const productMap = new Map<string, ProductStock>();

        for (const item of items) {
            if (!item.productId || item.availableBalance <= 0) continue;

            const existing = productMap.get(item.productId);
            if (existing) {
                existing.totalAvailable += item.availableBalance;
                // Update color breakdown
                const colorEntry = existing.colors.find(c => c.colorName === item.colorName);
                if (colorEntry) {
                    colorEntry.available += item.availableBalance;
                } else {
                    existing.colors.push({ colorName: item.colorName || 'Unknown', available: item.availableBalance });
                }
            } else {
                productMap.set(item.productId, {
                    productId: item.productId,
                    productName: item.productName || 'Unknown',
                    category: item.category || '',
                    imageUrl: item.imageUrl || null,
                    totalAvailable: item.availableBalance,
                    colors: [{ colorName: item.colorName || 'Unknown', available: item.availableBalance }],
                });
            }
        }

        // Sort by total available descending, take top 5
        return Array.from(productMap.values())
            .sort((a, b) => b.totalAvailable - a.totalAvailable)
            .slice(0, 5)
            .map(p => ({
                ...p,
                // Sort colors by available descending
                colors: p.colors.sort((a, b) => b.available - a.available).slice(0, 3),
            }));
    }, [inventoryData?.items]);

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
            cellStyle: { textAlign: 'center' },
        },
        {
            headerName: 'Available',
            field: 'availableBalance',
            width: 100,
            type: 'numericColumn' as const,
            cellStyle: (params: any) => {
                if (params.value === 0) {
                    return { color: '#dc2626', fontWeight: 600 };
                }
                if (params.data.status === 'below_target') {
                    return { color: '#f59e0b', fontWeight: 600 };
                }
                return { color: '#059669', fontWeight: 600 };
            },
        },
        {
            headerName: 'Reserved',
            field: 'reservedBalance',
            width: 100,
            type: 'numericColumn' as const,
            cellStyle: { color: '#6b7280' },
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
            valueFormatter: (params: any) => params.value || '-',
        },
        {
            headerName: 'Status',
            field: 'status',
            width: 100,
            cellRenderer: (params: any) => {
                if (params.data.availableBalance === 0) {
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
    ], []);

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

                {/* Stats Cards */}
                <div className="flex flex-wrap gap-3">
                    {/* Total Pieces */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 rounded-xl border border-blue-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-blue-700 leading-none">{stats.totalPieces.toLocaleString()}</div>
                            <div className="text-xs text-blue-600 mt-0.5">Total Pcs</div>
                        </div>
                    </div>

                    {/* Total SKUs */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-gray-900 leading-none">{stats.total.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 mt-0.5">SKUs</div>
                        </div>
                    </div>

                    {/* In Stock */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-green-50 rounded-xl border border-green-200 shadow-sm">
                        <div>
                            <div className="text-2xl font-bold text-green-700 leading-none">{stats.inStock.toLocaleString()}</div>
                            <div className="text-xs text-green-600 mt-0.5">In Stock</div>
                        </div>
                    </div>

                    {/* Low Stock */}
                    {stats.lowStock > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
                            <div>
                                <div className="text-2xl font-bold text-amber-700 leading-none">{stats.lowStock.toLocaleString()}</div>
                                <div className="text-xs text-amber-600 mt-0.5">Low Stock</div>
                            </div>
                        </div>
                    )}

                    {/* Out of Stock */}
                    {stats.outOfStock > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 rounded-xl border border-red-200 shadow-sm">
                            <div>
                                <div className="text-2xl font-bold text-red-700 leading-none">{stats.outOfStock.toLocaleString()}</div>
                                <div className="text-xs text-red-600 mt-0.5">Out of Stock</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Analytics Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Most Stocked Products Card */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                        <Warehouse size={18} className="text-blue-600" />
                        <h2 className="text-sm font-semibold text-gray-900">Most Stocked Products</h2>
                        <span className="text-xs text-gray-500 ml-auto">by available inventory</span>
                    </div>

                    {isLoading ? (
                        <div className="space-y-2">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
                            ))}
                        </div>
                    ) : mostStockedProducts.length === 0 ? (
                        <p className="text-gray-500 text-center py-6 text-sm">No inventory data</p>
                    ) : (
                        <div className="space-y-2">
                            {mostStockedProducts.map((product, index) => (
                                <div key={product.productId} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                                    {/* Rank Badge */}
                                    <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${
                                        index === 0 ? 'bg-amber-100 text-amber-700' :
                                        index === 1 ? 'bg-gray-200 text-gray-600' :
                                        index === 2 ? 'bg-orange-100 text-orange-700' :
                                        'bg-gray-100 text-gray-500'
                                    }`}>
                                        {index + 1}
                                    </div>

                                    {/* Product Image */}
                                    {product.imageUrl ? (
                                        <img src={product.imageUrl} alt={product.productName} className="w-10 h-10 rounded object-cover flex-shrink-0" />
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
                                            {product.colors.length < (mostStockedProducts.find(p => p.productId === product.productId)?.colors.length || 0) && ' ...'}
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
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
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
                                <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
                            ))}
                        </div>
                    ) : !demandData?.data?.length ? (
                        <p className="text-gray-500 text-center py-6 text-sm">No sales data for this period</p>
                    ) : (
                        <div className="space-y-2">
                            {demandData.data.map((product: any, index: number) => (
                                <div key={product.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                                    {/* Rank Badge */}
                                    <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${
                                        index === 0 ? 'bg-green-100 text-green-700' :
                                        index === 1 ? 'bg-gray-200 text-gray-600' :
                                        index === 2 ? 'bg-emerald-100 text-emerald-700' :
                                        'bg-gray-100 text-gray-500'
                                    }`}>
                                        {index + 1}
                                    </div>

                                    {/* Product Image */}
                                    {product.imageUrl ? (
                                        <img src={product.imageUrl} alt={product.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                                    ) : (
                                        <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                                            <Package size={16} className="text-gray-400" />
                                        </div>
                                    )}

                                    {/* Product Details */}
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-900 text-sm truncate">{product.name}</div>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                            {product.orderCount} orders · {product.category || 'uncategorized'}
                                        </div>
                                    </div>

                                    {/* Units Sold */}
                                    <div className="text-right flex-shrink-0">
                                        <div className="text-sm font-semibold text-green-600">{product.units.toLocaleString()}</div>
                                        <div className="text-xs text-gray-500">sold</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
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
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                stockFilter === 'all'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setStockFilter('in_stock')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                stockFilter === 'in_stock'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            In Stock
                        </button>
                        <button
                            onClick={() => setStockFilter('low_stock')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                stockFilter === 'low_stock'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            Low Stock
                        </button>
                        <button
                            onClick={() => setStockFilter('out_of_stock')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                stockFilter === 'out_of_stock'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            Out of Stock
                        </button>
                    </div>
                </div>

                {/* Result count */}
                <div className="mt-3 text-sm text-gray-500">
                    Showing {filteredData.length.toLocaleString()} of {stats.total.toLocaleString()} SKUs
                </div>
            </div>

            {/* AG-Grid Container */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="table-scroll-container">
                    <div style={{ minWidth: '1000px', height: 'calc(100vh - 520px)', minHeight: '400px' }}>
                        <AgGridReact
                            ref={gridRef}
                            theme={compactThemeSmall}
                            rowData={filteredData}
                            columnDefs={columnDefs}
                            loading={isLoading}
                            defaultColDef={{
                                sortable: true,
                                resizable: true,
                                suppressMovable: false,
                            }}
                            animateRows={false}
                            suppressCellFocus={false}
                            getRowId={(params) => params.data.skuId}
                            pagination={true}
                            paginationPageSize={100}
                            paginationPageSizeSelector={[50, 100, 200, 500]}
                            cacheQuickFilter={true}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
