/**
 * Fabrics page - Flat AG-Grid table with all fabric data
 * One row per fabric color showing type, supplier, stock, and analysis
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Search, Columns, RotateCcw, Eye, Package, Plus, Users, AlertTriangle, X, Trash2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { fabricsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';

// Page size options
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const;

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
    'fabricTypeName', 'composition', 'colorName', 'standardColor',
    'supplierName', 'costPerUnit', 'leadTimeDays', 'minOrderQty',
    'currentBalance', 'totalInward', 'totalOutward', 'avgDailyConsumption',
    'daysOfStock', 'reorderPoint', 'stockStatus', 'suggestedOrderQty',
    'actions'
];

// Default headers
const DEFAULT_HEADERS: Record<string, string> = {
    fabricTypeName: 'Fabric Type',
    composition: 'Composition',
    colorName: 'Color',
    standardColor: 'Std Color',
    supplierName: 'Supplier',
    costPerUnit: 'Cost/Unit',
    leadTimeDays: 'Lead (days)',
    minOrderQty: 'Min Order',
    currentBalance: 'Balance',
    totalInward: 'Total In',
    totalOutward: 'Total Out',
    avgDailyConsumption: 'Avg/Day',
    daysOfStock: 'Days Stock',
    reorderPoint: 'Reorder At',
    stockStatus: 'Status',
    suggestedOrderQty: 'Suggested Qty',
    actions: '',
};

// Standard colors for add color form
const STANDARD_COLORS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Brown', 'Black', 'White', 'Grey', 'Beige', 'Navy', 'Teal'];

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

// Status badge component
const StatusBadge = ({ status }: { status: string }) => {
    if (status === 'OK') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                OK
            </span>
        );
    }
    if (status === 'ORDER SOON') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                Soon
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
            Order Now
        </span>
    );
};

export default function Fabrics() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const gridRef = useRef<AgGridReact>(null);

    // Page size state
    const [pageSize, setPageSize] = useState<number>(() => {
        const saved = localStorage.getItem('fabricsGridPageSize');
        return saved ? parseInt(saved, 10) : 100;
    });

    // Filter state
    const [filter, setFilter] = useState({ fabricTypeId: '', status: '' });
    const [searchInput, setSearchInput] = useState('');

    // Column visibility state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('fabricsGridVisibleColumns');
        if (saved) {
            try {
                return new Set(JSON.parse(saved));
            } catch {
                return new Set(ALL_COLUMN_IDS);
            }
        }
        return new Set(ALL_COLUMN_IDS);
    });

    // Column order state
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('fabricsGridColumnOrder');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return ALL_COLUMN_IDS;
            }
        }
        return ALL_COLUMN_IDS;
    });

    // Modal states
    const [showAddType, setShowAddType] = useState(false);
    const [showAddColor, setShowAddColor] = useState<string | null>(null);
    const [showInward, setShowInward] = useState<any>(null);
    const [showAddSupplier, setShowAddSupplier] = useState(false);
    const [showDetail, setShowDetail] = useState<any>(null);

    // Form states
    const [typeForm, setTypeForm] = useState({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0 });
    const [colorForm, setColorForm] = useState({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: 400, supplierId: '', leadTimeDays: 14, minOrderQty: 20 });
    const [inwardForm, setInwardForm] = useState({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
    const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });

    // Save preferences to localStorage
    useEffect(() => {
        localStorage.setItem('fabricsGridVisibleColumns', JSON.stringify([...visibleColumns]));
    }, [visibleColumns]);

    useEffect(() => {
        localStorage.setItem('fabricsGridColumnOrder', JSON.stringify(columnOrder));
    }, [columnOrder]);

    useEffect(() => {
        localStorage.setItem('fabricsGridPageSize', String(pageSize));
    }, [pageSize]);

    // Apply quick filter when search input changes
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 150);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch flat fabric data
    const { data: fabricData, isLoading } = useQuery({
        queryKey: ['fabricsFlat', filter.fabricTypeId, filter.status],
        queryFn: () => fabricsApi.getFlat({
            fabricTypeId: filter.fabricTypeId || undefined,
            status: filter.status || undefined,
        }).then(r => r.data),
    });

    // Fetch filter options
    const { data: filterOptions } = useQuery({
        queryKey: ['fabricFilters'],
        queryFn: () => fabricsApi.getFilters().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch suppliers for forms
    const { data: suppliers } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => fabricsApi.getSuppliers().then(r => r.data),
    });

    // Fetch transactions when detail view is open
    const { data: transactions, isLoading: txnLoading } = useQuery({
        queryKey: ['fabricTransactions', showDetail?.fabricId],
        queryFn: () => fabricsApi.getTransactions(showDetail.fabricId).then(r => r.data),
        enabled: !!showDetail?.fabricId,
    });

    // Mutations
    const createType = useMutation({
        mutationFn: (data: any) => fabricsApi.createType(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            setShowAddType(false);
            setTypeForm({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0 });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric type'),
    });

    const createFabric = useMutation({
        mutationFn: (data: any) => fabricsApi.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            setShowAddColor(null);
            setColorForm({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: 400, supplierId: '', leadTimeDays: 14, minOrderQty: 20 });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric'),
    });

    const createInward = useMutation({
        mutationFn: ({ fabricId, data }: { fabricId: string; data: any }) => fabricsApi.createTransaction(fabricId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            setShowInward(null);
            setInwardForm({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to record inward'),
    });

    const createSupplier = useMutation({
        mutationFn: (data: any) => fabricsApi.createSupplier(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            setShowAddSupplier(false);
            setSupplierForm({ name: '', contactName: '', email: '', phone: '', address: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create supplier'),
    });

    const deleteTransaction = useMutation({
        mutationFn: (txnId: string) => fabricsApi.deleteTransaction(txnId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTransactions', showDetail?.fabricId] });
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete transaction'),
    });

    // Handlers
    const handlePageSizeChange = useCallback((newSize: number) => {
        setPageSize(newSize);
        if (gridRef.current?.api) {
            gridRef.current.api.setGridOption('paginationPageSize', newSize === 0 ? 999999 : newSize);
        }
    }, []);

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

    const handleResetAll = useCallback(() => {
        setVisibleColumns(new Set(ALL_COLUMN_IDS));
        setColumnOrder([...ALL_COLUMN_IDS]);
    }, []);

    const handleSubmitType = (e: React.FormEvent) => {
        e.preventDefault();
        createType.mutate(typeForm);
    };

    const handleSubmitColor = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showAddColor) return;
        const fabricType = filterOptions?.fabricTypes?.find((t: any) => t.id === showAddColor);
        createFabric.mutate({
            fabricTypeId: showAddColor,
            name: `${fabricType?.name || 'Fabric'} - ${colorForm.colorName}`,
            colorName: colorForm.colorName,
            standardColor: colorForm.standardColor || null,
            colorHex: colorForm.colorHex,
            costPerUnit: colorForm.costPerUnit,
            supplierId: colorForm.supplierId || null,
            leadTimeDays: colorForm.leadTimeDays,
            minOrderQty: colorForm.minOrderQty,
        });
    };

    const handleSubmitInward = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInward.mutate({
            fabricId: showInward.fabricId,
            data: {
                txnType: 'inward',
                qty: inwardForm.qty,
                unit: showInward.unit || 'meter',
                reason: 'supplier_receipt',
                notes: inwardForm.notes,
                costPerUnit: inwardForm.costPerUnit || null,
                supplierId: inwardForm.supplierId || null,
            },
        });
    };

    const handleSubmitSupplier = (e: React.FormEvent) => {
        e.preventDefault();
        createSupplier.mutate(supplierForm);
    };

    // Column definitions
    const columnDefs: ColDef[] = useMemo(() => [
        {
            colId: 'fabricTypeName',
            headerName: DEFAULT_HEADERS.fabricTypeName,
            field: 'fabricTypeName',
            width: 130,
            pinned: 'left' as const,
            cellClass: 'font-medium',
        },
        {
            colId: 'composition',
            headerName: DEFAULT_HEADERS.composition,
            field: 'composition',
            width: 100,
            cellClass: 'text-xs text-gray-600',
        },
        {
            colId: 'colorName',
            headerName: DEFAULT_HEADERS.colorName,
            field: 'colorName',
            width: 140,
            cellRenderer: (params: ICellRendererParams) => {
                const { colorHex, colorName } = params.data || {};
                return (
                    <div className="flex items-center gap-2">
                        <div
                            className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                            style={{ backgroundColor: colorHex || '#ccc' }}
                        />
                        <span className="truncate">{colorName}</span>
                    </div>
                );
            },
        },
        {
            colId: 'standardColor',
            headerName: DEFAULT_HEADERS.standardColor,
            field: 'standardColor',
            width: 80,
            cellClass: 'text-xs text-gray-500',
        },
        {
            colId: 'supplierName',
            headerName: DEFAULT_HEADERS.supplierName,
            field: 'supplierName',
            width: 110,
            cellClass: 'text-xs',
            valueFormatter: (params: ValueFormatterParams) => params.value || '-',
        },
        {
            colId: 'costPerUnit',
            headerName: DEFAULT_HEADERS.costPerUnit,
            field: 'costPerUnit',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${params.value}` : '-',
            cellClass: 'text-right',
        },
        {
            colId: 'leadTimeDays',
            headerName: DEFAULT_HEADERS.leadTimeDays,
            field: 'leadTimeDays',
            width: 80,
            cellClass: 'text-right text-xs',
        },
        {
            colId: 'minOrderQty',
            headerName: DEFAULT_HEADERS.minOrderQty,
            field: 'minOrderQty',
            width: 80,
            cellClass: 'text-right text-xs',
        },
        {
            colId: 'currentBalance',
            headerName: DEFAULT_HEADERS.currentBalance,
            field: 'currentBalance',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) => {
                const val = params.value || 0;
                const unit = params.data?.unit === 'kg' ? 'kg' : 'm';
                return `${val.toFixed(1)} ${unit}`;
            },
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-gray-400';
                return 'text-right font-medium';
            },
        },
        {
            colId: 'totalInward',
            headerName: DEFAULT_HEADERS.totalInward,
            field: 'totalInward',
            width: 75,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(1) : '0',
            cellClass: 'text-right text-green-600 text-xs',
        },
        {
            colId: 'totalOutward',
            headerName: DEFAULT_HEADERS.totalOutward,
            field: 'totalOutward',
            width: 75,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(1) : '0',
            cellClass: 'text-right text-red-600 text-xs',
        },
        {
            colId: 'avgDailyConsumption',
            headerName: DEFAULT_HEADERS.avgDailyConsumption,
            field: 'avgDailyConsumption',
            width: 70,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(2) : '-',
            cellClass: 'text-right text-xs text-gray-500',
        },
        {
            colId: 'daysOfStock',
            headerName: DEFAULT_HEADERS.daysOfStock,
            field: 'daysOfStock',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `${params.value}d` : '-',
            cellClass: (params: CellClassParams) => {
                const days = params.value;
                if (days == null) return 'text-right text-xs';
                if (days <= 7) return 'text-right text-xs text-red-600 font-medium';
                if (days <= 14) return 'text-right text-xs text-yellow-600';
                return 'text-right text-xs text-green-600';
            },
        },
        {
            colId: 'reorderPoint',
            headerName: DEFAULT_HEADERS.reorderPoint,
            field: 'reorderPoint',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(1) : '-',
            cellClass: 'text-right text-xs text-gray-500',
        },
        {
            colId: 'stockStatus',
            headerName: DEFAULT_HEADERS.stockStatus,
            field: 'stockStatus',
            width: 80,
            cellRenderer: (params: ICellRendererParams) => (
                <StatusBadge status={params.value || 'OK'} />
            ),
        },
        {
            colId: 'suggestedOrderQty',
            headerName: DEFAULT_HEADERS.suggestedOrderQty,
            field: 'suggestedOrderQty',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null && params.value > 0 ? params.value.toFixed(1) : '-',
            cellClass: (params: CellClassParams) => {
                const val = params.value;
                if (val && val > 0) return 'text-right font-medium text-blue-600';
                return 'text-right text-gray-400';
            },
        },
        {
            colId: 'actions',
            headerName: '',
            width: 80,
            pinned: 'right' as const,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowDetail(row)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="View details"
                        >
                            <Eye size={14} />
                        </button>
                        <button
                            onClick={() => setShowInward(row)}
                            className="p-1 rounded hover:bg-green-100 text-green-500 hover:text-green-700"
                            title="Add inward"
                        >
                            <Package size={14} />
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
        for (const colId of columnOrder) {
            const col = colMap.get(colId);
            if (col) {
                ordered.push(col);
                colMap.delete(colId);
            }
        }
        for (const col of colMap.values()) {
            ordered.push(col);
        }
        return ordered;
    }, [columnDefs, columnOrder]);

    // Summary stats
    const summary = fabricData?.summary || { total: 0, orderNow: 0, orderSoon: 0, ok: 0 };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Fabrics</h1>
                    <p className="text-sm text-gray-500">Fabric inventory and stock management</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3">
                    <button onClick={() => setShowAddSupplier(true)} className="btn-secondary flex items-center text-sm">
                        <Users size={18} className="mr-1.5" />Add Supplier
                    </button>
                    <button onClick={() => setShowAddType(true)} className="btn-primary flex items-center text-sm">
                        <Plus size={18} className="mr-1.5" />Add Type
                    </button>
                </div>
            </div>

            {/* Stats bar */}
            <div className="flex items-center gap-3 md:gap-4 text-sm">
                <div className="text-gray-500">
                    <span className="font-medium text-gray-900">{summary.total}</span> fabrics
                </div>
                {summary.orderNow > 0 && (
                    <div className="flex items-center gap-1 text-red-600">
                        <AlertTriangle size={14} />
                        <span className="font-medium">{summary.orderNow}</span> order now
                    </div>
                )}
                {summary.orderSoon > 0 && (
                    <div className="text-yellow-600">
                        <span className="font-medium">{summary.orderSoon}</span> order soon
                    </div>
                )}
                {summary.ok > 0 && (
                    <div className="text-green-600">
                        <span className="font-medium">{summary.ok}</span> OK
                    </div>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 md:gap-3">
                <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search fabric, color, supplier..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-full sm:w-48 md:w-56 focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                </div>

                <select
                    value={filter.fabricTypeId}
                    onChange={(e) => setFilter(f => ({ ...f, fabricTypeId: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Types</option>
                    {filterOptions?.fabricTypes?.map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>

                <select
                    value={filter.status}
                    onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Status</option>
                    <option value="ORDER NOW">Order Now</option>
                    <option value="ORDER SOON">Order Soon</option>
                    <option value="OK">OK</option>
                </select>

                <div className="hidden sm:block sm:flex-1" />

                {/* Add Color button */}
                {filterOptions?.fabricTypes?.length > 0 && (
                    <select
                        value=""
                        onChange={(e) => e.target.value && setShowAddColor(e.target.value)}
                        className="text-sm border rounded px-2 py-1.5 bg-white text-primary-600 w-full sm:w-auto"
                    >
                        <option value="">+ Add Color...</option>
                        {filterOptions?.fabricTypes?.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                )}

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
                        rowData={fabricData?.items || []}
                        columnDefs={orderedColumnDefs}
                        loading={isLoading}
                        defaultColDef={{
                            sortable: true,
                            resizable: true,
                            suppressMovable: false,
                        }}
                        animateRows={false}
                        suppressCellFocus={true}
                        getRowId={(params) => params.data.fabricId}
                        pagination={true}
                        paginationPageSize={pageSize === 0 ? 999999 : pageSize}
                        paginationPageSizeSelector={false}
                        cacheQuickFilter={true}
                        onColumnMoved={handleColumnMoved}
                        maintainColumnOrder={true}
                    />
                </div>
            </div>

            {/* Add Fabric Type Modal */}
            {showAddType && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Fabric Type</h2>
                            <button onClick={() => setShowAddType(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitType} className="space-y-4">
                            <div>
                                <label className="label">Type Name</label>
                                <input className="input" value={typeForm.name} onChange={(e) => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Linen 60 Lea" required />
                            </div>
                            <div>
                                <label className="label">Composition</label>
                                <input className="input" value={typeForm.composition} onChange={(e) => setTypeForm(f => ({ ...f, composition: e.target.value }))} placeholder="e.g., 100% Linen" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Unit</label>
                                    <select className="input" value={typeForm.unit} onChange={(e) => setTypeForm(f => ({ ...f, unit: e.target.value }))}>
                                        <option value="meter">Meter</option>
                                        <option value="kg">Kilogram</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Avg Shrinkage %</label>
                                    <input type="number" step="0.1" className="input" value={typeForm.avgShrinkagePct} onChange={(e) => setTypeForm(f => ({ ...f, avgShrinkagePct: Number(e.target.value) }))} min={0} max={100} />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddType(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createType.isPending}>{createType.isPending ? 'Creating...' : 'Add Type'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Color Modal */}
            {showAddColor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Color Variation</h2>
                            <button onClick={() => setShowAddColor(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitColor} className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={colorForm.colorName} onChange={(e) => setColorForm(f => ({ ...f, colorName: e.target.value }))} placeholder="e.g., Wildflower Blue" required />
                                </div>
                                <div>
                                    <label className="label">Standard Color</label>
                                    <select className="input" value={colorForm.standardColor} onChange={(e) => setColorForm(f => ({ ...f, standardColor: e.target.value }))}>
                                        <option value="">Select...</option>
                                        {STANDARD_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Color</label>
                                    <input type="color" className="input h-10" value={colorForm.colorHex} onChange={(e) => setColorForm(f => ({ ...f, colorHex: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select className="input" value={colorForm.supplierId} onChange={(e) => setColorForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Cost/Unit (₹)</label>
                                    <input type="number" className="input" value={colorForm.costPerUnit} onChange={(e) => setColorForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))} min={0} />
                                </div>
                                <div>
                                    <label className="label">Lead (days)</label>
                                    <input type="number" className="input" value={colorForm.leadTimeDays} onChange={(e) => setColorForm(f => ({ ...f, leadTimeDays: Number(e.target.value) }))} min={0} />
                                </div>
                                <div>
                                    <label className="label">Min Order</label>
                                    <input type="number" className="input" value={colorForm.minOrderQty} onChange={(e) => setColorForm(f => ({ ...f, minOrderQty: Number(e.target.value) }))} min={0} />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddColor(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createFabric.isPending}>{createFabric.isPending ? 'Creating...' : 'Add Color'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Fabric Inward</h2>
                            <button onClick={() => setShowInward(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: showInward.colorHex || '#ccc' }} />
                            <div>
                                <p className="font-medium">{showInward.colorName}</p>
                                <p className="text-xs text-gray-500">{showInward.fabricTypeName}</p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Quantity ({showInward.unit === 'kg' ? 'kg' : 'meters'})</label>
                                    <input type="number" step="0.1" className="input" value={inwardForm.qty} onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))} min={0.1} required />
                                </div>
                                <div>
                                    <label className="label">Price/Unit (₹)</label>
                                    <input type="number" step="0.01" className="input" value={inwardForm.costPerUnit} onChange={(e) => setInwardForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))} min={0} placeholder={showInward.costPerUnit?.toString() || '0'} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select className="input" value={inwardForm.supplierId} onChange={(e) => setInwardForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">Select supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <input className="input" value={inwardForm.notes} onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g., PO #1234, Invoice ref" />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowInward(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createInward.isPending}>{createInward.isPending ? 'Saving...' : 'Add to Inventory'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Supplier Modal */}
            {showAddSupplier && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Supplier</h2>
                            <button onClick={() => setShowAddSupplier(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitSupplier} className="space-y-4">
                            <div>
                                <label className="label">Supplier Name</label>
                                <input className="input" value={supplierForm.name} onChange={(e) => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., ABC Textiles" required />
                            </div>
                            <div>
                                <label className="label">Contact Name</label>
                                <input className="input" value={supplierForm.contactName} onChange={(e) => setSupplierForm(f => ({ ...f, contactName: e.target.value }))} placeholder="e.g., John Doe" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Email</label>
                                    <input type="email" className="input" value={supplierForm.email} onChange={(e) => setSupplierForm(f => ({ ...f, email: e.target.value }))} placeholder="email@supplier.com" />
                                </div>
                                <div>
                                    <label className="label">Phone</label>
                                    <input className="input" value={supplierForm.phone} onChange={(e) => setSupplierForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" />
                                </div>
                            </div>
                            <div>
                                <label className="label">Address</label>
                                <textarea className="input" rows={2} value={supplierForm.address} onChange={(e) => setSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address..." />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddSupplier(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createSupplier.isPending}>{createSupplier.isPending ? 'Creating...' : 'Add Supplier'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Fabric Detail Modal */}
            {showDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full border-2 border-gray-300" style={{ backgroundColor: showDetail.colorHex || '#ccc' }} />
                                <div>
                                    <h2 className="text-lg font-semibold">{showDetail.colorName}</h2>
                                    <p className="text-sm text-gray-500">{showDetail.fabricTypeName}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4">
                            <div className="bg-gray-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-gray-500">Current Balance</p>
                                <p className="text-base md:text-lg font-semibold">{showDetail.currentBalance?.toFixed(1) || 0} {showDetail.unit === 'kg' ? 'kg' : 'm'}</p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-green-600">Total Inward</p>
                                <p className="text-base md:text-lg font-semibold text-green-700">{showDetail.totalInward?.toFixed(1) || 0}</p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-red-600">Total Outward</p>
                                <p className="text-base md:text-lg font-semibold text-red-700">{showDetail.totalOutward?.toFixed(1) || 0}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-blue-600">Status</p>
                                <p className={`text-sm font-semibold ${showDetail.stockStatus === 'OK' ? 'text-green-600' : showDetail.stockStatus === 'ORDER SOON' ? 'text-yellow-600' : 'text-red-600'}`}>
                                    {showDetail.stockStatus || 'N/A'}
                                </p>
                            </div>
                        </div>

                        {/* Transactions List */}
                        <div className="flex-1 overflow-y-auto">
                            <h3 className="font-medium text-gray-700 mb-3">Transaction History</h3>
                            {txnLoading ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                                </div>
                            ) : transactions?.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">No transactions yet</div>
                            ) : (
                                <div className="space-y-2">
                                    {transactions?.map((txn: any) => (
                                        <div key={txn.id} className={`p-3 rounded-lg border ${txn.txnType === 'inward' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {txn.txnType === 'inward' ? (
                                                        <ArrowDownCircle size={20} className="text-green-600" />
                                                    ) : (
                                                        <ArrowUpCircle size={20} className="text-red-600" />
                                                    )}
                                                    <div>
                                                        <p className="font-medium">
                                                            {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} {txn.unit}
                                                            <span className="ml-2 text-xs text-gray-500 font-normal capitalize">
                                                                {txn.reason.replace(/_/g, ' ')}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <span>{new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                            {txn.supplier && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span>From: {txn.supplier.name}</span>
                                                                </>
                                                            )}
                                                            {txn.costPerUnit && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span>₹{txn.costPerUnit}/unit</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        {txn.notes && <p className="text-xs text-gray-600 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
                                                    </div>
                                                    {isAdmin && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete this ${txn.txnType} transaction of ${txn.qty} ${txn.unit}?`)) {
                                                                    deleteTransaction.mutate(txn.id);
                                                                }
                                                            }}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete transaction (admin only)"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 pt-4 mt-4 border-t">
                            <button onClick={() => setShowDetail(null)} className="btn-secondary flex-1">Close</button>
                            <button
                                onClick={() => { setShowInward({ ...showDetail }); setShowDetail(null); }}
                                className="btn-primary flex-1 flex items-center justify-center gap-2"
                            >
                                <Package size={16} /> Add Inward
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
