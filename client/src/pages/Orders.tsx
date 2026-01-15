/**
 * Orders page - Main orchestrator component
 * Uses extracted hooks, utilities, and components for maintainability
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Archive, Truck, RefreshCw, CheckSquare } from 'lucide-react';

// Custom hooks
import { useOrdersData } from '../hooks/useOrdersData';
import { useOrdersMutations } from '../hooks/useOrdersMutations';
import { useAuth } from '../hooks/useAuth';

// Local types (simplified to 2 tabs)
type OrderTab = 'open' | 'cancelled';

// Utilities
import {
    computeCustomerStats,
    flattenOrders,
    filterRows,
} from '../utils/orderHelpers';

// Components
import {
    OrdersGrid,
    CancelledOrdersGrid,
    CreateOrderModal,
    CustomerDetailModal,
    CustomizationModal,
    ProcessShippedModal,
    UnifiedOrderModal,
    GlobalOrderSearch,
} from '../components/orders';
import { GridPreferencesToolbar } from '../components/common/grid';
import type { Order } from '../types';

export default function Orders() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const navigate = useNavigate();

    // Tab state - persisted in URL for back/forward navigation and refresh
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = (searchParams.get('tab') as OrderTab) || 'open';
    const setTab = useCallback((newTab: OrderTab) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('tab', newTab);
            return newParams;
        }, { replace: true }); // Use replace to avoid polluting browser history
    }, [setSearchParams]);

    // Redirect old tab URLs to Shipments page
    useEffect(() => {
        const tabParam = searchParams.get('tab');
        if (tabParam && ['shipped', 'rto', 'cod-pending', 'archived'].includes(tabParam)) {
            navigate(`/shipments?tab=${tabParam}`, { replace: true });
        }
    }, [searchParams, navigate]);

    // Filter state (per-tab filtering, separate from GlobalOrderSearch)
    const [dateRange, setDateRange] = useState<'' | '14' | '30' | '60' | '90' | '180' | '365'>('14');
    const [allocatedFilter, setAllocatedFilter] = useState<'' | 'yes' | 'no'>('');
    const [productionFilter, setProductionFilter] = useState<'' | 'scheduled' | 'needs' | 'ready'>('');

    // Modal state
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [showProcessShippedModal, setShowProcessShippedModal] = useState(false);
    // Unified modal state for viewing, editing, and shipping orders
    const [unifiedModalOrder, setUnifiedModalOrder] = useState<Order | null>(null);
    const [unifiedModalMode, setUnifiedModalMode] = useState<'view' | 'edit' | 'ship'>('view');

    // Optimistic updates handle button state - use empty set for grid interface compatibility
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

    // Data hooks - only open and cancelled orders needed
    const {
        openOrders,
        cancelledOrders,
        allSkus,
        inventoryBalance,
        fabricStock,
        channels,
        lockedDates,
        customerDetail,
        customerLoading,
        isLoading,
        refetchOpen,
        refetchCancelled,
        isFetchingOpen,
        isFetchingCancelled,
    } = useOrdersData({ activeTab: tab, selectedCustomerId });

    // Unified modal handlers (must be after openOrders is available)
    const openUnifiedModal = useCallback((order: Order, mode: 'view' | 'edit' | 'ship' = 'view') => {
        setUnifiedModalOrder(order);
        setUnifiedModalMode(mode);
    }, []);

    // Handler for OrdersGrid which passes orderId (not full order)
    const handleViewOrderById = useCallback((orderId: string) => {
        // openOrders is EnrichedOrder[] from tRPC - cast through unknown for type compatibility
        const order = openOrders?.find((o: any) => o.id === orderId);
        if (order) {
            openUnifiedModal(order as unknown as Order, 'view');
        }
    }, [openOrders, openUnifiedModal]);

    // Handler for grids that pass full order
    const handleViewOrder = useCallback((order: Order) => {
        openUnifiedModal(order, 'view');
    }, [openUnifiedModal]);

    // Handler to open in edit mode
    const handleEditOrderUnified = useCallback((order: Order) => {
        openUnifiedModal(order, 'edit');
    }, [openUnifiedModal]);

    // Handler to open in ship mode
    const handleShipOrderUnified = useCallback((order: Order) => {
        openUnifiedModal(order, 'ship');
    }, [openUnifiedModal]);

    // Mutations hook with callbacks
    const mutations = useOrdersMutations({
        onShipSuccess: () => {
            setUnifiedModalOrder(null);
        },
        onCreateSuccess: () => {
            setShowCreateOrder(false);
        },
        onDeleteSuccess: () => {
            setUnifiedModalOrder(null);
        },
        onEditSuccess: () => {
            setUnifiedModalOrder(null);
        },
        onProcessMarkedShippedSuccess: () => {
            setShowProcessShippedModal(false);
        },
    });

    // Compute customer stats (no shipped orders needed for open view)
    const customerStats = useMemo(
        () => computeCustomerStats(openOrders, []),
        [openOrders]
    );

    // Flatten and filter orders for grid
    const openRows = useMemo(
        () => flattenOrders(openOrders, customerStats, inventoryBalance, fabricStock),
        [openOrders, customerStats, inventoryBalance, fabricStock]
    );

    const filteredOpenRows = useMemo(() => {
        // Note: Global search now handles cross-tab search. Per-tab filtering uses AG-Grid's built-in filters.
        let rows = filterRows(openRows, '', dateRange, tab === 'open');

        // Apply allocated filter
        if (allocatedFilter === 'yes') {
            rows = rows.filter(row =>
                row.lineStatus === 'allocated' ||
                row.lineStatus === 'picked' ||
                row.lineStatus === 'packed'
            );
        } else if (allocatedFilter === 'no') {
            rows = rows.filter(row => row.lineStatus === 'pending');
        }

        // Apply production filter
        if (productionFilter === 'scheduled') {
            rows = rows.filter(row => row.productionBatchId);
        } else if (productionFilter === 'needs') {
            rows = rows.filter(row =>
                row.lineStatus === 'pending' &&
                !row.productionBatchId &&
                (row.skuStock < row.qty || row.isCustomized)
            );
        } else if (productionFilter === 'ready') {
            // Ready = all lines of the order are allocated/picked/packed
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

        return rows;
    }, [openRows, dateRange, tab, allocatedFilter, productionFilter]);

    const uniqueOpenOrderCount = new Set(filteredOpenRows.map((r) => r.orderId)).size;

    // Count lines marked as shipped (ready for batch processing)
    const markedShippedCount = useMemo(() => {
        if (!openOrders) return 0;
        let count = 0;
        for (const order of openOrders) {
            const lines = order.orderLines || [];
            for (const line of lines) {
                if (line.lineStatus === 'marked_shipped') {
                    count++;
                }
            }
        }
        return count;
    }, [openOrders]);

    // Lines that can be closed (marked_shipped or cancelled, not already closed)
    const closableLineIds = useMemo(() => {
        if (!openOrders) return [];
        const ids: string[] = [];
        for (const order of openOrders) {
            const lines = order.orderLines || [];
            for (const line of lines) {
                // Line is closeable if marked_shipped or cancelled, and not already closed
                const status = line.lineStatus as string | null;
                if (status && ['marked_shipped', 'cancelled'].includes(status) && !line.closedAt) {
                    ids.push(line.id as string);
                }
            }
        }
        return ids;
    }, [openOrders]);

    // Pipeline counts for simple status bar
    const pipelineCounts = useMemo(() => {
        if (!openOrders) return { pending: 0, allocated: 0, ready: 0 };
        let pending = 0, allocated = 0, ready = 0;
        for (const order of openOrders) {
            const lines = (order.orderLines || []).filter((l: any) => l.lineStatus !== 'cancelled');
            if (lines.length === 0) continue;
            const allAllocatedOrBetter = lines.every((l: any) =>
                ['allocated', 'picked', 'packed', 'marked_shipped'].includes(l.lineStatus)
            );
            const allPackedOrBetter = lines.every((l: any) =>
                ['packed', 'marked_shipped'].includes(l.lineStatus)
            );
            if (allPackedOrBetter) {
                ready++;
            } else if (allAllocatedOrBetter) {
                allocated++;
            } else {
                pending++;
            }
        }
        return { pending, allocated, ready };
    }, [openOrders]);

    // Get orders with marked_shipped lines for the modal
    const ordersWithMarkedShipped = useMemo(() => {
        if (!openOrders) return [];
        return openOrders.filter((order: any) => {
            const lines = order.orderLines || [];
            return lines.some((line: any) => line.lineStatus === 'marked_shipped');
        });
    }, [openOrders]);

    // Handlers - mark shipped workflow
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

    // Optimistic updates handle UI state instantly - no need for loading tracking
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
                // Edit mode: delete existing customization then create new one
                // Using a chain of mutations for delete + create
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
                                // Keep modal open on error so user can see the error message
                            }
                        );
                    },
                    // Keep modal open on error
                });
            } else {
                // Create mode: just create new customization
                mutations.customizeLine.mutate(
                    { lineId: customizingLine.lineId, data },
                    {
                        onSuccess: () => {
                            setCustomizingLine(null);
                            setIsEditingCustomization(false);
                            setCustomizationInitialData(null);
                        },
                        // Keep modal open on error so user can see the error message
                    }
                );
            }
        },
        [customizingLine, isEditingCustomization, mutations.customizeLine, mutations.removeCustomization]
    );

    // Grid component
    const {
        gridComponent,
        actionPanel,
        columnVisibilityDropdown,
        statusLegend,
        // User preferences
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        // Admin-only
        isManager,
        savePreferencesToServer,
    } = OrdersGrid({
        rows: filteredOpenRows,
        lockedDates: lockedDates || [],
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
        onCancelLine: (lineId) => mutations.cancelLine.mutate(lineId),
        onUncancelLine: (lineId) => mutations.uncancelLine.mutate(lineId),
        onSelectCustomer: setSelectedCustomerId,
        onCustomize: handleCustomize,
        onEditCustomization: handleEditCustomization,
        onRemoveCustomization: handleRemoveCustomization,
        onUpdateShipByDate: (orderId, date) => mutations.updateShipByDate.mutate({ orderId, date }),
        onForceShipOrder: (orderId, data) => mutations.forceShip.mutate({ id: orderId, data }),
        onArchiveOrder: () => { }, // Not used on Orders page
        onCloseOrder: (id) => mutations.closeOrder.mutate(id),
        allocatingLines,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isArchiving: false, // Not used on Orders page
        isDeletingOrder: mutations.deleteOrder.isPending,
        isClosingOrder: mutations.closeOrder.isPending,
        isAdmin: user?.role === 'admin',
    });

    // Tab configuration - only 2 tabs now
    const tabs = [
        { id: 'open' as const, label: 'Open', count: openOrders?.length || 0, filteredCount: dateRange ? uniqueOpenOrderCount : null },
        { id: 'cancelled' as const, label: 'Cancelled', count: cancelledOrders?.length || 0 },
    ];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Orders</h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <GlobalOrderSearch
                        onSelectOrder={(orderId, selectedTab, page) => {
                            if (page === 'shipments') {
                                // Navigate to Shipments page
                                navigate(`/shipments?tab=${selectedTab}&orderId=${orderId}`);
                            } else {
                                // Stay on Orders page
                                setTab(selectedTab as OrderTab);
                                // Find the order and open it in the unified modal
                                const order = [...(openOrders || []), ...(cancelledOrders || [])].find(o => o.id === orderId);
                                if (order) {
                                    setUnifiedModalOrder(order as unknown as Order);
                                    setUnifiedModalMode('view');
                                }
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

            {/* Pipeline Status Bar */}
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

            {/* Tabs */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Tab Navigation - Clean row */}
                <div className="flex items-center justify-between px-4 border-b border-gray-100">
                    <div className="flex overflow-x-auto -mb-px">
                        {tabs.map((t) => (
                            <button
                                key={t.id}
                                className={`relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.id
                                        ? 'text-primary-600'
                                        : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                onClick={() => setTab(t.id)}
                            >
                                <span className="flex items-center gap-1.5">
                                    {t.label}
                                    {t.count > 0 && (
                                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${tab === t.id
                                                ? 'bg-primary-100 text-primary-700'
                                                : 'bg-gray-100 text-gray-500'
                                            }`}>
                                            {t.filteredCount !== undefined && t.filteredCount !== null ? `${t.filteredCount}/${t.count}` : t.count}
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
                {tab === 'open' && (
                    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50/80 border-b border-gray-100">
                        <div className="flex items-center gap-2">
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
                                <option value="180">Last 180 days</option>
                                <option value="365">Last 365 days</option>
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
                        </div>
                        <div className="flex items-center gap-2">
                            {markedShippedCount > 0 && (
                                <button
                                    onClick={() => setShowProcessShippedModal(true)}
                                    disabled={mutations.processMarkedShipped.isPending}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 font-medium"
                                >
                                    <Truck size={12} />
                                    Clear {markedShippedCount} Shipped
                                </button>
                            )}
                            {closableLineIds.length > 0 && (
                                <button
                                    onClick={() => {
                                        if (confirm(`Close ${closableLineIds.length} completed lines?\n\nThis will move them out of the open view.`)) {
                                            mutations.closeLines.mutate(closableLineIds);
                                        }
                                    }}
                                    disabled={mutations.closeLines.isPending}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
                                    title="Close all shipped and cancelled lines"
                                >
                                    <CheckSquare size={12} />
                                    Close {closableLineIds.length} Completed
                                </button>
                            )}
                            {user?.role === 'admin' && (
                                <button
                                    onClick={() => mutations.migrateShopifyFulfilled.mutate()}
                                    disabled={mutations.migrateShopifyFulfilled.isPending}
                                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 font-medium"
                                    title="Migrate orders fulfilled on Shopify (no inventory)"
                                >
                                    <Archive size={12} />
                                    {mutations.migrateShopifyFulfilled.isPending ? 'Migrating...' : 'Migrate Fulfilled'}
                                </button>
                            )}
                            {/* Refresh Button */}
                            <button
                                onClick={() => refetchOpen()}
                                disabled={isFetchingOpen}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all"
                                title="Refresh table data"
                            >
                                <RefreshCw size={12} className={isFetchingOpen ? 'animate-spin' : ''} />
                                {isFetchingOpen ? 'Refreshing...' : 'Refresh'}
                            </button>
                            <div className="w-px h-4 bg-gray-200" />
                            {statusLegend}
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
                )}

                {/* Loading */}
                {isLoading && (
                    <div className="flex justify-center p-12">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                    </div>
                )}

                {/* Open Orders Grid */}
                {!isLoading && tab === 'open' && filteredOpenRows.length > 0 && (
                    <div>{gridComponent}</div>
                )}
                {/* Action Panel for order management */}
                {actionPanel}
                {!isLoading && tab === 'open' && filteredOpenRows.length === 0 && (
                    <div className="text-center text-gray-400 py-16">
                        {dateRange ? 'No orders match your filters' : 'No open orders'}
                    </div>
                )}

                {/* Cancelled Orders */}
                {!isLoading && tab === 'cancelled' && (
                    <div className="p-4">
                        {/* Cancelled tab toolbar */}
                        <div className="flex items-center justify-end mb-3">
                            <button
                                onClick={() => refetchCancelled()}
                                disabled={isFetchingCancelled}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all"
                                title="Refresh table data"
                            >
                                <RefreshCw size={12} className={isFetchingCancelled ? 'animate-spin' : ''} />
                                {isFetchingCancelled ? 'Refreshing...' : 'Refresh'}
                            </button>
                        </div>
                        <CancelledOrdersGrid
                            orders={cancelledOrders || []}
                            onViewOrder={handleViewOrder}
                            onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                            onRestore={(id) => mutations.uncancelOrder.mutate(id)}
                            isRestoring={mutations.uncancelOrder.isPending}
                        />
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

            {showProcessShippedModal && (
                <ProcessShippedModal
                    orders={ordersWithMarkedShipped}
                    onProcess={(data) => mutations.processMarkedShipped.mutate(data)}
                    onClose={() => setShowProcessShippedModal(false)}
                    isProcessing={mutations.processMarkedShipped.isPending}
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

            {/* Unified Order Modal - for viewing, editing, and shipping orders */}
            {unifiedModalOrder && (
                <UnifiedOrderModal
                    order={unifiedModalOrder}
                    initialMode={unifiedModalMode}
                    onClose={() => setUnifiedModalOrder(null)}
                    onSuccess={() => {
                        setUnifiedModalOrder(null);
                        // Invalidate queries to refresh data
                        queryClient.invalidateQueries({ queryKey: ['openOrders'] });
                    }}
                />
            )}
        </div>
    );
}

