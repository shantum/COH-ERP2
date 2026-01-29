/**
 * OrdersAnalyticsBar - Clean, responsive dashboard metrics
 * Mobile-first design with collapsible sections
 *
 * SSR-optimized: Accepts initialData from route loader for instant render.
 * Uses server-side caching for efficient data fetching.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Users, UserPlus, AlertCircle, RefreshCcw } from 'lucide-react';
import { formatCurrency } from '@coh/shared';
import { getOrdersAnalytics, type OrdersAnalyticsResponse, type CustomerStats } from '../../server/functions/dashboard';

interface OrdersAnalyticsBarProps {
    /** SSR pre-fetched data from route loader */
    initialData?: OrdersAnalyticsResponse | null;
}

export function OrdersAnalyticsBar({ initialData }: OrdersAnalyticsBarProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const { data: analytics, isLoading, error, refetch } = useQuery<OrdersAnalyticsResponse>({
        queryKey: ['dashboard', 'ordersAnalytics'],
        queryFn: () => getOrdersAnalytics(),
        initialData: initialData ?? undefined,
        staleTime: 30 * 1000,
        refetchInterval: 60 * 1000,
    });

    // Show skeleton only if no initial data and still loading
    if (isLoading && !initialData) {
        return (
            <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <div className="h-8 sm:h-10 bg-gray-100 rounded flex-1"></div>
                    <div className="h-8 sm:h-10 bg-gray-100 rounded flex-1"></div>
                    <div className="h-8 sm:h-10 bg-gray-100 rounded flex-1"></div>
                </div>
            </div>
        );
    }

    // Show error state
    if (error && !analytics) {
        return (
            <div className="bg-white border border-red-200 rounded-lg p-3 sm:p-4">
                <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">Failed to load analytics</span>
                    <button
                        onClick={() => refetch()}
                        className="ml-auto inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                    >
                        <RefreshCcw className="w-3 h-3" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!analytics) return null;

    const codPercent = analytics.totalOrders > 0
        ? Math.round((analytics.paymentSplit.cod.count / analytics.totalOrders) * 100)
        : 0;

    // Use server-computed values for SSR consistency (avoids hydration mismatch)
    const { daysInThisMonth, daysInLastMonth } = analytics;

    const ChangeIndicator = ({ change }: { change: number | null | undefined }) => {
        if (change === null || change === undefined) return null;
        const isPositive = change > 0;
        const isNegative = change < 0;
        return (
            <span className={`inline-flex items-center gap-0.5 text-[10px] sm:text-xs font-medium px-1 sm:px-1.5 py-0.5 rounded ${
                isPositive ? 'bg-emerald-50 text-emerald-600' :
                isNegative ? 'bg-red-50 text-red-600' :
                'bg-gray-50 text-gray-500'
            }`}>
                {isPositive ? <TrendingUp size={10} /> : isNegative ? <TrendingDown size={10} /> : <Minus size={10} />}
                {Math.abs(change).toFixed(0)}%
            </span>
        );
    };

    const PipelineStep = ({ color, label, count }: { color: string; label: string; count: number }) => (
        <div className="flex items-center gap-1.5 sm:gap-2">
            <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${color}`}></div>
            <div>
                <div className="text-[10px] sm:text-xs text-gray-500 leading-none">{label}</div>
                <div className="text-sm sm:text-base font-semibold text-gray-900 leading-tight">{count}</div>
            </div>
        </div>
    );

    const RevenueCard = ({
        label,
        total,
        orderCount,
        change,
        avgDays,
        customers
    }: {
        label: string;
        total: number;
        orderCount: number;
        change: number | null | undefined;
        avgDays?: number;
        customers?: CustomerStats;
    }) => (
        <div className="bg-white rounded-lg border border-gray-100 p-2 sm:p-3 min-w-[85px] sm:min-w-[100px] flex-shrink-0">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-0.5 sm:mb-1">{label}</div>
            <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-semibold text-gray-900">{formatCurrency(total)}</span>
                <ChangeIndicator change={change} />
            </div>
            <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5">
                {orderCount} orders
                {avgDays && avgDays > 0 && (
                    <span className="text-gray-300 ml-1 hidden sm:inline">
                        ({formatCurrency(total / avgDays)}/d)
                    </span>
                )}
            </div>
            {/* New vs Returning Customers - hide on mobile for space */}
            {customers && (customers.newCustomers > 0 || customers.returningCustomers > 0) && (
                <div className="hidden sm:flex items-center gap-2 mt-1.5 text-[10px]">
                    <span className="inline-flex items-center gap-0.5 text-emerald-600">
                        <UserPlus size={9} />
                        {customers.newPercent}%
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="inline-flex items-center gap-0.5 text-blue-600">
                        <Users size={9} />
                        {customers.returningPercent}%
                    </span>
                </div>
            )}
        </div>
    );

    return (
        <div className="bg-gradient-to-b from-gray-50 to-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {/* Header Row - Always Visible */}
            <div
                className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3 cursor-pointer hover:bg-gray-50/80 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Order Pipeline - compact on mobile */}
                <div className="flex items-center gap-3 sm:gap-4 md:gap-6">
                    <PipelineStep color="bg-amber-400" label="Pending" count={analytics.pendingOrders} />
                    <span className="text-gray-300 text-xs hidden sm:inline">→</span>
                    <PipelineStep color="bg-blue-400" label="Allocated" count={analytics.allocatedOrders} />
                    <span className="text-gray-300 text-xs hidden sm:inline">→</span>
                    <PipelineStep color="bg-emerald-400" label="Ready" count={analytics.readyToShip} />
                </div>

                {/* Payment Split - simplified on mobile */}
                <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                        <div className="text-right">
                            <span className="text-[10px] sm:text-xs font-medium text-orange-600">COD</span>
                            <span className="text-[10px] sm:text-xs text-gray-400 ml-0.5 sm:ml-1">{analytics.paymentSplit.cod.count}</span>
                        </div>
                        <div className="w-12 sm:w-20 h-1.5 sm:h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-500"
                                style={{ width: `${codPercent}%` }}
                            />
                        </div>
                        <div className="text-left">
                            <span className="text-[10px] sm:text-xs text-gray-400 mr-0.5 sm:mr-1">{analytics.paymentSplit.prepaid.count}</span>
                            <span className="text-[10px] sm:text-xs font-medium text-indigo-600">Prepaid</span>
                        </div>
                    </div>
                </div>

                {/* Toggle Button */}
                <button className="p-1 sm:p-1.5 hover:bg-gray-100 rounded-lg transition-colors ml-auto sm:ml-0">
                    {isExpanded ? (
                        <ChevronUp size={16} className="text-gray-400 sm:w-[18px] sm:h-[18px]" />
                    ) : (
                        <ChevronDown size={16} className="text-gray-400 sm:w-[18px] sm:h-[18px]" />
                    )}
                </button>
            </div>

            {/* Expanded Section */}
            {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50">
                    {/* Revenue Timeline - horizontal scroll on mobile */}
                    <div className="px-2 sm:px-4 py-2 sm:py-3">
                        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-gray-200 snap-x snap-mandatory">
                            <div className="snap-start">
                                <RevenueCard
                                    label="Today"
                                    total={analytics.revenue?.today?.total || 0}
                                    orderCount={analytics.revenue?.today?.orderCount || 0}
                                    change={analytics.revenue?.today?.change}
                                    customers={analytics.revenue?.today?.customers}
                                />
                            </div>
                            <div className="snap-start">
                                <RevenueCard
                                    label="Yesterday"
                                    total={analytics.revenue?.yesterday?.total || 0}
                                    orderCount={analytics.revenue?.yesterday?.orderCount || 0}
                                    change={analytics.revenue?.yesterday?.change}
                                    customers={analytics.revenue?.yesterday?.customers}
                                />
                            </div>
                            <div className="snap-start">
                                <RevenueCard
                                    label="7 Days"
                                    total={analytics.revenue?.last7Days?.total || 0}
                                    orderCount={analytics.revenue?.last7Days?.orderCount || 0}
                                    change={analytics.revenue?.last7Days?.change}
                                    avgDays={7}
                                    customers={analytics.revenue?.last7Days?.customers}
                                />
                            </div>
                            <div className="snap-start">
                                <RevenueCard
                                    label="30 Days"
                                    total={analytics.revenue?.last30Days?.total || 0}
                                    orderCount={analytics.revenue?.last30Days?.orderCount || 0}
                                    change={analytics.revenue?.last30Days?.change}
                                    avgDays={30}
                                    customers={analytics.revenue?.last30Days?.customers}
                                />
                            </div>
                            <div className="snap-start">
                                <RevenueCard
                                    label="Last Month"
                                    total={analytics.revenue?.lastMonth?.total || 0}
                                    orderCount={analytics.revenue?.lastMonth?.orderCount || 0}
                                    change={analytics.revenue?.lastMonth?.change}
                                    avgDays={daysInLastMonth}
                                    customers={analytics.revenue?.lastMonth?.customers}
                                />
                            </div>
                            <div className="snap-start">
                                <RevenueCard
                                    label={`This Month`}
                                    total={analytics.revenue?.thisMonth?.total || 0}
                                    orderCount={analytics.revenue?.thisMonth?.orderCount || 0}
                                    change={analytics.revenue?.thisMonth?.change}
                                    avgDays={daysInThisMonth}
                                    customers={analytics.revenue?.thisMonth?.customers}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Bottom Row: Top Products + Units */}
                    <div className="px-2 sm:px-4 pb-2 sm:pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                        {/* Top Products - Text Tags - horizontal scroll on mobile */}
                        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
                            <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 font-medium whitespace-nowrap flex-shrink-0">
                                Top 30d
                            </span>
                            <div className="flex gap-1 sm:gap-1.5">
                                {analytics.topProducts.slice(0, 6).map((product) => (
                                    <span
                                        key={product.id}
                                        className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-white border border-gray-200 rounded-md text-[10px] sm:text-xs text-gray-700 whitespace-nowrap"
                                    >
                                        <span className="font-medium truncate max-w-[60px] sm:max-w-[100px]">{product.name}</span>
                                        <span className="text-blue-600 font-semibold">{product.qty}</span>
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Total Units */}
                        <div className="flex items-center gap-1.5 sm:gap-2 bg-white rounded-lg border border-gray-100 px-2 sm:px-3 py-1.5 sm:py-2 self-end sm:self-auto">
                            <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                                Open Units
                            </span>
                            <span className="text-lg sm:text-xl font-bold text-gray-900">{analytics.totalUnits}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default OrdersAnalyticsBar;
