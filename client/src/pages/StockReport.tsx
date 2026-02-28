/**
 * Stock Report Page
 *
 * Monthly accounting-style view: Opening + Inward - Outward = Closing
 * with reason breakdowns per SKU, product rollup, and summary cards.
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { Route } from '../routes/_authenticated/stock-report';
import {
    getMonthlySnapshot,
    getSnapshotSummary,
    type SnapshotRow,
} from '../server/functions/stockSnapshots';
import {
    ChevronLeft,
    ChevronRight,
    Search,
    Package,
    TrendingUp,
    TrendingDown,
    Warehouse,
    RefreshCw,
    Radio,
} from 'lucide-react';
import { startBackgroundJob } from '../server/functions/admin';
import { usePermissions } from '../hooks/usePermissions';

ModuleRegistry.registerModules([AllCommunityModule]);

// ============================================
// HELPERS
// ============================================

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatNumber(n: number): string {
    return n.toLocaleString('en-IN');
}

function isCurrentMonthIST(year: number, month: number): boolean {
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return istNow.getUTCFullYear() === year && istNow.getUTCMonth() + 1 === month;
}

function getDefaultYearMonth(): { year: number; month: number } {
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return { year: istNow.getUTCFullYear(), month: istNow.getUTCMonth() + 1 };
}

const REASON_LABELS: Record<string, string> = {
    production: 'Production',
    return_receipt: 'Returns',
    rto_received: 'RTO Received',
    adjustment: 'Adjustment',
    transfer: 'Transfer',
    order_allocation: 'Orders',
    sale: 'Sale',
    damage: 'Damage',
    write_off: 'Write Off',
    unknown: 'Other',
};

function reasonLabel(reason: string): string {
    return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const DEFAULT_COL_DEF = {
    sortable: true,
    resizable: true,
    suppressMovable: false,
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function StockReport() {
    const navigate = useNavigate();
    const loaderData = Route.useLoaderData();
    const search = Route.useSearch();
    const { isOwner } = usePermissions();
    const gridRef = useRef<AgGridReact>(null);
    const startJobFn = useServerFn(startBackgroundJob);

    // Derive year/month from search params (or default to current)
    const defaults = getDefaultYearMonth();
    const year = search.year ?? defaults.year;
    const month = search.month ?? defaults.month;
    const isLive = isCurrentMonthIST(year, month);

    const [searchText, setSearchText] = useState(search.search ?? '');
    const [refreshing, setRefreshing] = useState(false);

    // Fetch snapshot data (uses loader data as initial)
    const snapshotQuery = useQuery({
        queryKey: ['stock-report', 'snapshot', year, month, search.search, search.category, search.rollup, search.page, search.limit],
        queryFn: () => getMonthlySnapshot({
            data: {
                year,
                month,
                ...(search.search ? { search: search.search } : {}),
                ...(search.category ? { category: search.category } : {}),
                rollup: search.rollup,
                page: search.page,
                limit: search.limit,
            },
        }),
        initialData: loaderData.snapshot ?? undefined,
        staleTime: isLive ? 30_000 : 5 * 60_000, // Live = 30s, saved = 5min
    });

    const summaryQuery = useQuery({
        queryKey: ['stock-report', 'summary', year, month],
        queryFn: () => getSnapshotSummary({ data: { year, month } }),
        initialData: loaderData.summary ?? undefined,
        staleTime: isLive ? 30_000 : 5 * 60_000,
    });

    const snapshot = snapshotQuery.data;
    const summary = summaryQuery.data;
    const items = snapshot?.items ?? [];

    // Navigation
    const updateSearch = useCallback((updates: Partial<typeof search>) => {
        navigate({
            to: '/stock-report',
            search: { ...search, page: 1, ...updates },
        });
    }, [navigate, search]);

    const goToPrevMonth = useCallback(() => {
        const m = month === 1 ? 12 : month - 1;
        const y = month === 1 ? year - 1 : year;
        navigate({ to: '/stock-report', search: { ...search, year: y, month: m, page: 1 } });
    }, [year, month, navigate, search]);

    const goToNextMonth = useCallback(() => {
        if (isLive) return;
        const m = month === 12 ? 1 : month + 1;
        const y = month === 12 ? year + 1 : year;
        navigate({ to: '/stock-report', search: { ...search, year: y, month: m, page: 1 } });
    }, [year, month, isLive, navigate, search]);

    const handleSearch = useCallback(() => {
        updateSearch({ search: searchText || undefined });
    }, [searchText, updateSearch]);

    const handleRefresh = useCallback(async () => {
        if (!isOwner) return;
        setRefreshing(true);
        try {
            await startJobFn({ data: { jobId: 'snapshot_compute' } });
            // Refetch after compute
            await Promise.all([snapshotQuery.refetch(), summaryQuery.refetch()]);
        } finally {
            setRefreshing(false);
        }
    }, [isOwner, startJobFn, snapshotQuery, summaryQuery]);

    // AG-Grid column definitions
    const columnDefs = useMemo((): ColDef<SnapshotRow>[] => {
        // Determine which inward/outward reasons exist in the data
        const inwardReasons = new Set<string>();
        const outwardReasons = new Set<string>();
        for (const item of items) {
            for (const k of Object.keys(item.inwardBreakdown)) inwardReasons.add(k);
            for (const k of Object.keys(item.outwardBreakdown)) outwardReasons.add(k);
        }

        const cols: ColDef<SnapshotRow>[] = [
            {
                headerName: 'SKU',
                field: 'skuCode',
                width: 160,
                pinned: 'left' as const,
                cellStyle: { fontWeight: 600, fontSize: '12px' },
            },
            {
                headerName: 'Product',
                field: 'productName',
                width: 180,
                hide: search.rollup === 'product',
            },
            {
                headerName: 'Color',
                field: 'colorName',
                width: 120,
                hide: search.rollup === 'product',
            },
            {
                headerName: 'Size',
                field: 'size',
                width: 70,
                hide: search.rollup === 'product',
            },
            {
                headerName: 'Opening',
                field: 'openingStock',
                width: 95,
                type: 'numericColumn',
                valueFormatter: p => formatNumber(p.value ?? 0),
                cellStyle: { color: '#6b7280' },
            },
        ];

        // Inward reason columns
        for (const reason of inwardReasons) {
            cols.push({
                headerName: `+ ${reasonLabel(reason)}`,
                width: 100,
                type: 'numericColumn',
                valueGetter: p => p.data?.inwardBreakdown[reason] ?? 0,
                valueFormatter: p => p.value ? `+${formatNumber(p.value)}` : '',
                cellStyle: { color: '#16a34a', fontSize: '11px' },
            });
        }

        cols.push({
            headerName: 'Total In',
            field: 'totalInward',
            width: 90,
            type: 'numericColumn',
            valueFormatter: p => p.value ? `+${formatNumber(p.value)}` : '0',
            cellStyle: { fontWeight: 600, color: '#16a34a' },
        });

        // Outward reason columns
        for (const reason of outwardReasons) {
            cols.push({
                headerName: `- ${reasonLabel(reason)}`,
                width: 100,
                type: 'numericColumn',
                valueGetter: p => p.data?.outwardBreakdown[reason] ?? 0,
                valueFormatter: p => p.value ? `-${formatNumber(p.value)}` : '',
                cellStyle: { color: '#dc2626', fontSize: '11px' },
            });
        }

        cols.push({
            headerName: 'Total Out',
            field: 'totalOutward',
            width: 95,
            type: 'numericColumn',
            valueFormatter: p => p.value ? `-${formatNumber(p.value)}` : '0',
            cellStyle: { fontWeight: 600, color: '#dc2626' },
        });

        cols.push({
            headerName: 'Closing',
            field: 'closingStock',
            width: 95,
            pinned: 'right' as const,
            type: 'numericColumn',
            valueFormatter: p => formatNumber(p.value ?? 0),
            cellStyle: (p) => ({
                fontWeight: 700,
                color: (p.value ?? 0) < 0 ? '#dc2626' : '#1e40af',
            }),
        });

        return cols;
    }, [items, search.rollup]);

    const totalPages = snapshot ? Math.ceil(snapshot.total / snapshot.limit) : 1;

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-semibold text-gray-900">Stock Report</h1>
                    {isLive && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            <Radio className="w-3 h-3" />
                            Live
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Month navigation */}
                    <button
                        onClick={goToPrevMonth}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Previous month"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-medium text-gray-700 min-w-[120px] text-center">
                        {MONTH_NAMES[month - 1]} {year}
                    </span>
                    <button
                        onClick={goToNextMonth}
                        disabled={isLive}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Next month"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>

                    {/* Refresh (admin only) */}
                    {isOwner && (
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="ml-2 p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Recompute last month snapshot"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                </div>
            </div>

            {/* Summary Cards */}
            {summary && (
                <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50/50">
                    <SummaryCard
                        label="Opening"
                        value={summary.totalOpening}
                        icon={<Warehouse className="w-4 h-4" />}
                        color="gray"
                    />
                    <SummaryCard
                        label="Inward"
                        value={summary.totalInward}
                        prefix="+"
                        icon={<TrendingUp className="w-4 h-4" />}
                        color="green"
                    />
                    <SummaryCard
                        label="Outward"
                        value={summary.totalOutward}
                        prefix="-"
                        icon={<TrendingDown className="w-4 h-4" />}
                        color="red"
                    />
                    <SummaryCard
                        label="Closing"
                        value={summary.totalClosing}
                        icon={<Package className="w-4 h-4" />}
                        color="blue"
                    />
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-100 bg-white">
                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search SKU or product..."
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Rollup toggle */}
                <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden">
                    <button
                        onClick={() => updateSearch({ rollup: 'sku' })}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            search.rollup === 'sku'
                                ? 'bg-gray-900 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        SKU
                    </button>
                    <button
                        onClick={() => updateSearch({ rollup: 'product' })}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            search.rollup === 'product'
                                ? 'bg-gray-900 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        Product
                    </button>
                </div>

                {/* Result count + pagination */}
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-gray-500">
                        {snapshot ? `${formatNumber(snapshot.total)} ${search.rollup === 'product' ? 'products' : 'SKUs'}` : ''}
                    </span>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => updateSearch({ page: Math.max(1, search.page - 1) })}
                                disabled={search.page <= 1}
                                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-xs text-gray-500">
                                {search.page}/{totalPages}
                            </span>
                            <button
                                onClick={() => updateSearch({ page: Math.min(totalPages, search.page + 1) })}
                                disabled={search.page >= totalPages}
                                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Error state */}
            {loaderData.error && (
                <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
                    {loaderData.error}
                </div>
            )}

            {/* AG-Grid */}
            <div className="flex-1 px-6 py-3 overflow-auto">
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <AgGridReact<SnapshotRow>
                        ref={gridRef}
                        theme={compactThemeSmall}
                        rowData={items}
                        columnDefs={columnDefs}
                        loading={snapshotQuery.isLoading}
                        domLayout="autoHeight"
                        defaultColDef={DEFAULT_COL_DEF}
                        getRowId={(params) => params.data.skuId}
                        animateRows={false}
                        suppressCellFocus
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================
// SUMMARY CARD
// ============================================

const COLOR_MAP = {
    gray: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', icon: 'text-gray-500' },
    green: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'text-emerald-500' },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-500' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-500' },
} as const;

function SummaryCard({
    label,
    value,
    prefix = '',
    icon,
    color,
}: {
    label: string;
    value: number;
    prefix?: string;
    icon: React.ReactNode;
    color: keyof typeof COLOR_MAP;
}) {
    const c = COLOR_MAP[color];
    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${c.bg} ${c.border} shadow-sm`}>
            <div className={c.icon}>{icon}</div>
            <div>
                <div className={`text-xl font-bold ${c.text} leading-none`}>
                    {prefix}{formatNumber(value)}
                </div>
                <div className={`text-xs ${c.icon} mt-0.5`}>{label}</div>
            </div>
        </div>
    );
}
