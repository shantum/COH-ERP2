/**
 * TopFabricsCard - Configurable top fabrics display by sales value
 * Supports fabric type and specific color aggregation
 * Mobile-first responsive design
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fabricsApi } from '../../services/api';
import { Layers, Palette } from 'lucide-react';

interface FabricData {
    id: string;
    name: string;
    typeName?: string;
    composition?: string | null;
    units: number;
    revenue: number;
    orderCount: number;
    productCount: number;
    topColors?: string[];
}

interface TopFabricsResponse {
    level: 'type' | 'color';
    days: number;
    data: FabricData[];
}

const TIME_PERIODS = [
    { value: 7, label: '7d' },
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
    { value: 60, label: '60d' },
    { value: 90, label: '90d' },
];

const LEVELS = [
    { value: 'type', label: 'Type', icon: Layers },
    { value: 'color', label: 'Color', icon: Palette },
] as const;

export function TopFabricsCard() {
    const [days, setDays] = useState(30);
    const [level, setLevel] = useState<'type' | 'color'>('type');

    const { data, isLoading } = useQuery<TopFabricsResponse>({
        queryKey: ['topFabrics', days, level],
        queryFn: () => fabricsApi.getTopFabrics({ days, level, limit: 12 }).then(r => r.data),
        staleTime: 60 * 1000,
    });

    const formatCurrency = (amount: number) => {
        if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
        if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
        return `₹${amount.toFixed(0)}`;
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            {/* Header with controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500" />
                    <h2 className="text-base sm:text-lg font-semibold">Top Fabrics</h2>
                </div>

                <div className="flex items-center gap-2">
                    {/* Level Toggle */}
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {LEVELS.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                onClick={() => setLevel(value)}
                                className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-colors ${
                                    level === value
                                        ? 'bg-purple-50 text-purple-600'
                                        : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                <Icon size={12} className="sm:w-[14px] sm:h-[14px]" />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>

                    {/* Time Period Select */}
                    <select
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        className="text-[10px] sm:text-xs border border-gray-200 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
                        <div key={i} className="h-10 sm:h-12 bg-gray-100 rounded animate-pulse" />
                    ))}
                </div>
            ) : !data?.data?.length ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No fabric sales data for this period</p>
            ) : (
                <div className="space-y-1.5 sm:space-y-2 max-h-[300px] sm:max-h-[400px] overflow-y-auto">
                    {data.data.map((item, index) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-2 sm:gap-3 p-1.5 sm:p-2 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            {/* Rank */}
                            <div className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-bold flex-shrink-0 ${
                                index === 0 ? 'bg-purple-100 text-purple-700' :
                                index === 1 ? 'bg-gray-200 text-gray-700' :
                                index === 2 ? 'bg-indigo-100 text-indigo-700' :
                                'bg-gray-100 text-gray-500'
                            }`}>
                                {index + 1}
                            </div>

                            {/* Fabric swatch placeholder */}
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center flex-shrink-0">
                                {level === 'type' ? (
                                    <Layers size={14} className="text-purple-400 sm:w-4 sm:h-4" />
                                ) : (
                                    <Palette size={14} className="text-purple-400 sm:w-4 sm:h-4" />
                                )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1 sm:gap-2">
                                    <span className="font-medium text-gray-900 truncate text-sm sm:text-base">
                                        {item.name}
                                    </span>
                                    {level === 'color' && item.typeName && (
                                        <span className="text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded flex-shrink-0">
                                            {item.typeName}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs text-gray-500">
                                    <span>{item.productCount} products</span>
                                    <span className="text-gray-300">•</span>
                                    <span>{item.orderCount} orders</span>
                                    {level === 'type' && item.topColors && item.topColors.length > 0 && (
                                        <>
                                            <span className="text-gray-300 hidden sm:inline">•</span>
                                            <span className="truncate hidden sm:inline text-purple-500">
                                                {item.topColors.join(', ')}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="text-right flex-shrink-0">
                                <div className="text-xs sm:text-sm font-semibold text-gray-900">
                                    {formatCurrency(item.revenue)}
                                </div>
                                <div className="text-[10px] sm:text-xs text-gray-500">
                                    {item.units} units
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default TopFabricsCard;
