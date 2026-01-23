/**
 * TopFabricsCard - Configurable top fabrics display by sales value
 * Supports fabric type and specific color aggregation
 * Mobile-first responsive design
 *
 * Uses TanStack Start Server Functions for data fetching.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTopMaterials } from '../../server/functions/fabricColours';
import { Layers, Palette } from 'lucide-react';

const TIME_PERIODS = [
    { value: 7, label: '7d' },
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
    { value: 60, label: '60d' },
    { value: 90, label: '90d' },
];

const LEVELS = [
    { value: 'material', label: 'Material', icon: Layers },
    { value: 'colour', label: 'Colour', icon: Palette },
] as const;

export function TopFabricsCard() {
    const [days, setDays] = useState(30);
    const [level, setLevel] = useState<'material' | 'colour'>('material');

    const { data, isLoading } = useQuery({
        queryKey: ['topMaterials', days, level],
        queryFn: () => getTopMaterials({ data: { days, level, limit: 12 } }),
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
                        <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                    ))}
                </div>
            ) : !data?.data?.length ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No materials sales data for this period</p>
            ) : (
                <div className="space-y-0.5 max-h-[300px] sm:max-h-[400px] overflow-y-auto">
                    {data.data.map((item, index) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-2 sm:gap-3 py-1.5 sm:py-2 px-1 rounded hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                        >
                            {/* Rank */}
                            <span className={`w-5 text-center text-xs sm:text-sm font-semibold flex-shrink-0 ${
                                index === 0 ? 'text-purple-600' :
                                index === 1 ? 'text-gray-600' :
                                index === 2 ? 'text-indigo-600' :
                                'text-gray-400'
                            }`}>
                                {index + 1}
                            </span>

                            {/* Colour Swatch - only in colour mode */}
                            {level === 'colour' && (
                                <div
                                    className="w-6 h-6 sm:w-7 sm:h-7 rounded-md flex-shrink-0 border border-gray-200 shadow-sm"
                                    style={{
                                        backgroundColor: item.colorHex || '#e5e7eb',
                                    }}
                                    title={item.colorHex || 'No colour'}
                                />
                            )}

                            {/* Name & Fabric Badge */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-gray-900 text-sm sm:text-base truncate">
                                        {item.name}
                                    </span>
                                    {level === 'colour' && item.fabricName && (
                                        <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded flex-shrink-0">
                                            {item.fabricName}
                                        </span>
                                    )}
                                </div>
                                {/* Stats row */}
                                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-gray-400 mt-0.5">
                                    <span>{item.productCount} products</span>
                                    <span>·</span>
                                    <span>{item.orderCount} orders</span>
                                    {level === 'material' && item.topColours && item.topColours.length > 0 && (
                                        <>
                                            <span className="hidden sm:inline">·</span>
                                            <span className="truncate hidden sm:inline text-purple-400">
                                                {item.topColours.slice(0, 2).join(', ')}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Revenue & Units */}
                            <div className="text-right flex-shrink-0">
                                <div className="text-sm sm:text-base font-semibold text-gray-900">
                                    {formatCurrency(item.revenue)}
                                </div>
                                <div className="text-[10px] sm:text-xs text-gray-400">
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
