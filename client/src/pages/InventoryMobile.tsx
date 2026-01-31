/**
 * InventoryMobile - Mobile inventory scanner
 *
 * Industrial-utilitarian design for rapid stock scanning.
 * Card-based layout with size grids for instant pattern recognition.
 *
 * Variation-based flat list for immediate data visibility.
 */

import { useMemo, useState, useCallback, memo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Route as InventoryMobileRoute } from '../routes/_authenticated/inventory-mobile';
import {
    getInventoryGrouped,
    type ColorGroup,
} from '../server/functions/inventory';
import { Search, AlertTriangle, Package, RefreshCw, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { showSuccess, showError } from '../utils/toast';
import { getOptimizedImageUrl } from '../utils/imageOptimization';

// ============================================
// SHOPIFY SYNC
// ============================================

async function fetchShopifyLocationId(): Promise<string | null> {
    try {
        const res = await fetch('/api/shopify/inventory/locations');
        if (!res.ok) return null;
        const data = await res.json() as { locations: Array<{ id: string; name: string }> };
        return data.locations?.[0]?.id ?? null;
    } catch {
        return null;
    }
}

async function zeroOutShopifyStock(sku: string, locationId: string): Promise<void> {
    const res = await fetch('/api/shopify/inventory/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, locationId, quantity: 0 }),
    });
    if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to sync');
    }
}

function useShopifyLocation() {
    return useQuery({
        queryKey: ['shopify-location'],
        queryFn: fetchShopifyLocationId,
        staleTime: Infinity,
        retry: 1,
    });
}

// ============================================
// VARIATION ROW COMPONENT (flat list item)
// ============================================

// Canonical size order for aligned columns
const ALL_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] as const;

/** Extended color group with product info for flat list */
interface VariationWithProduct extends ColorGroup {
    productName: string;
    productId: string;
}

interface VariationRowProps {
    variation: VariationWithProduct;
    locationId: string | null | undefined;
    onRefresh: () => void;
    activeSizes: string[]; // Which size columns to show
}

const VariationRow = memo(function VariationRow({ variation, locationId, onRefresh, activeSizes }: VariationRowProps) {
    const [syncing, setSyncing] = useState<string | null>(null);
    const isOutOfStock = variation.totalStock <= 0;
    const hasActionable = variation.archivedWithStock.length > 0;
    const hasMismatch = variation.sizes.some(s => s.shopify !== null && s.stock !== s.shopify);

    // Get Shopify status from first size
    const shopifyStatus = variation.sizes[0]?.status ?? null;

    // Create size lookup map
    const sizeMap = useMemo(() => {
        const map = new Map<string, { stock: number; skuId: string }>();
        for (const s of variation.sizes) {
            map.set(s.size, { stock: s.stock, skuId: s.skuId });
        }
        return map;
    }, [variation.sizes]);

    const handleZeroAll = async () => {
        if (!locationId || syncing || variation.archivedWithStock.length === 0) return;
        setSyncing('all');
        try {
            for (const sku of variation.archivedWithStock) {
                await zeroOutShopifyStock(sku.skuCode, locationId);
            }
            showSuccess(`Zeroed ${variation.archivedWithStock.length} SKUs`);
            setTimeout(onRefresh, 500);
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Sync failed');
        } finally {
            setSyncing(null);
        }
    };

    // Left accent color for alerts
    const accentColor = isOutOfStock ? 'border-l-red-400' :
        hasMismatch ? 'border-l-amber-400' :
        shopifyStatus === 'archived' ? 'border-l-zinc-300' :
        'border-l-transparent';

    return (
        <div className={cn(
            'border-b border-zinc-100 bg-white',
            'border-l-2',
            accentColor,
            'hover:bg-zinc-50 transition-colors'
        )}>
            {/* Single compact row */}
            <div className="flex items-center gap-2 sm:gap-4 px-3 py-2">
                {/* Thumbnail */}
                <div
                    className="w-9 h-11 sm:w-10 sm:h-12 rounded overflow-hidden flex-shrink-0"
                    style={{ backgroundColor: variation.fabricColourHex || '#f4f4f5' }}
                >
                    {variation.imageUrl && (
                        <img src={getOptimizedImageUrl(variation.imageUrl, 'xs') || variation.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                </div>

                {/* Info - flexible on mobile, fixed on desktop */}
                <div className="min-w-0 flex-1 sm:flex-none sm:w-56 md:w-72">
                    {/* Product name - allow 2 lines on mobile, truncate on desktop */}
                    <h3 className="font-medium text-zinc-900 text-[12px] sm:text-[13px] leading-snug line-clamp-2 sm:line-clamp-none sm:truncate">
                        {variation.productName}
                    </h3>
                    <p className="text-[10px] sm:text-[11px] text-zinc-400 truncate">
                        {variation.colorName}
                        {variation.fabricColourBalance !== null && (
                            <span className={cn(
                                'ml-1',
                                (variation.fabricColourBalance ?? 0) <= 0 ? 'text-red-500' :
                                (variation.fabricColourBalance ?? 0) < 10 ? 'text-amber-500' :
                                'text-emerald-600'
                            )}>
                                · {variation.fabricColourBalance}{variation.fabricUnit === 'kg' ? 'kg' : 'm'}
                            </span>
                        )}
                    </p>
                </div>

                {/* Size grid - aligned columns */}
                <div className="flex justify-end gap-0 flex-shrink-0">
                    {activeSizes.map((size) => {
                        const sizeData = sizeMap.get(size);
                        const hasSize = sizeData !== undefined;
                        const isOut = hasSize && sizeData.stock <= 0;
                        return (
                            <div key={size} className="text-center w-7 sm:w-9">
                                <div className="text-[8px] sm:text-[9px] text-zinc-400 uppercase leading-none">{size}</div>
                                <div className={cn(
                                    'text-xs sm:text-sm font-medium tabular-nums leading-tight',
                                    !hasSize ? 'text-zinc-200' :
                                    isOut ? 'text-red-500' : 'text-zinc-700'
                                )}>
                                    {hasSize ? sizeData.stock : '-'}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Stock total */}
                <div className={cn(
                    'text-base sm:text-lg font-semibold tabular-nums flex-shrink-0 w-10 sm:w-14 text-right',
                    isOutOfStock ? 'text-red-500' : 'text-zinc-800'
                )}>
                    {variation.totalStock}
                </div>
            </div>

            {/* Zero action - inline compact */}
            {hasActionable && (
                <button
                    onClick={handleZeroAll}
                    disabled={syncing !== null}
                    className={cn(
                        'w-full py-1.5 text-[10px] font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors flex items-center justify-center gap-1',
                        syncing === 'all' && 'opacity-50'
                    )}
                >
                    <Zap className="w-3 h-3" />
                    {syncing === 'all' ? 'Syncing...' : `Zero ${variation.archivedWithStock.length} on Shopify`}
                </button>
            )}
        </div>
    );
});

// ============================================
// FILTER PILL
// ============================================

interface FilterPillProps {
    label: string;
    isActive: boolean;
    onClick: () => void;
    variant?: 'default' | 'danger' | 'warning';
}

const FilterPill = memo(function FilterPill({ label, isActive, onClick, variant = 'default' }: FilterPillProps) {
    return (
        <button
            onClick={onClick}
            className={cn(
                'px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap',
                isActive ? (
                    variant === 'danger' ? 'bg-red-500 text-white' :
                    variant === 'warning' ? 'bg-amber-500 text-white' :
                    'bg-zinc-800 text-white'
                ) : (
                    'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                )
            )}
        >
            {label}
        </button>
    );
});

// ============================================
// MAIN COMPONENT
// ============================================

export default function InventoryMobile() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const search = InventoryMobileRoute.useSearch();

    const { data: locationId } = useShopifyLocation();
    const [searchInput, setSearchInputRaw] = useState(search.search || '');

    // Reset to page 1 when search input changes
    const setSearchInput = useCallback((value: string) => {
        setSearchInputRaw(value);
        // Only navigate if we're not already on page 1
        if (search.page !== 1) {
            navigate({ to: '/inventory-mobile', search: { ...search, page: 1 } });
        }
    }, [navigate, search]);

    // Get loader data for initial hydration (now pre-grouped from server)
    const loaderData = InventoryMobileRoute.useLoaderData();

    const { data, isLoading, error } = useQuery({
        queryKey: [
            'inventory-mobile-grouped',
            search.search,
            search.stockFilter,
            search.shopifyStatus,
            search.discrepancy,
            search.fabricFilter,
            search.sortBy,
            search.sortOrder,
        ],
        queryFn: () =>
            getInventoryGrouped({
                data: {
                    search: search.search,
                    stockFilter: search.stockFilter,
                    shopifyStatus: search.shopifyStatus,
                    discrepancy: search.discrepancy,
                    fabricFilter: search.fabricFilter,
                    sortBy: search.sortBy,
                    sortOrder: search.sortOrder,
                },
            }),
        // Use loader data as initial data when available
        initialData: loaderData?.inventory ?? undefined,
        staleTime: 60000,
    });

    // Flatten products into variations for flat list display
    const variations: VariationWithProduct[] = useMemo(() => {
        const products = data?.products ?? [];
        return products.flatMap(product =>
            product.colors.map(color => ({
                ...color,
                productName: product.productName,
                productId: product.productId,
            }))
        );
    }, [data?.products]);

    // Real-time filtering based on searchInput (client-side for instant feedback)
    const filteredVariations = useMemo(() => {
        if (!searchInput) return variations;
        const q = searchInput.toLowerCase();
        return variations.filter(v =>
            v.productName.toLowerCase().includes(q) ||
            v.colorName.toLowerCase().includes(q) ||
            v.fabricColourName?.toLowerCase().includes(q) ||
            v.sizes.some(s => s.skuCode.toLowerCase().includes(q))
        );
    }, [variations, searchInput]);

    // Pagination
    const page = search.page ?? 1;
    const pageSize = search.pageSize ?? 50;
    const totalPages = Math.ceil(filteredVariations.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedVariations = useMemo(() => {
        return filteredVariations.slice(startIndex, startIndex + pageSize);
    }, [filteredVariations, startIndex, pageSize]);

    // Calculate active sizes (union of all sizes in current page) - sorted by canonical order
    const activeSizes = useMemo(() => {
        const sizeSet = new Set<string>();
        for (const v of paginatedVariations) {
            for (const s of v.sizes) {
                sizeSet.add(s.size);
            }
        }
        // Sort by canonical order
        return ALL_SIZES.filter(size => sizeSet.has(size));
    }, [paginatedVariations]);

    // Reset to page 1 when filters/search change
    const handleFilterChange = useCallback(
        (filterKey: 'stockFilter' | 'shopifyStatus' | 'discrepancy' | 'fabricFilter', value: string) => {
            const currentValue = search[filterKey];
            const newValue = currentValue === value ? 'all' : value;
            navigate({ to: '/inventory-mobile', search: { ...search, [filterKey]: newValue, page: 1 } });
        },
        [navigate, search]
    );

    const handlePageChange = useCallback(
        (newPage: number) => {
            if (newPage >= 1 && newPage <= totalPages) {
                navigate({ to: '/inventory-mobile', search: { ...search, page: newPage } });
                // Scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        },
        [navigate, search, totalPages]
    );

    const handleRefresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['inventory-mobile-grouped'] });
    }, [queryClient]);

    if (error) {
        return (
            <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl p-6 text-center max-w-sm">
                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="font-semibold text-lg mb-2">Failed to load</h2>
                    <p className="text-sm text-zinc-500 mb-4">
                        {(error as Error)?.message || 'Something went wrong'}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-50">
            {/* Centered container for desktop */}
            <div className="max-w-4xl mx-auto">
                {/* Sticky header - compact */}
                <div className="sticky top-0 z-20 bg-white border-b border-zinc-200">
                    {/* Title + Search row */}
                    <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3">
                        <div className="flex-shrink-0">
                            <h1 className="text-sm sm:text-base font-semibold text-zinc-900">Stock</h1>
                            {!isLoading && (
                                <p className="text-[10px] sm:text-xs text-zinc-400">
                                    {startIndex + 1}-{Math.min(startIndex + pageSize, filteredVariations.length)} / {filteredVariations.length}
                                </p>
                            )}
                        </div>
                        <div className="flex-1 relative max-w-md">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-400" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Search..."
                                className="w-full pl-8 sm:pl-9 pr-3 py-1.5 sm:py-2 bg-zinc-100 border-0 rounded text-xs sm:text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                            />
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={isLoading}
                            className="p-1.5 sm:p-2 rounded hover:bg-zinc-100 transition-colors"
                        >
                        <RefreshCw className={cn('w-4 h-4 sm:w-5 sm:h-5 text-zinc-500', isLoading && 'animate-spin')} />
                    </button>
                </div>

                {/* Filters - compact pills */}
                <div className="px-3 sm:px-4 pb-2 sm:pb-3 overflow-x-auto scrollbar-hide">
                    <div className="flex gap-1.5 sm:gap-2">
                        <FilterPill
                            label="Out of Stock"
                            isActive={search.stockFilter === 'out_of_stock'}
                            onClick={() => handleFilterChange('stockFilter', 'out_of_stock')}
                            variant="danger"
                        />
                        <FilterPill
                            label="Low Stock"
                            isActive={search.stockFilter === 'low_stock'}
                            onClick={() => handleFilterChange('stockFilter', 'low_stock')}
                            variant="warning"
                        />
                        <FilterPill
                            label="Mismatch"
                            isActive={search.discrepancy === 'has_discrepancy'}
                            onClick={() => handleFilterChange('discrepancy', 'has_discrepancy')}
                            variant="warning"
                        />
                        <FilterPill
                            label="Active"
                            isActive={search.shopifyStatus === 'active'}
                            onClick={() => handleFilterChange('shopifyStatus', 'active')}
                        />
                        <FilterPill
                            label="Archived"
                            isActive={search.shopifyStatus === 'archived'}
                            onClick={() => handleFilterChange('shopifyStatus', 'archived')}
                        />
                        <FilterPill
                            label="Has Fabric"
                            isActive={search.fabricFilter === 'has_fabric'}
                            onClick={() => handleFilterChange('fabricFilter', 'has_fabric')}
                        />
                        <FilterPill
                            label="Low Fabric"
                            isActive={search.fabricFilter === 'low_fabric'}
                            onClick={() => handleFilterChange('fabricFilter', 'low_fabric')}
                            variant="warning"
                        />
                    </div>
                </div>
            </div>

            {/* Content - flat list */}
            <div className="bg-white">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-10 h-10 rounded-full border-3 border-zinc-200 border-t-zinc-600 animate-spin" />
                        <p className="mt-3 text-xs text-zinc-400">Loading...</p>
                    </div>
                ) : filteredVariations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                        <Package className="w-12 h-12 text-zinc-200 mb-3" />
                        <h2 className="font-medium text-zinc-600 text-sm mb-1">No variations found</h2>
                        <p className="text-xs text-zinc-400">Try adjusting your search or filters</p>
                    </div>
                ) : (
                    <>
                        {paginatedVariations.map((variation) => (
                            <VariationRow
                                key={variation.variationId}
                                variation={variation}
                                locationId={locationId}
                                onRefresh={handleRefresh}
                                activeSizes={activeSizes}
                            />
                        ))}

                        {/* Pagination controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between py-3 px-3 border-t border-zinc-100 bg-zinc-50">
                                <button
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={page <= 1}
                                    className={cn(
                                        'flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
                                        page <= 1
                                            ? 'text-zinc-300 cursor-not-allowed'
                                            : 'text-zinc-600 hover:bg-zinc-100'
                                    )}
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                    Prev
                                </button>

                                <span className="text-xs text-zinc-500">
                                    {page} / {totalPages}
                                </span>

                                <button
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={page >= totalPages}
                                    className={cn(
                                        'flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
                                        page >= totalPages
                                            ? 'text-zinc-300 cursor-not-allowed'
                                            : 'text-zinc-600 hover:bg-zinc-100'
                                    )}
                                >
                                    Next
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
            </div>
        </div>
    );
}
