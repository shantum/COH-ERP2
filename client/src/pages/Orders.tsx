/**
 * Orders page - Main orchestrator component
 * Uses extracted hooks, utilities, and components for maintainability
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Search, Undo2, RefreshCw, Archive } from 'lucide-react';
import { shopifyApi, trackingApi, ordersApi } from '../services/api';

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
} from '../utils/orderHelpers';

// Components
import {
    OrdersGrid,
    ShippedOrdersGrid,
    ArchivedOrdersGrid,
    RtoOrdersGrid,
    CodPendingGrid,
    OrderDetailModal,
    OrderViewModal,
    CreateOrderModal,
    EditOrderModal,
    ShipOrderModal,
    NotesModal,
    CustomerDetailModal,
    SummaryPanel,
    TrackingModal,
} from '../components/orders';

export default function Orders() {
    const queryClient = useQueryClient();

    // Tab state
    const [tab, setTab] = useState<OrderTab>('open');

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState<'' | '14' | '30' | '60' | '90' | '180' | '365'>('14');

    // Shipped orders pagination state
    const [shippedPage, setShippedPage] = useState(1);
    const [shippedDays, setShippedDays] = useState(30);

    // Archived orders period state (0 = all time)
    const [archivedDays, setArchivedDays] = useState(90);
    const [archivedSortBy, setArchivedSortBy] = useState<'orderDate' | 'archivedAt'>('archivedAt');

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

    // Tracking modal state
    const [trackingAwb, setTrackingAwb] = useState<string | null>(null);
    const [trackingOrderNumber, setTrackingOrderNumber] = useState<string | null>(null);

    // Data hooks
    const {
        openOrders,
        shippedOrders,
        shippedPagination,
        rtoOrders,
        rtoTotalCount,
        codPendingOrders,
        codPendingTotalCount,
        codPendingTotalAmount,
        cancelledOrders,
        archivedOrders,
        archivedTotalCount,
        shippedSummary,
        loadingShippedSummary,
        allSkus,
        inventoryBalance,
        fabricStock,
        channels,
        lockedDates,
        customerDetail,
        customerLoading,
        isLoading,
    } = useOrdersData({ activeTab: tab, selectedCustomerId, shippedPage, shippedDays, archivedDays, archivedSortBy });

    // Shopify config for external links (needed for shipped, rto, cod-pending, and archived tabs)
    const { data: shopifyConfig } = useQuery({
        queryKey: ['shopifyConfig'],
        queryFn: () => shopifyApi.getConfig().then(r => r.data),
        enabled: tab === 'shipped' || tab === 'rto' || tab === 'cod-pending' || tab === 'archived',
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });

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

    // iThink sync state for real-time feedback
    const [syncResult, setSyncResult] = useState<{
        success: boolean;
        updated: number;
        delivered: number;
        rto: number;
        errors: number;
    } | null>(null);

    // Tracking sync mutation - uses the main triggerSync endpoint
    const trackingSyncMutation = useMutation({
        mutationFn: () => trackingApi.triggerSync(),
        onSuccess: (response) => {
            const result = response.data;
            setSyncResult({
                success: true,
                updated: result.updated || 0,
                delivered: result.delivered || 0,
                rto: result.rto || 0,
                errors: result.errors || 0,
            });
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
            queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
            queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
            queryClient.invalidateQueries({ queryKey: ['rtoOrders'] });
            queryClient.invalidateQueries({ queryKey: ['codPendingOrders'] });
            // Clear result after 5 seconds
            setTimeout(() => setSyncResult(null), 5000);
        },
        onError: () => {
            setSyncResult({
                success: false,
                updated: 0,
                delivered: 0,
                rto: 0,
                errors: 1,
            });
            setTimeout(() => setSyncResult(null), 5000);
        },
    });

    // Archive delivered orders mutation (prepaid + paid COD)
    const archivePrepaidMutation = useMutation({
        mutationFn: () => ordersApi.archiveDeliveredPrepaid(),
        onSuccess: (response) => {
            const result = response.data;
            const breakdown = [];
            if (result.prepaid > 0) breakdown.push(`${result.prepaid} prepaid`);
            if (result.cod > 0) breakdown.push(`${result.cod} COD`);
            const breakdownText = breakdown.length > 0 ? ` (${breakdown.join(', ')})` : '';
            alert(`Archive complete!\n${result.archived} orders archived${breakdownText}\nAvg delivery time: ${result.avgDaysToDeliver || 'N/A'} days`);
            queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
            queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
            queryClient.invalidateQueries({ queryKey: ['archivedOrders'] });
        },
        onError: (error: any) => {
            alert(`Archive failed: ${error.response?.data?.error || error.message}`);
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
    const { gridComponent, columnVisibilityDropdown, customHeaders, resetHeaders } = OrdersGrid({
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
        onDeleteOrder: (id) => mutations.deleteOrder.mutate(id),
        onCancelLine: (lineId) => mutations.cancelLine.mutate(lineId),
        onUncancelLine: (lineId) => mutations.uncancelLine.mutate(lineId),
        onSelectCustomer: setSelectedCustomerId,
        allocatingLines,
        shippingChecked,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isArchiving: mutations.archiveOrder.isPending,
        isDeletingOrder: mutations.deleteOrder.isPending,
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
                        className={`pb-2 font-medium ${tab === 'rto' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
                        onClick={() => setTab('rto')}
                    >
                        RTO{' '}
                        {rtoTotalCount > 0 && (
                            <span className="text-amber-600 ml-1">({rtoTotalCount})</span>
                        )}
                    </button>
                    <button
                        className={`pb-2 font-medium ${tab === 'cod-pending' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
                        onClick={() => setTab('cod-pending')}
                    >
                        COD Pending{' '}
                        {codPendingTotalCount > 0 && (
                            <span className="text-amber-600 ml-1">
                                ({codPendingTotalCount})
                            </span>
                        )}
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
                        Archived <span className="text-gray-400 ml-1">({archivedTotalCount || archivedOrders?.length || 0})</span>
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
                        <button
                            onClick={() => trackingSyncMutation.mutate()}
                            disabled={trackingSyncMutation.isPending}
                            className={`flex items-center gap-1 text-xs px-2 py-1 border rounded transition-all ${
                                syncResult?.success
                                    ? 'bg-green-50 border-green-300 text-green-700'
                                    : syncResult && !syncResult.success
                                    ? 'bg-red-50 border-red-300 text-red-700'
                                    : 'bg-white hover:bg-blue-50 hover:border-blue-300'
                            } disabled:opacity-50`}
                            title="Sync iThink tracking data for fulfilled orders with AWB"
                        >
                            <RefreshCw size={12} className={trackingSyncMutation.isPending ? 'animate-spin' : ''} />
                            {trackingSyncMutation.isPending ? (
                                'Syncing...'
                            ) : syncResult?.success ? (
                                `✓ ${syncResult.updated} updated`
                            ) : syncResult && !syncResult.success ? (
                                'Sync failed'
                            ) : (
                                'Sync iThink'
                            )}
                        </button>
                        {columnVisibilityDropdown}
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
                        <button
                            onClick={() => trackingSyncMutation.mutate()}
                            disabled={trackingSyncMutation.isPending}
                            className={`flex items-center gap-1 text-xs px-2 py-1 border rounded transition-all ${
                                syncResult?.success
                                    ? 'bg-green-50 border-green-300 text-green-700'
                                    : syncResult && !syncResult.success
                                    ? 'bg-red-50 border-red-300 text-red-700'
                                    : 'bg-white hover:bg-blue-50 hover:border-blue-300'
                            } disabled:opacity-50`}
                            title="Sync iThink tracking data for all orders with AWB"
                        >
                            <RefreshCw size={12} className={trackingSyncMutation.isPending ? 'animate-spin' : ''} />
                            {trackingSyncMutation.isPending ? (
                                'Syncing...'
                            ) : syncResult?.success ? (
                                `✓ ${syncResult.updated} updated${syncResult.delivered > 0 ? `, ${syncResult.delivered} delivered` : ''}`
                            ) : syncResult && !syncResult.success ? (
                                'Sync failed'
                            ) : (
                                'Sync iThink'
                            )}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm('Archive all delivered orders?\n\nThis will archive:\n• Prepaid orders marked as delivered\n• COD orders that are delivered AND paid')) {
                                    archivePrepaidMutation.mutate();
                                }
                            }}
                            disabled={archivePrepaidMutation.isPending}
                            className="flex items-center gap-1 text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                            title="Archive delivered prepaid orders and delivered+paid COD orders"
                        >
                            <Archive size={12} />
                            {archivePrepaidMutation.isPending ? 'Archiving...' : 'Archive Delivered'}
                        </button>
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

            {/* Shipped Orders with Summary Panel and Grid */}
            {!isLoading && tab === 'shipped' && (
                <>
                    <SummaryPanel
                        type="shipped"
                        data={shippedSummary}
                        isLoading={loadingShippedSummary}
                    />
                    <ShippedOrdersGrid
                        orders={filteredShippedOrders}
                        onUnship={(id) => mutations.unship.mutate(id)}
                        onMarkDelivered={(id) => mutations.markDelivered.mutate(id)}
                        onMarkRto={(id) => mutations.markRto.mutate(id)}
                        onArchive={(id) => mutations.archiveOrder.mutate(id)}
                        onViewOrder={(order) => setViewingOrderId(order.id)}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        onTrack={(awb, orderNumber) => {
                            setTrackingAwb(awb);
                            setTrackingOrderNumber(orderNumber);
                        }}
                        isUnshipping={mutations.unship.isPending}
                        isMarkingDelivered={mutations.markDelivered.isPending}
                        isMarkingRto={mutations.markRto.isPending}
                        isArchiving={mutations.archiveOrder.isPending}
                        shopDomain={shopifyConfig?.shopDomain}
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

            {/* RTO Orders */}
            {!isLoading && tab === 'rto' && (
                <RtoOrdersGrid
                    orders={rtoOrders}
                    onViewOrder={(order) => setViewingOrderId(order.id)}
                    onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                    onTrack={(awb, orderNumber) => {
                        setTrackingAwb(awb);
                        setTrackingOrderNumber(orderNumber);
                    }}
                    shopDomain={shopifyConfig?.shopDomain}
                />
            )}

            {/* COD Pending Orders */}
            {!isLoading && tab === 'cod-pending' && (
                <div className="space-y-4">
                    {codPendingTotalAmount > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <span className="text-sm text-amber-800">
                                Total pending COD: <strong>₹{codPendingTotalAmount.toLocaleString()}</strong> from {codPendingTotalCount} orders
                            </span>
                        </div>
                    )}
                    <CodPendingGrid
                        orders={codPendingOrders}
                        onViewOrder={(order) => setViewingOrderId(order.id)}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        onTrack={(awb, orderNumber) => {
                            setTrackingAwb(awb);
                            setTrackingOrderNumber(orderNumber);
                        }}
                        shopDomain={shopifyConfig?.shopDomain}
                    />
                </div>
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

            {/* Archived Orders Grid */}
            {!isLoading && tab === 'archived' && (
                <div className="space-y-4">
                    {/* Period selector */}
                    <div className="flex items-center gap-4">
                        <label className="text-sm text-gray-600">Period:</label>
                        <select
                            value={archivedDays}
                            onChange={(e) => setArchivedDays(Number(e.target.value))}
                            className="border rounded px-3 py-1.5 text-sm"
                        >
                            <option value={30}>Last 30 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 6 months</option>
                            <option value={365}>Last year</option>
                            <option value={0}>All time</option>
                        </select>
                        <span className="text-sm text-gray-500">
                            {archivedTotalCount.toLocaleString()} orders
                        </span>
                    </div>
                    <ArchivedOrdersGrid
                        orders={archivedOrders}
                        onRestore={(id) => mutations.unarchiveOrder.mutate(id)}
                        onViewOrder={(order) => setViewingOrderId(order.id)}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        isRestoring={mutations.unarchiveOrder.isPending}
                        shopDomain={shopifyConfig?.shopDomain}
                        sortBy={archivedSortBy}
                        onSortChange={setArchivedSortBy}
                    />
                </div>
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

            {trackingAwb && (
                <TrackingModal
                    awbNumber={trackingAwb}
                    orderNumber={trackingOrderNumber || undefined}
                    onClose={() => {
                        setTrackingAwb(null);
                        setTrackingOrderNumber(null);
                    }}
                />
            )}
        </div>
    );
}

// Order List Section (inline component for cancelled tab)
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
                                        className={`text-xs px-2 py-0.5 rounded ${order.status === 'cancelled'
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
