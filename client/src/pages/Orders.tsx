/**
 * Orders page - Monitoring dashboard
 * Views: All Orders, In Transit, Delivered, RTO, Cancelled
 */

import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Route } from '../routes/_authenticated/orders';
import { Plus, RefreshCw, ChevronLeft, ChevronRight, X, Search } from 'lucide-react';

// Custom hooks
import { useUnifiedOrdersData, type OrderView } from '../hooks/useUnifiedOrdersData';
import { useSearchOrders } from '../hooks/useSearchOrders';
import { useOrdersMutations } from '../hooks/useOrdersMutations';
import { useOrderSSE } from '../hooks/useOrderSSE';
import { useDebounce } from '../hooks/useDebounce';
import { useOrdersUrlModal, type OrderModalType } from '../hooks/useUrlModal';
import { invalidateAllOrderViewsStale } from '../hooks/orders/orderMutationUtils';

// Server functions
import { getOrderById } from '../server/functions/orders';

// Components
import {
    OrdersTable,
    OrdersGridSkeleton,
    GlobalOrderSearch,
    OrderViewTabs,
} from '../components/orders';

// Lazy load modals - only loaded when user opens them
const CreateOrderModal = lazy(() => import('../components/orders/CreateOrderModal'));
const UnifiedOrderModal = lazy(() => import('../components/orders/UnifiedOrderModal'));
import type { Order } from '../types';
import type { OrdersSearchParams } from '@coh/shared';

// Type for the derived order objects from useUnifiedOrdersData
interface DerivedOrder {
    id: string;
    orderNumber: string;
    status: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
}

export default function Orders() {
    const queryClient = useQueryClient();
    // Get loader data from route (SSR pre-fetched data)
    const loaderData = Route.useLoaderData();

    // View, page, and limit state - persisted in URL via TanStack Router
    const search = Route.useSearch();
    const navigate = useNavigate();
    const view = (search.view || 'all') as OrderView;
    const page = search.page || 1;
    const limit = search.limit || 250;

    const setView = useCallback((newView: OrderView) => {
        navigate({
            to: '/orders',
            search: {
                ...search,
                view: newView,
                page: 1,
            } satisfies OrdersSearchParams,
            replace: true,
        });
    }, [navigate, search]);

    const setPage = useCallback((newPage: number) => {
        navigate({
            to: '/orders',
            search: { ...search, page: newPage } satisfies OrdersSearchParams,
            replace: true,
        });
    }, [navigate, search]);

    // Search state - when active, overrides view filtering
    const [searchInput, setSearchInput] = useState('');
    const debouncedSearch = useDebounce(searchInput, 300);
    const isSearchMode = debouncedSearch.length >= 2;
    const [searchPage, setSearchPage] = useState(1);

    // URL-driven modal state
    const {
        modalType,
        selectedId: modalOrderId,
        openModal,
        closeModal,
    } = useOrdersUrlModal();

    const showCreateOrder = modalType === 'create';
    const unifiedModalMode = (modalType === 'view' || modalType === 'edit' || modalType === 'ship' || modalType === 'customer') ? modalType : 'view';

    // Real-time updates via SSE
    const { isConnected: isSSEConnected } = useOrderSSE({ currentView: view, page, limit });

    // Data hook - simplified
    const {
        rows: serverRows,
        orders,
        pagination: viewPagination,
        viewCounts,
        viewCountsLoading,
        channels,
        isLoading: viewLoading,
        isFetching: viewFetching,
        refetch: viewRefetch,
    } = useUnifiedOrdersData({
        currentView: view,
        page,
        limit,
        isSSEConnected,
        initialData: loaderData?.orders ?? null,
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

    // Find the order for the modal
    const orderFromList = useMemo(() => {
        if (!modalOrderId || !orders) return null;
        const found = (orders as DerivedOrder[]).find((o) => o.id === modalOrderId);
        return found ? (found as unknown as Order) : null;
    }, [modalOrderId, orders]);

    // Fetch order directly when orderId is in URL but not in loaded list
    const { data: fetchedOrder, isLoading: isLoadingModalOrder } = useQuery({
        queryKey: ['order', modalOrderId],
        queryFn: () => getOrderById({ data: { id: modalOrderId! } }),
        enabled: !!modalOrderId && !orderFromList && modalType !== null,
        staleTime: 30 * 1000,
    });

    const unifiedModalOrder = orderFromList || (fetchedOrder as unknown as Order) || null;

    // Modal handlers
    const handleViewCustomer = useCallback((order: Order) => {
        openModal('customer' as OrderModalType, order.id);
    }, [openModal]);

    const handleViewOrderById = useCallback((orderId: string) => {
        openModal('view' as OrderModalType, orderId);
    }, [openModal]);

    // Mutations hook
    const mutations = useOrdersMutations({
        onCreateSuccess: () => closeModal(),
        onDeleteSuccess: () => closeModal(),
        onEditSuccess: () => closeModal(),
        currentView: view,
        page,
    });

    // Search handlers
    const handleSearchChange = useCallback((query: string) => {
        setSearchInput(query);
        setSearchPage(1);
    }, []);

    const handleClearSearch = useCallback(() => {
        setSearchInput('');
        setSearchPage(1);
    }, []);

    // Grid props - simplified for monitoring dashboard
    const gridProps = {
        rows: activeRows,
        currentView: view,
        onViewOrder: handleViewOrderById,
        onViewCustomer: handleViewCustomer,
    };

    // Grid component
    const {
        tableComponent,
        columnVisibilityDropdown,
    } = OrdersTable(gridProps);

    return (
        <div className="space-y-1.5">
            {/* Header Bar */}
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg">
                <h1 className="text-sm font-semibold text-gray-900 whitespace-nowrap">Orders</h1>

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
                {/* Top Toolbar */}
                <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-1.5">
                        {isSearchMode ? (
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
                            <OrderViewTabs
                                currentView={view}
                                onViewChange={setView}
                                counts={viewCounts}
                                isLoading={viewCountsLoading}
                            />
                        )}
                    </div>

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

                {/* Loading */}
                {isLoading && activeRows.length === 0 && <OrdersGridSkeleton />}

                {/* Table */}
                {activeRows.length > 0 && <div>{tableComponent}</div>}
                {!isLoading && activeRows.length === 0 && (
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
                            <>No orders</>
                        )}
                    </div>
                )}

                {/* Bottom Bar - Pagination */}
                <div className="flex items-center justify-between gap-2 px-2 py-1 border-t border-gray-100 bg-gray-50/50">
                    <div className="text-[10px] text-gray-500">
                        {pagination && pagination.total > 0
                            ? `${((activePage - 1) * ('pageSize' in pagination ? pagination.pageSize : pagination.limit)) + 1}–${Math.min(activePage * ('pageSize' in pagination ? pagination.pageSize : pagination.limit), pagination.total)} of ${pagination.total}`
                            : '0 orders'
                        }
                        {isSearchMode && debouncedSearch && (
                            <span className="ml-1 text-blue-600">for "{debouncedSearch}"</span>
                        )}
                    </div>

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

            {/* Modals - lazy loaded */}
            <Suspense fallback={null}>
                {showCreateOrder && (
                    <CreateOrderModal
                        channels={channels || []}
                        onCreate={(data) => mutations.createOrder.mutate(data)}
                        onClose={closeModal}
                        isCreating={mutations.createOrder.isPending}
                    />
                )}

                {isLoadingModalOrder && modalOrderId && !unifiedModalOrder && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 flex items-center gap-3">
                            <RefreshCw className="h-5 w-5 animate-spin text-primary-600" />
                            <span>Loading order...</span>
                        </div>
                    </div>
                )}

                {unifiedModalOrder && (
                    <UnifiedOrderModal
                        order={unifiedModalOrder}
                        initialMode={unifiedModalMode}
                        onClose={closeModal}
                        onSuccess={() => {
                            closeModal();
                            invalidateAllOrderViewsStale(queryClient);
                        }}
                    />
                )}
            </Suspense>
        </div>
    );
}
