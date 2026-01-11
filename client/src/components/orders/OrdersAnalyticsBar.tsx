/**
 * OrdersAnalyticsBar - Shows key metrics for open orders
 * Displays pending count, payment split, top products
 */

import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { Package, CreditCard, Banknote, TrendingUp, ShoppingBag, Truck } from 'lucide-react';

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
    topProducts: Array<{ name: string; qty: number }>;
}

export function OrdersAnalyticsBar() {
    const { data: analytics, isLoading } = useQuery<AnalyticsData>({
        queryKey: ['ordersAnalytics'],
        queryFn: () => ordersApi.getAnalytics().then(r => r.data),
        staleTime: 30 * 1000, // 30 seconds
        refetchInterval: 60 * 1000, // Refresh every minute
    });

    if (isLoading) {
        return (
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-4 animate-pulse">
                <div className="flex gap-6">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="flex-1">
                            <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
                            <div className="h-6 bg-gray-200 rounded w-12"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!analytics) return null;

    const formatCurrency = (amount: number) => {
        if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
        if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
        return amount.toFixed(0);
    };

    const codPercent = analytics.totalOrders > 0
        ? Math.round((analytics.paymentSplit.cod.count / analytics.totalOrders) * 100)
        : 0;
    const prepaidPercent = 100 - codPercent;

    return (
        <div className="bg-gradient-to-r from-slate-50 via-white to-slate-50 border border-gray-200 rounded-xl p-3 shadow-sm">
            <div className="flex items-center gap-2 overflow-x-auto">
                {/* Order Status Pills */}
                <div className="flex items-center gap-3 pr-4 border-r border-gray-200">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-100">
                        <Package size={14} className="text-amber-600" />
                        <div>
                            <div className="text-xs text-amber-600 font-medium">Pending</div>
                            <div className="text-lg font-bold text-amber-700">{analytics.pendingOrders}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg border border-blue-100">
                        <ShoppingBag size={14} className="text-blue-600" />
                        <div>
                            <div className="text-xs text-blue-600 font-medium">Allocated</div>
                            <div className="text-lg font-bold text-blue-700">{analytics.allocatedOrders}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg border border-green-100">
                        <Truck size={14} className="text-green-600" />
                        <div>
                            <div className="text-xs text-green-600 font-medium">Ready</div>
                            <div className="text-lg font-bold text-green-700">{analytics.readyToShip}</div>
                        </div>
                    </div>
                </div>

                {/* Payment Split */}
                <div className="flex items-center gap-3 px-4 border-r border-gray-200">
                    <div className="flex items-center gap-2">
                        <Banknote size={14} className="text-orange-500" />
                        <div>
                            <div className="text-xs text-gray-500">COD</div>
                            <div className="text-sm font-semibold text-gray-800">
                                {analytics.paymentSplit.cod.count}
                                <span className="text-xs text-gray-400 ml-1">({codPercent}%)</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <CreditCard size={14} className="text-indigo-500" />
                        <div>
                            <div className="text-xs text-gray-500">Prepaid</div>
                            <div className="text-sm font-semibold text-gray-800">
                                {analytics.paymentSplit.prepaid.count}
                                <span className="text-xs text-gray-400 ml-1">({prepaidPercent}%)</span>
                            </div>
                        </div>
                    </div>
                    {/* Visual bar */}
                    <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-orange-400 to-orange-500"
                            style={{ width: `${codPercent}%` }}
                        />
                    </div>
                </div>

                {/* Top Products */}
                <div className="flex items-center gap-3 px-4 flex-1 min-w-0">
                    <TrendingUp size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <span className="text-xs text-gray-500 whitespace-nowrap">Top:</span>
                        {analytics.topProducts.slice(0, 3).map((product, i) => (
                            <span
                                key={product.name}
                                className="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-700 whitespace-nowrap"
                                title={`${product.name}: ${product.qty} units`}
                            >
                                {product.name.length > 15 ? product.name.substring(0, 15) + '...' : product.name}
                                <span className="text-gray-400 ml-1">({product.qty})</span>
                            </span>
                        ))}
                    </div>
                </div>

                {/* Total Units */}
                <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
                    <div className="text-right">
                        <div className="text-xs text-gray-500">Total Units</div>
                        <div className="text-lg font-bold text-gray-800">{analytics.totalUnits}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default OrdersAnalyticsBar;
