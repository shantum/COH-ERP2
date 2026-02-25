import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { getAllReturns } from '../../../server/functions/returns';
import { formatDate, formatRelativeTime } from '../../../utils/agGridHelpers';
import { getStatusBadge, getResolutionBadge } from '../types';
import { ReturnTrackingStatus } from '../ReturnTrackingStatus';
import { RETURN_REASONS } from '@coh/shared/domain/returns';
import type { ActiveReturnLine } from '@coh/shared/schemas/returns';

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
    const items = data?.items || [];

    return (
        <div className="space-y-4">
            {/* Filters */}
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

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr className="text-xs text-gray-500 font-medium">
                            <th className="text-left px-3 py-2.5">Order</th>
                            <th className="text-left px-3 py-2.5">Batch</th>
                            <th className="text-left px-3 py-2.5">SKU</th>
                            <th className="text-left px-3 py-2.5">Product</th>
                            <th className="text-right px-3 py-2.5">Qty</th>
                            <th className="text-left px-3 py-2.5">Status</th>
                            <th className="text-left px-3 py-2.5">Resolution</th>
                            <th className="text-left px-3 py-2.5">QC</th>
                            <th className="text-left px-3 py-2.5">Reason</th>
                            <th className="text-left px-3 py-2.5">AWB / Tracking</th>
                            <th className="text-left px-3 py-2.5">Customer</th>
                            <th className="text-left px-3 py-2.5">Requested</th>
                            <th className="text-left px-3 py-2.5">Age</th>
                            <th className="text-right px-3 py-2.5">Refund</th>
                            <th className="text-left px-3 py-2.5">Exchange</th>
                            <th className="text-left px-3 py-2.5">Notes</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {isLoading ? (
                            <tr>
                                <td colSpan={16} className="text-center py-12 text-gray-400">Loading...</td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={16} className="text-center py-12 text-gray-400">No returns found</td>
                            </tr>
                        ) : (
                            items.map((row) => <ReturnRow key={row.id} row={row} />)
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-2 bg-white rounded-lg border border-gray-200">
                <div className="text-sm text-gray-600">
                    {data ? (
                        <>Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total.toLocaleString()} returns</>
                    ) : 'Loading...'}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm text-gray-600">Page {page} of {totalPages || 1}</span>
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

function ReturnRow({ row }: { row: ActiveReturnLine }) {
    const badge = getResolutionBadge(row.returnResolution || null);
    const reason = row.returnReasonCategory
        ? (RETURN_REASONS[row.returnReasonCategory as keyof typeof RETURN_REASONS] || row.returnReasonCategory)
        : '-';

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                <a
                    href={`/orders?modal=view&orderId=${row.orderId}`}
                    className="text-blue-600 hover:underline font-medium"
                >
                    {row.orderNumber}
                </a>
            </td>
            <td className="px-3 py-2 text-gray-600">{row.returnBatchNumber || '-'}</td>
            <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.skuCode}</td>
            <td className="px-3 py-2">
                <div className="leading-tight">
                    <div className="text-xs font-medium truncate max-w-[180px]">{row.productName}</div>
                    <div className="text-[10px] text-gray-500">{row.colorName} / {row.size}</div>
                </div>
            </td>
            <td className="px-3 py-2 text-right">{row.returnQty}</td>
            <td className="px-3 py-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded whitespace-nowrap ${getStatusBadge(row.returnStatus)}`}>
                    {row.returnStatus.replace(/_/g, ' ')}
                </span>
            </td>
            <td className="px-3 py-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${badge.color}`}>
                    {badge.label}
                </span>
            </td>
            <td className="px-3 py-2">
                {row.returnQcResult ? (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                        row.returnQcResult === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                        {row.returnQcResult === 'approved' ? 'Approved' : 'Written Off'}
                    </span>
                ) : <span className="text-gray-400 text-xs">-</span>}
            </td>
            <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{reason}</td>
            <td className="px-3 py-2">
                {row.returnAwbNumber ? (
                    <div>
                        <div className="font-mono text-xs text-gray-600">{row.returnAwbNumber}</div>
                        {row.returnCourier && (
                            <div className="text-[10px] text-gray-400">{row.returnCourier}</div>
                        )}
                        <ReturnTrackingStatus awbNumber={row.returnAwbNumber} />
                    </div>
                ) : <span className="text-gray-400 text-xs">-</span>}
            </td>
            <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{row.customerName}</td>
            <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{formatDate(row.returnRequestedAt)}</td>
            <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{formatRelativeTime(row.returnRequestedAt)}</td>
            <td className="px-3 py-2 text-right text-xs">
                {row.returnNetAmount != null ? `₹${Number(row.returnNetAmount).toLocaleString()}` : '-'}
            </td>
            <td className="px-3 py-2">
                {row.returnExchangeOrderId ? (
                    <a
                        href={`/orders?modal=view&orderId=${row.returnExchangeOrderId}`}
                        className="text-blue-600 hover:underline text-xs flex items-center gap-1"
                    >
                        <ExternalLink size={10} />
                        View
                    </a>
                ) : <span className="text-gray-400 text-xs">-</span>}
            </td>
            <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[150px]">{row.returnNotes || ''}</td>
        </tr>
    );
}
