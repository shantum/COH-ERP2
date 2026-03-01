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
import { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Crown, TrendingDown, AlertTriangle, ShoppingBag,
    Search, ChevronLeft, ChevronRight, Users, Repeat, ArrowUpRight, RotateCcw,
} from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

import type { Order, OrderLine } from '../types';
import { useCustomersUrlModal } from '../hooks/useUrlModal';
import { Route } from '../routes/_authenticated/customers';
import type { CustomersSearchParams } from '@coh/shared';
import { reportError } from '@/utils/errorReporter';
import { cn } from '@/lib/utils';
import {
    getTierConfig,
    calculateHealthScore,
    getHealthScoreColor,
    getInitials,
} from '@/utils/customerIntelligence';

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
    avgOrderValue?: number;
    lastOrderDate?: string | null;
    daysSinceLastOrder?: number;
    returnRate?: number;
    firstOrderDate?: string | null;
}

/**
 * Transform TopCustomer (from analytics endpoints) to CustomerDisplayItem.
 */
function topCustomerToDisplayItem(c: TopCustomer): CustomerDisplayItem {
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
 */
function buildModalOrder(orderLines: FlattenedOrderRow[]): Order | null {
    if (orderLines.length === 0) return null;

    const firstLine = orderLines[0];

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
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

const PAGE_SIZE = 50;

// Format relative time
function formatRelativeTime(date: string | Date | null): string {
    if (!date) return '-';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks}w ago`;
    }
    if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return `${months}mo ago`;
    }
    const years = Math.floor(diffDays / 365);
    return `${years}y ago`;
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

const TAB_CONFIG = [
    { key: 'all' as const, label: 'All', icon: null },
    { key: 'highValue' as const, label: 'High Value', icon: Crown },
    { key: 'atRisk' as const, label: 'At Risk', icon: TrendingDown },
    { key: 'returners' as const, label: 'Returners', icon: AlertTriangle },
];

export default function Customers() {
    const loaderData = Route.useLoaderData();
    const urlSearch = Route.useSearch();
    const navigate = useNavigate();

    const tab = (urlSearch.tab || 'all') as 'all' | 'highValue' | 'atRisk' | 'returners';
    const page = (urlSearch.page || 1) - 1;
    const topN = urlSearch.topN || 100;
    const timePeriod = urlSearch.timePeriod || 'all';

    const setTab = useCallback((value: 'all' | 'highValue' | 'atRisk' | 'returners') => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            tab: value === 'all' ? undefined : value,
            page: 1,
        };
        navigate({ to: '/customers', search: newSearch, replace: true });
    }, [navigate, urlSearch]);

    const setPage = useCallback((value: number) => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            page: value + 1,
        };
        navigate({ to: '/customers', search: newSearch, replace: true });
    }, [navigate, urlSearch]);

    const setTopN = useCallback((value: number) => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            topN: value === 100 ? undefined : value,
        };
        navigate({ to: '/customers', search: newSearch, replace: true });
    }, [navigate, urlSearch]);

    const setTimePeriod = useCallback((value: number | 'all') => {
        const newSearch: CustomersSearchParams = {
            ...urlSearch,
            timePeriod: value === 'all' ? undefined : value,
        };
        navigate({ to: '/customers', search: newSearch, replace: true });
    }, [navigate, urlSearch]);

    const {
        modalType,
        selectedId: selectedCustomerId,
        closeModal,
    } = useCustomersUrlModal();

    const [modalOrder, setModalOrder] = useState<Order | null>(null);
    const [search, setSearch] = useState(urlSearch.search || '');
    const debouncedSearch = useDebounce(search, 300);

    useEffect(() => {
        if (debouncedSearch !== (urlSearch.search || '')) {
            const newSearch: CustomersSearchParams = {
                ...urlSearch,
                search: debouncedSearch || undefined,
                page: 1,
            };
            navigate({ to: '/customers', search: newSearch, replace: true });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch]);

    const getCustomerFn = useServerFn(getCustomer);
    const { data: customerOrderData, isLoading: isLoadingCustomerOrder } = useQuery({
        queryKey: ['customers', 'detail', selectedCustomerId],
        queryFn: () => getCustomerFn({ data: { id: selectedCustomerId! } }),
        enabled: !!selectedCustomerId && !modalOrder,
    });

    const getOrdersFn = useServerFn(getOrders);
    useEffect(() => {
        const orders = customerOrderData?.orders;
        if (orders?.length && !modalOrder) {
            const fetchOrder = async () => {
                try {
                    const response = await getOrdersFn({
                        data: { view: 'all', orderId: orders[0].id },
                    });
                    if (response.rows.length > 0) {
                        const orderLines = response.rows.filter(
                            (line) => line.order.id === orders[0].id
                        );
                        const order = buildModalOrder(orderLines);
                        if (order) setModalOrder(order);
                    }
                } catch (error) {
                    console.error('Failed to fetch order:', error);
                    reportError(error, { page: 'Customers', action: 'fetchOrder', orderId: orders[0].id });
                }
            };
            fetchOrder();
        }
    }, [customerOrderData, modalOrder, getOrdersFn]);

    const handleCustomerClick = useCallback((email: string) => {
        navigate({ to: '/customers/$customerId', params: { customerId: email } });
    }, [navigate]);

    const handleCloseModal = useCallback(() => {
        closeModal();
        setModalOrder(null);
    }, [closeModal]);

    const hasLoaderData = tab === 'all' && !!loaderData?.customers;

    const getCustomersListFn = useServerFn(getCustomersList);
    const { data: customersData, isLoading, isFetching } = useQuery({
        queryKey: ['customers', 'list', { search: debouncedSearch, tier: 'all', limit: PAGE_SIZE, offset: page * PAGE_SIZE }],
        queryFn: () => getCustomersListFn({ data: { search: debouncedSearch, tier: 'all', limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
        initialData: hasLoaderData ? loaderData?.customers : undefined,
        staleTime: hasLoaderData ? 30000 : 0,
    });

    const customers = hasLoaderData && loaderData?.customers
        ? loaderData.customers.customers
        : customersData?.customers;

    const getOverviewStatsFn = useServerFn(getCustomerOverviewStats);
    const getHighValueFn = useServerFn(getHighValueCustomers);
    const getAtRiskFn = useServerFn(getAtRiskCustomers);
    const getReturnersFn = useServerFn(getFrequentReturners);

    const { data: overviewStats } = useQuery({
        queryKey: ['customerOverviewStats', timePeriod],
        queryFn: () => getOverviewStatsFn({ data: { months: timePeriod === 'all' ? 'all' : timePeriod } }),
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

    const highValue = useMemo(() => highValueData || [], [highValueData]);

    const hasMore = customers?.length === PAGE_SIZE;

    const displayData: CustomerDisplayItem[] | undefined = useMemo(() => {
        if (tab === 'all') {
            return customers?.map(customerListItemToDisplayItem);
        } else if (tab === 'highValue') {
            return highValue?.map(topCustomerToDisplayItem);
        } else if (tab === 'atRisk') {
            return atRisk?.map((c) => {
                const display = topCustomerToDisplayItem(c);
                if (c.lastOrderDate) {
                    const lastOrder = new Date(c.lastOrderDate);
                    const now = new Date();
                    display.daysSinceLastOrder = Math.floor((now.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24));
                }
                return display;
            });
        } else {
            return returners?.map((c) => {
                const display = topCustomerToDisplayItem(c);
                display.returnRate = c.totalOrders > 0 ? Math.round((1 / c.totalOrders) * 100) : 0;
                return display;
            });
        }
    }, [tab, customers, highValue, atRisk, returners]);

    if (isLoading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-[#D4A574] border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-[#8C7B6B]">Loading customers...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#FAF9F7]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-[#1A1A1A] tracking-tight font-display">
                            Customers
                        </h1>
                        {overviewStats && (
                            <p className="text-sm text-[#8C7B6B] mt-1">
                                {overviewStats.totalCustomers.toLocaleString()} total
                            </p>
                        )}
                    </div>
                </div>

                {/* Stats Row */}
                {tab === 'all' && overviewStats && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
                        <StatCard
                            label="Repeat Customers"
                            value={overviewStats.repeatCustomers.toLocaleString()}
                            subtitle={`${overviewStats.repeatRate}% repeat rate`}
                            icon={<Repeat className="w-4 h-4" />}
                            iconBg="bg-[#F0E6DB]"
                            iconColor="text-[#D4A574]"
                        />
                        <StatCard
                            label="Avg Order Value"
                            value={`₹${overviewStats.avgOrderValue.toLocaleString()}`}
                            subtitle="per order"
                            icon={<ArrowUpRight className="w-4 h-4" />}
                            iconBg="bg-emerald-50"
                            iconColor="text-[#5B9A6F]"
                        />
                        <StatCard
                            label="Return Rate"
                            value={`${((overviewStats.totalOrders > 0 ? (overviewStats.repeatCustomers / overviewStats.totalCustomers) * 100 : 0)).toFixed(1)}%`}
                            subtitle={`${overviewStats.totalOrders.toLocaleString()} total orders`}
                            icon={<RotateCcw className="w-4 h-4" />}
                            iconBg="bg-orange-50"
                            iconColor="text-orange-500"
                        />
                        <StatCard
                            label="New This Month"
                            value={overviewStats.newCustomers.toLocaleString()}
                            subtitle="new customers"
                            icon={<Users className="w-4 h-4" />}
                            iconBg="bg-[#F5F0EB]"
                            iconColor="text-[#8C7B6B]"
                        />
                    </div>
                )}

                {/* Filter bar */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                    {/* Tab pills */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                        {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                onClick={() => { setTab(key); if (key === 'all') setPage(0); }}
                                className={cn(
                                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                                    tab === key
                                        ? 'bg-[#1A1A1A] text-white'
                                        : 'bg-[#F5F0EB] text-[#6B5E50] hover:bg-[#EDE5DB]',
                                )}
                            >
                                {Icon && <Icon className="w-3.5 h-3.5" />}
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Search + filters */}
                    <div className="flex items-center gap-2">
                        {tab === 'all' && (
                            <select
                                value={timePeriod}
                                onChange={(e) => setTimePeriod(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                                className="h-9 px-3 text-sm text-[#6B5E50] bg-white border border-[#E8E4DF] rounded-lg focus:ring-2 focus:ring-[#D4A574]/30 focus:border-[#D4A574] outline-none"
                            >
                                {TIME_PERIOD_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        )}
                        {tab === 'highValue' && (
                            <select
                                value={topN}
                                onChange={(e) => setTopN(Number(e.target.value))}
                                className="h-9 px-3 text-sm text-[#6B5E50] bg-white border border-[#E8E4DF] rounded-lg focus:ring-2 focus:ring-[#D4A574]/30 focus:border-[#D4A574] outline-none"
                            >
                                {TOP_N_OPTIONS.map(n => (
                                    <option key={n} value={n}>Top {n.toLocaleString()}</option>
                                ))}
                            </select>
                        )}
                        {tab === 'all' && (
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B5AAA0]" />
                                <input
                                    type="text"
                                    placeholder="Search customers..."
                                    className="h-9 w-full sm:w-64 pl-9 pr-3 text-sm bg-white border border-[#E8E4DF] rounded-lg text-[#1A1A1A] placeholder:text-[#B5AAA0] focus:ring-2 focus:ring-[#D4A574]/30 focus:border-[#D4A574] outline-none"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Customer Table */}
                <div className="bg-white rounded-xl border border-[#E8E4DF] overflow-hidden">
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[#E8E4DF]">
                                    <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Customer</th>
                                    <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Tier</th>
                                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Orders</th>
                                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Lifetime Value</th>
                                    {(tab === 'all' || tab === 'highValue') && <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Avg Order</th>}
                                    {(tab === 'all' || tab === 'highValue') && <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Last Order</th>}
                                    {tab === 'atRisk' && <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Days Inactive</th>}
                                    {tab === 'returners' && <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3">Return Rate</th>}
                                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-[#B5AAA0] px-4 py-3 w-20">Health</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F5F0EB]">
                                {displayData?.map((c) => {
                                    const tier = getTierConfig(c.customerTier);
                                    const healthScore = calculateHealthScore({
                                        id: c.id,
                                        totalOrders: c.totalOrders,
                                        lifetimeValue: c.lifetimeValue,
                                        lastOrderDate: c.lastOrderDate,
                                        firstOrderDate: c.firstOrderDate,
                                        returnRate: c.returnRate,
                                    });
                                    const healthColor = getHealthScoreColor(healthScore);
                                    const lastOrderDays = c.lastOrderDate
                                        ? Math.floor((Date.now() - new Date(c.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
                                        : null;

                                    return (
                                        <tr
                                            key={c.id}
                                            className="hover:bg-[#FAF9F7] cursor-pointer transition-colors"
                                            onClick={() => handleCustomerClick(c.email)}
                                        >
                                            {/* Customer cell with avatar */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0',
                                                        tier.avatarBg || tier.bg,
                                                    )}>
                                                        {getInitials(c.firstName, c.lastName)}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-[#1A1A1A] truncate">
                                                            {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}
                                                        </p>
                                                        <p className="text-xs text-[#B5AAA0] truncate">{c.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            {/* Tier badge */}
                                            <td className="px-4 py-3">
                                                <span className={cn(
                                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                                                    tier.bg, tier.text,
                                                )}>
                                                    {c.customerTier}
                                                </span>
                                            </td>
                                            {/* Orders */}
                                            <td className="px-4 py-3 text-right text-sm text-[#6B5E50] tabular-nums">
                                                {c.totalOrders}
                                            </td>
                                            {/* LTV */}
                                            <td className="px-4 py-3 text-right text-sm font-semibold text-[#1A1A1A] tabular-nums font-display">
                                                ₹{Number(c.lifetimeValue).toLocaleString()}
                                            </td>
                                            {/* Avg Order */}
                                            {(tab === 'all' || tab === 'highValue') && (
                                                <td className="px-4 py-3 text-right text-sm text-[#6B5E50] tabular-nums">
                                                    {c.avgOrderValue
                                                        ? `₹${Number(c.avgOrderValue).toLocaleString()}`
                                                        : c.totalOrders > 0
                                                            ? `₹${Math.round(Number(c.lifetimeValue) / c.totalOrders).toLocaleString()}`
                                                            : '-'}
                                                </td>
                                            )}
                                            {/* Last Order */}
                                            {(tab === 'all' || tab === 'highValue') && (
                                                <td className="px-4 py-3">
                                                    {c.lastOrderDate ? (
                                                        <span className={cn(
                                                            'text-sm',
                                                            lastOrderDays !== null && lastOrderDays > 90 ? 'text-[#C0392B]' : 'text-[#6B5E50]',
                                                        )}>
                                                            {formatRelativeTime(c.lastOrderDate)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-sm text-[#B5AAA0]">-</span>
                                                    )}
                                                </td>
                                            )}
                                            {/* Days inactive (at risk tab) */}
                                            {tab === 'atRisk' && (
                                                <td className="px-4 py-3 text-right text-sm font-medium text-[#C0392B] tabular-nums">
                                                    {c.daysSinceLastOrder}d
                                                </td>
                                            )}
                                            {/* Return rate (returners tab) */}
                                            {tab === 'returners' && (
                                                <td className="px-4 py-3 text-right text-sm font-medium text-[#C0392B] tabular-nums">
                                                    {c.returnRate}%
                                                </td>
                                            )}
                                            {/* Health Score Ring */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end">
                                                    <div className="relative w-8 h-8">
                                                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                                            <circle cx="18" cy="18" r="14" fill="none" stroke="#F5F0EB" strokeWidth="3" />
                                                            <circle
                                                                cx="18" cy="18" r="14" fill="none" stroke={healthColor} strokeWidth="3"
                                                                strokeLinecap="round"
                                                                strokeDasharray={2 * Math.PI * 14}
                                                                strokeDashoffset={2 * Math.PI * 14 - (healthScore / 100) * 2 * Math.PI * 14}
                                                            />
                                                        </svg>
                                                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color: healthColor }}>
                                                            {healthScore}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card Layout */}
                    <div className="md:hidden divide-y divide-[#F5F0EB]">
                        {displayData?.map((c) => {
                            const tier = getTierConfig(c.customerTier);
                            const healthScore = calculateHealthScore({
                                id: c.id,
                                totalOrders: c.totalOrders,
                                lifetimeValue: c.lifetimeValue,
                                lastOrderDate: c.lastOrderDate,
                                firstOrderDate: c.firstOrderDate,
                                returnRate: c.returnRate,
                            });
                            const healthColor = getHealthScoreColor(healthScore);

                            return (
                                <button
                                    key={c.id}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAF9F7] transition-colors text-left"
                                    onClick={() => handleCustomerClick(c.email)}
                                >
                                    <div className={cn(
                                        'w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0',
                                        tier.avatarBg || tier.bg,
                                    )}>
                                        {getInitials(c.firstName, c.lastName)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-[#1A1A1A] truncate">
                                                {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}
                                            </p>
                                            <span className={cn(
                                                'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex-shrink-0',
                                                tier.bg, tier.text,
                                            )}>
                                                {c.customerTier}
                                            </span>
                                        </div>
                                        <p className={cn(
                                            'text-xs',
                                            c.lastOrderDate && Math.floor((Date.now() - new Date(c.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24)) > 90
                                                ? 'text-[#C0392B]' : 'text-[#8C7B6B]',
                                        )}>
                                            {c.totalOrders} order{c.totalOrders !== 1 ? 's' : ''} &middot; ₹{Number(c.lifetimeValue).toLocaleString()}
                                            {c.lastOrderDate && ` · ${formatRelativeTime(c.lastOrderDate)}`}
                                        </p>
                                    </div>
                                    <div className="relative w-8 h-8 flex-shrink-0">
                                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                            <circle cx="18" cy="18" r="14" fill="none" stroke="#F5F0EB" strokeWidth="3" />
                                            <circle
                                                cx="18" cy="18" r="14" fill="none" stroke={healthColor} strokeWidth="3"
                                                strokeLinecap="round"
                                                strokeDasharray={2 * Math.PI * 14}
                                                strokeDashoffset={2 * Math.PI * 14 - (healthScore / 100) * 2 * Math.PI * 14}
                                            />
                                        </svg>
                                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color: healthColor }}>
                                            {healthScore}
                                        </span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-[#B5AAA0] flex-shrink-0" />
                                </button>
                            );
                        })}
                    </div>

                    {displayData?.length === 0 && (
                        <div className="py-16 text-center">
                            <Users className="w-10 h-10 text-[#E8E4DF] mx-auto mb-3" />
                            <p className="text-sm text-[#8C7B6B]">No customers found</p>
                        </div>
                    )}

                    {/* Pagination */}
                    {tab === 'all' && (customers?.length ?? 0) > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E8E4DF]">
                            <p className="text-xs text-[#8C7B6B]">
                                Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + (customers?.length || 0)}
                                {overviewStats && ` of ${overviewStats.totalCustomers.toLocaleString()} customers`}
                                {isFetching && <span className="ml-1 text-[#B5AAA0]">updating...</span>}
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#6B5E50] hover:bg-[#F5F0EB] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    onClick={() => setPage(Math.max(0, page - 1))}
                                    disabled={page === 0}
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                {/* Page number buttons */}
                                {(() => {
                                    const totalPages = overviewStats
                                        ? Math.ceil(overviewStats.totalCustomers / PAGE_SIZE)
                                        : (hasMore ? page + 2 : page + 1);
                                    const pages: (number | '...')[] = [];
                                    for (let i = 0; i < Math.min(3, totalPages); i++) pages.push(i);
                                    if (page > 3) pages.push('...');
                                    if (page > 2 && page < totalPages - 3) pages.push(page);
                                    if (totalPages > 4 && page < totalPages - 4) pages.push('...');
                                    if (totalPages > 3) {
                                        for (let i = Math.max(totalPages - 1, 3); i < totalPages; i++) {
                                            if (!pages.includes(i)) pages.push(i);
                                        }
                                    }
                                    // Deduplicate
                                    const unique = pages.filter((v, i, a) => a.indexOf(v) === i);
                                    return unique.map((p, i) =>
                                        p === '...' ? (
                                            <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-[#B5AAA0]">...</span>
                                        ) : (
                                            <button
                                                key={p}
                                                onClick={() => setPage(p)}
                                                className={cn(
                                                    'w-8 h-8 rounded-lg text-xs font-medium transition-colors',
                                                    p === page
                                                        ? 'bg-[#1A1A1A] text-white'
                                                        : 'text-[#6B5E50] hover:bg-[#F5F0EB]',
                                                )}
                                            >
                                                {p + 1}
                                            </button>
                                        ),
                                    );
                                })()}
                                <button
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#6B5E50] hover:bg-[#F5F0EB] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    onClick={() => setPage(page + 1)}
                                    disabled={!hasMore}
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Loading modal for customer order */}
                {modalType === 'view' && selectedCustomerId && !modalOrder && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-[#1A1A1A]/40 backdrop-blur-sm" onClick={handleCloseModal} />
                        <div className="relative bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4">
                            {isLoadingCustomerOrder ? (
                                <>
                                    <div className="w-8 h-8 border-2 border-[#D4A574] border-t-transparent rounded-full animate-spin" />
                                    <p className="text-sm text-[#8C7B6B]">Loading customer profile...</p>
                                </>
                            ) : customerOrderData && customerOrderData.orders?.length === 0 ? (
                                <>
                                    <div className="p-3 bg-[#F5F0EB] rounded-full">
                                        <ShoppingBag className="w-6 h-6 text-[#B5AAA0]" />
                                    </div>
                                    <p className="text-sm text-[#8C7B6B]">This customer has no orders yet.</p>
                                    <button
                                        onClick={handleCloseModal}
                                        className="mt-2 px-4 py-2 text-sm font-medium text-[#6B5E50] hover:bg-[#F5F0EB] rounded-lg transition-colors"
                                    >
                                        Close
                                    </button>
                                </>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function StatCard({ label, value, subtitle, icon, iconBg, iconColor }: {
    label: string;
    value: string;
    subtitle: string;
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
}) {
    return (
        <div className="bg-white rounded-xl border border-[#E8E4DF] p-4">
            <div className="flex items-center gap-3">
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', iconBg)}>
                    <span className={iconColor}>{icon}</span>
                </div>
                <div className="min-w-0">
                    <p className="text-lg font-bold text-[#1A1A1A] tabular-nums leading-tight font-display">{value}</p>
                    <p className="text-[10px] uppercase tracking-wider text-[#B5AAA0] font-medium">{label}</p>
                </div>
            </div>
            <p className="text-xs text-[#8C7B6B] mt-2">{subtitle}</p>
        </div>
    );
}
