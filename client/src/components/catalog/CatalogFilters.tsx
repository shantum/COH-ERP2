/**
 * CatalogFilters Component
 *
 * Filter controls for the Catalog page including:
 * - View level selector (Product/Color/SKU/Consumption)
 * - Search input
 * - Gender, Category, Product, and Status filters
 * - Page size selector
 * - Column visibility dropdown
 */

import { Search, RefreshCw } from 'lucide-react';
import { ColumnVisibilityDropdown, GridPreferencesToolbar } from '../common/grid';
import type { ViewLevel } from './FabricEditPopover';

export const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const; // 0 = All

// eslint-disable-next-line react-refresh/only-export-components -- intentional shared constants
export const VIEW_OPTIONS: { value: ViewLevel; label: string }[] = [
    { value: 'product', label: 'By Product' },
    { value: 'variation', label: 'By Color' },
    { value: 'sku', label: 'By SKU' },
    { value: 'consumption', label: 'Fabric Consumption' },
];

/** Filter state for the catalog page */
export interface CatalogFilter {
    gender: string;
    category: string;
    productId: string;
    variationId: string;
    colorName: string;
    status: string;
}

export interface CatalogFiltersProps {
    viewLevel: ViewLevel;
    setViewLevel: (level: ViewLevel) => void;
    searchInput: string;
    setSearchInput: (value: string) => void;
    filter: CatalogFilter;
    setFilter: React.Dispatch<React.SetStateAction<CatalogFilter>>;
    filterOptions?: {
        genders?: string[];
        categories?: string[];
        products?: Array<{ id: string; name: string; gender: string | null; category: string | null }>;
    };
    filteredProducts: Array<{ id: string; name: string }>;
    pageSize: number;
    handlePageSizeChange: (size: number) => void;
    visibleColumns: Set<string>;
    onToggleColumn: (columnId: string) => void;
    onResetAll: () => void;
    availableColumnIds: string[];
    columnHeaders: Record<string, string>;
    isManager: boolean;
    hasUserCustomizations: boolean;
    differsFromAdminDefaults: boolean;
    isSavingPrefs: boolean;
    resetToDefaults: () => Promise<boolean>;
    savePreferencesToServer: () => Promise<boolean>;
    hiddenColumnsByView: string[];
    onRefresh: () => void;
    isRefreshing: boolean;
}

export function CatalogFilters({
    viewLevel,
    setViewLevel,
    searchInput,
    setSearchInput,
    filter,
    setFilter,
    filterOptions,
    filteredProducts,
    pageSize,
    handlePageSizeChange,
    visibleColumns,
    onToggleColumn,
    onResetAll,
    availableColumnIds,
    columnHeaders,
    isManager,
    hasUserCustomizations,
    differsFromAdminDefaults,
    isSavingPrefs,
    resetToDefaults,
    savePreferencesToServer,
    hiddenColumnsByView,
    onRefresh,
    isRefreshing,
}: CatalogFiltersProps) {
    return (
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
                        onChange={(e) => setFilter((f: typeof filter) => ({ ...f, gender: e.target.value, productId: '' }))}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                    >
                        <option value="">All Genders</option>
                        {filterOptions?.genders?.map((g: string) => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </select>

                    <select
                        value={filter.category}
                        onChange={(e) => setFilter((f: typeof filter) => ({ ...f, category: e.target.value, productId: '' }))}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all"
                    >
                        <option value="">All Categories</option>
                        {filterOptions?.categories?.map((c: string) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>

                    <select
                        value={filter.productId}
                        onChange={(e) => setFilter((f: typeof filter) => ({ ...f, productId: e.target.value }))}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all max-w-[180px]"
                    >
                        <option value="">All Products</option>
                        {filteredProducts.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>

                    <select
                        value={filter.status}
                        onChange={(e) => setFilter((f: typeof filter) => ({ ...f, status: e.target.value }))}
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

                    {/* Refresh Button */}
                    <button
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 transition-all"
                        title="Refresh table data"
                    >
                        <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                        {isRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>

                    {/* Column Visibility - filter out columns hidden by view level and permissions */}
                    <ColumnVisibilityDropdown
                        visibleColumns={visibleColumns}
                        onToggleColumn={onToggleColumn}
                        onResetAll={onResetAll}
                        columnIds={availableColumnIds.filter(id => !hiddenColumnsByView.includes(id))}
                        columnHeaders={columnHeaders}
                    />
                    <GridPreferencesToolbar
                        hasUserCustomizations={hasUserCustomizations}
                        differsFromAdminDefaults={differsFromAdminDefaults}
                        isSavingPrefs={isSavingPrefs}
                        onResetToDefaults={resetToDefaults}
                        isManager={isManager}
                        onSaveAsDefaults={savePreferencesToServer}
                    />
                </div>
            </div>
        </div>
    );
}
