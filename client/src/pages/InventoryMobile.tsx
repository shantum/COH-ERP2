/**
 * InventoryMobile - Mobile-friendly inventory page
 *
 * Uses TanStack Table with shadcn/ui styling.
 * Shows SKU-level stock data with product info, Shopify stock, and fabric stock.
 */

import { useMemo, useState, useCallback, memo, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    type ColumnDef,
} from '@tanstack/react-table';
import { Route as InventoryMobileRoute } from '../routes/_authenticated/inventory-mobile';
import { getInventoryAll, type InventoryAllItem } from '../server/functions/inventory';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Package, Search, ChevronLeft, ChevronRight, AlertCircle, X, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { showSuccess, showError } from '../utils/toast';

// ============================================
// SHOPIFY INVENTORY SYNC
// ============================================

/**
 * Fetch Shopify inventory locations
 * Returns the first (primary) location ID
 */
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

/**
 * Zero out Shopify stock for a SKU
 */
async function zeroOutShopifyStock(sku: string, locationId: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch('/api/shopify/inventory/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, locationId, quantity: 0 }),
    });

    if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to update Shopify');
    }

    return res.json() as Promise<{ success: boolean; error?: string }>;
}

/**
 * Hook to manage Shopify location ID (fetched once and cached)
 */
function useShopifyLocation() {
    return useQuery({
        queryKey: ['shopify-location'],
        queryFn: fetchShopifyLocationId,
        staleTime: Infinity, // Location rarely changes
        retry: 1,
    });
}

// ============================================
// CELL COMPONENTS (Memoized for performance)
// ============================================

interface ProductCellProps {
    item: InventoryAllItem;
}

/**
 * ProductCell - Displays product thumbnail, name, color, size, and SKU code
 * Styled similar to orders table ProductNameCell
 */
const ProductCell = memo(function ProductCell({ item }: ProductCellProps) {
    const { productName, colorName, size, skuCode, imageUrl } = item;

    return (
        <div className="flex items-center gap-2 py-1">
            {/* Thumbnail */}
            <div className="w-10 h-10 rounded bg-gray-100 flex-shrink-0 overflow-hidden">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={productName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Package size={18} />
                    </div>
                )}
            </div>

            {/* Product info */}
            <div className="flex flex-col justify-center leading-tight min-w-0 flex-1">
                {/* Line 1: Product name */}
                <span className="font-medium text-gray-900 truncate text-sm">
                    {productName || '-'}
                </span>
                {/* Line 2: Color | Size */}
                <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                    {colorName && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 truncate max-w-[80px]">
                            {colorName}
                        </span>
                    )}
                    {colorName && size && <span className="text-gray-300">|</span>}
                    {size && <span className="shrink-0">{size}</span>}
                </div>
                {/* Line 3: SKU code */}
                <span className="font-mono text-[10px] text-gray-400 truncate mt-0.5">
                    {skuCode}
                </span>
            </div>
        </div>
    );
});

interface StockValueCellProps {
    value: number | null;
    isOutOfStock?: boolean;
    showUnit?: string;
}

/**
 * StockValueCell - Displays a stock value with color coding
 */
const StockValueCell = memo(function StockValueCell({
    value,
    isOutOfStock = false,
    showUnit,
}: StockValueCellProps) {
    if (value === null) {
        return <span className="text-gray-300 text-sm">-</span>;
    }

    const displayValue = showUnit ? value.toFixed(1) : value;

    return (
        <span
            className={cn(
                'font-semibold tabular-nums',
                isOutOfStock || value <= 0 ? 'text-red-600' : 'text-gray-900'
            )}
        >
            {displayValue}
            {showUnit && <span className="text-xs text-gray-400 ml-0.5">{showUnit}</span>}
        </span>
    );
});

interface ShopifyStatusCellProps {
    status: 'active' | 'archived' | 'draft' | null;
}

/**
 * ShopifyStatusCell - Displays Shopify product status as a badge
 */
const ShopifyStatusCell = memo(function ShopifyStatusCell({ status }: ShopifyStatusCellProps) {
    if (!status) {
        return <span className="text-gray-300 text-xs">-</span>;
    }

    const config: Record<string, { label: string; className: string }> = {
        active: { label: 'Active', className: 'bg-green-100 text-green-700' },
        archived: { label: 'Archived', className: 'bg-gray-100 text-gray-600' },
        draft: { label: 'Draft', className: 'bg-amber-100 text-amber-700' },
    };

    const { label, className } = config[status] || { label: status, className: 'bg-gray-100 text-gray-500' };

    return (
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium uppercase', className)}>
            {label}
        </span>
    );
});

interface ZeroOutButtonProps {
    skuCode: string;
    shopifyQty: number | null;
    shopifyProductStatus: 'active' | 'archived' | 'draft' | null;
    locationId: string | null | undefined;
    onRefresh: () => void;
}

/** Polling interval in ms */
const POLL_INTERVAL = 1000;
/** Max polling attempts (10 seconds total) */
const MAX_POLL_ATTEMPTS = 10;

/**
 * ZeroOutButton - Button to zero out Shopify stock for archived SKUs
 * Only visible when: status is 'archived' AND shopifyQty > 0
 * Polls for updates until shopifyQty becomes 0 or timeout
 */
const ZeroOutButton = memo(function ZeroOutButton({
    skuCode,
    shopifyQty,
    shopifyProductStatus,
    locationId,
    onRefresh,
}: ZeroOutButtonProps) {
    const [isPending, setIsPending] = useState(false);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollCountRef = useRef(0);

    // Cleanup polling when shopifyQty becomes 0 or component unmounts
    useEffect(() => {
        if (shopifyQty === 0 || shopifyQty === null) {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
                setIsPending(false);
            }
        }
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, [shopifyQty]);

    // Only show for archived SKUs with stock > 0 on Shopify
    const shouldShow = shopifyProductStatus === 'archived' && shopifyQty !== null && shopifyQty > 0;

    if (!shouldShow) return null;

    const handleClick = async () => {
        if (!locationId || isPending) return;

        setIsPending(true);
        pollCountRef.current = 0;

        try {
            await zeroOutShopifyStock(skuCode, locationId);
            showSuccess('Syncing with Shopify...', { description: 'Will refresh automatically' });

            // Start polling - refresh every second until data updates
            pollIntervalRef.current = setInterval(() => {
                pollCountRef.current++;
                onRefresh();

                // Stop after max attempts
                if (pollCountRef.current >= MAX_POLL_ATTEMPTS) {
                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                    setIsPending(false);
                }
            }, POLL_INTERVAL);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            showError('Failed to zero stock', { description: message });
            setIsPending(false);
        }
    };

    // Don't show button if location not loaded yet
    if (!locationId) return null;

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors',
                'bg-red-50 text-red-600 hover:bg-red-100',
                isPending && 'cursor-not-allowed opacity-50'
            )}
        >
            {isPending ? (
                <Loader2 className="w-3 h-3 animate-spin inline" />
            ) : (
                'Set Shopify to 0'
            )}
        </button>
    );
});

// ============================================
// FILTER CHIP COMPONENT
// ============================================

interface FilterChipProps {
    label: string;
    isActive: boolean;
    onClick: () => void;
    onClear?: () => void;
}

const FilterChip = memo(function FilterChip({ label, isActive, onClick, onClear }: FilterChipProps) {
    return (
        <button
            type="button"
            onClick={isActive && onClear ? onClear : onClick}
            className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                isActive
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
            )}
        >
            {label}
            {isActive && onClear && <X className="w-3 h-3" />}
        </button>
    );
});

// ============================================
// SORTABLE HEADER COMPONENT
// ============================================

interface SortableHeaderProps {
    label: string;
    sortKey: 'stock' | 'shopify' | 'fabric';
    currentSortBy: string;
    currentSortOrder: string;
    onSort: (key: 'stock' | 'shopify' | 'fabric') => void;
}

const SortableHeader = memo(function SortableHeader({
    label,
    sortKey,
    currentSortBy,
    currentSortOrder,
    onSort,
}: SortableHeaderProps) {
    const isActive = currentSortBy === sortKey;

    return (
        <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={cn(
                'flex items-center justify-end gap-0.5 w-full text-right hover:text-gray-900 transition-colors',
                isActive ? 'text-blue-600 font-medium' : 'text-gray-500'
            )}
        >
            <span>{label}</span>
            {isActive && (
                currentSortOrder === 'desc' ? (
                    <ArrowDown className="w-3 h-3" />
                ) : (
                    <ArrowUp className="w-3 h-3" />
                )
            )}
        </button>
    );
});

// Filter options configuration
const filterConfig = {
    stock: {
        label: 'Stock',
        options: [
            { value: 'in_stock', label: 'In Stock' },
            { value: 'out_of_stock', label: 'Out of Stock' },
            { value: 'low_stock', label: 'Low Stock' },
        ],
    },
    shopifyStatus: {
        label: 'Shopify',
        options: [
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: 'draft', label: 'Draft' },
        ],
    },
    discrepancy: {
        label: 'Sync',
        options: [
            { value: 'has_discrepancy', label: 'Discrepancy' },
            { value: 'no_discrepancy', label: 'In Sync' },
        ],
    },
    fabric: {
        label: 'Fabric',
        options: [
            { value: 'has_fabric', label: 'Has Fabric' },
            { value: 'no_fabric', label: 'No Fabric' },
            { value: 'low_fabric', label: 'Low Fabric' },
        ],
    },
} as const;


// ============================================
// MAIN COMPONENT
// ============================================

export default function InventoryMobile() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const search = InventoryMobileRoute.useSearch();
    const loaderData = InventoryMobileRoute.useLoaderData();

    // Shopify location (fetched once)
    const { data: locationId } = useShopifyLocation();

    // Local search input state (debounced)
    const [searchInput, setSearchInput] = useState(search.search || '');

    // Query with loader data as initial
    const { data, isLoading, error } = useQuery({
        queryKey: [
            'inventory-mobile',
            search.search,
            search.page,
            search.pageSize,
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
                    limit: search.pageSize,
                    offset: (search.page - 1) * search.pageSize,
                    stockFilter: search.stockFilter,
                    shopifyStatus: search.shopifyStatus,
                    discrepancy: search.discrepancy,
                    fabricFilter: search.fabricFilter,
                    sortBy: search.sortBy,
                    sortOrder: search.sortOrder,
                },
            }),
        initialData: loaderData.inventory ?? undefined,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;
    const totalPages = pagination ? Math.ceil(pagination.total / search.pageSize) : 1;

    // Handle search submit
    const handleSearch = useCallback(() => {
        navigate({
            to: '/inventory-mobile',
            search: {
                ...search,
                search: searchInput || undefined,
                page: 1,
            },
        });
    }, [navigate, searchInput, search]);

    // Handle page change
    const handlePageChange = useCallback(
        (newPage: number) => {
            navigate({
                to: '/inventory-mobile',
                search: { ...search, page: newPage },
            });
        },
        [navigate, search]
    );

    // Handle filter change
    const handleFilterChange = useCallback(
        (filterKey: 'stockFilter' | 'shopifyStatus' | 'discrepancy' | 'fabricFilter', value: string) => {
            navigate({
                to: '/inventory-mobile',
                search: {
                    ...search,
                    [filterKey]: value,
                    page: 1, // Reset to first page on filter change
                },
            });
        },
        [navigate, search]
    );

    // Clear a specific filter
    const clearFilter = useCallback(
        (filterKey: 'stockFilter' | 'shopifyStatus' | 'discrepancy' | 'fabricFilter') => {
            navigate({
                to: '/inventory-mobile',
                search: {
                    ...search,
                    [filterKey]: 'all',
                    page: 1,
                },
            });
        },
        [navigate, search]
    );

    // Clear all filters
    const clearAllFilters = useCallback(() => {
        navigate({
            to: '/inventory-mobile',
            search: {
                search: search.search,
                page: 1,
                pageSize: search.pageSize,
                stockFilter: 'all',
                shopifyStatus: 'all',
                discrepancy: 'all',
                fabricFilter: 'all',
                sortBy: search.sortBy,
                sortOrder: search.sortOrder,
            },
        });
    }, [navigate, search.search, search.pageSize, search.sortBy, search.sortOrder]);

    // Handle sort change
    const handleSortChange = useCallback(
        (sortBy: 'stock' | 'shopify' | 'fabric') => {
            // If clicking the same sort field, toggle order; otherwise set to desc
            const newOrder = search.sortBy === sortBy && search.sortOrder === 'desc' ? 'asc' : 'desc';
            navigate({
                to: '/inventory-mobile',
                search: {
                    ...search,
                    sortBy,
                    sortOrder: newOrder,
                    page: 1, // Reset to first page on sort change
                },
            });
        },
        [navigate, search]
    );

    // Count active filters
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (search.stockFilter && search.stockFilter !== 'all') count++;
        if (search.shopifyStatus && search.shopifyStatus !== 'all') count++;
        if (search.discrepancy && search.discrepancy !== 'all') count++;
        if (search.fabricFilter && search.fabricFilter !== 'all') count++;
        return count;
    }, [search.stockFilter, search.shopifyStatus, search.discrepancy, search.fabricFilter]);

    // Table columns
    const columns = useMemo<ColumnDef<InventoryAllItem>[]>(
        () => [
            {
                id: 'product',
                header: 'Product',
                cell: ({ row }) => <ProductCell item={row.original} />,
            },
            {
                id: 'stock',
                header: () => (
                    <SortableHeader
                        label="Stock"
                        sortKey="stock"
                        currentSortBy={search.sortBy}
                        currentSortOrder={search.sortOrder}
                        onSort={handleSortChange}
                    />
                ),
                cell: ({ row }) => (
                    <div className="text-right">
                        <StockValueCell
                            value={row.original.availableBalance}
                            isOutOfStock={row.original.availableBalance <= 0}
                        />
                    </div>
                ),
            },
            {
                id: 'shopify',
                header: () => (
                    <SortableHeader
                        label="Shopify"
                        sortKey="shopify"
                        currentSortBy={search.sortBy}
                        currentSortOrder={search.sortOrder}
                        onSort={handleSortChange}
                    />
                ),
                cell: ({ row }) => {
                    const { shopifyQty, availableBalance } = row.original;
                    const hasDiscrepancy = shopifyQty !== null && availableBalance !== shopifyQty;
                    return (
                        <div className="text-right">
                            {shopifyQty !== null ? (
                                <span
                                    className={cn(
                                        'tabular-nums',
                                        hasDiscrepancy ? 'text-amber-600 font-medium' : 'text-gray-500'
                                    )}
                                >
                                    {shopifyQty}
                                </span>
                            ) : (
                                <span className="text-gray-300 text-sm">-</span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'fabric',
                header: () => (
                    <SortableHeader
                        label="Fabric"
                        sortKey="fabric"
                        currentSortBy={search.sortBy}
                        currentSortOrder={search.sortOrder}
                        onSort={handleSortChange}
                    />
                ),
                cell: ({ row }) => (
                    <div className="text-right">
                        <StockValueCell
                            value={row.original.fabricColourBalance}
                            showUnit="m"
                        />
                    </div>
                ),
            },
            {
                id: 'shopifyStatus',
                header: () => <div className="text-center">Status</div>,
                cell: ({ row }) => (
                    <div className="flex items-center justify-center gap-1">
                        <ShopifyStatusCell status={row.original.shopifyProductStatus} />
                        <ZeroOutButton
                            skuCode={row.original.skuCode}
                            shopifyQty={row.original.shopifyQty}
                            shopifyProductStatus={row.original.shopifyProductStatus}
                            locationId={locationId}
                            onRefresh={() => {
                                queryClient.invalidateQueries({ queryKey: ['inventory-mobile'] });
                            }}
                        />
                    </div>
                ),
            },
        ],
        [search.sortBy, search.sortOrder, handleSortChange, locationId, queryClient]
    );

    // Table instance
    const table = useReactTable({
        data: items,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    // Error state
    if (loaderData.error || error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] p-4">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-gray-600 text-center">
                    {loaderData.error || (error as Error)?.message || 'Failed to load inventory'}
                </p>
                <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => window.location.reload()}
                >
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header with search */}
            <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 space-y-3">
                <h1 className="text-lg font-semibold text-gray-900">Inventory</h1>

                {/* Search bar */}
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Search SKU, product, color..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="pl-9"
                        />
                    </div>
                    <Button onClick={handleSearch} variant="default" size="sm">
                        Search
                    </Button>
                </div>

                {/* Filter chips */}
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
                    {/* Stock filters */}
                    {filterConfig.stock.options.map((opt) => (
                        <FilterChip
                            key={`stock-${opt.value}`}
                            label={opt.label}
                            isActive={search.stockFilter === opt.value}
                            onClick={() => handleFilterChange('stockFilter', opt.value)}
                            onClear={() => clearFilter('stockFilter')}
                        />
                    ))}
                    {/* Shopify status filters */}
                    {filterConfig.shopifyStatus.options.map((opt) => (
                        <FilterChip
                            key={`shopify-${opt.value}`}
                            label={opt.label}
                            isActive={search.shopifyStatus === opt.value}
                            onClick={() => handleFilterChange('shopifyStatus', opt.value)}
                            onClear={() => clearFilter('shopifyStatus')}
                        />
                    ))}
                    {/* Discrepancy filter */}
                    {filterConfig.discrepancy.options.map((opt) => (
                        <FilterChip
                            key={`disc-${opt.value}`}
                            label={opt.label}
                            isActive={search.discrepancy === opt.value}
                            onClick={() => handleFilterChange('discrepancy', opt.value)}
                            onClear={() => clearFilter('discrepancy')}
                        />
                    ))}
                    {/* Fabric filters */}
                    {filterConfig.fabric.options.map((opt) => (
                        <FilterChip
                            key={`fabric-${opt.value}`}
                            label={opt.label}
                            isActive={search.fabricFilter === opt.value}
                            onClick={() => handleFilterChange('fabricFilter', opt.value)}
                            onClear={() => clearFilter('fabricFilter')}
                        />
                    ))}
                </div>

                {/* Stats bar */}
                {pagination && (
                    <div className="flex items-center justify-between text-xs text-gray-500">
                        <div className="flex items-center gap-2">
                            <span>{pagination.total.toLocaleString()} SKUs</span>
                            {activeFilterCount > 0 && (
                                <button
                                    onClick={clearAllFilters}
                                    className="text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
                                >
                                    Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <span>
                            Page {search.page} of {totalPages}
                        </span>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-500">
                        <Package className="w-10 h-10 mb-2 text-gray-300" />
                        <p>No inventory found</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader className="sticky top-0 bg-white">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            className="text-xs font-medium text-gray-500 bg-gray-50"
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef.header,
                                                      header.getContext()
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    className={cn(
                                        row.original.availableBalance <= 0 && 'bg-red-50/50'
                                    )}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="py-2">
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            {/* Pagination footer */}
            {pagination && totalPages > 1 && (
                <div className="sticky bottom-0 bg-white border-t px-4 py-3 flex items-center justify-between">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(search.page - 1)}
                        disabled={search.page <= 1}
                    >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Prev
                    </Button>
                    <span className="text-sm text-gray-600">
                        {search.page} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(search.page + 1)}
                        disabled={!pagination.hasMore}
                    >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                </div>
            )}
        </div>
    );
}
