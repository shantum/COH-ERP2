/**
 * Orders page - Unified order management with dropdown view selector
 * Views: Open, Shipped, RTO, COD Pending, Cancelled, Archived
 */

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Send, ChevronDown, Archive, ChevronLeft, ChevronRight } from 'lucide-react';

// Custom hooks
import { useUnifiedOrdersData, type OrderView } from '../hooks/useUnifiedOrdersData';
import { useOrdersMutations } from '../hooks/useOrdersMutations';
import { useAuth } from '../hooks/useAuth';

// Utilities
import {
    computeCustomerStats,
    flattenOrders,
    filterRows,
} from '../utils/orderHelpers';

// Components
import {
    OrdersGrid,
    CreateOrderModal,
    CustomerDetailModal,
    CustomizationModal,
    UnifiedOrderModal,
    GlobalOrderSearch,
} from '../components/orders';
import { GridPreferencesToolbar } from '../components/common/grid';
import type { Order } from '../types';

// View configuration
const VIEW_CONFIG: Record<OrderView, { label: string; color: string }> = {
    open: { label: 'Open Orders', color: 'primary' },
    shipped: { label: 'Shipped', color: 'blue' },
    rto: { label: 'RTO', color: 'red' },
    cod_pending: { label: 'COD Pending', color: 'amber' },
    cancelled: { label: 'Cancelled', color: 'gray' },
    archived: { label: 'Archived', color: 'gray' },
};

export default function Orders() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    // View and page state - persisted in URL
    const [searchParams, setSearchParams] = useSearchParams();
    const view = (searchParams.get('view') as OrderView) || 'open';
    const page = parseInt(searchParams.get('page') || '1', 10);

    const setView = useCallback((newView: OrderView) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('view', newView);
            newParams.set('page', '1'); // Reset to page 1 on view change
            return newParams;
        }, { replace: true });
    }, [setSearchParams]);

    const setPage = useCallback((newPage: number) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', String(newPage));
            return newParams;
        }, { replace: true });
    }, [setSearchParams]);

    // Filter state (Open view only)
    const [dateRange, setDateRange] = useState<'' | '14' | '30' | '60' | '90' | '180' | '365'>('14');
    const [allocatedFilter, setAllocatedFilter] = useState<'' | 'yes' | 'no'>('');
    const [productionFilter, setProductionFilter] = useState<'' | 'scheduled' | 'needs' | 'ready'>('');

    // Modal state
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [unifiedModalOrder, setUnifiedModalOrder] = useState<Order | null>(null);
    const [unifiedModalMode, setUnifiedModalMode] = useState<'view' | 'edit' | 'ship'>('view');

    // Optimistic updates handle button state
    const allocatingLines = new Set<string>();

    // Customization modal state
    const [customizingLine, setCustomizingLine] = useState<{
        lineId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        qty: number;
    } | null>(null);
    const [isEditingCustomization, setIsEditingCustomization] = useState(false);
    const [customizationInitialData, setCustomizationInitialData] = useState<{
        type: string;
        value: string;
        notes?: string;
    } | null>(null);

    // Data hook - simplified, single view with pagination
    const {
        orders,
        pagination,
        allSkus,
        inventoryBalance,
        fabricStock,
        channels,
        lockedDates,
        customerDetail,
        customerLoading,
        isLoading,
        isFetching,
        refetch,
    } = useUnifiedOrdersData({
        currentView: view,
        page,
        selectedCustomerId,
    });

    // Modal handlers
    const openUnifiedModal = useCallback((order: Order, mode: 'view' | 'edit' | 'ship' = 'view') => {
        setUnifiedModalOrder(order);
        setUnifiedModalMode(mode);
    }, []);

    const handleViewOrderById = useCallback((orderId: string) => {
        const order = orders?.find((o: any) => o.id === orderId);
        if (order) {
            openUnifiedModal(order as unknown as Order, 'view');
        }
    }, [orders, openUnifiedModal]);

    const handleEditOrderUnified = useCallback((order: Order) => {
        openUnifiedModal(order, 'edit');
    }, [openUnifiedModal]);

    const handleShipOrderUnified = useCallback((order: Order) => {
        openUnifiedModal(order, 'ship');
    }, [openUnifiedModal]);

    // Mutations hook
    const mutations = useOrdersMutations({
        onShipSuccess: () => setUnifiedModalOrder(null),
        onCreateSuccess: () => setShowCreateOrder(false),
        onDeleteSuccess: () => setUnifiedModalOrder(null),
        onEditSuccess: () => setUnifiedModalOrder(null),
    });

    // Compute customer stats
    const customerStats = useMemo(
        () => computeCustomerStats(orders, []),
        [orders]
    );

    // Flatten orders for grid
    const currentRows = useMemo(
        () => flattenOrders(orders, customerStats, inventoryBalance, fabricStock),
        [orders, customerStats, inventoryBalance, fabricStock]
    );

    // Apply filters
    const filteredRows = useMemo(() => {
        // Date range filter only applies to open view
        const applyDateFilter = view === 'open';
        let rows = filterRows(currentRows, '', applyDateFilter ? dateRange : '', applyDateFilter);

        // Open view specific filters
        if (view === 'open') {
            if (allocatedFilter === 'yes') {
                rows = rows.filter(row =>
                    row.lineStatus === 'allocated' ||
                    row.lineStatus === 'picked' ||
                    row.lineStatus === 'packed'
                );
            } else if (allocatedFilter === 'no') {
                rows = rows.filter(row => row.lineStatus === 'pending');
            }

            if (productionFilter === 'scheduled') {
                rows = rows.filter(row => row.productionBatchId);
            } else if (productionFilter === 'needs') {
                rows = rows.filter(row =>
                    row.lineStatus === 'pending' &&
                    !row.productionBatchId &&
                    (row.skuStock < row.qty || row.isCustomized)
                );
            } else if (productionFilter === 'ready') {
                rows = rows.filter(row => {
                    const activeLines = row.order?.orderLines?.filter(
                        (line: any) => line.lineStatus !== 'cancelled'
                    ) || [];
                    return activeLines.length > 0 && activeLines.every(
                        (line: any) =>
                            line.lineStatus === 'allocated' ||
                            line.lineStatus === 'picked' ||
                            line.lineStatus === 'packed'
                    );
                });
            }
        }

        return rows;
    }, [currentRows, dateRange, view, allocatedFilter, productionFilter]);

    // Count of fully shipped orders ready for release (Open view only)
    const releasableOrderCount = useMemo(() => {
        if (view !== 'open' || !orders) return 0;
        let count = 0;
        for (const order of orders) {
            const lines = order.orderLines || [];
            const nonCancelledLines = lines.filter((l: any) => l.lineStatus !== 'cancelled');
            if (nonCancelledLines.length === 0) continue;
            const allShipped = nonCancelledLines.every((l: any) => l.lineStatus === 'shipped');
            if (allShipped) count++;
        }
        return count;
    }, [view, orders]);

    // Pipeline counts (Open view only)
    const pipelineCounts = useMemo(() => {
        if (view !== 'open' || !orders) return { pending: 0, allocated: 0, ready: 0 };
        let pending = 0, allocated = 0, ready = 0;
        for (const order of orders) {
            const lines = (order.orderLines || []).filter((l: any) => l.lineStatus !== 'cancelled');
            if (lines.length === 0) continue;
            const allAllocatedOrBetter = lines.every((l: any) =>
                ['allocated', 'picked', 'packed', 'shipped'].includes(l.lineStatus)
            );
            const allPackedOrBetter = lines.every((l: any) =>
                ['packed', 'shipped'].includes(l.lineStatus)
            );
            if (allPackedOrBetter) ready++;
            else if (allAllocatedOrBetter) allocated++;
            else pending++;
        }
        return { pending, allocated, ready };
    }, [view, orders]);

    // Handlers
    const handleMarkShippedLine = useCallback(
        (lineId: string, data?: { awbNumber?: string; courier?: string }) =>
            mutations.markShippedLine.mutate({ lineId, data }),
        [mutations.markShippedLine]
    );

    const handleUnmarkShippedLine = useCallback(
        (lineId: string) => mutations.unmarkShippedLine.mutate(lineId),
        [mutations.unmarkShippedLine]
    );

    const handleUpdateLineTracking = useCallback(
        (lineId: string, data: { awbNumber?: string; courier?: string }) =>
            mutations.updateLineTracking.mutate({ lineId, data }),
        [mutations.updateLineTracking]
    );

    const handleAllocate = useCallback(
        (lineId: string) => mutations.allocate.mutate({ lineIds: [lineId] }),
        [mutations.allocate]
    );

    const handleUnallocate = useCallback(
        (lineId: string) => mutations.unallocate.mutate(lineId),
        [mutations.unallocate]
    );

    const handlePick = useCallback(
        (lineId: string) => mutations.pickLine.mutate(lineId),
        [mutations.pickLine]
    );

    const handleUnpick = useCallback(
        (lineId: string) => mutations.unpickLine.mutate(lineId),
        [mutations.unpickLine]
    );

    const handlePack = useCallback(
        (lineId: string) => mutations.packLine.mutate(lineId),
        [mutations.packLine]
    );

    const handleUnpack = useCallback(
        (lineId: string) => mutations.unpackLine.mutate(lineId),
        [mutations.unpackLine]
    );

    const handleShipLine = useCallback(
        (lineId: string, data: { awbNumber: string; courier: string }) => {
            mutations.markShippedLine.mutate({ lineId, data });
        },
        [mutations.markShippedLine]
    );

    const handleCustomize = useCallback(
        (_lineId: string, lineData: {
            lineId: string;
            skuCode: string;
            productName: string;
            colorName: string;
            size: string;
            qty: number;
        }) => {
            setCustomizingLine(lineData);
            setIsEditingCustomization(false);
            setCustomizationInitialData(null);
        },
        []
    );

    const handleEditCustomization = useCallback(
        (_lineId: string, lineData: {
            lineId: string;
            skuCode: string;
            productName: string;
            colorName: string;
            size: string;
            qty: number;
            customizationType: string | null;
            customizationValue: string | null;
            customizationNotes: string | null;
        }) => {
            setCustomizingLine({
                lineId: lineData.lineId,
                skuCode: lineData.skuCode,
                productName: lineData.productName,
                colorName: lineData.colorName,
                size: lineData.size,
                qty: lineData.qty,
            });
            setIsEditingCustomization(true);
            setCustomizationInitialData({
                type: lineData.customizationType || 'length',
                value: lineData.customizationValue || '',
                notes: lineData.customizationNotes || undefined,
            });
        },
        []
    );

    const handleRemoveCustomization = useCallback(
        (lineId: string, skuCode: string) => {
            if (confirm(`Remove customization from ${skuCode}?\n\nThis will revert the line to its original state.`)) {
                mutations.removeCustomization.mutate({ lineId });
            }
        },
        [mutations.removeCustomization]
    );

    const handleConfirmCustomization = useCallback(
        (data: { type: string; value: string; notes?: string }) => {
            if (!customizingLine) return;

            if (isEditingCustomization) {
                mutations.removeCustomization.mutate({ lineId: customizingLine.lineId }, {
                    onSuccess: () => {
                        mutations.customizeLine.mutate(
                            { lineId: customizingLine.lineId, data },
                            {
                                onSuccess: () => {
                                    setCustomizingLine(null);
                                    setIsEditingCustomization(false);
                                    setCustomizationInitialData(null);
                                },
                            }
                        );
                    },
                });
            } else {
                mutations.customizeLine.mutate(
                    { lineId: customizingLine.lineId, data },
                    {
                        onSuccess: () => {
                            setCustomizingLine(null);
                            setIsEditingCustomization(false);
                            setCustomizationInitialData(null);
                        },
                    }
                );
            }
        },
        [customizingLine, isEditingCustomization, mutations.customizeLine, mutations.removeCustomization]
    );

    // Grid component
    const {
        gridComponent,
        columnVisibilityDropdown,
        statusLegend,
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        isManager,
        savePreferencesToServer,
    } = OrdersGrid({
        rows: filteredRows,
        lockedDates: lockedDates || [],
        currentView: view,
        onAllocate: handleAllocate,
        onUnallocate: handleUnallocate,
        onPick: handlePick,
        onUnpick: handleUnpick,
        onPack: handlePack,
        onUnpack: handleUnpack,
        onShipLine: handleShipLine,
        onMarkShippedLine: handleMarkShippedLine,
        onUnmarkShippedLine: handleUnmarkShippedLine,
        onUpdateLineTracking: handleUpdateLineTracking,
        onShip: handleShipOrderUnified,
        onCreateBatch: (data) => mutations.createBatch.mutate(data),
        onUpdateBatch: (id, data) => mutations.updateBatch.mutate({ id, data }),
        onDeleteBatch: (id) => mutations.deleteBatch.mutate(id),
        onUpdateLineNotes: (lineId, notes) => mutations.updateLineNotes.mutate({ lineId, notes }),
        onViewOrder: handleViewOrderById,
        onEditOrder: handleEditOrderUnified,
        onCancelOrder: (id, reason) => mutations.cancelOrder.mutate({ id, reason }),
        onDeleteOrder: (id) => mutations.deleteOrder.mutate(id),
        onCancelLine: (lineId) => mutations.cancelLine.mutate(lineId),
        onUncancelLine: (lineId) => mutations.uncancelLine.mutate(lineId),
        onSelectCustomer: setSelectedCustomerId,
        onCustomize: handleCustomize,
        onEditCustomization: handleEditCustomization,
        onRemoveCustomization: handleRemoveCustomization,
        onUpdateShipByDate: (orderId, date) => mutations.updateShipByDate.mutate({ orderId, date }),
        onForceShipOrder: (orderId, data) => mutations.forceShip.mutate({ id: orderId, data }),
        onUnarchive: () => {},
        allocatingLines,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isDeletingOrder: mutations.deleteOrder.isPending,
        isUnarchiving: false,
        isAdmin: user?.role === 'admin',
    });

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Orders</h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <GlobalOrderSearch
                        onSelectOrder={(orderId, selectedView) => {
                            // Map old view names to new
                            const viewMap: Record<string, OrderView> = {
                                'rto': 'rto',
                                'cod-pending': 'cod_pending',
                                'open': 'open',
                                'shipped': 'shipped',
                                'archived': 'archived',
                                'cancelled': 'cancelled',
                            };
                            const mappedView = viewMap[selectedView] || 'open';
                            setView(mappedView);
                            const order = orders?.find(o => o.id === orderId);
                            if (order) {
                                setUnifiedModalOrder(order as unknown as Order);
                                setUnifiedModalMode('view');
                            }
                        }}
                    />
                    <button
                        onClick={() => setShowCreateOrder(true)}
                        className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2 whitespace-nowrap"
                    >
                        <Plus size={16} />
                        New Order
                    </button>
                </div>
            </div>

            {/* Pipeline Status Bar - Only for Open view */}
            {view === 'open' && (
                <div className="flex items-center gap-4 px-4 py-2.5 bg-white border border-gray-200 rounded-lg">
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                        <span className="text-sm text-gray-600">Pending</span>
                        <span className="text-sm font-semibold text-gray-900">{pipelineCounts.pending}</span>
                    </div>
                    <span className="text-gray-300">→</span>
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                        <span className="text-sm text-gray-600">Allocated</span>
                        <span className="text-sm font-semibold text-gray-900">{pipelineCounts.allocated}</span>
                    </div>
                    <span className="text-gray-300">→</span>
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                        <span className="text-sm text-gray-600">Ready</span>
                        <span className="text-sm font-semibold text-gray-900">{pipelineCounts.ready}</span>
                    </div>
                </div>
            )}

            {/* Main Content Card */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50/80 border-b border-gray-100">
                    {/* Left side: View selector + filters */}
                    <div className="flex items-center gap-3">
                        {/* View Dropdown */}
                        <div className="relative">
                            <select
                                value={view}
                                onChange={(e) => setView(e.target.value as OrderView)}
                                className="appearance-none text-sm font-medium bg-white border border-gray-200 rounded-lg px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 cursor-pointer"
                            >
                                <option value="open">Open Orders{pagination?.total ? ` (${pagination.total})` : ''}</option>
                                <option value="shipped">Shipped</option>
                                <option value="rto">RTO</option>
                                <option value="cod_pending">COD Pending</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="archived">Archived</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>

                        {/* Open view filters */}
                        {view === 'open' && (
                            <>
                                <div className="w-px h-5 bg-gray-200" />
                                <select
                                    value={dateRange}
                                    onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
                                    className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-200 focus:border-primary-300"
                                >
                                    <option value="">All time</option>
                                    <option value="14">Last 14 days</option>
                                    <option value="30">Last 30 days</option>
                                    <option value="60">Last 60 days</option>
                                    <option value="90">Last 90 days</option>
                                </select>
                                <select
                                    value={allocatedFilter}
                                    onChange={(e) => setAllocatedFilter(e.target.value as typeof allocatedFilter)}
                                    className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-200 focus:border-primary-300"
                                >
                                    <option value="">All status</option>
                                    <option value="yes">Allocated</option>
                                    <option value="no">Not allocated</option>
                                </select>
                                <select
                                    value={productionFilter}
                                    onChange={(e) => setProductionFilter(e.target.value as typeof productionFilter)}
                                    className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-200 focus:border-primary-300"
                                >
                                    <option value="">All production</option>
                                    <option value="scheduled">Scheduled</option>
                                    <option value="needs">Needs production</option>
                                    <option value="ready">Ready to ship</option>
                                </select>
                            </>
                        )}
                    </div>

                    {/* Right side: Actions */}
                    <div className="flex items-center gap-2">
                        {/* Release button - Open view only */}
                        {view === 'open' && releasableOrderCount > 0 && (
                            <button
                                onClick={() => {
                                    if (confirm(`Release ${releasableOrderCount} shipped orders?\n\nThis will move them to the Shipped view.`)) {
                                        mutations.releaseToShipped.mutate(undefined);
                                    }
                                }}
                                disabled={mutations.releaseToShipped.isPending}
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
                            >
                                <Send size={12} />
                                Release {releasableOrderCount}
                            </button>
                        )}

                        {/* Admin migrate button - Open view only */}
                        {view === 'open' && user?.role === 'admin' && (
                            <button
                                onClick={() => mutations.migrateShopifyFulfilled.mutate()}
                                disabled={mutations.migrateShopifyFulfilled.isPending}
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 font-medium"
                            >
                                <Archive size={12} />
                                {mutations.migrateShopifyFulfilled.isPending ? 'Migrating...' : 'Migrate'}
                            </button>
                        )}

                        {/* Refresh */}
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
                            Refresh
                        </button>

                        <div className="w-px h-4 bg-gray-200" />

                        {/* Grid controls */}
                        {view === 'open' && statusLegend}
                        {columnVisibilityDropdown}
                        <GridPreferencesToolbar
                            hasUserCustomizations={hasUserCustomizations}
                            differsFromAdminDefaults={differsFromAdminDefaults}
                            isSavingPrefs={isSavingPrefs}
                            onResetToDefaults={resetToDefaults}
                            isManager={isManager}
                            onSaveAsDefaults={savePreferencesToServer}
                        />
                    </div>
                </div>

                {/* Loading */}
                {isLoading && (
                    <div className="flex justify-center p-12">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                    </div>
                )}

                {/* Grid */}
                {!isLoading && filteredRows.length > 0 && (
                    <div>{gridComponent}</div>
                )}
                {!isLoading && filteredRows.length === 0 && (
                    <div className="text-center text-gray-400 py-16">
                        No {VIEW_CONFIG[view].label.toLowerCase()}
                    </div>
                )}

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                        <div className="text-sm text-gray-600">
                            Showing {((page - 1) * pagination.limit) + 1}–{Math.min(page * pagination.limit, pagination.total)} of {pagination.total} orders
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(page - 1)}
                                disabled={page === 1 || isFetching}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft size={14} />
                                Previous
                            </button>
                            <span className="text-sm text-gray-600 px-2">
                                Page {page} of {pagination.totalPages}
                            </span>
                            <button
                                onClick={() => setPage(page + 1)}
                                disabled={page >= pagination.totalPages || isFetching}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
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

            {selectedCustomerId && (
                <CustomerDetailModal
                    customer={customerDetail}
                    isLoading={customerLoading}
                    onClose={() => setSelectedCustomerId(null)}
                />
            )}

            {customizingLine && (
                <CustomizationModal
                    isOpen={true}
                    onClose={() => {
                        setCustomizingLine(null);
                        setIsEditingCustomization(false);
                        setCustomizationInitialData(null);
                    }}
                    onConfirm={handleConfirmCustomization}
                    lineData={customizingLine}
                    isSubmitting={mutations.customizeLine.isPending || mutations.removeCustomization.isPending}
                    isEditMode={isEditingCustomization}
                    initialData={customizationInitialData}
                />
            )}

            {unifiedModalOrder && (
                <UnifiedOrderModal
                    order={unifiedModalOrder}
                    initialMode={unifiedModalMode}
                    onClose={() => setUnifiedModalOrder(null)}
                    onSuccess={() => {
                        setUnifiedModalOrder(null);
                        queryClient.invalidateQueries({ queryKey: ['orders'] });
                    }}
                />
            )}
        </div>
    );
}
