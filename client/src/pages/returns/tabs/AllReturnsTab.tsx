import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { getAllReturns } from '../../../server/functions/returns';
import { compactTheme, defaultColDef, formatDate, formatRelativeTime } from '../../../utils/agGridHelpers';
import { getStatusBadge, getResolutionBadge } from '../types';
import { RETURN_REASONS } from '@coh/shared/domain/returns';
import type { ActiveReturnLine } from '@coh/shared/schemas/returns';

ModuleRegistry.registerModules([AllCommunityModule]);

const STATUS_OPTIONS = [
    { value: '', label: 'All Statuses' },
    { value: 'requested', label: 'Requested' },
    { value: 'pickup_scheduled', label: 'Pickup Scheduled' },
    { value: 'in_transit', label: 'In Transit' },
    { value: 'received', label: 'Received' },
    { value: 'qc_inspected', label: 'QC Inspected' },
    { value: 'complete', label: 'Complete' },
    { value: 'cancelled', label: 'Cancelled' },
];

const RESOLUTION_OPTIONS = [
    { value: '', label: 'All Resolutions' },
    { value: 'refund', label: 'Refund' },
    { value: 'exchange', label: 'Exchange' },
    { value: 'rejected', label: 'Rejected' },
];

const PAGE_SIZE = 100;

export function AllReturnsTab() {
    const gridRef = useRef<AgGridReact>(null);
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');
    const [resolutionFilter, setResolutionFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchInput, setSearchInput] = useState('');

    const getAllReturnsFn = useServerFn(getAllReturns);
    const { data, isLoading } = useQuery({
        queryKey: ['returns', 'all', { page, status: statusFilter, resolution: resolutionFilter, search: searchTerm }],
        queryFn: () => getAllReturnsFn({
            data: {
                page,
                limit: PAGE_SIZE,
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(resolutionFilter ? { resolution: resolutionFilter } : {}),
                ...(searchTerm ? { search: searchTerm } : {}),
            },
        }),
        staleTime: 30_000,
    });

    const handleSearch = useCallback(() => {
        setSearchTerm(searchInput);
        setPage(1);
    }, [searchInput]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    }, [handleSearch]);

    const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

    const columnDefs = useMemo((): ColDef<ActiveReturnLine>[] => [
        {
            headerName: 'Order',
            field: 'orderNumber',
            width: 120,
            pinned: 'left' as const,
            cellRenderer: (params: ICellRendererParams<ActiveReturnLine>) => {
                if (!params.data) return null;
                return (
                    <a
                        href={`/orders?modal=view&orderId=${params.data.orderId}`}
                        className="text-blue-600 hover:underline font-medium"
                    >
                        {params.value}
                    </a>
                );
            },
        },
        {
            headerName: 'Batch',
            field: 'returnBatchNumber',
            width: 100,
            valueFormatter: (p: ValueFormatterParams) => p.value || '-',
        },
        {
            headerName: 'SKU',
            field: 'skuCode',
            width: 130,
            cellStyle: { fontFamily: 'monospace', fontSize: '11px' },
        },
        {
            headerName: 'Product',
            field: 'productName',
            width: 180,
            cellRenderer: (params: ICellRendererParams<ActiveReturnLine>) => {
                if (!params.data) return null;
                return (
                    <div className="leading-tight py-1">
                        <div className="text-xs font-medium truncate">{params.data.productName}</div>
                        <div className="text-[10px] text-gray-500">{params.data.colorName} / {params.data.size}</div>
                    </div>
                );
            },
        },
        {
            headerName: 'Qty',
            field: 'returnQty',
            width: 60,
            type: 'numericColumn',
        },
        {
            headerName: 'Status',
            field: 'returnStatus',
            width: 130,
            cellRenderer: (params: ICellRendererParams<ActiveReturnLine>) => {
                if (!params.value) return null;
                return (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusBadge(params.value)}`}>
                        {params.value.replace(/_/g, ' ')}
                    </span>
                );
            },
        },
        {
            headerName: 'Resolution',
            field: 'returnResolution',
            width: 100,
            cellRenderer: (params: ICellRendererParams<ActiveReturnLine>) => {
                const badge = getResolutionBadge(params.value || null);
                return (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${badge.color}`}>
                        {badge.label}
                    </span>
                );
            },
        },
        {
            headerName: 'QC',
            field: 'returnQcResult',
            width: 90,
            cellRenderer: (params: ICellRendererParams<ActiveReturnLine>) => {
                if (!params.value) return <span className="text-gray-400 text-xs">-</span>;
                const isApproved = params.value === 'approved';
                return (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                        isApproved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                        {isApproved ? 'Approved' : 'Written Off'}
                    </span>
                );
            },
        },
        {
            headerName: 'Reason',
            field: 'returnReasonCategory',
            width: 140,
            valueFormatter: (p: ValueFormatterParams) => {
                if (!p.value) return '-';
                return RETURN_REASONS[p.value as keyof typeof RETURN_REASONS] || p.value;
            },
        },
        {
            headerName: 'AWB',
            field: 'returnAwbNumber',
            width: 130,
            cellStyle: { fontFamily: 'monospace', fontSize: '11px' },
            valueFormatter: (p: ValueFormatterParams) => p.value || '-',
        },
        {
            headerName: 'Customer',
            field: 'customerName',
            width: 140,
        },
        {
            headerName: 'Requested',
            field: 'returnRequestedAt',
            width: 100,
            valueFormatter: (p: ValueFormatterParams) => formatDate(p.value),
        },
        {
            headerName: 'Age',
            field: 'returnRequestedAt',
            width: 80,
            colId: 'age',
            valueFormatter: (p: ValueFormatterParams) => formatRelativeTime(p.value),
        },
        {
            headerName: 'Refund',
            field: 'returnNetAmount',
            width: 90,
            type: 'numericColumn',
            valueFormatter: (p: ValueFormatterParams) => {
                if (p.value == null) return '-';
                return `\u20B9${Number(p.value).toLocaleString()}`;
            },
        },
        {
            headerName: 'Exchange',
            field: 'returnExchangeOrderId',
            width: 90,
            cellRenderer: (params: ICellRendererParams<ActiveReturnLine>) => {
                if (!params.value) return <span className="text-gray-400 text-xs">-</span>;
                return (
                    <a
                        href={`/orders?modal=view&orderId=${params.value}`}
                        className="text-blue-600 hover:underline text-xs flex items-center gap-1"
                    >
                        <ExternalLink size={10} />
                        View
                    </a>
                );
            },
        },
        {
            headerName: 'Notes',
            field: 'returnNotes',
            width: 150,
            valueFormatter: (p: ValueFormatterParams) => p.value || '',
        },
    ], []);

    return (
        <div className="space-y-4">
            {/* Filters Bar */}
            <div className="flex flex-col sm:flex-row gap-3 p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex-1 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search order, SKU, customer, AWB..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                    >
                        Search
                    </button>
                </div>
                <select
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                    {STATUS_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <select
                    value={resolutionFilter}
                    onChange={(e) => { setResolutionFilter(e.target.value); setPage(1); }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                    {RESOLUTION_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>

            {/* Grid */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 320px)', minHeight: '400px' }}>
                <AgGridReact<ActiveReturnLine>
                    ref={gridRef}
                    theme={compactTheme}
                    rowData={data?.items || []}
                    columnDefs={columnDefs}
                    loading={isLoading}
                    defaultColDef={defaultColDef}
                    animateRows={false}
                    suppressCellFocus={false}
                    getRowId={(params) => params.data.id}
                    pagination={false}
                    enableCellTextSelection={true}
                    ensureDomOrder={true}
                />
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-2 bg-white rounded-lg border border-gray-200">
                <div className="text-sm text-gray-600">
                    {data ? (
                        <>
                            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total.toLocaleString()} returns
                        </>
                    ) : (
                        'Loading...'
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm text-gray-600">
                        Page {page} of {totalPages || 1}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
