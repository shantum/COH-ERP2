/**
 * Orders page - Unified order management with dropdown view selector
 * Views: Open, Shipped, Cancelled
 * Shipped view has filter chips for: All, RTO, COD Pending
 * Note: Archived view hidden from UI but auto-archive still runs. Search shows archived orders.
 */

import { useState, useMemo, useCallback } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { OrdersSearchParams } from '@coh/shared';
import { Plus, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, X, Search } from 'lucide-react';

// Custom hooks
import { useUnifiedOrdersData, type OrderView } from '../hooks/useUnifiedOrdersData';
import { useSearchOrders } from '../hooks/useSearchOrders';
import { useOrdersMutations } from '../hooks/useOrdersMutations';
import { useOrderSSE } from '../hooks/useOrderSSE';
import { useAuth } from '../hooks/useAuth';
import { useDebounce } from '../hooks/useDebounce';
import { useOrdersUrlModal, type OrderModalType } from '../hooks/useUrlModal';

// Utilities
import {
    enrichRowsWithInventory,
} from '../utils/orderHelpers';

// Components
import {
    OrdersTable,
    OrdersGridSkeleton,
    CreateOrderModal,
    CustomizationModal,
    UnifiedOrderModal,
    GlobalOrderSearch,
} from '../components/orders';
import type { CustomizationType } from '../components/orders';
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

    // View and page state - persisted in URL via TanStack Router
    const search = useSearch({ strict: false }) as OrdersSearchParams;
    const navigate = useNavigate();
    const view = (search.view || 'open') as OrderView;
    const page = search.page || 1;

    const setView = useCallback((newView: OrderView) => {
        // Clear view-specific filters when changing views
        // Open view filters: allocatedFilter, productionFilter
        // Shipped view filters: shippedFilter
        navigate({
            to: '/orders',
            search: {
                ...search,
                view: newView,
                page: 1,
                // Clear all view-specific filters when changing views
                allocatedFilter: undefined,
                productionFilter: undefined,
                shippedFilter: undefined,
            } as any,
            replace: true,
        });
    }, [navigate, search]);

    const setPage = useCallback((newPage: number) => {
        navigate({
            to: '/orders',
            search: { ...search, page: newPage } as any,
            replace: true,
        });
    }, [navigate, search]);

    // Search state - when active, overrides view filtering
    const [searchInput, setSearchInput] = useState('');
    const debouncedSearch = useDebounce(searchInput, 300);
    const isSearchMode = debouncedSearch.length >= 2;
    const [searchPage, setSearchPage] = useState(1);

    // Filter state - now URL-persisted via TanStack Router search params
    // This enables bookmarking and sharing filtered views
    const allocatedFilter = search.allocatedFilter || 'all';
    const productionFilter = search.productionFilter || 'all';
    const shippedFilter = (search.shippedFilter || 'all') as ShippedFilter;

    const setAllocatedFilter = useCallback((value: 'all' | 'allocated' | 'pending') => {
        navigate({
            to: '/orders',
            search: { ...search, allocatedFilter: value === 'all' ? undefined : value, page: 1 } as any,
            replace: true,
        });
    }, [navigate, search]);

    const setProductionFilter = useCallback((value: 'all' | 'scheduled' | 'needs' | 'ready') => {
        navigate({
            to: '/orders',
            search: { ...search, productionFilter: value === 'all' ? undefined : value, page: 1 } as any,
            replace: true,
        });
    }, [navigate, search]);

    const setShippedFilter = useCallback((value: ShippedFilter) => {
        navigate({
            to: '/orders',
            search: { ...search, shippedFilter: value === 'all' ? undefined : value, page: 1 } as any,
            replace: true,
        });
    }, [navigate, search]);

    // URL-driven modal state (enables bookmarking/sharing modal links)
    // Instead of useState, modal state is stored in URL search params
    const {
        modalType,
        selectedId: modalOrderId,
        openModal,
        closeModal,
    } = useOrdersUrlModal();

    // Derive modal state from URL params
    const showCreateOrder = modalType === 'create';
    const unifiedModalMode = (modalType === 'view' || modalType === 'edit' || modalType === 'ship' || modalType === 'customer') ? modalType : 'view';

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
        type: CustomizationType;
        value: string;
        notes?: string;
    } | null>(null);

    // Real-time updates via SSE (for multi-user collaboration)
    // When SSE is connected, polling is reduced since SSE handles updates
    const { isConnected: isSSEConnected } = useOrderSSE({ currentView: view, page });

    // Data hook - simplified, single view with pagination
    const {
        rows: serverRows,
        orders,
        pagination: viewPagination,
        allSkus,
        inventoryBalance,
        fabricStock,
        channels,
        lockedDates,
        isLoading: viewLoading,
        isFetching: viewFetching,
        refetch: viewRefetch,
    } = useUnifiedOrdersData({
        currentView: view,
        page,
        isSSEConnected,
        // Pass shipped filter for server-side filtering (rto, cod_pending)
        shippedFilter: view === 'shipped' && shippedFilter !== 'all' ? shippedFilter : undefined,
    });

    // Search data hook - only active when searching
    const {
        rows: searchRows,
        pagination: searchPagination,
        isLoading: searchLoading,
        isFetching: searchFetching,
        refetch: searchRefetch,
    } = useSearchOrders({
        query: debouncedSearch,
        page: searchPage,
        pageSize: 100,
        enabled: isSearchMode,
    });

    // Select appropriate data based on search mode
    const activeRows = isSearchMode ? searchRows : serverRows;
    const pagination = isSearchMode ? searchPagination : viewPagination;
    const isLoading = isSearchMode ? searchLoading : viewLoading;
    const isFetching = isSearchMode ? searchFetching : viewFetching;
    const refetch = isSearchMode ? searchRefetch : viewRefetch;
    const activePage = isSearchMode ? searchPage : page;
    const setActivePage = isSearchMode ? setSearchPage : setPage;

    // Find the order for the modal from the URL orderId param
    // Must be placed after `orders` is defined from useUnifiedOrdersData
    const unifiedModalOrder = useMemo(() => {
        if (!modalOrderId || !orders) return null;
        const found = orders.find((o: any) => o.id === modalOrderId);
        return found ? (found as unknown as Order) : null;
    }, [modalOrderId, orders]);

    // Modal handlers - now URL-driven for bookmarking/sharing
    const openUnifiedModal = useCallback((order: Order, mode: 'view' | 'edit' | 'ship' | 'customer' = 'view') => {
        openModal(mode as OrderModalType, order.id);
    }, [openModal]);

    // Handler for viewing customer profile from grid
    const handleViewCustomer = useCallback((order: Order) => {
        openUnifiedModal(order, 'customer');
    }, [openUnifiedModal]);

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
        onShipSuccess: () => closeModal(),
        onCreateSuccess: () => closeModal(),
        onDeleteSuccess: () => closeModal(),
        onEditSuccess: () => closeModal(),
        currentView: view,
        page,
        shippedFilter: view === 'shipped' && shippedFilter !== 'all' ? shippedFilter : undefined,
    });

    // Enrich server-flattened rows with client-side inventory data
    // This is O(n) with O(1) Map lookups - much faster than full flatten
    const currentRows = useMemo(
        () => enrichRowsWithInventory(activeRows, inventoryBalance, fabricStock),
        [activeRows, inventoryBalance, fabricStock]
    );

    // Search handlers
    const handleSearchChange = useCallback((query: string) => {
        setSearchInput(query);
        setSearchPage(1); // Reset to page 1 when search changes
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchInput('');
        setSearchPage(1);
    }, []);

    // Apply filters (only in normal view mode, not search mode)
    const filteredRows = useMemo(() => {
        let rows = currentRows;

        // Skip client-side filters in search mode - search returns all matching orders
        if (isSearchMode) {
            return rows;
        }

        // Open view specific filters
        if (view === 'open') {
            if (allocatedFilter === 'allocated') {
                rows = rows.filter(row =>
                    row.lineStatus === 'allocated' ||
                    row.lineStatus === 'picked' ||
                    row.lineStatus === 'packed'
                );
            } else if (allocatedFilter === 'pending') {
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
    }, [currentRows, view, allocatedFilter, productionFilter, isSearchMode]);

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
            // Shipping requires AWB and courier - if not provided, do nothing (UI should prompt)
            if (!data?.awbNumber || !data?.courier) {
                console.warn('Cannot ship without AWB number and courier');
                return;
            }
            startProcessing(lineId);
            mutations.markShippedLine.mutate(
                { lineId, data: { awbNumber: data.awbNumber, courier: data.courier } },
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
                type: (lineData.customizationType as CustomizationType) || 'length',
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
        (data: { type: 'length' | 'size' | 'measurements' | 'other'; value: string; notes?: string }) => {
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

    // Common grid props shared between AG-Grid and TanStack Table
    const gridProps = {
        rows: filteredRows,
        lockedDates: lockedDates || [],
        currentView: view,
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
        onCreateBatch: (data: any) => mutations.createBatch.mutate(data),
        onUpdateBatch: (id: string, data: any) => mutations.updateBatch.mutate({ id, data }),
        onDeleteBatch: (id: string) => mutations.deleteBatch.mutate(id),
        // Use mutateAsync for debounced auto-save hook compatibility
        onUpdateLineNotes: (lineId: string, notes: string) => mutations.updateLineNotes.mutateAsync({ lineId, notes }),
        onViewOrder: handleViewOrderById,
        onEditOrder: handleEditOrderUnified,
        onCancelOrder: (id: string, reason?: string) => mutations.cancelOrder.mutate({ id, reason }),
        onDeleteOrder: (id: string) => mutations.deleteOrder.mutate(id),
        onCancelLine: (lineId: string) => {
            startProcessing(lineId);
            mutations.cancelLine.mutate(lineId, { onSettled: () => stopProcessing(lineId) });
        },
        onUncancelLine: (lineId: string) => {
            startProcessing(lineId);
            mutations.uncancelLine.mutate(lineId, { onSettled: () => stopProcessing(lineId) });
        },
        onViewCustomer: handleViewCustomer,
        onCustomize: handleCustomize,
        onEditCustomization: handleEditCustomization,
        onRemoveCustomization: handleRemoveCustomization,
        onUpdateShipByDate: (orderId: string, date: string | null) => mutations.updateShipByDate.mutate({ orderId, date }),
        onForceShipLine: (lineId: string, data: { awbNumber?: string; courier?: string }) => mutations.adminShip.mutate({ lineIds: [lineId], awbNumber: data.awbNumber, courier: data.courier }),
        allocatingLines: processingLines,
        isCancellingOrder: mutations.cancelOrder.isPending,
        isCancellingLine: mutations.cancelLine.isPending,
        isUncancellingLine: mutations.uncancelLine.isPending,
        isDeletingOrder: mutations.deleteOrder.isPending,
        isAdmin: user?.role === 'admin',
        // CRITICAL: onSettled for UI/DB sync after inline edits
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
    };

    // Grid component using TanStack Table
    const {
        tableComponent,
        columnVisibilityDropdown,
    } = OrdersTable(gridProps);

    return (
        <div className="space-y-1.5">
            {/* Unified Header Bar */}
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg">
                {/* Left: Title */}
                <h1 className="text-sm font-semibold text-gray-900 whitespace-nowrap">Orders</h1>

                {/* Center: Pipeline counts (Open view only) */}
                {view === 'open' && (
                    <div className="hidden sm:flex items-center gap-2 text-[11px]">
                        <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            <span className="text-gray-500">Pending</span>
                            <span className="font-semibold text-gray-800">{pipelineCounts.pending}</span>
                        </div>
                        <span className="text-gray-300">→</span>
                        <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                            <span className="text-gray-500">Allocated</span>
                            <span className="font-semibold text-gray-800">{pipelineCounts.allocated}</span>
                        </div>
                        <span className="text-gray-300">→</span>
                        <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span className="text-gray-500">Ready</span>
                            <span className="font-semibold text-gray-800">{pipelineCounts.ready}</span>
                        </div>
                    </div>
                )}

                {/* Right: Search + New Order */}
                <div className="flex items-center gap-1.5">
                    <GlobalOrderSearch
                        searchQuery={searchInput}
                        onSearchChange={handleSearchChange}
                        onClearSearch={handleClearSearch}
                        isSearchMode={isSearchMode}
                        placeholder="Search orders..."
                    />
                    <button
                        onClick={() => openModal('create')}
                        className="btn-primary flex items-center gap-1 text-[11px] px-2 py-1 whitespace-nowrap"
                    >
                        <Plus size={12} />
                        New
                    </button>
                </div>
            </div>

            {/* Main Content Card */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {/* Top Toolbar - Filters, Actions, Grid Controls */}
                <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-gray-100 bg-gray-50/50">
                    {/* Left: View selector + filters OR Search results indicator */}
                    <div className="flex items-center gap-1.5">
                        {isSearchMode ? (
                            /* Search Mode: Show search results header */
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-100 border border-blue-200 rounded">
                                    <Search size={10} className="text-blue-600" />
                                    <span className="text-[10px] font-medium text-blue-800">
                                        Search Results
                                    </span>
                                    {pagination?.total !== undefined && (
                                        <span className="text-[10px] text-blue-600">
                                            ({pagination.total} found)
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={handleClearSearch}
                                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                                >
                                    <X size={10} />
                                    Clear
                                </button>
                            </div>
                        ) : (
                            /* Normal Mode: View selector + filters */
                            <>
                                <div className="relative">
                                    <select
                                        value={view}
                                        onChange={(e) => setView(e.target.value as OrderView)}
                                        className="appearance-none text-[10px] font-medium bg-white border border-gray-200 rounded px-1.5 py-0.5 pr-5 focus:outline-none cursor-pointer"
                                    >
                                        <option value="open">Open{viewPagination?.total ? ` (${viewPagination.total})` : ''}</option>
                                        <option value="shipped">Shipped</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                    <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                </div>

                                {view === 'open' && (
                                    <>
                                        <select
                                            value={allocatedFilter}
                                            onChange={(e) => setAllocatedFilter(e.target.value as 'all' | 'allocated' | 'pending')}
                                            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white"
                                        >
                                            <option value="all">All</option>
                                            <option value="allocated">Allocated</option>
                                            <option value="pending">Pending</option>
                                        </select>
                                        <select
                                            value={productionFilter}
                                            onChange={(e) => setProductionFilter(e.target.value as 'all' | 'scheduled' | 'needs' | 'ready')}
                                            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white"
                                        >
                                            <option value="all">All</option>
                                            <option value="scheduled">Scheduled</option>
                                            <option value="needs">Needs prod</option>
                                            <option value="ready">Ready</option>
                                        </select>
                                    </>
                                )}

                                {view === 'shipped' && (
                                    <div className="flex items-center gap-0.5">
                                        {(['all', 'rto', 'cod_pending'] as const).map((f) => (
                                            <button
                                                key={f}
                                                onClick={() => setShippedFilter(f)}
                                                className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                                                    shippedFilter === f
                                                        ? f === 'rto' ? 'bg-orange-600 text-white' : f === 'cod_pending' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'
                                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                            >
                                                {f === 'cod_pending' ? 'COD' : f.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="w-px h-3 bg-gray-200" />

                                {/* Actions */}
                                {view === 'open' && releasableOrderCount > 0 && (
                                    <button
                                        onClick={() => {
                                            if (confirm(`Release ${releasableOrderCount} shipped orders?`)) {
                                                mutations.releaseToShipped.mutate(undefined);
                                            }
                                        }}
                                        disabled={mutations.releaseToShipped.isPending}
                                        className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600 text-white font-medium"
                                    >
                                        Release {releasableOrderCount}
                                    </button>
                                )}
                                {view === 'open' && releasableCancelledCount > 0 && (
                                    <button
                                        onClick={() => {
                                            if (confirm(`Release ${releasableCancelledCount} cancelled orders?`)) {
                                                mutations.releaseToCancelled.mutate(undefined);
                                            }
                                        }}
                                        disabled={mutations.releaseToCancelled.isPending}
                                        className="text-[9px] px-1.5 py-0.5 rounded bg-red-600 text-white font-medium"
                                    >
                                        {releasableCancelledCount} Cancelled
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Right: Grid controls */}
                    <div className="flex items-center gap-1">
                        {columnVisibilityDropdown}
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className={`p-0.5 rounded ${isFetching ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Refresh"
                        >
                            <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Loading - show skeleton for initial load (no cached data) */}
                {isLoading && filteredRows.length === 0 && (
                    <OrdersGridSkeleton />
                )}

                {/* Table - show even with stale data while refreshing in background */}
                {filteredRows.length > 0 && (
                    <div>{tableComponent}</div>
                )}
                {!isLoading && filteredRows.length === 0 && (
                    <div className="text-center text-gray-400 py-12 text-xs">
                        {isSearchMode ? (
                            <div className="space-y-2">
                                <Search size={24} className="mx-auto text-gray-300" />
                                <div>No orders found for "{debouncedSearch}"</div>
                                <button
                                    onClick={handleClearSearch}
                                    className="text-blue-500 hover:text-blue-600 underline"
                                >
                                    Clear search
                                </button>
                            </div>
                        ) : (
                            <>No {VIEW_CONFIG[view].label.toLowerCase()}</>
                        )}
                    </div>
                )}

                {/* Bottom Bar - Pagination */}
                <div className="flex items-center justify-between gap-2 px-2 py-1 border-t border-gray-100 bg-gray-50/50">
                    {/* Left: Record count */}
                    <div className="text-[10px] text-gray-500">
                        {pagination && pagination.total > 0
                            ? `${((activePage - 1) * ('pageSize' in pagination ? pagination.pageSize : pagination.limit)) + 1}–${Math.min(activePage * ('pageSize' in pagination ? pagination.pageSize : pagination.limit), pagination.total)} of ${pagination.total}`
                            : '0 orders'
                        }
                        {isSearchMode && debouncedSearch && (
                            <span className="ml-1 text-blue-600">
                                for "{debouncedSearch}"
                            </span>
                        )}
                    </div>

                    {/* Right: Pagination controls */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setActivePage(activePage - 1)}
                            disabled={activePage === 1 || isFetching || !pagination}
                            className="p-0.5 text-gray-500 hover:text-gray-700 disabled:opacity-30"
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <span className="text-[10px] text-gray-600 min-w-[30px] text-center">
                            {activePage}/{pagination?.totalPages || 1}
                        </span>
                        <button
                            onClick={() => setActivePage(activePage + 1)}
                            disabled={!pagination || activePage >= pagination.totalPages || isFetching}
                            className="p-0.5 text-gray-500 hover:text-gray-700 disabled:opacity-30"
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Modals */}
            {showCreateOrder && (
                <CreateOrderModal
                    allSkus={allSkus || []}
                    channels={channels || []}
                    inventoryBalance={inventoryBalance || []}
                    onCreate={(data) => mutations.createOrder.mutate(data)}
                    onClose={closeModal}
                    isCreating={mutations.createOrder.isPending}
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
                    onClose={closeModal}
                    onSuccess={() => {
                        closeModal();
                        queryClient.invalidateQueries({ queryKey: ['orders'] });
                    }}
                />
            )}
        </div>
    );
}
