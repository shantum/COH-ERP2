import { useMemo } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useUnifiedOrdersData } from '../hooks/useUnifiedOrdersData';
import { useOrderSSE } from '../hooks/useOrderSSE';
import { formatDate } from '../utils/agGridHelpers';
import { ORDERS_PAGE_SIZE } from '../constants/queryKeys';

const PAGE_SIZE = ORDERS_PAGE_SIZE;

const HEADERS = [
    { label: 'Date', width: 85 },
    { label: 'Order #', width: 90 },
    { label: 'Customer', width: 150 },
    { label: 'City', width: 100 },
    { label: 'Product', width: 180 },
    { label: 'Color', width: 80 },
    { label: 'Size', width: 50 },
    { label: 'Qty', width: 50 },
    { label: 'Price', width: 80 },
    { label: 'Status', width: 80 },
    { label: 'Notes', width: 140 },
    { label: 'Amount', width: 80 },
    { label: 'Payment', width: 65 },
];

export function OrdersSimplePage() {
    const search = useSearch({ strict: false }) as { page?: number };
    const page = search.page ?? 1;

    // SSE for real-time updates
    const { isConnected } = useOrderSSE({
        currentView: 'all',
        page: 1,
    });

    // Data fetching
    const {
        rows: allRows,
        isLoading,
    } = useUnifiedOrdersData({
        currentView: 'all',
        page: 1,
        isSSEConnected: isConnected,
    });

    // Client-side pagination
    const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const pagedRows = useMemo(
        () => allRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        [allRows, currentPage],
    );

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center font-mono text-xs text-gray-500">
                Loading...
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col font-mono text-xs">
            {/* Header bar */}
            <div className="flex items-center justify-between border-b bg-white px-3 py-2">
                <span className="font-semibold">
                    All Orders ({allRows.length} rows)
                </span>
                <div className="flex items-center gap-3">
                    <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-400'}`} />
                    <span className="text-gray-500">
                        Page {currentPage} / {totalPages}
                    </span>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-gray-100">
                        <tr>
                            {HEADERS.map((h) => (
                                <th
                                    key={h.label}
                                    className="border border-gray-300 px-2 py-1 text-left font-semibold"
                                    style={{ width: h.width, minWidth: h.width }}
                                >
                                    {h.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {pagedRows.map((row, i) => (
                            <tr
                                key={row.lineId || i}
                                className={`${
                                    row.isFirstLine
                                        ? 'border-t-2 border-t-gray-400'
                                        : ''
                                } even:bg-gray-50`}
                            >
                                {/* Date */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.isFirstLine ? formatDate(row.orderDate) : ''}
                                </td>
                                {/* Order # */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.isFirstLine ? (
                                        <Link
                                            to="/orders"
                                            search={{ view: 'all', page: 1, limit: 250, search: row.orderNumber }}
                                            className="text-blue-700 underline"
                                        >
                                            {row.orderNumber}
                                        </Link>
                                    ) : ''}
                                </td>
                                {/* Customer */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.isFirstLine ? row.customerName : ''}
                                </td>
                                {/* City */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.isFirstLine ? row.city : ''}
                                </td>
                                {/* Product */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.productName}
                                </td>
                                {/* Color */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.colorName}
                                </td>
                                {/* Size */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.size}
                                </td>
                                {/* Qty */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.qty}
                                </td>
                                {/* Price */}
                                <td className="border border-gray-200 px-2 py-1 text-right">
                                    {row.unitPrice > 0 ? `\u20B9${row.unitPrice.toLocaleString('en-IN')}` : '-'}
                                </td>
                                {/* Status */}
                                <td className="border border-gray-200 px-2 py-1">
                                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                        row.lineStatus === 'shipped' ? 'bg-green-100 text-green-700' :
                                        row.lineStatus === 'cancelled' ? 'bg-red-100 text-red-600' :
                                        row.lineStatus === 'packed' ? 'bg-purple-100 text-purple-700' :
                                        row.lineStatus === 'picked' ? 'bg-blue-100 text-blue-700' :
                                        row.lineStatus === 'allocated' ? 'bg-cyan-100 text-cyan-700' :
                                        'bg-amber-100 text-amber-700'
                                    }`}>
                                        {row.lineStatus}
                                    </span>
                                </td>
                                {/* Notes */}
                                <td className="border border-gray-200 px-2 py-1 truncate max-w-[140px]">
                                    {row.lineNotes || '-'}
                                </td>
                                {/* Amount */}
                                <td className="border border-gray-200 px-2 py-1 text-right">
                                    {row.isFirstLine
                                        ? (row.totalAmount != null
                                            ? row.totalAmount.toLocaleString('en-IN')
                                            : '-')
                                        : ''}
                                </td>
                                {/* Payment */}
                                <td className="border border-gray-200 px-2 py-1">
                                    {row.isFirstLine ? (row.paymentMethod ?? '-') : ''}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 border-t bg-white px-3 py-2">
                    {currentPage > 1 ? (
                        <Link
                            to="/orders-simple"
                            search={{ page: currentPage - 1 }}
                            className="rounded border px-3 py-1"
                        >
                            Prev
                        </Link>
                    ) : (
                        <span className="rounded border px-3 py-1 opacity-40">Prev</span>
                    )}
                    <span>
                        {currentPage} / {totalPages}
                    </span>
                    {currentPage < totalPages ? (
                        <Link
                            to="/orders-simple"
                            search={{ page: currentPage + 1 }}
                            className="rounded border px-3 py-1"
                        >
                            Next
                        </Link>
                    ) : (
                        <span className="rounded border px-3 py-1 opacity-40">Next</span>
                    )}
                </div>
            )}
        </div>
    );
}
