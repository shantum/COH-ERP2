/**
 * Orders page - Main orchestrator component
 * Uses extracted hooks, utilities, and components for maintainability
 */

import { useState, useMemo, useCallback } from 'react';
import { Plus, X, Search, ChevronDown, Undo2 } from 'lucide-react';

// Custom hooks
import { useOrdersData } from '../hooks/useOrdersData';
import type { OrderTab } from '../hooks/useOrdersData';
import { useOrdersMutations } from '../hooks/useOrdersMutations';

// Utilities
import {
    computeCustomerStats,
    flattenOrders,
    filterRows,
    parseCity,
    formatDateTime,
} from '../utils/orderHelpers';

// Components
import {
    OrdersGrid,
    OrderDetailModal,
    OrderViewModal,
    CreateOrderModal,
    EditOrderModal,
    ShipOrderModal,
    NotesModal,
    CustomerDetailModal,
} from '../components/orders';

export default function Orders() {
    // Tab state
    const [tab, setTab] = useState<OrderTab>('open');

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState<'' | '14' | '30' | '60' | '90' | '180' | '365'>('');

    // Shipped orders pagination state
    const [shippedPage, setShippedPage] = useState(1);
    const [shippedDays, setShippedDays] = useState(30);

    // Modal state
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    const [editingOrder, setEditingOrder] = useState<any>(null);
    const [notesOrder, setNotesOrder] = useState<any>(null);
    const [notesText, setNotesText] = useState('');
    const [pendingShipOrder, setPendingShipOrder] = useState<any>(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

    // Shipping form state
    const [shipForm, setShipForm] = useState({ awbNumber: '', courier: '' });
    const [shippingChecked, setShippingChecked] = useState<Set<string>>(new Set());
    const [allocatingLines, setAllocatingLines] = useState<Set<string>>(new Set());

    // Accordion state for shipped orders
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    // Data hooks
    const {
        openOrders,
        shippedOrders,
        shippedPagination,
        cancelledOrders,
        archivedOrders,
        allSkus,
        inventoryBalance,
        fabricStock,
        channels,
        lockedDates,
        customerDetail,
        customerLoading,
        isLoading,
    } = useOrdersData({ activeTab: tab, selectedCustomerId, shippedPage, shippedDays });

    // Mutations hook with callbacks
    const mutations = useOrdersMutations({
        onShipSuccess: () => {
            setSelectedOrder(null);
            setPendingShipOrder(null);
            setShipForm({ awbNumber: '', courier: '' });
            setShippingChecked(new Set());
        },
        onCreateSuccess: () => {
            setShowCreateOrder(false);
        },
        onDeleteSuccess: () => {
            setSelectedOrder(null);
        },
        onEditSuccess: () => {
            setEditingOrder(null);
        },
        onNotesSuccess: () => {
            setNotesOrder(null);
            setNotesText('');
        },
    });

    // Compute customer stats
    const customerStats = useMemo(
        () => computeCustomerStats(openOrders, shippedOrders),
        [openOrders, shippedOrders]
    );

    // Flatten and filter orders for grid
    const openRows = useMemo(
        () => flattenOrders(openOrders, customerStats, inventoryBalance, fabricStock),
        [openOrders, customerStats, inventoryBalance, fabricStock]
    );

    const filteredOpenRows = useMemo(
        () => filterRows(openRows, searchQuery, dateRange, tab === 'open'),
        [openRows, searchQuery, dateRange, tab]
    );

    const filteredShippedOrders = useMemo(() => {
        if (!searchQuery.trim()) return shippedOrders;
        return shippedOrders?.filter((order: any) =>
            order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [shippedOrders, searchQuery]);

    const uniqueOpenOrderCount = new Set(filteredOpenRows.map((r) => r.orderId)).size;

    // Handlers
    const handleShippingCheck = useCallback(
        (lineId: string, order: any) => {
            const newChecked = new Set(shippingChecked);
            if (newChecked.has(lineId)) {
                newChecked.delete(lineId);
            } else {
                newChecked.add(lineId);
            }
            setShippingChecked(newChecked);

            const orderLineIds = order.orderLines?.map((l: any) => l.id) || [];
            const allChecked = orderLineIds.every((id: string) => newChecked.has(id));
            if (allChecked && orderLineIds.length > 0) {
                setPendingShipOrder(order);
            }
        },
        [shippingChecked]
    );

    const handleAllocate = useCallback(
        (lineId: string) => {
            setAllocatingLines((p) => new Set(p).add(lineId));
            mutations.allocate.mutate(lineId, {
                onSettled: () =>
                    setAllocatingLines((p) => {
                        const n = new Set(p);
                        n.delete(lineId);
                        return n;
                    }),
            });
        },
        [mutations.allocate]
    );

    const handleUnallocate = useCallback(
        (lineId: string) => {
            setAllocatingLines((p) => new Set(p).add(lineId));
            mutations.unallocate.mutate(lineId, {
                onSettled: () =>
                    setAllocatingLines((p) => {
                        const n = new Set(p);
                        n.delete(lineId);
                        return n;
                    }),
            });
        },
        [mutations.unallocate]
    );

    const handlePick = useCallback(
        (lineId: string) => {
            setAllocatingLines((p) => new Set(p).add(lineId));
            mutations.pickLine.mutate(lineId, {
                onSettled: () =>
                    setAllocatingLines((p) => {
                        const n = new Set(p);
                        n.delete(lineId);
                        return n;
                    }),
            });
        },
        [mutations.pickLine]
    );

    const handleUnpick = useCallback(
        (lineId: string) => {
            setAllocatingLines((p) => new Set(p).add(lineId));
            mutations.unpickLine.mutate(lineId, {
                onSettled: () =>
                    setAllocatingLines((p) => {
                        const n = new Set(p);
                        n.delete(lineId);
                        return n;
                    }),
            });
        },
        [mutations.unpickLine]
    );

    // Grid component
    const { gridComponent, customHeaders, resetHeaders } = OrdersGrid({
        rows: filteredOpenRows,
        lockedDates: lockedDates || [],
        onAllocate: handleAllocate,
        onUnallocate: handleUnallocate,
        onPick: handlePick,
        onUnpick: handleUnpick,
        onShippingCheck: handleShippingCheck,
        onCreateBatch: (data) => mutations.createBatch.mutate(data),
        onUpdateBatch: (id, data) => mutations.updateBatch.mutate({ id, data }),
        onDeleteBatch: (id) => mutations.deleteBatch.mutate(id),
        onUpdateNotes: (id, notes) => mutations.updateOrderNotes.mutate({ id, notes }),
        onViewOrder: setViewingOrderId,
        onEditOrder: setEditingOrder,
        onCancelOrder: (id, reason) => mutations.cancelOrder.mutate({ id, reason }),
        onArchiveOrder: (id) => mutations.archiveOrder.mutate(id),
        onCancelLine: (lineId) => mutations.cancelLine.mutate(lineId),
        onUncancelLine: (lineId) => mutations.uncancelLine.mutate(lineId),
        onSelectCustomer: setSelectedCustomerId,
        allocatingLines,
        shippingChecked,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isArchiving: mutations.archiveOrder.isPending,
    });

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search order #..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 pr-3 py-1.5 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-gray-200"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={() => setShowCreateOrder(true)}
                        className="btn-primary flex items-center text-sm"
                    >
                        <Plus size={18} className="mr-1" />
                        New Order
                    </button>
                </div>
            </div>

            {/* Tabs and Date Filter */}
            <div className="flex items-center justify-between border-b">
                <div className="flex gap-4 text-sm">
                    <button
                        className={`pb-2 font-medium ${tab === 'open' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
                        onClick={() => setTab('open')}
                    >
                        Open{' '}
                        <span className="text-gray-400 ml-1">
                            ({searchQuery || dateRange ? `${uniqueOpenOrderCount}/` : ''}
                            {openOrders?.length || 0})
                        </span>
                    </button>
                    <button
                        className={`pb-2 font-medium ${tab === 'shipped' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
                        onClick={() => setTab('shipped')}
                    >
                        Shipped{' '}
                        <span className="text-gray-400 ml-1">
                            ({shippedPagination.total})
                        </span>
                    </button>
                    <button
                        className={`pb-2 font-medium ${tab === 'cancelled' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
                        onClick={() => setTab('cancelled')}
                    >
                        Cancelled <span className="text-gray-400 ml-1">({cancelledOrders?.length || 0})</span>
                    </button>
                    <button
                        className={`pb-2 font-medium ${tab === 'archived' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
                        onClick={() => setTab('archived')}
                    >
                        Archived <span className="text-gray-400 ml-1">({archivedOrders?.length || 0})</span>
                    </button>
                </div>
                {tab === 'open' && (
                    <div className="flex items-center gap-2 pb-2">
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
                            className="text-xs border rounded px-2 py-1 bg-white"
                        >
                            <option value="">All time</option>
                            <option value="14">Last 14 days</option>
                            <option value="30">Last 30 days</option>
                            <option value="60">Last 60 days</option>
                            <option value="90">Last 90 days</option>
                            <option value="180">Last 180 days</option>
                            <option value="365">Last 365 days</option>
                        </select>
                        {Object.keys(customHeaders).length > 0 && (
                            <button
                                onClick={resetHeaders}
                                className="text-xs text-gray-400 hover:text-gray-600"
                                title="Reset column headers to default"
                            >
                                Reset headers
                            </button>
                        )}
                    </div>
                )}
                {tab === 'shipped' && (
                    <div className="flex items-center gap-2 pb-2">
                        <select
                            value={shippedDays}
                            onChange={(e) => {
                                setShippedDays(Number(e.target.value));
                                setShippedPage(1);
                            }}
                            className="text-xs border rounded px-2 py-1 bg-white"
                        >
                            <option value={7}>Last 7 days</option>
                            <option value={14}>Last 14 days</option>
                            <option value={30}>Last 30 days</option>
                            <option value={60}>Last 60 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 180 days</option>
                            <option value={365}>Last 365 days</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex justify-center p-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                </div>
            )}

            {/* Open Orders Grid */}
            {!isLoading && tab === 'open' && filteredOpenRows.length > 0 && gridComponent}
            {!isLoading && tab === 'open' && filteredOpenRows.length === 0 && (
                <div className="text-center text-gray-400 py-12 border rounded">
                    {searchQuery || dateRange ? 'No orders match your filters' : 'No open orders'}
                </div>
            )}

            {/* Shipped Orders Accordion */}
            {!isLoading && tab === 'shipped' && (
                <>
                    <ShippedOrdersSection
                        orders={filteredShippedOrders}
                        expandedOrders={expandedOrders}
                        setExpandedOrders={setExpandedOrders}
                        onUnship={(id) => mutations.unship.mutate(id)}
                        isUnshipping={mutations.unship.isPending}
                        searchQuery={searchQuery}
                    />
                    {/* Pagination Controls */}
                    {shippedPagination.totalPages > 1 && (
                        <div className="flex items-center justify-between border-t pt-4 mt-4">
                            <div className="text-sm text-gray-500">
                                Showing {((shippedPage - 1) * 100) + 1} - {Math.min(shippedPage * 100, shippedPagination.total)} of {shippedPagination.total} orders
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShippedPage(1)}
                                    disabled={shippedPage === 1}
                                    className="px-2 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                                >
                                    First
                                </button>
                                <button
                                    onClick={() => setShippedPage(p => Math.max(1, p - 1))}
                                    disabled={shippedPage === 1}
                                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                                >
                                    Prev
                                </button>
                                <span className="px-3 py-1 text-sm">
                                    Page {shippedPage} of {shippedPagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setShippedPage(p => Math.min(shippedPagination.totalPages, p + 1))}
                                    disabled={shippedPage >= shippedPagination.totalPages}
                                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                                >
                                    Next
                                </button>
                                <button
                                    onClick={() => setShippedPage(shippedPagination.totalPages)}
                                    disabled={shippedPage >= shippedPagination.totalPages}
                                    className="px-2 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                                >
                                    Last
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Cancelled Orders */}
            {!isLoading && tab === 'cancelled' && (
                <OrderListSection
                    orders={cancelledOrders}
                    type="cancelled"
                    onRestore={(id) => mutations.uncancelOrder.mutate(id)}
                    isRestoring={mutations.uncancelOrder.isPending}
                />
            )}

            {/* Archived Orders */}
            {!isLoading && tab === 'archived' && (
                <OrderListSection
                    orders={archivedOrders}
                    type="archived"
                    onRestore={(id) => mutations.unarchiveOrder.mutate(id)}
                    isRestoring={mutations.unarchiveOrder.isPending}
                />
            )}

            {/* Modals */}
            {selectedOrder && (
                <OrderDetailModal
                    order={selectedOrder}
                    shipForm={shipForm}
                    onShipFormChange={setShipForm}
                    onShip={() => mutations.ship.mutate({ id: selectedOrder.id, data: shipForm })}
                    onDelete={() => mutations.deleteOrder.mutate(selectedOrder.id)}
                    onClose={() => setSelectedOrder(null)}
                    isShipping={mutations.ship.isPending}
                    isDeleting={mutations.deleteOrder.isPending}
                />
            )}

            {showCreateOrder && (
                <CreateOrderModal
                    allSkus={allSkus || []}
                    channels={channels || []}
                    inventoryBalance={inventoryBalance || []}
                    onCreate={(data) => mutations.createOrder.mutate(data)}
                    onClose={() => setShowCreateOrder(false)}
                    isCreating={mutations.createOrder.isPending}
                />
            )}

            {pendingShipOrder && (
                <ShipOrderModal
                    order={pendingShipOrder}
                    shipForm={shipForm}
                    onShipFormChange={setShipForm}
                    onShip={() => mutations.ship.mutate({ id: pendingShipOrder.id, data: shipForm })}
                    onClose={() => {
                        setPendingShipOrder(null);
                        setShipForm({ awbNumber: '', courier: '' });
                    }}
                    isShipping={mutations.ship.isPending}
                />
            )}

            {editingOrder && (
                <EditOrderModal
                    order={editingOrder}
                    allSkus={allSkus || []}
                    onUpdateOrder={(data) => mutations.updateOrder.mutate({ id: editingOrder.id, data })}
                    onUpdateLine={(lineId, data) => mutations.updateLine.mutate({ lineId, data })}
                    onAddLine={(orderId, data) => mutations.addLine.mutate({ orderId, data })}
                    onCancelLine={(lineId) => mutations.cancelLine.mutate(lineId)}
                    onUncancelLine={(lineId) => mutations.uncancelLine.mutate(lineId)}
                    onClose={() => setEditingOrder(null)}
                    isUpdating={mutations.updateOrder.isPending}
                    isAddingLine={mutations.addLine.isPending}
                />
            )}

            {notesOrder && (
                <NotesModal
                    order={notesOrder}
                    notesText={notesText}
                    onNotesChange={setNotesText}
                    onSave={() => mutations.updateOrderNotes.mutate({ id: notesOrder.id, notes: notesText })}
                    onClose={() => {
                        setNotesOrder(null);
                        setNotesText('');
                    }}
                    isSaving={mutations.updateOrderNotes.isPending}
                />
            )}

            {selectedCustomerId && (
                <CustomerDetailModal
                    customer={customerDetail}
                    isLoading={customerLoading}
                    onClose={() => setSelectedCustomerId(null)}
                />
            )}

            {viewingOrderId && (
                <OrderViewModal
                    orderId={viewingOrderId}
                    onClose={() => setViewingOrderId(null)}
                />
            )}
        </div>
    );
}

// Shipped Orders Section (inline component for shipped tab)
function ShippedOrdersSection({
    orders,
    expandedOrders,
    setExpandedOrders,
    onUnship,
    isUnshipping,
    searchQuery,
}: {
    orders: any[];
    expandedOrders: Set<string>;
    setExpandedOrders: (s: Set<string>) => void;
    onUnship: (id: string) => void;
    isUnshipping: boolean;
    searchQuery: string;
}) {
    if (!orders?.length) {
        return (
            <div className="text-center text-gray-400 py-12">
                {searchQuery ? 'No orders found' : 'No shipped orders'}
            </div>
        );
    }

    // Group orders by shipping date
    const groupedByDate: Record<string, any[]> = {};
    orders.forEach((order: any) => {
        const shipDate = order.shippedAt
            ? new Date(order.shippedAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
              })
            : 'Unknown';
        if (!groupedByDate[shipDate]) groupedByDate[shipDate] = [];
        groupedByDate[shipDate].push(order);
    });

    return (
        <div className="space-y-3">
            {Object.entries(groupedByDate).map(([shipDate, dateOrders]) => {
                const isDateExpanded = expandedOrders.has(shipDate);
                const totalItems = dateOrders.reduce(
                    (sum: number, o: any) => sum + (o.orderLines?.length || 0),
                    0
                );

                return (
                    <div key={shipDate} className="border rounded-lg overflow-hidden">
                        <div
                            className="flex items-center justify-between px-4 py-3 bg-gray-100 hover:bg-gray-200 cursor-pointer"
                            onClick={() => {
                                const newExpanded = new Set(expandedOrders);
                                isDateExpanded ? newExpanded.delete(shipDate) : newExpanded.add(shipDate);
                                setExpandedOrders(newExpanded);
                            }}
                        >
                            <div className="flex items-center gap-4">
                                <ChevronDown
                                    size={18}
                                    className={`text-gray-500 transition-transform ${isDateExpanded ? 'rotate-180' : ''}`}
                                />
                                <span className="text-gray-900 font-semibold">{shipDate}</span>
                                <span className="text-gray-500 text-sm">
                                    {dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''} •{' '}
                                    {totalItems} item{totalItems !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>

                        {isDateExpanded && (
                            <div className="divide-y">
                                {dateOrders.map((order: any) => {
                                    const dt = formatDateTime(order.orderDate);
                                    const isOrderExpanded = expandedOrders.has(order.id);

                                    return (
                                        <div key={order.id} className="bg-white">
                                            <div
                                                className="flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                                onClick={() => {
                                                    const newExpanded = new Set(expandedOrders);
                                                    isOrderExpanded
                                                        ? newExpanded.delete(order.id)
                                                        : newExpanded.add(order.id);
                                                    setExpandedOrders(newExpanded);
                                                }}
                                            >
                                                <div className="flex items-center gap-4">
                                                    <ChevronDown
                                                        size={14}
                                                        className={`text-gray-400 transition-transform ${isOrderExpanded ? 'rotate-180' : ''}`}
                                                    />
                                                    <span className="text-gray-600 font-mono text-xs">
                                                        {order.orderNumber}
                                                    </span>
                                                    <span className="text-gray-900">{order.customerName}</span>
                                                    <span className="text-gray-500 text-sm">
                                                        {parseCity(order.shippingAddress)}
                                                    </span>
                                                    <span className="text-gray-400 text-xs">
                                                        Ordered: {dt.date}
                                                    </span>
                                                    <span className="text-gray-400 text-xs">
                                                        • {order.orderLines?.length} item
                                                        {order.orderLines?.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {order.courier && (
                                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                            {order.courier}
                                                        </span>
                                                    )}
                                                    {order.awbNumber && (
                                                        <span className="text-xs font-mono text-gray-500">
                                                            {order.awbNumber}
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (
                                                                confirm(
                                                                    `Undo shipping for ${order.orderNumber}? This will move it back to open orders.`
                                                                )
                                                            ) {
                                                                onUnship(order.id);
                                                            }
                                                        }}
                                                        disabled={isUnshipping}
                                                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-orange-600"
                                                        title="Undo shipping"
                                                    >
                                                        <Undo2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                            {isOrderExpanded && (
                                                <table className="w-full text-sm">
                                                    <tbody>
                                                        {order.orderLines?.map((line: any) => (
                                                            <tr
                                                                key={line.id}
                                                                className="border-b border-gray-100 bg-white"
                                                            >
                                                                <td className="py-1.5 pl-12 pr-4 text-gray-700">
                                                                    {line.sku?.variation?.product?.name || '-'}
                                                                </td>
                                                                <td className="py-1.5 px-4 text-gray-600">
                                                                    {line.sku?.variation?.colorName || '-'}
                                                                </td>
                                                                <td className="py-1.5 px-4 text-gray-600">
                                                                    {line.sku?.size || '-'}
                                                                </td>
                                                                <td className="py-1.5 px-4 font-mono text-xs text-gray-500">
                                                                    {line.sku?.skuCode || '-'}
                                                                </td>
                                                                <td className="py-1.5 px-4 text-center w-16">
                                                                    {line.qty}
                                                                </td>
                                                                <td className="py-1.5 px-4 text-right text-gray-600 w-24">
                                                                    ₹{Number(line.unitPrice).toLocaleString()}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// Order List Section (inline component for cancelled/archived tabs)
function OrderListSection({
    orders,
    type,
    onRestore,
    isRestoring,
}: {
    orders: any[];
    type: 'cancelled' | 'archived';
    onRestore: (id: string) => void;
    isRestoring: boolean;
}) {
    if (!orders?.length) {
        return (
            <p className="text-center py-8 text-gray-400">
                No {type} orders
            </p>
        );
    }

    return (
        <div className="card divide-y">
            {orders.map((order: any) => (
                <div key={order.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-4">
                            <span className="text-gray-600 font-mono text-xs">{order.orderNumber}</span>
                            <span className="text-gray-900">{order.customerName}</span>
                            <span className="text-gray-500 text-sm">{parseCity(order.shippingAddress)}</span>
                            <span className="text-gray-400 text-xs">
                                {new Date(order.orderDate).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                })}
                            </span>
                            {type === 'cancelled' && (
                                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                                    Cancelled
                                </span>
                            )}
                            {type === 'archived' && (
                                <>
                                    <span
                                        className={`text-xs px-2 py-0.5 rounded ${
                                            order.status === 'cancelled'
                                                ? 'bg-red-100 text-red-700'
                                                : order.status === 'shipped' || order.status === 'delivered'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-amber-100 text-amber-700'
                                        }`}
                                    >
                                        {order.status === 'open'
                                            ? 'Was Open'
                                            : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                                    </span>
                                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                        Archived{' '}
                                        {order.archivedAt
                                            ? new Date(order.archivedAt).toLocaleDateString('en-IN', {
                                                  day: 'numeric',
                                                  month: 'short',
                                              })
                                            : ''}
                                    </span>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-gray-400 text-xs">
                                ₹{Number(order.totalAmount).toLocaleString()}
                            </span>
                            <button
                                onClick={() => {
                                    if (confirm(`Restore order ${order.orderNumber}?`)) {
                                        onRestore(order.id);
                                    }
                                }}
                                disabled={isRestoring}
                                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                                <Undo2 size={12} /> Restore
                            </button>
                        </div>
                    </div>
                    {order.internalNotes && (
                        <p className="text-xs text-gray-500 ml-4 mt-1">{order.internalNotes}</p>
                    )}
                    <div className="text-xs text-gray-500 mt-2">
                        {order.orderLines?.map((line: any) => (
                            <span key={line.id} className="mr-3">
                                {line.sku?.variation?.product?.name} ({line.sku?.size}) x{line.qty}
                            </span>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
