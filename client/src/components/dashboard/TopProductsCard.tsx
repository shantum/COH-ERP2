/**
 * TopProductsCard - Configurable top products display
 * Supports product-level and variation-level aggregation
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../services/api';
import { TrendingUp, Package, Palette } from 'lucide-react';

interface ProductData {
    id: string;
    name: string;
    category?: string;
    colorName?: string;
    fabricName?: string | null;
    imageUrl: string | null;
    units: number;
    revenue: number;
    orderCount: number;
    variations?: Array<{ colorName: string; units: number }>;
}

interface TopProductsResponse {
    level: 'product' | 'variation';
    days: number;
    data: ProductData[];
}

const TIME_PERIODS = [
    { value: 7, label: '7 days' },
    { value: 14, label: '14 days' },
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
];

const LEVELS = [
    { value: 'product', label: 'Product', icon: Package },
    { value: 'variation', label: 'Variation', icon: Palette },
] as const;

export function TopProductsCard() {
    const [days, setDays] = useState(30);
    const [level, setLevel] = useState<'product' | 'variation'>('product');

    const { data, isLoading } = useQuery<TopProductsResponse>({
        queryKey: ['topProducts', days, level],
        queryFn: () => reportsApi.getTopProducts({ days, level, limit: 15 }).then(r => r.data),
        staleTime: 60 * 1000,
    });

    const formatCurrency = (amount: number) => {
        if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
        if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
        return `₹${amount.toFixed(0)}`;
    };

    return (
        <div className="card">
            {/* Header with controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-500" />
                    <h2 className="text-lg font-semibold">Top Products</h2>
                </div>

                <div className="flex items-center gap-2">
                    {/* Level Toggle */}
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {LEVELS.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                onClick={() => setLevel(value)}
                                className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                                    level === value
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Icon size={14} />
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Time Period Select */}
                    <select
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {TIME_PERIODS.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
                    ))}
                </div>
            ) : !data?.data?.length ? (
                <p className="text-gray-500 text-center py-8">No sales data for this period</p>
            ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {data.data.map((item, index) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            {/* Rank */}
                            <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                                index === 0 ? 'bg-amber-100 text-amber-700' :
                                index === 1 ? 'bg-gray-200 text-gray-700' :
                                index === 2 ? 'bg-orange-100 text-orange-700' :
                                'bg-gray-100 text-gray-500'
                            }`}>
                                {index + 1}
                            </div>

                            {/* Image */}
                            {item.imageUrl ? (
                                <img
                                    src={item.imageUrl}
                                    alt={item.name}
                                    className="w-10 h-10 rounded object-cover"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center">
                                    <Package size={16} className="text-gray-400" />
                                </div>
                            )}

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-900 truncate">
                                        {item.name}
                                    </span>
                                    {level === 'variation' && item.colorName && (
                                        <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                                            {item.colorName}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span>{item.orderCount} orders</span>
                                    {level === 'product' && item.variations && item.variations.length > 0 && (
                                        <>
                                            <span className="text-gray-300">•</span>
                                            <span className="truncate">
                                                {item.variations.slice(0, 3).map(v => v.colorName).join(', ')}
                                                {item.variations.length > 3 && ` +${item.variations.length - 3}`}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="text-right flex-shrink-0">
                                <div className="text-sm font-semibold text-gray-900">
                                    {item.units} units
                                </div>
                                <div className="text-xs text-gray-500">
                                    {formatCurrency(item.revenue)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default TopProductsCard;
