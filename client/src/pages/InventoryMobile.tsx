/**
 * InventoryMobile - Mobile-friendly inventory page
 *
 * Uses TanStack Table with shadcn/ui styling.
 * Shows SKU-level stock data with product info, Shopify stock, and fabric stock.
 */

import { useMemo, useState, useCallback, memo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
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
import { Package, Search, ChevronLeft, ChevronRight, AlertCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';
// Filter types are defined locally since the route just needs the schema

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
    const search = InventoryMobileRoute.useSearch();
    const loaderData = InventoryMobileRoute.useLoaderData();

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
            },
        });
    }, [navigate, search.search, search.pageSize]);

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
                header: () => <div className="text-right">Stock</div>,
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
                header: () => <div className="text-right">Shopify</div>,
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
                header: () => <div className="text-right">Fabric</div>,
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
                header: () => <div className="text-center">Shopify</div>,
                cell: ({ row }) => (
                    <div className="text-center">
                        <ShopifyStatusCell status={row.original.shopifyProductStatus} />
                    </div>
                ),
            },
        ],
        []
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
