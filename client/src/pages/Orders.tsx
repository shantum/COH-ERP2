/**
 * Orders page - Unified order management with dropdown view selector
 * Views: Open, Shipped, Cancelled
 * Shipped view has filter chips for: All, RTO, COD Pending
 * Note: Archived view hidden from UI but auto-archive still runs. Search shows archived orders.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import type { AgGridReact } from 'ag-grid-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Send, ChevronDown, Archive, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';

// Custom hooks
import { useUnifiedOrdersData, type OrderView } from '../hooks/useUnifiedOrdersData';
import { useOrdersMutations } from '../hooks/useOrdersMutations';
import { useOrderSSE } from '../hooks/useOrderSSE';
import { useAuth } from '../hooks/useAuth';

// Utilities
import {
    enrichRowsWithInventory,
} from '../utils/orderHelpers';

// Components
import {
    OrdersGrid,
    OrdersGridSkeleton,
    CreateOrderModal,
    CustomerDetailModal,
    CustomizationModal,
    UnifiedOrderModal,
    GlobalOrderSearch,
} from '../components/orders';
import { GridPreferencesToolbar } from '../components/common/grid';
import type { Order } from '../types';

// View configuration (3 views: Open, Shipped, Cancelled)
// RTO and COD Pending are now filter chips within Shipped view
const VIEW_CONFIG: Record<OrderView, { label: string; color: string }> = {
    open: { label: 'Open Orders', color: 'primary' },
    shipped: { label: 'Shipped', color: 'blue' },
    cancelled: { label: 'Cancelled', color: 'gray' },
};

// Shipped view filter options
type ShippedFilter = 'all' | 'rto' | 'cod_pending';

export default function Orders() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    // Grid ref for AG-Grid transaction-based updates from SSE
    const gridRef = useRef<AgGridReact>(null);

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
        // Reset shipped filter when leaving shipped view
        if (newView !== 'shipped') {
            setShippedFilter('all');
        }
    }, [setSearchParams]);

    const setPage = useCallback((newPage: number) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', String(newPage));
            return newParams;
        }, { replace: true });
    }, [setSearchParams]);

    // Filter state (Open view only)
    const [allocatedFilter, setAllocatedFilter] = useState<'' | 'yes' | 'no'>('');
    const [productionFilter, setProductionFilter] = useState<'' | 'scheduled' | 'needs' | 'ready'>('');
    // Filter state (Shipped view only) - for RTO and COD Pending sub-filters
    const [shippedFilter, setShippedFilter] = useState<ShippedFilter>('all');

    // Modal state
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [unifiedModalOrder, setUnifiedModalOrder] = useState<Order | null>(null);
    const [unifiedModalMode, setUnifiedModalMode] = useState<'view' | 'edit' | 'ship'>('view');

    // Track which lines are currently being processed (for loading spinners)
    const [processingLines, setProcessingLines] = useState<Set<string>>(new Set());

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

    // Real-time updates via SSE (for multi-user collaboration)
    // When SSE is connected, polling is reduced since SSE handles updates
    // Pass gridRef for AG-Grid transaction-based updates (faster than cache updates)
    const { isConnected: isSSEConnected } = useOrderSSE({ currentView: view, page, gridRef });

    // Data hook - simplified, single view with pagination
    const {
        rows: serverRows,
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
        isSSEConnected,
        // Pass shipped filter for server-side filtering (rto, cod_pending)
        shippedFilter: view === 'shipped' && shippedFilter !== 'all' ? shippedFilter : undefined,
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

    // Mutations hook with optimistic update support
    // Pass currentView and page so mutations can target the correct cache
    const mutations = useOrdersMutations({
        onShipSuccess: () => setUnifiedModalOrder(null),
        onCreateSuccess: () => setShowCreateOrder(false),
        onDeleteSuccess: () => setUnifiedModalOrder(null),
        onEditSuccess: () => setUnifiedModalOrder(null),
        currentView: view,
        page,
        shippedFilter: view === 'shipped' && shippedFilter !== 'all' ? shippedFilter : undefined,
    });

    // Enrich server-flattened rows with client-side inventory data
    // This is O(n) with O(1) Map lookups - much faster than full flatten
    const currentRows = useMemo(
        () => enrichRowsWithInventory(serverRows, inventoryBalance, fabricStock),
        [serverRows, inventoryBalance, fabricStock]
    );

    // Apply filters
    const filteredRows = useMemo(() => {
        let rows = currentRows;

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

        // Note: Shipped view filters (RTO, COD Pending) are applied server-side

        return rows;
    }, [currentRows, view, allocatedFilter, productionFilter]);

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

    // Count of fully cancelled orders ready for release (Open view only)
    const releasableCancelledCount = useMemo(() => {
        if (view !== 'open' || !orders) return 0;
        let count = 0;
        for (const order of orders) {
            const lines = order.orderLines || [];
            if (lines.length === 0) continue;
            const allCancelled = lines.every((l: any) => l.lineStatus === 'cancelled');
            if (allCancelled) count++;
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

    // Helper to add/remove lineId from processingLines set
    const startProcessing = useCallback((lineId: string) => {
        setProcessingLines(prev => new Set(prev).add(lineId));
    }, []);

    const stopProcessing = useCallback((lineId: string) => {
        setProcessingLines(prev => {
            const next = new Set(prev);
            next.delete(lineId);
            return next;
        });
    }, []);

    // Handlers with loading state tracking
    const handleMarkShippedLine = useCallback(
        (lineId: string, data?: { awbNumber?: string; courier?: string }) => {
            startProcessing(lineId);
            mutations.markShippedLine.mutate(
                { lineId, data },
                { onSettled: () => stopProcessing(lineId) }
            );
        },
        [mutations.markShippedLine, startProcessing, stopProcessing]
    );

    const handleUnmarkShippedLine = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.unmarkShippedLine.mutate(lineId, {
                onSettled: () => stopProcessing(lineId)
            });
        },
        [mutations.unmarkShippedLine, startProcessing, stopProcessing]
    );

    const handleUpdateLineTracking = useCallback(
        (lineId: string, data: { awbNumber?: string; courier?: string }) => {
            startProcessing(lineId);
            mutations.updateLineTracking.mutate(
                { lineId, data },
                { onSettled: () => stopProcessing(lineId) }
            );
        },
        [mutations.updateLineTracking, startProcessing, stopProcessing]
    );

    const handleAllocate = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.allocate.mutate(
                { lineIds: [lineId] },
                { onSettled: () => stopProcessing(lineId) }
            );
        },
        [mutations.allocate, startProcessing, stopProcessing]
    );

    const handleUnallocate = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.unallocate.mutate(lineId, {
                onSettled: () => stopProcessing(lineId)
            });
        },
        [mutations.unallocate, startProcessing, stopProcessing]
    );

    const handlePick = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.pickLine.mutate(lineId, {
                onSettled: () => stopProcessing(lineId)
            });
        },
        [mutations.pickLine, startProcessing, stopProcessing]
    );

    const handleUnpick = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.unpickLine.mutate(lineId, {
                onSettled: () => stopProcessing(lineId)
            });
        },
        [mutations.unpickLine, startProcessing, stopProcessing]
    );

    const handlePack = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.packLine.mutate(lineId, {
                onSettled: () => stopProcessing(lineId)
            });
        },
        [mutations.packLine, startProcessing, stopProcessing]
    );

    const handleUnpack = useCallback(
        (lineId: string) => {
            startProcessing(lineId);
            mutations.unpackLine.mutate(lineId, {
                onSettled: () => stopProcessing(lineId)
            });
        },
        [mutations.unpackLine, startProcessing, stopProcessing]
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
        externalGridRef: gridRef,
        onAllocate: handleAllocate,
        onUnallocate: handleUnallocate,
        onPick: handlePick,
        onUnpick: handleUnpick,
        onPack: handlePack,
        onUnpack: handleUnpack,
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
        onCancelLine: (lineId) => {
            startProcessing(lineId);
            mutations.cancelLine.mutate(lineId, { onSettled: () => stopProcessing(lineId) });
        },
        onUncancelLine: (lineId) => {
            startProcessing(lineId);
            mutations.uncancelLine.mutate(lineId, { onSettled: () => stopProcessing(lineId) });
        },
        onSelectCustomer: setSelectedCustomerId,
        onCustomize: handleCustomize,
        onEditCustomization: handleEditCustomization,
        onRemoveCustomization: handleRemoveCustomization,
        onUpdateShipByDate: (orderId, date) => mutations.updateShipByDate.mutate({ orderId, date }),
        onForceShipLine: (lineId, data) => mutations.adminShip.mutate({ lineIds: [lineId], awbNumber: data.awbNumber, courier: data.courier }),
        allocatingLines: processingLines,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isDeletingOrder: mutations.deleteOrder.isPending,
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
                            // Map search results to views (RTO/COD route to Shipped with filter)
                            const viewMap: Record<string, OrderView> = {
                                'open': 'open',
                                'shipped': 'shipped',
                                'rto': 'shipped',         // RTO routes to shipped with filter
                                'cod-pending': 'shipped', // COD Pending routes to shipped with filter
                                'archived': 'shipped',    // Archived orders route to shipped view
                                'cancelled': 'cancelled',
                            };
                            const mappedView = viewMap[selectedView] || 'open';
                            setView(mappedView);
                            // Set shipped filter based on search result tab
                            if (selectedView === 'rto') {
                                setShippedFilter('rto');
                            } else if (selectedView === 'cod-pending') {
                                setShippedFilter('cod_pending');
                            } else if (mappedView === 'shipped') {
                                setShippedFilter('all');
                            }
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
                                <option value="cancelled">Cancelled</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>

                        {/* Open view filters */}
                        {view === 'open' && (
                            <>
                                <div className="w-px h-5 bg-gray-200" />
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

                        {/* Shipped view filter chips */}
                        {view === 'shipped' && (
                            <>
                                <div className="w-px h-5 bg-gray-200" />
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => { setShippedFilter('all'); setPage(1); }}
                                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                                            shippedFilter === 'all'
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        All
                                    </button>
                                    <button
                                        onClick={() => { setShippedFilter('rto'); setPage(1); }}
                                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                                            shippedFilter === 'rto'
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                                        }`}
                                    >
                                        RTO
                                    </button>
                                    <button
                                        onClick={() => { setShippedFilter('cod_pending'); setPage(1); }}
                                        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                                            shippedFilter === 'cod_pending'
                                                ? 'bg-amber-600 text-white'
                                                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                        }`}
                                    >
                                        COD Pending
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Right side: Actions */}
                    <div className="flex items-center gap-2">
                        {/* Release shipped button - Open view only */}
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

                        {/* Release cancelled button - Open view only */}
                        {view === 'open' && releasableCancelledCount > 0 && (
                            <button
                                onClick={() => {
                                    if (confirm(`Release ${releasableCancelledCount} cancelled orders?\n\nThis will move them to the Cancelled view.`)) {
                                        mutations.releaseToCancelled.mutate(undefined);
                                    }
                                }}
                                disabled={mutations.releaseToCancelled.isPending}
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-medium"
                            >
                                <XCircle size={12} />
                                Release {releasableCancelledCount} Cancelled
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

                        {/* Refresh - non-blocking with visual feedback */}
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                isFetching
                                    ? 'text-blue-600 bg-blue-50 border border-blue-200'
                                    : 'text-gray-600 bg-white border border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
                            {isFetching ? 'Refreshing...' : 'Refresh'}
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

                {/* Loading - show skeleton for initial load (no cached data) */}
                {isLoading && filteredRows.length === 0 && (
                    <div className="px-4 py-2">
                        <OrdersGridSkeleton rowCount={25} columnCount={10} />
                    </div>
                )}

                {/* Grid - show even with stale data while refreshing in background */}
                {filteredRows.length > 0 && (
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
