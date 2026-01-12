/**
 * Orders page - Main orchestrator component
 * Uses extracted hooks, utilities, and components for maintainability
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Archive, Truck, Save } from 'lucide-react';
import { shopifyApi, trackingApi, ordersApi } from '../services/api';

// Custom hooks
import { useOrdersData } from '../hooks/useOrdersData';
import type { OrderTab } from '../hooks/useOrdersData';
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
    ShippedOrdersGrid,
    ArchivedOrdersGrid,
    RtoOrdersGrid,
    CodPendingGrid,
    CancelledOrdersGrid,
    OrderDetailModal,
    OrderViewModal,
    CreateOrderModal,
    EditOrderModal,
    ShipOrderModal,
    NotesModal,
    CustomerDetailModal,
    CustomizationModal,
    SummaryPanel,
    TrackingModal,
    ProcessShippedModal,
    UnifiedOrderModal,
    GlobalOrderSearch,
} from '../components/orders';
import type { Order } from '../types';

export default function Orders() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

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

    // Filter state (per-tab filtering, separate from GlobalOrderSearch)
    const [dateRange, setDateRange] = useState<'' | '14' | '30' | '60' | '90' | '180' | '365'>('14');
    const [allocatedFilter, setAllocatedFilter] = useState<'' | 'yes' | 'no'>('');
    const [productionFilter, setProductionFilter] = useState<'' | 'scheduled' | 'needs' | 'ready'>('');

    // Shipped orders pagination state
    const [shippedPage, setShippedPage] = useState(1);
    const [shippedDays, setShippedDays] = useState(30);

    // Archived orders period and limit state (0 = all time)
    const [archivedDays, setArchivedDays] = useState(90);
    const [archivedLimit, setArchivedLimit] = useState(100);
    const [archivedSortBy, setArchivedSortBy] = useState<'orderDate' | 'archivedAt'>('archivedAt');

    // Modal state
    // @deprecated - Use unifiedModalOrder instead. Kept for backward compatibility.
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    // @deprecated - Use unifiedModalOrder with 'view' mode instead. Kept for backward compatibility.
    const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
    const [showCreateOrder, setShowCreateOrder] = useState(false);
    // @deprecated - Use unifiedModalOrder with 'edit' mode instead. Kept for backward compatibility.
    const [editingOrder, setEditingOrder] = useState<any>(null);
    const [notesOrder, setNotesOrder] = useState<any>(null);
    const [notesText, setNotesText] = useState('');
    // @deprecated - Use unifiedModalOrder with 'ship' mode instead. Kept for backward compatibility.
    const [pendingShipOrder, setPendingShipOrder] = useState<any>(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [showProcessShippedModal, setShowProcessShippedModal] = useState(false);
    // New unified modal state
    const [unifiedModalOrder, setUnifiedModalOrder] = useState<Order | null>(null);
    const [unifiedModalMode, setUnifiedModalMode] = useState<'view' | 'edit' | 'ship'>('view');

    // Shipping form state
    const [shipForm, setShipForm] = useState({ awbNumber: '', courier: '' });
    // Optimistic updates handle button state - use empty set for grid interface compatibility
    const allocatingLines = new Set<string>();

    // Tracking modal state
    const [trackingAwb, setTrackingAwb] = useState<string | null>(null);
    const [trackingOrderNumber, setTrackingOrderNumber] = useState<string | null>(null);

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
        rtoSummary,
        loadingRtoSummary,
        allSkus,
        inventoryBalance,
        fabricStock,
        channels,
        lockedDates,
        customerDetail,
        customerLoading,
        isLoading,
    } = useOrdersData({ activeTab: tab, selectedCustomerId, shippedPage, shippedDays, archivedDays, archivedLimit, archivedSortBy });

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
            // Clear legacy modal state (backward compatibility)
            setSelectedOrder(null);
            setPendingShipOrder(null);
            setShipForm({ awbNumber: '', courier: '' });
            // Clear unified modal state
            setUnifiedModalOrder(null);
        },
        onCreateSuccess: () => {
            setShowCreateOrder(false);
        },
        onDeleteSuccess: () => {
            setSelectedOrder(null);
            setUnifiedModalOrder(null);
        },
        onEditSuccess: () => {
            setEditingOrder(null);
            setUnifiedModalOrder(null);
        },
        onNotesSuccess: () => {
            setNotesOrder(null);
            setNotesText('');
        },
        onProcessMarkedShippedSuccess: () => {
            setShowProcessShippedModal(false);
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
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
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

    // Shipped orders are now unfiltered - use AG-Grid's quick filter or GlobalOrderSearch
    const filteredShippedOrders = shippedOrders;

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
    const { gridComponent, actionPanel, columnVisibilityDropdown, statusLegend, isManager, hasUnsavedChanges, isSavingPrefs, savePreferencesToServer } = OrdersGrid({
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
        onArchiveOrder: (id) => mutations.archiveOrder.mutate(id),
        onDeleteOrder: (id) => mutations.deleteOrder.mutate(id),
        onCancelLine: (lineId) => mutations.cancelLine.mutate(lineId),
        onUncancelLine: (lineId) => mutations.uncancelLine.mutate(lineId),
        onSelectCustomer: setSelectedCustomerId,
        onCustomize: handleCustomize,
        onEditCustomization: handleEditCustomization,
        onRemoveCustomization: handleRemoveCustomization,
        onUpdateShipByDate: (orderId, date) => mutations.updateShipByDate.mutate({ orderId, date }),
        allocatingLines,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isArchiving: mutations.archiveOrder.isPending,
        isDeletingOrder: mutations.deleteOrder.isPending,
    });

    // Tab configuration for cleaner rendering
    const tabs = [
        { id: 'open' as const, label: 'Open', count: openOrders?.length || 0, filteredCount: dateRange ? uniqueOpenOrderCount : null },
        { id: 'shipped' as const, label: 'Shipped', count: shippedPagination.total },
        { id: 'rto' as const, label: 'RTO', count: rtoTotalCount, highlight: true },
        { id: 'cod-pending' as const, label: 'COD Pending', count: codPendingTotalCount, highlight: true },
        { id: 'cancelled' as const, label: 'Cancelled', count: cancelledOrders?.length || 0 },
        { id: 'archived' as const, label: 'Archived', count: archivedTotalCount || archivedOrders?.length || 0 },
    ];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Orders</h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <GlobalOrderSearch
                        onSelectOrder={(orderId, selectedTab) => {
                            // Navigate to the tab where the order is found
                            setTab(selectedTab);
                            // Find the order and open it in the unified modal
                            // The order data will be fetched when opening the modal
                            ordersApi.getAll({ view: selectedTab === 'cod-pending' ? 'cod_pending' : selectedTab, search: orderId.slice(0, 8) })
                                .then(res => {
                                    const order = res.data.orders?.find((o: Order) => o.id === orderId);
                                    if (order) {
                                        setUnifiedModalOrder(order);
                                        setUnifiedModalMode('view');
                                    }
                                });
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
                            <div className="w-px h-4 bg-gray-200" />
                            {statusLegend}
                            {columnVisibilityDropdown}
                            {isManager && hasUnsavedChanges && (
                                <button
                                    onClick={async () => {
                                        const success = await savePreferencesToServer();
                                        if (success) {
                                            alert('Column preferences saved for all users');
                                        } else {
                                            alert('Failed to save preferences');
                                        }
                                    }}
                                    disabled={isSavingPrefs}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 border border-blue-200"
                                    title="Save current column visibility and order for all users"
                                >
                                    <Save size={12} />
                                    {isSavingPrefs ? 'Saving...' : 'Sync columns'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
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

                {/* Shipped Orders with Summary Panel and Grid */}
                {!isLoading && tab === 'shipped' && (
                <div className="p-4 space-y-4">
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
                                Total pending COD: <strong>₹{codPendingTotalAmount.toLocaleString()}</strong> from {codPendingTotalCount} orders
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

                {/* Cancelled Orders */}
                {!isLoading && tab === 'cancelled' && (
                <div className="p-4">
                    <CancelledOrdersGrid
                        orders={cancelledOrders || []}
                        onViewOrder={handleViewOrder}
                        onSelectCustomer={(customer) => setSelectedCustomerId(customer.id)}
                        onRestore={(id) => mutations.uncancelOrder.mutate(id)}
                        isRestoring={mutations.uncancelOrder.isPending}
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
                        totalCount={archivedTotalCount}
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
                    onShipLines={(lineIds) => mutations.shipLines.mutate({
                        lineIds,
                        awbNumber: shipForm.awbNumber,
                        courier: shipForm.courier
                    })}
                    onClose={() => {
                        setPendingShipOrder(null);
                        setShipForm({ awbNumber: '', courier: '' });
                    }}
                    isShipping={mutations.ship.isPending || mutations.shipLines.isPending}
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

            {/* New Unified Order Modal */}
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

