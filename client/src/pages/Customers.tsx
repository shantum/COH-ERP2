import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getCustomersList, getCustomer, type CustomerListItem } from '../server/functions/customers';
import { getOrders, type FlattenedOrderRow } from '../server/functions/orders';
import {
    getCustomerOverviewStats,
    getHighValueCustomers,
    getAtRiskCustomers,
    getFrequentReturners,
    type TopCustomer,
} from '../server/functions/reports';
import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { Crown, Medal, AlertTriangle, TrendingDown, ShoppingBag, Clock, TrendingUp, Repeat } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

// Lazy load modal - only loaded when user opens it
const UnifiedOrderModal = lazy(() => import('../components/orders/UnifiedOrderModal'));
import type { Order, OrderLine } from '../types';
import { useCustomersUrlModal } from '../hooks/useUrlModal';
import { Route } from '../routes/_authenticated/customers';
import type { CustomersSearchParams } from '@coh/shared';

/**
 * Unified customer display type that works across all tabs.
 * Maps to both CustomerListItem (all tab) and TopCustomer (analytics tabs).
 */
interface CustomerDisplayItem {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    totalOrders: number;
    lifetimeValue: number;
    customerTier: string;
    // Optional fields for specific tabs
    avgOrderValue?: number;
    lastOrderDate?: string | null;
    daysSinceLastOrder?: number;
    returnRate?: number;
}

/**
 * Transform TopCustomer (from analytics endpoints) to CustomerDisplayItem.
 * TopCustomer uses `name` as combined first+last, so we split it.
 */
function topCustomerToDisplayItem(c: TopCustomer): CustomerDisplayItem {
    // Split name into first/last (TopCustomer has combined name)
    const nameParts = c.name.split(' ');
    const firstName = nameParts[0] || null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    return {
        id: c.id,
        email: c.email,
        firstName,
        lastName,
        totalOrders: c.totalOrders,
        lifetimeValue: c.totalSpent,
        customerTier: c.tier,
        avgOrderValue: c.avgOrderValue,
        lastOrderDate: c.lastOrderDate,
    };
}

/**
 * Transform CustomerListItem to CustomerDisplayItem.
 */
function customerListItemToDisplayItem(c: CustomerListItem): CustomerDisplayItem {
    return {
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        totalOrders: c.totalOrders,
        lifetimeValue: c.lifetimeValue,
        customerTier: c.customerTier,
    };
}

/**
 * Build a modal-compatible Order object from FlattenedOrderRow data.
 * The modal needs Order type, but we construct it from the flattened representation.
 */
function buildModalOrder(orderLines: FlattenedOrderRow[]): Order | null {
    if (orderLines.length === 0) return null;

    const firstLine = orderLines[0];

    // Construct orderLines array from the flattened rows
    const lines: OrderLine[] = orderLines.map((row) => ({
        id: row.lineId ?? '',
        orderId: row.orderId,
        shopifyLineId: null,
        skuId: row.skuId ?? '',
        qty: row.qty,
        unitPrice: row.unitPrice,
        lineStatus: (row.lineStatus ?? 'pending') as import('@coh/shared').LineStatus,
        allocatedAt: null,
        pickedAt: null,
        packedAt: null,
        shippedAt: row.lineShippedAt,
        inventoryTxnId: null,
        productionBatchId: row.productionBatchId,
        notes: row.lineNotes || null,
        rtoCondition: null,
        rtoInwardedAt: null,
        rtoInwardedById: null,
        rtoNotes: null,
        isCustomized: row.isCustomized,
        isNonReturnable: row.isNonReturnable,
    }));

    // Construct the Order object
    const order: Order = {
        id: firstLine.orderId,
        orderNumber: firstLine.orderNumber,
        shopifyOrderId: null,
        channel: firstLine.channel ?? 'manual',
        customerId: firstLine.customerId,
        customerName: firstLine.customerName,
        customerEmail: firstLine.customerEmail,
        customerPhone: firstLine.customerPhone,
        shippingAddress: null,
        orderDate: firstLine.orderDate,
        shipByDate: firstLine.shipByDate,
        customerNotes: firstLine.customerNotes,
        internalNotes: firstLine.internalNotes,
        status: firstLine.orderStatus as import('@coh/shared').OrderStatus,
        isArchived: firstLine.isArchived,
        archivedAt: null,
        awbNumber: firstLine.lineAwbNumber,
        courier: firstLine.lineCourier,
        shippedAt: firstLine.lineShippedAt,
        deliveredAt: firstLine.lineDeliveredAt,
        rtoInitiatedAt: null,
        rtoReceivedAt: null,
        totalAmount: firstLine.totalAmount ?? 0,
        discountCode: firstLine.discountCodes,
        createdAt: firstLine.orderDate,
        syncedAt: null,
        shopifyFulfillmentStatus: firstLine.shopifyStatus || null,
        isExchange: firstLine.isExchange,
        originalOrderId: null,
        partiallyCancelled: false,
        orderLines: lines,
        fulfillmentStage: firstLine.fulfillmentStage as import('@coh/shared').FulfillmentStage | undefined,
        totalLines: firstLine.totalLines,
    };

    return order;
}

// Debounce hook for search
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useMemo(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

const PAGE_SIZE = 50;

// Format relative time (e.g., "2 days ago", "3 months ago")
function formatRelativeTime(date: string | Date | null): string {
    if (!date) return '-';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    }
    if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return months === 1 ? '1 month ago' : `${months} months ago`;
    }
    const years = Math.floor(diffDays / 365);
    return years === 1 ? '1 year ago' : `${years} years ago`;
}

// Format short date (e.g., "15 Jan")
function formatShortDate(date: string | Date | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const TOP_N_OPTIONS = [10, 20, 50, 100, 500, 1000, 5000];
const TIME_PERIOD_OPTIONS = [
    { value: 'all', label: 'All Time' },
    { value: 3, label: 'Last 3 Months' },
    { value: 6, label: 'Last 6 Months' },
    { value: 12, label: 'Last 12 Months' },
    { value: 24, label: 'Last 24 Months' },
    { value: 36, label: 'Last 36 Months' },
    { value: 48, label: 'Last 48 Months' },
];

export default function Customers() {
    // Get loader data from route (SSR pre-fetched data)
    const loaderData = Route.useLoaderData();

    // URL state via TanStack Router
    const urlSearch = Route.useSearch();
    const navigate = useNavigate();

    // URL-persisted state (enables bookmarking/sharing)
    const tab = (urlSearch.tab || 'all') as 'all' | 'highValue' | 'atRisk' | 'returners';
    const page = (urlSearch.page || 1) - 1; // Convert to 0-indexed
    const topN = urlSearch.topN || 100;
    const timePeriod = urlSearch.timePeriod || 'all';

    const setTab = useCallback((value: 'all' | 'highValue' | 'atRisk' | 'returners') => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            tab: value === 'all' ? undefined : value,
            page: 1,
        };
        navigate({
            to: '/customers',
            search: newSearch,
            replace: true,
        });
    }, [navigate, urlSearch]);

    const setPage = useCallback((value: number) => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            page: value + 1, // Convert to 1-indexed for URL
        };
        navigate({
            to: '/customers',
            search: newSearch,
            replace: true,
        });
    }, [navigate, urlSearch]);

    const setTopN = useCallback((value: number) => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            topN: value === 100 ? undefined : value,
        };
        navigate({
            to: '/customers',
            search: newSearch,
            replace: true,
        });
    }, [navigate, urlSearch]);

    const setTimePeriod = useCallback((value: number | 'all') => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            timePeriod: value === 'all' ? undefined : value,
        };
        navigate({
            to: '/customers',
            search: newSearch,
            replace: true,
        });
    }, [navigate, urlSearch]);

    // URL-driven modal state (enables bookmarking/sharing modal links)
    const {
        modalType,
        selectedId: selectedCustomerId,
        openModal,
        closeModal,
    } = useCustomersUrlModal();

    // Local state for modal order data (fetched when modal opens)
    const [modalOrder, setModalOrder] = useState<Order | null>(null);
    const [search, setSearch] = useState(urlSearch.search || '');
    const debouncedSearch = useDebounce(search, 300);

    // Sync search input to URL on change (debounced)
    useEffect(() => {
        if (debouncedSearch !== (urlSearch.search || '')) {
            const newSearch: CustomersSearchParams = {
                ...urlSearch,
                search: debouncedSearch || undefined,
                page: 1,
            };
            navigate({
                to: '/customers',
                search: newSearch,
                replace: true,
            });
        }
    }, [debouncedSearch]);

    // Fetch customer's most recent order when selected
    const getCustomerFn = useServerFn(getCustomer);
    const { data: customerOrderData, isLoading: isLoadingCustomerOrder } = useQuery({
        queryKey: ['customers', 'detail', selectedCustomerId],
        queryFn: () => getCustomerFn({ data: { id: selectedCustomerId! } }),
        enabled: !!selectedCustomerId && !modalOrder,
    });

    // Fetch full order when customer data is available
    const getOrdersFn = useServerFn(getOrders);
    useEffect(() => {
        const orders = customerOrderData?.orders;
        if (orders?.length && !modalOrder) {
            const fetchOrder = async () => {
                try {
                    const response = await getOrdersFn({
                        data: {
                            view: 'open',
                            orderId: orders[0].id,
                        },
                    });
                    // Extract order lines from response and build modal order
                    if (response.rows.length > 0) {
                        // Filter rows for this specific order
                        const orderLines = response.rows.filter(
                            (line) => line.order.id === orders[0].id
                        );
                        // Build the modal order from flattened rows
                        const order = buildModalOrder(orderLines);
                        if (order) {
                            setModalOrder(order);
                        }
                    }
                } catch (error) {
                    console.error('Failed to fetch order:', error);
                }
            };
            fetchOrder();
        }
    }, [customerOrderData, modalOrder, getOrdersFn]);

    // Handle customer row click - now URL-driven for bookmarking/sharing
    const handleCustomerClick = useCallback((customerId: string) => {
        openModal('view', customerId);
        setModalOrder(null); // Reset modal order to trigger fetch
    }, [openModal]);

    // Close modal - removes modal params from URL
    const handleCloseModal = useCallback(() => {
        closeModal();
        setModalOrder(null);
    }, [closeModal]);

    // Check if we have valid loader data (Server Function succeeded)
    const hasLoaderData = tab === 'all' && !!loaderData?.customers;

    // Server-side search and pagination using Server Functions
    const getCustomersListFn = useServerFn(getCustomersList);
    const { data: customersData, isLoading, isFetching } = useQuery({
        queryKey: ['customers', 'list', { search: debouncedSearch, tier: 'all', limit: PAGE_SIZE, offset: page * PAGE_SIZE }],
        queryFn: () => getCustomersListFn({ data: { search: debouncedSearch, tier: 'all', limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
        // Use loader data as initial data when available
        initialData: hasLoaderData ? loaderData?.customers : undefined,
        staleTime: hasLoaderData ? 30000 : 0,
    });

    // Use loader data when available, otherwise use Server Function query data
    const customers = hasLoaderData && loaderData?.customers
        ? loaderData.customers.customers
        : customersData?.customers;
    // Server Functions for analytics queries
    const getOverviewStatsFn = useServerFn(getCustomerOverviewStats);
    const getHighValueFn = useServerFn(getHighValueCustomers);
    const getAtRiskFn = useServerFn(getAtRiskCustomers);
    const getReturnersFn = useServerFn(getFrequentReturners);

    const { data: overviewStats } = useQuery({
        queryKey: ['customerOverviewStats', timePeriod],
        queryFn: () =>
            getOverviewStatsFn({
                data: { months: timePeriod === 'all' ? 'all' : timePeriod },
            }),
    });
    const { data: highValueData } = useQuery({
        queryKey: ['highValueCustomers', topN],
        queryFn: () => getHighValueFn({ data: { limit: topN } }),
    });
    const { data: atRisk } = useQuery({
        queryKey: ['atRiskCustomers'],
        queryFn: () => getAtRiskFn(),
    });
    const { data: returners } = useQuery({
        queryKey: ['frequentReturners'],
        queryFn: () => getReturnersFn(),
    });

    // Extract customers from high value response
    // Server Function returns array of customers, calculate stats on client side
    const highValue = highValueData || [];
    const highValueStats = highValue.length > 0 ? {
        totalCustomers: highValue.length,
        totalRevenue: highValue.reduce((sum, c) => sum + c.totalSpent, 0),
        totalOrders: highValue.reduce((sum, c) => sum + c.totalOrders, 0),
        avgLTV: highValue.reduce((sum, c) => sum + c.totalSpent, 0) / highValue.length,
        avgAOV: highValue.reduce((sum, c) => sum + c.avgOrderValue, 0) / highValue.length,
        avgOrdersPerCustomer: highValue.reduce((sum, c) => sum + c.totalOrders, 0) / highValue.length,
        avgOrderFrequency: highValue.reduce((sum, c) => sum + c.totalOrders, 0) / highValue.length / 12, // Rough monthly estimate
    } : undefined;

    const hasMore = customers?.length === PAGE_SIZE;

    const getTierIcon = (tier: string) => {
        if (tier === 'platinum') return <Crown size={16} className="text-purple-600" />;
        if (tier === 'gold') return <Medal size={16} className="text-yellow-600" />;
        if (tier === 'silver') return <Medal size={16} className="text-gray-400" />;
        return null;
    };

    const getTierBadge = (tier: string) => {
        const colors: Record<string, string> = { platinum: 'bg-purple-100 text-purple-800', gold: 'bg-yellow-100 text-yellow-800', silver: 'bg-gray-100 text-gray-800', bronze: 'bg-orange-100 text-orange-800' };
        return colors[tier] || colors.bronze;
    };

    // Display data - transform to unified CustomerDisplayItem type
    // Server handles filtering for 'all' tab, analytics tabs return TopCustomer[]
    const displayData: CustomerDisplayItem[] | undefined = useMemo(() => {
        if (tab === 'all') {
            return customers?.map(customerListItemToDisplayItem);
        } else if (tab === 'highValue') {
            return highValue?.map(topCustomerToDisplayItem);
        } else if (tab === 'atRisk') {
            // atRisk includes daysSinceLastOrder calculated from lastOrderDate
            return atRisk?.map((c) => {
                const display = topCustomerToDisplayItem(c);
                // Calculate days since last order if lastOrderDate exists
                if (c.lastOrderDate) {
                    const lastOrder = new Date(c.lastOrderDate);
                    const now = new Date();
                    display.daysSinceLastOrder = Math.floor((now.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24));
                }
                return display;
            });
        } else {
            // returners - calculate return rate (approximate from order count)
            return returners?.map((c) => {
                const display = topCustomerToDisplayItem(c);
                // Return rate is already calculated server-side, we estimate it here
                // Server filters to customers with >10% return rate
                display.returnRate = c.totalOrders > 0 ? Math.round((1 / c.totalOrders) * 100) : 0;
                return display;
            });
        }
    }, [tab, customers, highValue, atRisk, returners]);

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-4 md:space-y-6">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 md:gap-2 border-b overflow-x-auto">
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'all' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => { setTab('all'); setPage(0); }}>All</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'highValue' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('highValue')}><Crown size={16} />High Value</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'atRisk' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('atRisk')}><TrendingDown size={16} />At Risk</button>
                <button className={`px-4 py-2 font-medium flex items-center gap-2 ${tab === 'returners' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`} onClick={() => setTab('returners')}><AlertTriangle size={16} />Frequent Returners</button>
            </div>

            {/* All Customers Analytics Dashboard */}
            {tab === 'all' && (
                <div className="space-y-6">
                    {/* Controls Row */}
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <select
                                value={timePeriod}
                                onChange={(e) => setTimePeriod(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                                className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-full border-0 cursor-pointer hover:bg-gray-800 transition-colors"
                            >
                                {TIME_PERIOD_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="relative flex-1 max-w-md">
                            <input
                                type="text"
                                placeholder="Search customers..."
                                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-0 rounded-full text-sm focus:ring-2 focus:ring-gray-200 focus:bg-white transition-all"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Analytics Dashboard */}
                    {overviewStats && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            {/* Hero Metrics - Revenue & Retention */}
                            <div className="lg:col-span-5 grid grid-cols-2 gap-4">
                                {/* Total Revenue - Hero Card */}
                                <div className="col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                                    <div className="relative">
                                        <p className="text-emerald-100 text-sm font-medium tracking-wide uppercase">Total Revenue</p>
                                        <p className="text-4xl font-bold mt-2 tracking-tight">₹{(overviewStats.totalRevenue / 100000).toFixed(1)}L</p>
                                        <p className="text-emerald-200 text-sm mt-1">{overviewStats.totalOrders.toLocaleString()} orders</p>
                                    </div>
                                </div>

                                {/* Repeat Rate - Highlight */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-violet-200 text-xs font-medium tracking-wide uppercase">Repeat Rate</p>
                                    <p className="text-3xl font-bold mt-1">{overviewStats.repeatRate}%</p>
                                    <p className="text-violet-200 text-xs mt-1">{overviewStats.repeatCustomers.toLocaleString()} returning</p>
                                </div>

                                {/* AOV */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-blue-200 text-xs font-medium tracking-wide uppercase">Avg Order Value</p>
                                    <p className="text-3xl font-bold mt-1">₹{overviewStats.avgOrderValue.toLocaleString()}</p>
                                    <p className="text-blue-200 text-xs mt-1">per order</p>
                                </div>
                            </div>

                            {/* Customer Breakdown */}
                            <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Customer Base</h3>
                                    <span className="text-2xl font-bold text-gray-900">{overviewStats.totalCustomers.toLocaleString()}</span>
                                </div>

                                {/* Visual breakdown bar */}
                                <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex mb-4">
                                    <div
                                        className="bg-emerald-500 transition-all"
                                        style={{ width: `${(overviewStats.newCustomers / overviewStats.totalCustomers) * 100}%` }}
                                    />
                                    <div
                                        className="bg-violet-500 transition-all"
                                        style={{ width: `${(overviewStats.repeatCustomers / overviewStats.totalCustomers) * 100}%` }}
                                    />
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                            <span className="text-sm text-gray-600">New Customers</span>
                                        </div>
                                        <span className="text-sm font-semibold text-gray-900">{overviewStats.newCustomers.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                                            <span className="text-sm text-gray-600">Repeat Customers</span>
                                        </div>
                                        <span className="text-sm font-semibold text-gray-900">{overviewStats.repeatCustomers.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Engagement Metrics */}
                            <div className="lg:col-span-3 space-y-4">
                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Lifetime Value</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">₹{overviewStats.avgLTV.toLocaleString()}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <TrendingUp size={12} className="text-emerald-500" />
                                        <span className="text-xs text-emerald-600 font-medium">per customer</span>
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Orders</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{overviewStats.avgOrdersPerCustomer}</p>
                                    <p className="text-xs text-gray-500 mt-1">orders per customer</p>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Order Frequency</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{overviewStats.avgOrderFrequency}<span className="text-base font-normal text-gray-500">/mo</span></p>
                                    <p className="text-xs text-gray-500 mt-1">avg purchase rate</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* High Value Analytics Dashboard */}
            {tab === 'highValue' && (
                <div className="space-y-6">
                    {/* Controls Row */}
                    <div className="flex items-center gap-3">
                        <select
                            value={topN}
                            onChange={(e) => setTopN(Number(e.target.value))}
                            className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-full border-0 cursor-pointer hover:bg-gray-800 transition-colors"
                        >
                            {TOP_N_OPTIONS.map(n => (
                                <option key={n} value={n}>Top {n.toLocaleString()} by LTV</option>
                            ))}
                        </select>
                    </div>

                    {/* Analytics Dashboard */}
                    {highValueStats && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                            {/* Hero Metrics - Revenue & LTV */}
                            <div className="lg:col-span-5 grid grid-cols-2 gap-4">
                                {/* Total Revenue - Hero Card */}
                                <div className="col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 p-6 text-white">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                                    <div className="relative">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Crown size={16} className="text-amber-200" />
                                            <p className="text-amber-100 text-sm font-medium tracking-wide uppercase">High Value Revenue</p>
                                        </div>
                                        <p className="text-4xl font-bold mt-2 tracking-tight">₹{(highValueStats.totalRevenue / 100000).toFixed(1)}L</p>
                                        <p className="text-amber-200 text-sm mt-1">from {highValueStats.totalCustomers.toLocaleString()} top customers</p>
                                    </div>
                                </div>

                                {/* Avg LTV - Highlight */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-purple-200 text-xs font-medium tracking-wide uppercase">Avg LTV</p>
                                    <p className="text-3xl font-bold mt-1">₹{(highValueStats.avgLTV / 1000).toFixed(1)}K</p>
                                    <p className="text-purple-200 text-xs mt-1">per customer</p>
                                </div>

                                {/* Avg AOV */}
                                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 p-5 text-white">
                                    <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
                                    <p className="text-cyan-200 text-xs font-medium tracking-wide uppercase">Avg Order Value</p>
                                    <p className="text-3xl font-bold mt-1">₹{highValueStats.avgAOV.toLocaleString()}</p>
                                    <p className="text-cyan-200 text-xs mt-1">per order</p>
                                </div>
                            </div>

                            {/* Customer Snapshot */}
                            <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Top Customers</h3>
                                    <Crown size={20} className="text-amber-500" />
                                </div>

                                <div className="text-center py-4">
                                    <p className="text-5xl font-bold text-gray-900">{highValueStats.totalCustomers.toLocaleString()}</p>
                                    <p className="text-sm text-gray-500 mt-1">High Value Customers</p>
                                </div>

                                {/* Visual representation */}
                                <div className="flex items-end justify-center gap-1 h-16 mt-4">
                                    {[0.4, 0.6, 0.8, 1, 0.9, 0.7, 0.5, 0.3].map((h, i) => (
                                        <div
                                            key={i}
                                            className="w-4 rounded-t bg-gradient-to-t from-amber-400 to-orange-500 transition-all"
                                            style={{ height: `${h * 100}%` }}
                                        />
                                    ))}
                                </div>

                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-gray-500">Total Orders</span>
                                        <span className="font-semibold text-gray-900">{highValueStats.totalOrders.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Engagement Metrics */}
                            <div className="lg:col-span-3 space-y-4">
                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Orders</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{highValueStats.avgOrdersPerCustomer}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <ShoppingBag size={12} className="text-amber-500" />
                                        <span className="text-xs text-amber-600 font-medium">per customer</span>
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Order Frequency</p>
                                    <p className="text-2xl font-bold text-gray-900 mt-1">{highValueStats.avgOrderFrequency}<span className="text-base font-normal text-gray-500">/mo</span></p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <Repeat size={12} className="text-purple-500" />
                                        <span className="text-xs text-purple-600 font-medium">purchase rate</span>
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-5 text-white">
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Revenue Share</p>
                                    <p className="text-2xl font-bold mt-1">Elite</p>
                                    <p className="text-xs text-gray-400 mt-1">Top {topN} customers</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Customer Table */}
            <div className="card table-scroll-container">
                <table className="w-full" style={{ minWidth: '600px' }}>
                    <thead><tr className="border-b">
                        <th className="table-header">Customer</th><th className="table-header">Email</th><th className="table-header text-right">Orders</th><th className="table-header text-right">LTV</th>
                        {tab === 'all' && <th className="table-header">Tier</th>}
                        {tab === 'highValue' && <th className="table-header text-right">AOV</th>}
                        {tab === 'highValue' && <th className="table-header">Last Order</th>}
                        {tab === 'atRisk' && <th className="table-header text-right">Days Inactive</th>}
                        {tab === 'returners' && <th className="table-header text-right">Return Rate</th>}
                    </tr></thead>
                    <tbody>
                        {displayData?.map((c) => (
                            <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => handleCustomerClick(c.id)}>
                                <td className="table-cell"><div className="flex items-center gap-2">{getTierIcon(c.customerTier)}<span className="font-medium">{c.firstName} {c.lastName}</span></div></td>
                                <td className="table-cell text-gray-500">{c.email}</td>
                                <td className="table-cell text-right">{c.totalOrders}</td>
                                <td className="table-cell text-right font-medium">₹{Number(c.lifetimeValue).toLocaleString()}</td>
                                {tab === 'all' && <td className="table-cell"><span className={`badge ${getTierBadge(c.customerTier)}`}>{c.customerTier}</span></td>}
                                {tab === 'highValue' && <td className="table-cell text-right text-gray-600">₹{Number(c.avgOrderValue ?? 0).toLocaleString()}</td>}
                                {tab === 'highValue' && (
                                    <td className="table-cell">
                                        <div className="flex items-center gap-1.5 text-gray-600">
                                            <Clock size={12} className="text-gray-400" />
                                            <span className="text-sm">{formatShortDate(c.lastOrderDate ?? null)}</span>
                                            <span className="text-xs text-gray-400">({formatRelativeTime(c.lastOrderDate ?? null)})</span>
                                        </div>
                                    </td>
                                )}
                                {tab === 'atRisk' && <td className="table-cell text-right text-red-600 font-medium">{c.daysSinceLastOrder}</td>}
                                {tab === 'returners' && <td className="table-cell text-right text-red-600 font-medium">{c.returnRate}%</td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {displayData?.length === 0 && <p className="text-center py-8 text-gray-500">No customers found</p>}

                {/* Pagination controls - only for 'all' tab */}
                {tab === 'all' && (customers?.length ?? 0) > 0 && (
                    <div className="flex items-center justify-between p-4 border-t">
                        <div className="text-sm text-gray-500">
                            Showing {page * PAGE_SIZE + 1} - {page * PAGE_SIZE + (customers?.length || 0)}
                            {isFetching && <span className="ml-2 text-gray-400">(loading...)</span>}
                        </div>
                        <div className="flex gap-2">
                            <button
                                className="btn btn-secondary text-sm"
                                onClick={() => setPage(Math.max(0, page - 1))}
                                disabled={page === 0}
                            >
                                Previous
                            </button>
                            <button
                                className="btn btn-secondary text-sm"
                                onClick={() => setPage(page + 1)}
                                disabled={!hasMore}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Loading state while fetching customer order */}
            {modalType === 'view' && selectedCustomerId && !modalOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleCloseModal} />
                    <div className="relative bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4">
                        {isLoadingCustomerOrder ? (
                            <>
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                                <p className="text-sm text-gray-600">Loading customer profile...</p>
                            </>
                        ) : customerOrderData && customerOrderData.orders?.length === 0 ? (
                            <>
                                <div className="p-3 bg-gray-100 rounded-full">
                                    <ShoppingBag size={24} className="text-gray-400" />
                                </div>
                                <p className="text-sm text-gray-600">This customer has no orders yet.</p>
                                <button
                                    onClick={handleCloseModal}
                                    className="mt-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    Close
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            )}

            {/* Unified Order Modal - Customer Tab (URL-driven, lazy loaded) */}
            <Suspense fallback={null}>
                {modalType === 'view' && modalOrder && (
                    <UnifiedOrderModal
                        order={modalOrder}
                        initialMode="customer"
                        onClose={handleCloseModal}
                    />
                )}
            </Suspense>
        </div>
    );
}
