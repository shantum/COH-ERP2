/**
 * Catalog page - Combined Products + Inventory view
 * Flat AG-Grid table with 1 row per SKU showing all product and inventory data
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Search, Columns, RotateCcw, Eye, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { catalogApi } from '../services/api';

// Page size options
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const; // 0 = All

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Custom compact theme based on Quartz
const compactTheme = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 28,
    headerHeight: 32,
});

// All column IDs in display order
const ALL_COLUMN_IDS = [
    'productName', 'styleCode', 'category', 'gender', 'productType', 'fabricTypeName',
    'colorName', 'fabricName', 'image',
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

// Column visibility dropdown component
const ColumnVisibilityDropdown = ({
    visibleColumns,
    onToggleColumn,
    onResetAll,
}: {
    visibleColumns: Set<string>;
    onToggleColumn: (colId: string) => void;
    onResetAll: () => void;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div ref={dropdownRef} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50"
            >
                <Columns size={12} />
                Columns
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                    <div className="p-2 border-b">
                        <button
                            onClick={onResetAll}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                        >
                            <RotateCcw size={10} />
                            Reset All
                        </button>
                    </div>
                    <div className="p-2 space-y-1">
                        {ALL_COLUMN_IDS.filter(id => id !== 'actions').map((colId) => (
                            <label key={colId} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                                <input
                                    type="checkbox"
                                    checked={visibleColumns.has(colId)}
                                    onChange={() => onToggleColumn(colId)}
                                    className="w-3 h-3"
                                />
                                {DEFAULT_HEADERS[colId] || colId}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// Status badge renderer
const StatusBadge = ({ status }: { status: string }) => {
    if (status === 'ok') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                <CheckCircle size={10} />
                OK
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
            <AlertCircle size={10} />
            Low
        </span>
    );
};

export default function Catalog() {
    // Grid ref for API access
    const gridRef = useRef<AgGridReact>(null);

    // Page size state (persisted to localStorage)
    const [pageSize, setPageSize] = useState<number>(() => {
        const saved = localStorage.getItem('catalogGridPageSize');
        return saved ? parseInt(saved, 10) : 100;
    });

    // Filter state
    const [filter, setFilter] = useState({
        gender: '',
        category: '',
        productId: '',
        status: '',
    });
    const [searchInput, setSearchInput] = useState('');

    // Column visibility state (persisted to localStorage)
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('catalogGridVisibleColumns');
        if (saved) {
            try {
                return new Set(JSON.parse(saved));
            } catch {
                return new Set(ALL_COLUMN_IDS);
            }
        }
        return new Set(ALL_COLUMN_IDS);
    });

    // Column order state (persisted to localStorage)
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('catalogGridColumnOrder');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return ALL_COLUMN_IDS;
            }
        }
        return ALL_COLUMN_IDS;
    });

    // Save column visibility to localStorage
    useEffect(() => {
        localStorage.setItem('catalogGridVisibleColumns', JSON.stringify([...visibleColumns]));
    }, [visibleColumns]);

    // Save column order to localStorage
    useEffect(() => {
        localStorage.setItem('catalogGridColumnOrder', JSON.stringify(columnOrder));
    }, [columnOrder]);

    // Save page size to localStorage
    useEffect(() => {
        localStorage.setItem('catalogGridPageSize', String(pageSize));
    }, [pageSize]);

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

    // Handle page size change
    const handlePageSizeChange = useCallback((newSize: number) => {
        setPageSize(newSize);
        if (gridRef.current?.api) {
            if (newSize === 0) {
                // Show all - set to a very large number
                gridRef.current.api.setGridOption('paginationPageSize', 999999);
            } else {
                gridRef.current.api.setGridOption('paginationPageSize', newSize);
            }
        }
    }, []);

    // Fetch filter options
    const { data: filterOptions } = useQuery({
        queryKey: ['catalogFilters'],
        queryFn: () => catalogApi.getFilters().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Filtered products based on selected gender/category
    const filteredProducts = useMemo(() => {
        if (!filterOptions?.products) return [];
        return filterOptions.products.filter((p: any) => {
            if (filter.gender && p.gender !== filter.gender) return false;
            if (filter.category && p.category !== filter.category) return false;
            return true;
        });
    }, [filterOptions?.products, filter.gender, filter.category]);

    // Column toggle handler
    const handleToggleColumn = useCallback((colId: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev);
            if (next.has(colId)) {
                next.delete(colId);
            } else {
                next.add(colId);
            }
            return next;
        });
    }, []);

    // Column moved handler - persist order
    const handleColumnMoved = useCallback(() => {
        const api = gridRef.current?.api;
        if (!api) return;
        const newOrder = api.getAllDisplayedColumns()
            .map(col => col.getColId())
            .filter((id): id is string => id !== undefined);
        if (newOrder.length > 0) {
            setColumnOrder(newOrder);
        }
    }, []);

    // Reset all columns (visibility and order)
    const handleResetAll = useCallback(() => {
        setVisibleColumns(new Set(ALL_COLUMN_IDS));
        setColumnOrder([...ALL_COLUMN_IDS]);
    }, []);

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
            field: 'fabricTypeName',
            width: 100,
            cellClass: 'text-xs',
        },
        // Variation columns
        {
            colId: 'colorName',
            headerName: DEFAULT_HEADERS.colorName,
            field: 'colorName',
            width: 110,
        },
        {
            colId: 'fabricName',
            headerName: DEFAULT_HEADERS.fabricName,
            field: 'fabricName',
            width: 100,
            cellClass: 'text-xs',
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
                <StatusBadge status={params.value} />
            ),
        },
        // Actions
        {
            colId: 'actions',
            headerName: '',
            width: 60,
            pinned: 'right' as const,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => {
                                // TODO: Open SKU detail modal
                                console.log('View SKU:', row.skuId);
                            }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="View details"
                        >
                            <Eye size={14} />
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
    ].map(col => ({
        ...col,
        hide: !visibleColumns.has(col.colId!),
    })), [visibleColumns]);

    // Order columns based on saved order
    const orderedColumnDefs = useMemo(() => {
        const colMap = new Map(columnDefs.map(col => [col.colId, col]));
        const ordered: ColDef[] = [];
        // Add columns in saved order
        for (const colId of columnOrder) {
            const col = colMap.get(colId);
            if (col) {
                ordered.push(col);
                colMap.delete(colId);
            }
        }
        // Add any remaining columns (new columns not in saved order)
        for (const col of colMap.values()) {
            ordered.push(col);
        }
        return ordered;
    }, [columnDefs, columnOrder]);

    // Summary stats
    const stats = useMemo(() => {
        const items = catalogData?.items || [];
        return {
            totalSkus: items.length,
            belowTarget: items.filter((i: any) => i.status === 'below_target').length,
            outOfStock: items.filter((i: any) => i.availableBalance === 0).length,
        };
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
                        <span className="font-medium text-gray-900">{stats.totalSkus}</span> SKUs
                    </div>
                    {stats.belowTarget > 0 && (
                        <div className="text-amber-600">
                            <span className="font-medium">{stats.belowTarget}</span> below target
                        </div>
                    )}
                    {stats.outOfStock > 0 && (
                        <div className="text-red-600">
                            <span className="font-medium">{stats.outOfStock}</span> out of stock
                        </div>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 md:gap-3">
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
                />
            </div>

            {/* AG-Grid */}
            <div className="table-scroll-container border rounded">
                <div style={{ minWidth: '1100px', height: 'calc(100vh - 280px)', minHeight: '400px' }}>
                    <AgGridReact
                        ref={gridRef}
                        theme={compactTheme}
                        rowData={catalogData?.items || []}
                        columnDefs={orderedColumnDefs}
                        loading={isLoading}
                        defaultColDef={{
                            sortable: true,
                            resizable: true,
                            suppressMovable: false,
                        }}
                        animateRows={false}
                        suppressCellFocus={true}
                        getRowId={(params) => params.data.skuId}
                        // Pagination
                        pagination={true}
                        paginationPageSize={pageSize === 0 ? 999999 : pageSize}
                        paginationPageSizeSelector={false}
                        // Quick filter for fast search
                        cacheQuickFilter={true}
                        // Column order persistence
                        onColumnMoved={handleColumnMoved}
                        maintainColumnOrder={true}
                    />
                </div>
            </div>
        </div>
    );
}
