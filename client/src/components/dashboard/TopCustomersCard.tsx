/**
 * TopCustomersCard - Top customers by revenue with their favorite products
 * Mobile-first responsive design
 *
 * Uses optimized Kysely queries with server-side caching.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@coh/shared';
import { getTopCustomersForDashboard } from '../../server/functions/dashboard';
import { Users, Crown, Star, Award, AlertCircle, RefreshCcw } from 'lucide-react';

const TIME_PERIODS = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'thisMonth', label: 'This Month' },
    { value: 'lastMonth', label: 'Last Month' },
    { value: '3months', label: '3 Months' },
    { value: '6months', label: '6 Months' },
    { value: '1year', label: '1 Year' },
];

const TIER_STYLES: Record<string, { bg: string; text: string; icon: any }> = {
    vip: { bg: 'bg-purple-100', text: 'text-purple-700', icon: Crown },
    loyal: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Star },
    bronze: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Award },
};

export function TopCustomersCard() {
    const [period, setPeriod] = useState('today');

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['dashboard', 'topCustomers', period],
        queryFn: () => getTopCustomersForDashboard({ data: { period, limit: 10 } }),
        staleTime: 60 * 1000,
        retry: 2,
    });

    const getTierBadge = (tier?: string) => {
        if (!tier) return null;
        const style = TIER_STYLES[tier] || TIER_STYLES.bronze;
        const Icon = style.icon;
        return (
            <span className={`inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                <Icon size={10} />
                {tier}
            </span>
        );
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            {/* Header with controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                    <h2 className="text-base sm:text-lg font-semibold">Top Customers</h2>
                </div>

                {/* Time Period Select */}
                <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="text-[10px] sm:text-xs border border-gray-200 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                    {TIME_PERIODS.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
            </div>

            {/* Content */}
            {error ? (
                <div className="py-6 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-gray-500 text-sm mb-2">Failed to load customers</p>
                    <button
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
                    >
                        <RefreshCcw className="w-3 h-3" />
                        Try again
                    </button>
                </div>
            ) : isLoading ? (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-14 sm:h-16 bg-gray-100 rounded" />
                    ))}
                </div>
            ) : !data?.data?.length ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No customer data for this period</p>
            ) : (
                <div className="space-y-1.5 sm:space-y-2 max-h-[350px] sm:max-h-[450px] overflow-y-auto">
                    {data.data.map((customer, index) => (
                        <div
                            key={customer.id}
                            className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                        >
                            {/* Rank */}
                            <div className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-bold flex-shrink-0 mt-0.5 ${
                                index === 0 ? 'bg-emerald-100 text-emerald-700' :
                                index === 1 ? 'bg-gray-200 text-gray-700' :
                                index === 2 ? 'bg-teal-100 text-teal-700' :
                                'bg-gray-100 text-gray-500'
                            }`}>
                                {index + 1}
                            </div>

                            {/* Customer Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                    <span className="font-medium text-gray-900 text-sm sm:text-base truncate">
                                        {customer.name}
                                    </span>
                                    {getTierBadge(customer.tier)}
                                </div>
                                <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
                                    {customer.orderCount} orders • {customer.units} units
                                </div>
                                {/* Top Products */}
                                {customer.topProducts && customer.topProducts.length > 0 && (
                                    <div className="flex gap-1 mt-1.5 flex-wrap">
                                        {customer.topProducts.map((product, idx) => (
                                            <span
                                                key={idx}
                                                className="inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded"
                                            >
                                                {product.name}
                                                <span className="font-semibold">({product.units})</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Revenue */}
                            <div className="text-right flex-shrink-0">
                                <div className="text-sm sm:text-base font-semibold text-gray-900">
                                    {formatCurrency(customer.revenue)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default TopCustomersCard;
