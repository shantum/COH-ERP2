/**
 * OrdersAnalyticsBar - Clean, modern dashboard metrics
 * Two-row layout: Order pipeline on top, Revenue timeline below
 */

import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface AnalyticsData {
    totalOrders: number;
    pendingOrders: number;
    allocatedOrders: number;
    readyToShip: number;
    totalUnits: number;
    paymentSplit: {
        cod: { count: number; amount: number };
        prepaid: { count: number; amount: number };
    };
    topProducts: Array<{ id: string; name: string; imageUrl: string | null; qty: number; orderCount: number; salesValue: number }>;
    revenue: {
        today: { total: number; orderCount: number };
        yesterday: { total: number; orderCount: number };
        yesterdaySameTime: { total: number; orderCount: number };
        last7Days: { total: number; orderCount: number };
        last30Days: { total: number; orderCount: number };
        lastMonth: { total: number; orderCount: number };
        thisMonth: { total: number; orderCount: number };
    };
}

export function OrdersAnalyticsBar() {
    const [isExpanded, setIsExpanded] = useState(true);
    const { data: analytics, isLoading } = useQuery<AnalyticsData>({
        queryKey: ['ordersAnalytics'],
        queryFn: () => ordersApi.getAnalytics().then(r => r.data),
        staleTime: 30 * 1000,
        refetchInterval: 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="bg-white border border-gray-200 rounded-lg p-3 animate-pulse">
                <div className="h-12 bg-gray-100 rounded"></div>
            </div>
        );
    }

    if (!analytics) return null;

    const formatCurrency = (amount: number) => {
        if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
        if (amount >= 1000) return `₹${(amount / 1000).toFixed(2)}K`;
        return `₹${amount.toFixed(0)}`;
    };

    const codPercent = analytics.totalOrders > 0
        ? Math.round((analytics.paymentSplit.cod.count / analytics.totalOrders) * 100)
        : 0;

    // Current time formatted for display
    const currentTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Compare today with yesterday at same time (fair comparison)
    const todayVsYesterday = analytics.revenue?.yesterdaySameTime?.total > 0
        ? ((analytics.revenue?.today?.total - analytics.revenue?.yesterdaySameTime?.total) / analytics.revenue?.yesterdaySameTime?.total * 100)
        : 0;

    return (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Compact Header Row - Always Visible */}
            <div
                className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50/50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Left: Order Pipeline */}
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                            <span className="text-xs text-gray-500">Pending</span>
                            <span className="text-sm font-semibold text-gray-900">{analytics.pendingOrders}</span>
                        </div>
                        <div className="text-gray-300">→</div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                            <span className="text-xs text-gray-500">Allocated</span>
                            <span className="text-sm font-semibold text-gray-900">{analytics.allocatedOrders}</span>
                        </div>
                        <div className="text-gray-300">→</div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                            <span className="text-xs text-gray-500">Ready</span>
                            <span className="text-sm font-semibold text-gray-900">{analytics.readyToShip}</span>
                        </div>
                    </div>

                    <div className="h-4 w-px bg-gray-200"></div>

                    {/* Payment Split - Compact */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <span className="text-xs text-orange-600 font-medium">COD</span>
                            <span className="text-xs text-gray-400">{analytics.paymentSplit.cod.count}</span>
                        </div>
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full"
                                style={{ width: `${codPercent}%` }}
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-400">{analytics.paymentSplit.prepaid.count}</span>
                            <span className="text-xs text-indigo-600 font-medium">Prepaid</span>
                        </div>
                    </div>
                </div>

                {/* Right: Today's Revenue + Toggle */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <div className="text-xs text-gray-400">Today <span className="text-gray-300">till {currentTime}</span></div>
                            <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(analytics.revenue?.today?.total || 0)}
                                <span className="text-xs text-gray-400 ml-1">
                                    ({analytics.revenue?.today?.orderCount || 0})
                                </span>
                            </div>
                        </div>
                        {todayVsYesterday !== 0 && (
                            <div className={`text-xs px-1.5 py-0.5 rounded ${
                                todayVsYesterday > 0
                                    ? 'bg-emerald-50 text-emerald-600'
                                    : 'bg-red-50 text-red-600'
                            }`}
                            title={`Compared to yesterday at ${currentTime}: ${formatCurrency(analytics.revenue?.yesterdaySameTime?.total || 0)}`}
                            >
                                {todayVsYesterday > 0 ? '↑' : '↓'} {Math.abs(todayVsYesterday).toFixed(0)}%
                            </div>
                        )}
                    </div>
                    <button className="p-1 hover:bg-gray-100 rounded transition-colors">
                        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </button>
                </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
                <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-gray-50/30">
                    <div className="flex items-center justify-between">
                        {/* Revenue Timeline */}
                        <div className="flex items-center gap-1">
                            {(() => {
                                // Calculate days for averages
                                const now = new Date();
                                const daysInThisMonth = now.getDate(); // Days elapsed in current month
                                const lastMonthDate = new Date(now.getFullYear(), now.getMonth(), 0);
                                const daysInLastMonth = lastMonthDate.getDate(); // Total days in last month

                                return [
                                    { label: 'Yesterday', data: analytics.revenue?.yesterday, days: 0 },
                                    { label: '7 Days', data: analytics.revenue?.last7Days, days: 7 },
                                    { label: '30 Days', data: analytics.revenue?.last30Days, days: 30 },
                                    { label: 'Last Month', data: analytics.revenue?.lastMonth, days: daysInLastMonth },
                                    { label: `This Month (${daysInThisMonth}d)`, data: analytics.revenue?.thisMonth, days: daysInThisMonth },
                                ].map((period, i) => (
                                    <div
                                        key={period.label}
                                        className="flex items-center"
                                    >
                                        {i > 0 && <div className="w-px h-8 bg-gray-200 mx-3"></div>}
                                        <div className="text-center min-w-[70px]">
                                            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{period.label}</div>
                                            <div className="text-sm font-medium text-gray-700">
                                                {formatCurrency(period.data?.total || 0)}
                                            </div>
                                            <div className="text-[10px] text-gray-400">
                                                {period.data?.orderCount || 0} orders
                                                {period.days > 0 && (
                                                    <span className="ml-1 text-gray-300">
                                                        ({formatCurrency((period.data?.total || 0) / period.days)}/d)
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>

                        {/* Top Products - Image Grid (Last 30 Days) */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">Top 30d</span>
                            <div className="flex gap-0.5">
                                {analytics.topProducts.slice(0, 10).map((product) => (
                                    <div
                                        key={product.id}
                                        className="relative group"
                                    >
                                        {product.imageUrl ? (
                                            <img
                                                src={product.imageUrl}
                                                alt={product.name}
                                                className="w-8 h-8 object-cover rounded border border-gray-200 hover:border-blue-400 hover:scale-110 transition-all cursor-pointer"
                                            />
                                        ) : (
                                            <div className="w-8 h-8 rounded border border-gray-200 bg-gray-100 flex items-center justify-center text-[10px] text-gray-400 hover:border-blue-400 transition-colors">
                                                {product.name.charAt(0)}
                                            </div>
                                        )}
                                        {/* Units badge */}
                                        <span className="absolute -bottom-1 -right-1 min-w-[16px] h-4 px-0.5 bg-blue-600 text-white text-[9px] rounded-full flex items-center justify-center font-medium">
                                            {product.qty}
                                        </span>
                                        {/* Hover tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                                            <div className="font-medium">{product.name}</div>
                                            <div className="text-gray-300">{product.qty} units · {product.orderCount} orders</div>
                                            <div className="text-emerald-400 font-medium">{formatCurrency(product.salesValue)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Total Units */}
                        <div className="text-right">
                            <div className="text-[10px] uppercase tracking-wide text-gray-400">Open Units</div>
                            <div className="text-lg font-semibold text-gray-900">{analytics.totalUnits}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default OrdersAnalyticsBar;
