import { useMemo, useCallback, useRef } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useUnifiedOrdersData } from '../hooks/useUnifiedOrdersData';
import { useOrdersMutations } from '../hooks/useOrdersMutations';
import { useOrderSSE } from '../hooks/useOrderSSE';
import { enrichRowsWithInventory } from '../utils/orderHelpers';
import { formatDate } from '../utils/agGridHelpers';
import type { DynamicColumnHandlers } from '../components/orders/OrdersTable/types';
import { ORDERS_PAGE_SIZE } from '../constants/queryKeys';

// Cell components (reused from main orders table)
import { ProductionCell } from '../components/orders/OrdersTable/cells/ProductionCell';
import { NotesCell } from '../components/orders/OrdersTable/cells/NotesCell';
import { QtyStockCell } from '../components/orders/OrdersTable/cells/QtyStockCell';
import { ShipByDateCell } from '../components/orders/OrdersTable/cells/ShipByDateCell';

const PAGE_SIZE = ORDERS_PAGE_SIZE;

const HEADERS = [
    { label: 'Date', width: 85 },
    { label: 'Order #', width: 90 },
    { label: 'Customer', width: 150 },
    { label: 'City', width: 100 },
    { label: 'Ship By', width: 100 },
    { label: 'Product', width: 180 },
    { label: 'Color', width: 80 },
    { label: 'Size', width: 50 },
    { label: 'Qty/Stock', width: 90 },
    { label: 'Status', width: 80 },
    { label: 'Production', width: 100 },
    { label: 'Notes', width: 140 },
    { label: 'Amount', width: 80 },
    { label: 'Payment', width: 65 },
];

export function OrdersSimplePage() {
    const search = useSearch({ strict: false }) as { page?: number };
    const page = search.page ?? 1;

    // SSE for real-time updates
    const { isConnected } = useOrderSSE({
        currentView: 'open',
        page: 1,
    });

    // Data fetching with inventory enrichment & SSE support
    const {
        rows: rawRows,
        inventoryBalance,
        fabricStock,
        lockedDates,
        isLoading,
    } = useUnifiedOrdersData({
        currentView: 'open',
        page: 1,
        isSSEConnected: isConnected,
    });

    // Enrich rows with live inventory data
    const allRows = useMemo(
        () => enrichRowsWithInventory(rawRows, inventoryBalance, fabricStock),
        [rawRows, inventoryBalance, fabricStock],
    );

    // Mutations (only CRUD, status, production — no fulfillment)
    const mutations = useOrdersMutations({
        currentView: 'open',
        page: 1,
    });

    // isDateLocked helper for ProductionCell
    const isDateLocked = useCallback(
        (date: string) => (lockedDates || []).includes(date),
        [lockedDates],
    );

    // Build handlersRef (mutable ref avoids re-renders while always having latest handlers)
    const handlersRef = useRef<DynamicColumnHandlers>({} as DynamicColumnHandlers);
    handlersRef.current = {
        allocatingLines: new Set(),
        isCancellingLine: false,
        isUncancellingLine: false,
        isCancellingOrder: false,
        isDeletingOrder: false,
        onCreateBatch: (data) => mutations.createBatch.mutate(data),
        onUpdateBatch: (id, data) => mutations.updateBatch.mutate({ id, data }),
        onDeleteBatch: (id) => mutations.deleteBatch.mutate(id),
        onUpdateLineNotes: (lineId, notes) => mutations.updateLineNotes.mutateAsync({ lineId, notes }),
        onViewOrder: () => {},
        onViewCustomer: () => {},
        onUpdateShipByDate: (orderId, date) => mutations.updateShipByDate.mutate({ orderId, date }),
        onSettled: () => mutations.invalidateAll(),
    };

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
                    Open Orders ({allRows.length} rows)
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
                                            search={{ view: 'open', page: 1, limit: 250, search: row.orderNumber }}
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
                                {/* Ship By */}
                                <td className="border border-gray-200 px-1 py-0.5">
                                    {row.isFirstLine ? (
                                        <ShipByDateCell row={row} handlersRef={handlersRef} />
                                    ) : ''}
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
                                {/* Qty/Stock */}
                                <td className="border border-gray-200 px-1 py-0.5">
                                    <QtyStockCell row={row} />
                                </td>
                                {/* Status (read-only badge) */}
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
                                {/* Production */}
                                <td className="border border-gray-200 px-1 py-0.5">
                                    <ProductionCell row={row} handlersRef={handlersRef} isDateLocked={isDateLocked} />
                                </td>
                                {/* Notes */}
                                <td className="border border-gray-200 px-1 py-0.5">
                                    <NotesCell row={row} handlersRef={handlersRef} />
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
