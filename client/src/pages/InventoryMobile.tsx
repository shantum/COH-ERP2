/**
 * InventoryMobile - Mobile inventory scanner
 *
 * Industrial-utilitarian design for rapid stock scanning.
 * Card-based layout with size grids for instant pattern recognition.
 */

import { useMemo, useState, useCallback, memo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Route as InventoryMobileRoute } from '../routes/_authenticated/inventory-mobile';
import { getInventoryAll, type InventoryAllItem } from '../server/functions/inventory';
import { Search, AlertTriangle, Package, RefreshCw, ChevronDown, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { showSuccess, showError } from '../utils/toast';

// ============================================
// TYPES
// ============================================

interface SizeStock {
    size: string;
    skuCode: string;
    skuId: string;
    stock: number;
    shopify: number | null;
    status: 'active' | 'archived' | 'draft' | null;
}

interface ColorGroup {
    variationId: string;
    colorName: string;
    imageUrl: string | null;
    sizes: SizeStock[];
    totalStock: number;
    totalShopify: number;
    hasArchived: boolean;
    archivedWithStock: SizeStock[];
    // Fabric details
    fabricName: string | null;
    fabricUnit: string | null;
    fabricColourName: string | null;
    fabricColourHex: string | null;
    fabricColourBalance: number | null;
}

interface ProductGroup {
    productId: string;
    productName: string;
    imageUrl: string | null;
    colors: ColorGroup[];
    totalStock: number;
    totalShopify: number;
}

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
// GROUPING LOGIC
// ============================================

function groupInventory(items: InventoryAllItem[]): ProductGroup[] {
    const productMap = new Map<string, ProductGroup>();
    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];

    for (const item of items) {
        let product = productMap.get(item.productId);
        if (!product) {
            product = {
                productId: item.productId,
                productName: item.productName,
                imageUrl: item.imageUrl,
                colors: [],
                totalStock: 0,
                totalShopify: 0,
            };
            productMap.set(item.productId, product);
        }

        let color = product.colors.find(c => c.variationId === item.variationId);
        if (!color) {
            color = {
                variationId: item.variationId,
                colorName: item.colorName,
                imageUrl: item.imageUrl,
                sizes: [],
                totalStock: 0,
                totalShopify: 0,
                hasArchived: false,
                archivedWithStock: [],
                fabricName: item.fabricName,
                fabricUnit: item.fabricUnit,
                fabricColourName: item.fabricColourName,
                fabricColourHex: item.fabricColourHex,
                fabricColourBalance: item.fabricColourBalance,
            };
            product.colors.push(color);
        }

        const sizeData: SizeStock = {
            size: item.size,
            skuCode: item.skuCode,
            skuId: item.skuId,
            stock: item.availableBalance,
            shopify: item.shopifyQty,
            status: item.shopifyProductStatus,
        };

        color.sizes.push(sizeData);
        color.totalStock += item.availableBalance;
        color.totalShopify += item.shopifyQty ?? 0;
        product.totalStock += item.availableBalance;
        product.totalShopify += item.shopifyQty ?? 0;

        // Track archived SKUs with Shopify stock
        if (item.shopifyProductStatus === 'archived') {
            color.hasArchived = true;
            if ((item.shopifyQty ?? 0) > 0) {
                color.archivedWithStock.push(sizeData);
            }
        }

        if (!product.imageUrl && item.imageUrl) product.imageUrl = item.imageUrl;
        if (!color.imageUrl && item.imageUrl) color.imageUrl = item.imageUrl;
    }

    // Sort sizes
    for (const product of productMap.values()) {
        for (const color of product.colors) {
            color.sizes.sort((a, b) => {
                const aIdx = sizeOrder.indexOf(a.size);
                const bIdx = sizeOrder.indexOf(b.size);
                if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                if (aIdx !== -1) return -1;
                if (bIdx !== -1) return 1;
                return a.size.localeCompare(b.size);
            });
        }
    }

    return Array.from(productMap.values());
}

// ============================================
// LOGOS
// ============================================

const CohLogo = memo(function CohLogo() {
    return (
        <img
            src="/COH-Square-Monkey-Logo.png"
            alt="COH"
            className="w-5 h-5 rounded object-contain"
        />
    );
});

const ShopifyLogo = memo(function ShopifyLogo() {
    return (
        <img
            src="/shopify_glyph.svg"
            alt="Shopify"
            className="w-5 h-5 object-contain"
        />
    );
});

// ============================================
// COLOR CARD COMPONENT
// ============================================

interface ColorCardProps {
    color: ColorGroup;
    locationId: string | null | undefined;
    onRefresh: () => void;
}

const ColorCard = memo(function ColorCard({ color, locationId, onRefresh }: ColorCardProps) {
    const [syncing, setSyncing] = useState<string | null>(null);
    const isOutOfStock = color.totalStock <= 0;
    const hasActionable = color.archivedWithStock.length > 0;

    // Get Shopify status from first size (all sizes of a variation share the same status)
    const shopifyStatus = color.sizes[0]?.status ?? null;

    const handleZeroAll = async () => {
        if (!locationId || syncing || color.archivedWithStock.length === 0) return;
        setSyncing('all');
        try {
            for (const sku of color.archivedWithStock) {
                await zeroOutShopifyStock(sku.skuCode, locationId);
            }
            showSuccess(`Zeroed ${color.archivedWithStock.length} SKUs`);
            setTimeout(onRefresh, 500);
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Sync failed');
        } finally {
            setSyncing(null);
        }
    };

    // Use fabric hex for border if available
    const borderColor = color.fabricColourHex || (
        isOutOfStock ? '#fecaca' :
        shopifyStatus === 'archived' ? '#d4d4d8' :
        shopifyStatus === 'draft' ? '#fde68a' :
        '#e4e4e7'
    );

    return (
        <div
            className="bg-white rounded-xl overflow-hidden"
            style={{ boxShadow: `inset 0 0 0 2px ${borderColor}` }}
        >
            {/* Header */}
            <div className="flex items-center gap-3 p-3 pb-2">
                {/* Color swatch - use fabric hex if available */}
                <div
                    className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"
                    style={{ backgroundColor: color.fabricColourHex || '#f4f4f5' }}
                >
                    {color.imageUrl && (
                        <img src={color.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-zinc-900 truncate text-sm">
                        {color.colorName}
                    </h3>
                    {/* Fabric info */}
                    {(color.fabricName || color.fabricColourName) && (
                        <p className="text-[10px] text-zinc-500 truncate">
                            {color.fabricName && color.fabricColourName
                                ? `${color.fabricName} - ${color.fabricColourName}`
                                : color.fabricName || color.fabricColourName}
                            <span className={cn(
                                'ml-1 font-medium',
                                (color.fabricColourBalance ?? 0) <= 0 ? 'text-red-500' :
                                (color.fabricColourBalance ?? 0) < 10 ? 'text-amber-500' :
                                'text-emerald-600'
                            )}>
                                | {color.fabricColourBalance ?? 0}{color.fabricUnit === 'kg' ? 'kg' : 'm'}
                            </span>
                        </p>
                    )}
                </div>

                {/* Stock total + status */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <div className={cn(
                        'text-lg font-bold tabular-nums',
                        isOutOfStock ? 'text-red-500' : 'text-zinc-800'
                    )}>
                        {color.totalStock}
                    </div>
                    {shopifyStatus && (
                        <span className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide',
                            shopifyStatus === 'active' ? 'bg-emerald-100 text-emerald-700' :
                            shopifyStatus === 'archived' ? 'bg-zinc-200 text-zinc-500' :
                            shopifyStatus === 'draft' ? 'bg-amber-100 text-amber-700' :
                            'bg-zinc-100 text-zinc-400'
                        )}>
                            {shopifyStatus}
                        </span>
                    )}
                </div>
            </div>

            {/* Stock grid */}
            <div className="px-3 pb-3">
                {/* Size headers */}
                <div className="flex items-center mb-1">
                    <div className="w-8 flex-shrink-0" /> {/* Logo spacer */}
                    <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${color.sizes.length}, 1fr)` }}>
                        {color.sizes.map((size) => (
                            <div key={size.skuId} className="text-center">
                                <span className="text-[10px] font-medium text-zinc-400 uppercase">
                                    {size.size}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* COH Row */}
                <div className="flex items-center py-1">
                    <div className="w-8 flex-shrink-0">
                        <CohLogo />
                    </div>
                    <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${color.sizes.length}, 1fr)` }}>
                        {color.sizes.map((size) => {
                            const isOut = size.stock <= 0;
                            return (
                                <div key={size.skuId} className="text-center">
                                    <span className={cn(
                                        'text-sm font-semibold tabular-nums',
                                        isOut ? 'text-red-500' : 'text-zinc-800'
                                    )}>
                                        {size.stock}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Shopify Row */}
                <div className="flex items-center py-1">
                    <div className="w-8 flex-shrink-0">
                        <ShopifyLogo />
                    </div>
                    <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${color.sizes.length}, 1fr)` }}>
                        {color.sizes.map((size) => {
                            const shopifyVal = size.shopify ?? 0;
                            const sizeMismatch = size.shopify !== null && size.stock !== size.shopify;
                            return (
                                <div key={size.skuId} className="text-center">
                                    <span className={cn(
                                        'text-sm tabular-nums',
                                        sizeMismatch ? 'text-amber-500 font-semibold' : 'text-zinc-400'
                                    )}>
                                        {shopifyVal}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Zero action - only show if there are archived SKUs with Shopify stock */}
            {hasActionable && (
                <div className="px-3 pb-3 pt-1 border-t border-zinc-100">
                    <button
                        onClick={handleZeroAll}
                        disabled={syncing !== null}
                        className={cn(
                            'w-full py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2',
                            'bg-amber-500 text-white hover:bg-amber-600',
                            syncing === 'all' && 'opacity-50'
                        )}
                    >
                        <Zap className="w-3 h-3" />
                        {syncing === 'all' ? 'Syncing...' : `Zero ${color.archivedWithStock.length} archived on Shopify`}
                    </button>
                </div>
            )}
        </div>
    );
});

// ============================================
// PRODUCT SECTION
// ============================================

interface ProductSectionProps {
    product: ProductGroup;
    locationId: string | null | undefined;
    onRefresh: () => void;
    defaultExpanded?: boolean;
}

const ProductSection = memo(function ProductSection({
    product,
    locationId,
    onRefresh,
    defaultExpanded = false
}: ProductSectionProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    // Get up to 4 color thumbnails for the stack preview
    const previewColors = product.colors.slice(0, 4);
    const remainingCount = product.colors.length - previewColors.length;

    return (
        <div className="mb-3">
            {/* Product header - white theme with color stack on right */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                    'bg-white border border-zinc-200',
                    isExpanded && 'rounded-b-none border-b-0'
                )}
            >
                {/* Name */}
                <div className="flex-1 text-left min-w-0">
                    <h2 className="font-semibold text-sm text-zinc-900 truncate">{product.productName}</h2>
                    <p className="text-xs text-zinc-400">
                        {product.colors.length} color{product.colors.length !== 1 ? 's' : ''}
                    </p>
                </div>

                {/* Color thumbnails stack - rectangles */}
                <div className="flex items-center flex-shrink-0">
                    <div className="flex -space-x-1.5">
                        {previewColors.map((color, idx) => (
                            <div
                                key={color.variationId}
                                className="w-7 h-9 rounded-md border-2 border-white overflow-hidden bg-zinc-100 shadow-sm"
                                style={{
                                    zIndex: previewColors.length - idx,
                                    backgroundColor: color.fabricColourHex || '#f4f4f5'
                                }}
                            >
                                {color.imageUrl && (
                                    <img src={color.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                )}
                            </div>
                        ))}
                        {remainingCount > 0 && (
                            <div
                                className="w-7 h-9 rounded-md border-2 border-white bg-zinc-200 flex items-center justify-center shadow-sm"
                                style={{ zIndex: 0 }}
                            >
                                <span className="text-[9px] font-medium text-zinc-600">+{remainingCount}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Chevron */}
                <ChevronDown className={cn(
                    'w-5 h-5 text-zinc-400 transition-transform',
                    isExpanded && 'rotate-180'
                )} />
            </button>

            {/* Color cards */}
            {isExpanded && (
                <div className="bg-zinc-100 rounded-b-xl p-3 space-y-3 border border-t-0 border-zinc-200">
                    {product.colors.map((color) => (
                        <ColorCard
                            key={color.variationId}
                            color={color}
                            locationId={locationId}
                            onRefresh={onRefresh}
                        />
                    ))}
                </div>
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
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
                'border-2',
                isActive ? (
                    variant === 'danger' ? 'bg-red-500 border-red-500 text-white' :
                    variant === 'warning' ? 'bg-amber-500 border-amber-500 text-zinc-900' :
                    'bg-zinc-900 border-zinc-900 text-white'
                ) : (
                    'bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400'
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
    const [searchInput, setSearchInput] = useState(search.search || '');

    // Get loader data for initial hydration
    const loaderData = InventoryMobileRoute.useLoaderData();

    const { data, isLoading, error } = useQuery({
        queryKey: [
            'inventory-mobile-all',
            search.search,
            search.stockFilter,
            search.shopifyStatus,
            search.discrepancy,
            search.fabricFilter,
            search.sortBy,
            search.sortOrder,
        ],
        queryFn: () =>
            getInventoryAll({
                data: {
                    includeCustomSkus: false,
                    search: search.search,
                    limit: 10000, // Need all for product grouping
                    offset: 0,
                    stockFilter: search.stockFilter,
                    shopifyStatus: search.shopifyStatus,
                    discrepancy: search.discrepancy,
                    fabricFilter: search.fabricFilter,
                    sortBy: search.sortBy,
                    sortOrder: search.sortOrder,
                },
            }),
        // Use loader data as initial data when available and params match
        initialData: loaderData?.inventory ?? undefined,
        staleTime: 60000,
    });

    const items = data?.items ?? [];
    const products = useMemo(() => groupInventory(items), [items]);

    // Real-time filtering based on searchInput
    const filteredProducts = useMemo(() => {
        if (!searchInput) return products;
        const q = searchInput.toLowerCase();
        return products.filter(p =>
            p.productName.toLowerCase().includes(q) ||
            p.colors.some(c =>
                c.colorName.toLowerCase().includes(q) ||
                c.fabricColourName?.toLowerCase().includes(q) ||
                c.sizes.some(s => s.skuCode.toLowerCase().includes(q))
            )
        );
    }, [products, searchInput]);

    const handleFilterChange = useCallback(
        (filterKey: 'stockFilter' | 'shopifyStatus' | 'discrepancy' | 'fabricFilter', value: string) => {
            const currentValue = search[filterKey];
            const newValue = currentValue === value ? 'all' : value;
            navigate({ to: '/inventory-mobile', search: { ...search, [filterKey]: newValue } });
        },
        [navigate, search]
    );

    const handleRefresh = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['inventory-mobile-all'] });
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
        <div className="min-h-screen bg-zinc-100">
            {/* Sticky header - white theme */}
            <div className="sticky top-0 z-20 bg-white border-b border-zinc-200">
                {/* Title bar */}
                <div className="px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-zinc-900">Stock Scanner</h1>
                            {!isLoading && (
                                <p className="text-xs text-zinc-500">
                                    {filteredProducts.length} products · {items.length} SKUs
                                </p>
                            )}
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={isLoading}
                            className={cn(
                                'p-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 transition-colors',
                                isLoading && 'animate-pulse'
                            )}
                        >
                            <RefreshCw className={cn('w-5 h-5 text-zinc-600', isLoading && 'animate-spin')} />
                        </button>
                    </div>
                </div>

                {/* Search - real-time */}
                <div className="px-4 pb-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search products, colors, SKUs..."
                            className="w-full pl-10 pr-4 py-2.5 bg-zinc-100 border-0 rounded-lg text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                        />
                    </div>
                </div>

                {/* Filters */}
                <div className="px-4 pb-3 overflow-x-auto scrollbar-hide">
                    <div className="flex gap-2">
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

            {/* Content */}
            <div className="px-4 py-4">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-12 h-12 rounded-full border-4 border-zinc-300 border-t-zinc-900 animate-spin" />
                        <p className="mt-4 text-sm text-zinc-500">Loading inventory...</p>
                    </div>
                ) : filteredProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Package className="w-16 h-16 text-zinc-300 mb-4" />
                        <h2 className="font-semibold text-zinc-900 mb-1">No products found</h2>
                        <p className="text-sm text-zinc-500">Try adjusting your search or filters</p>
                    </div>
                ) : (
                    filteredProducts.map((product) => (
                        <ProductSection
                            key={product.productId}
                            product={product}
                            locationId={locationId}
                            onRefresh={handleRefresh}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
