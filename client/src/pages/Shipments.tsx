/**
 * Shipments page - Post-shipment order management
 * Handles shipped, RTO, COD pending, and archived orders
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { RefreshCw, Archive } from 'lucide-react';
import { shopifyApi, trackingApi, ordersApi } from '../services/api';

// Custom hooks
import { useShipmentsData } from '../hooks/useShipmentsData';
import type { OrderTab } from '../hooks/useOrdersData';
import { useShipmentsMutations } from '../hooks/useShipmentsMutations';

// Components
import {
    ShippedOrdersGrid,
    RtoOrdersGrid,
    CodPendingGrid,
    ArchivedOrdersGrid,
    CustomerDetailModal,
    SummaryPanel,
    TrackingModal,
    UnifiedOrderModal,
    GlobalOrderSearch,
} from '../components/orders';
import type { Order } from '../types';

type ShipmentsTab = 'shipped' | 'rto' | 'cod-pending' | 'archived';

export default function Shipments() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    // Tab state - persisted in URL for back/forward navigation and refresh
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = (searchParams.get('tab') as ShipmentsTab) || 'shipped';
    const setTab = useCallback((newTab: ShipmentsTab) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('tab', newTab);
            return newParams;
        }, { replace: true }); // Use replace to avoid polluting browser history
    }, [setSearchParams]);

    // Shipped orders pagination state
    const [shippedPage, setShippedPage] = useState(1);
    const [shippedDays, setShippedDays] = useState(30);

    // Archived orders period and limit state (0 = all time)
    const [archivedDays, setArchivedDays] = useState(90);
    const [archivedLimit, setArchivedLimit] = useState(100);
    const [archivedSortBy, setArchivedSortBy] = useState<'orderDate' | 'archivedAt'>('archivedAt');

    // Modal state
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [unifiedModalOrder, setUnifiedModalOrder] = useState<Order | null>(null);
    const [unifiedModalMode, setUnifiedModalMode] = useState<'view' | 'edit'>('view');

    // Tracking modal state
    const [trackingAwb, setTrackingAwb] = useState<string | null>(null);
    const [trackingOrderNumber, setTrackingOrderNumber] = useState<string | null>(null);

    // Data hooks
    const {
        shippedOrders,
        shippedPagination,
        rtoOrders,
        rtoCount,
        codPendingOrders,
        codPendingCount,
        codPendingTotalAmount,
        archivedOrders,
        archivedCount,
        shippedSummary,
        loadingShippedSummary,
        rtoSummary,
        loadingRtoSummary,
        customerDetail,
        customerLoading,
        isLoading,
    } = useShipmentsData({ activeTab: tab, selectedCustomerId, shippedPage, shippedDays, archivedDays, archivedLimit, archivedSortBy });

    // Unified modal handlers
    const openUnifiedModal = useCallback((orderId: string, mode: 'view' | 'edit' = 'view') => {
        // Find the order in the current tab's data
        let order: Order | undefined;
        if (tab === 'shipped') {
            order = shippedOrders?.find((o: any) => o.id === orderId);
        } else if (tab === 'rto') {
            order = rtoOrders?.find((o: any) => o.id === orderId);
        } else if (tab === 'cod-pending') {
            order = codPendingOrders?.find((o: any) => o.id === orderId);
        } else if (tab === 'archived') {
            order = archivedOrders?.find((o: any) => o.id === orderId);
        }

        if (order) {
            setUnifiedModalOrder(order);
            setUnifiedModalMode(mode);
        }
    }, [tab, shippedOrders, rtoOrders, codPendingOrders, archivedOrders]);

    // Handler for grids that pass full order
    const handleViewOrder = useCallback((order: Order) => {
        setUnifiedModalOrder(order);
        setUnifiedModalMode('view');
    }, []);

    // Shopify config for external links
    const { data: shopifyConfig } = useQuery({
        queryKey: ['shopifyConfig'],
        queryFn: () => shopifyApi.getConfig().then(r => r.data),
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });

    // Mutations hook with callbacks
    const mutations = useShipmentsMutations({
        onEditSuccess: () => {
            setUnifiedModalOrder(null);
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

    // Timer ref for sync result cleanup
    const syncResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (syncResultTimerRef.current) {
                clearTimeout(syncResultTimerRef.current);
            }
        };
    }, []);

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
            queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
            queryClient.invalidateQueries({ queryKey: ['shippedSummary'] });
            queryClient.invalidateQueries({ queryKey: ['rtoOrders'] });
            queryClient.invalidateQueries({ queryKey: ['codPendingOrders'] });
            // Clear result after 5 seconds
            if (syncResultTimerRef.current) clearTimeout(syncResultTimerRef.current);
            syncResultTimerRef.current = setTimeout(() => setSyncResult(null), 5000);
        },
        onError: () => {
            setSyncResult({
                success: false,
                updated: 0,
                delivered: 0,
                rto: 0,
                errors: 1,
            });
            if (syncResultTimerRef.current) clearTimeout(syncResultTimerRef.current);
            syncResultTimerRef.current = setTimeout(() => setSyncResult(null), 5000);
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

    // Handler for GlobalOrderSearch - navigate to /orders for open/cancelled
    const handleSearchSelect = useCallback((orderId: string, selectedTab: OrderTab, page: 'orders' | 'shipments') => {
        if (page === 'orders') {
            // Navigate to orders page with the selected tab
            navigate(`/orders?tab=${selectedTab}&orderId=${orderId}`);
        } else {
            // Stay on shipments page, switch to the selected tab and open modal
            setTab(selectedTab as ShipmentsTab);
            // Fetch the order and open modal
            ordersApi.getAll({ view: selectedTab === 'cod-pending' ? 'cod_pending' : selectedTab, search: orderId.slice(0, 8) })
                .then(res => {
                    const order = res.data.orders?.find((o: Order) => o.id === orderId);
                    if (order) {
                        setUnifiedModalOrder(order);
                        setUnifiedModalMode('view');
                    }
                });
        }
    }, [navigate, setTab]);

    // Tab configuration for cleaner rendering
    const tabs = [
        { id: 'shipped' as const, label: 'Shipped', count: shippedPagination.total },
        { id: 'rto' as const, label: 'RTO', count: rtoCount, highlight: true },
        { id: 'cod-pending' as const, label: 'COD Pending', count: codPendingCount, highlight: true },
        { id: 'archived' as const, label: 'Archived', count: archivedCount },
    ];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Shipments</h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <GlobalOrderSearch
                        onSelectOrder={handleSearchSelect}
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Tab Navigation - Clean row */}
                <div className="flex items-center justify-between px-4 border-b border-gray-100">
                    <div className="flex overflow-x-auto -mb-px">
                        {tabs.map((t) => (
                            <button
                                key={t.id}
                                className={`relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                                    tab === t.id
                                        ? 'text-primary-600'
                                        : 'text-gray-500 hover:text-gray-700'
                                }`}
                                onClick={() => setTab(t.id)}
                            >
                                <span className="flex items-center gap-1.5">
                                    {t.label}
                                    {t.count > 0 && (
                                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                                            tab === t.id
                                                ? 'bg-primary-100 text-primary-700'
                                                : t.highlight
                                                    ? 'bg-amber-100 text-amber-700'
                                                    : 'bg-gray-100 text-gray-500'
                                        }`}>
                                            {t.count}
                                        </span>
                                    )}
                                </span>
                                {tab === t.id && (
                                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary-600 rounded-full" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tab-specific toolbar - Separate row */}
                {tab === 'shipped' && (
                    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50/80 border-b border-gray-100">
                        <select
                            value={shippedDays}
                            onChange={(e) => {
                                setShippedDays(Number(e.target.value));
                                setShippedPage(1);
                            }}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-200 focus:border-primary-300"
                        >
                            <option value={7}>Last 7 days</option>
                            <option value={14}>Last 14 days</option>
                            <option value={30}>Last 30 days</option>
                            <option value={60}>Last 60 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 180 days</option>
                            <option value={365}>Last 365 days</option>
                        </select>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => trackingSyncMutation.mutate()}
                                disabled={trackingSyncMutation.isPending}
                                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-all ${
                                    syncResult?.success
                                        ? 'bg-green-100 text-green-700'
                                        : syncResult && !syncResult.success
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-white border border-gray-200 hover:bg-gray-100 text-gray-600'
                                } disabled:opacity-50`}
                                title="Sync tracking status"
                            >
                                <RefreshCw size={12} className={trackingSyncMutation.isPending ? 'animate-spin' : ''} />
                                {trackingSyncMutation.isPending ? 'Syncing' : syncResult?.success ? `${syncResult.updated} synced` : 'Sync'}
                            </button>
                            <button
                                onClick={() => {
                                    if (confirm('Archive all delivered orders?')) {
                                        archivePrepaidMutation.mutate();
                                    }
                                }}
                                disabled={archivePrepaidMutation.isPending}
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-white border border-gray-200 hover:bg-gray-100 text-gray-600 disabled:opacity-50"
                            >
                                <Archive size={12} />
                                {archivePrepaidMutation.isPending ? 'Archiving' : 'Archive'}
                            </button>
                        </div>
                    </div>
                )}
                {tab === 'rto' && (
                    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50/80 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => trackingSyncMutation.mutate()}
                                disabled={trackingSyncMutation.isPending}
                                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-all ${
                                    syncResult?.success
                                        ? 'bg-green-100 text-green-700'
                                        : syncResult && !syncResult.success
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-white border border-gray-200 hover:bg-gray-100 text-gray-600'
                                } disabled:opacity-50`}
                                title="Sync tracking status"
                            >
                                <RefreshCw size={12} className={trackingSyncMutation.isPending ? 'animate-spin' : ''} />
                                {trackingSyncMutation.isPending ? 'Syncing' : syncResult?.success ? `${syncResult.updated} synced` : 'Sync'}
                            </button>
                        </div>
                    </div>
                )}
                {tab === 'cod-pending' && (
                    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50/80 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => trackingSyncMutation.mutate()}
                                disabled={trackingSyncMutation.isPending}
                                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-all ${
                                    syncResult?.success
                                        ? 'bg-green-100 text-green-700'
                                        : syncResult && !syncResult.success
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-white border border-gray-200 hover:bg-gray-100 text-gray-600'
                                } disabled:opacity-50`}
                                title="Sync tracking status"
                            >
                                <RefreshCw size={12} className={trackingSyncMutation.isPending ? 'animate-spin' : ''} />
                                {trackingSyncMutation.isPending ? 'Syncing' : syncResult?.success ? `${syncResult.updated} synced` : 'Sync'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Loading */}
                {isLoading && (
                    <div className="flex justify-center p-12">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                    </div>
                )}

                {/* Shipped Orders with Summary Panel and Grid */}
                {!isLoading && tab === 'shipped' && (
                <div className="p-4 space-y-4">
                    <SummaryPanel
                        type="shipped"
                        data={shippedSummary}
                        isLoading={loadingShippedSummary}
                    />
                    <ShippedOrdersGrid
                        orders={shippedOrders}
                        onUnship={(id) => mutations.unship.mutate(id)}
                        onMarkDelivered={(id) => mutations.markDelivered.mutate(id)}
                        onMarkRto={(id) => mutations.markRto.mutate(id)}
                        onArchive={(id) => mutations.archiveOrder.mutate(id)}
                        onViewOrder={handleViewOrder}
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
                </div>
                )}

                {/* RTO Orders */}
                {!isLoading && tab === 'rto' && (
                <div className="p-4 space-y-4">
                    <SummaryPanel
                        type="rto"
                        data={rtoSummary}
                        isLoading={loadingRtoSummary}
                    />
                    <RtoOrdersGrid
                        orders={rtoOrders}
                        onViewOrder={handleViewOrder}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        onTrack={(awb, orderNumber) => {
                            setTrackingAwb(awb);
                            setTrackingOrderNumber(orderNumber);
                        }}
                        shopDomain={shopifyConfig?.shopDomain}
                    />
                </div>
                )}

                {/* COD Pending Orders */}
                {!isLoading && tab === 'cod-pending' && (
                <div className="p-4 space-y-4">
                    {codPendingTotalAmount > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <span className="text-sm text-amber-800">
                                Total pending COD: <strong>₹{codPendingTotalAmount.toLocaleString()}</strong> from {codPendingCount} orders
                            </span>
                        </div>
                    )}
                    <CodPendingGrid
                        orders={codPendingOrders}
                        onViewOrder={handleViewOrder}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        onTrack={(awb, orderNumber) => {
                            setTrackingAwb(awb);
                            setTrackingOrderNumber(orderNumber);
                        }}
                        shopDomain={shopifyConfig?.shopDomain}
                    />
                </div>
                )}

                {/* Archived Orders Grid */}
                {!isLoading && tab === 'archived' && (
                <div className="p-4 space-y-4">
                    {/* Period selector */}
                    <div className="flex items-center gap-4">
                        <label className="text-sm text-gray-600">Period:</label>
                        <select
                            value={archivedDays}
                            onChange={(e) => setArchivedDays(Number(e.target.value))}
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                        >
                            <option value={30}>Last 30 days</option>
                            <option value={90}>Last 90 days</option>
                            <option value={180}>Last 6 months</option>
                            <option value={365}>Last year</option>
                            <option value={0}>All time</option>
                        </select>
                        <label className="text-sm text-gray-600">Load:</label>
                        <select
                            value={archivedLimit}
                            onChange={(e) => setArchivedLimit(Number(e.target.value))}
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                        >
                            <option value={100}>100 orders</option>
                            <option value={500}>500 orders</option>
                            <option value={1000}>1,000 orders</option>
                            <option value={2500}>2,500 orders</option>
                        </select>
                    </div>
                    <ArchivedOrdersGrid
                        orders={archivedOrders}
                        totalCount={archivedCount}
                        onRestore={(id) => mutations.unarchiveOrder.mutate(id)}
                        onViewOrder={handleViewOrder}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        isRestoring={mutations.unarchiveOrder.isPending}
                        shopDomain={shopifyConfig?.shopDomain}
                        sortBy={archivedSortBy}
                        onSortChange={setArchivedSortBy}
                        pageSize={archivedLimit}
                        onPageSizeChange={setArchivedLimit}
                    />
                </div>
                )}
            </div>

            {/* Modals */}
            {selectedCustomerId && (
                <CustomerDetailModal
                    customer={customerDetail}
                    isLoading={customerLoading}
                    onClose={() => setSelectedCustomerId(null)}
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

            {/* Unified Order Modal - for viewing and editing orders */}
            {unifiedModalOrder && (
                <UnifiedOrderModal
                    order={unifiedModalOrder}
                    initialMode={unifiedModalMode}
                    onClose={() => setUnifiedModalOrder(null)}
                    onSuccess={() => {
                        setUnifiedModalOrder(null);
                        // Invalidate queries to refresh data
                        queryClient.invalidateQueries({ queryKey: ['shippedOrders'] });
                        queryClient.invalidateQueries({ queryKey: ['rtoOrders'] });
                        queryClient.invalidateQueries({ queryKey: ['codPendingOrders'] });
                        queryClient.invalidateQueries({ queryKey: ['archivedOrders'] });
                    }}
                />
            )}
        </div>
    );
}
