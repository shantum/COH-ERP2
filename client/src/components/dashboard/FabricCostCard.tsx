/**
 * FabricCostCard - Fabric cost breakdown by fabric → colour
 *
 * Shows real numbers: metres consumed, rate per metre, and total cost.
 * Grouped by Fabric parent with collapsible colour children.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@coh/shared';
import { getFabricColourCosts } from '../../server/functions/costing';
import type { FabricGroup } from '../../server/functions/costing';
import { Scissors, ChevronDown, ChevronRight, AlertCircle, RefreshCcw } from 'lucide-react';

const PERIODS = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: 'mtd', label: 'MTD' },
] as const;

type Period = (typeof PERIODS)[number]['value'];

export function FabricCostCard() {
    const [period, setPeriod] = useState<Period>('30d');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['dashboard', 'fabricCosts', period],
        queryFn: () => getFabricColourCosts({ data: { period, channel: 'all', limit: 15 } }),
        staleTime: 2 * 60 * 1000,
        retry: 2,
    });

    const toggle = (fabricId: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(fabricId)) next.delete(fabricId);
            else next.add(fabricId);
            return next;
        });
    };

    const fabrics = data?.data;
    const totals = data?.totals;

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                    <Scissors className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" />
                    <h2 className="text-base sm:text-lg font-semibold">Fabric Cost Breakdown</h2>
                </div>

                {/* Period Toggle */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    {PERIODS.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => setPeriod(value)}
                            className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-colors ${
                                period === value
                                    ? 'bg-rose-50 text-rose-600'
                                    : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            {error ? (
                <div className="py-6 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-gray-500 text-sm mb-2">Failed to load fabric costs</p>
                    <button
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700"
                    >
                        <RefreshCcw className="w-3 h-3" />
                        Try again
                    </button>
                </div>
            ) : isLoading ? (
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-10 bg-gray-100 rounded" />
                    ))}
                </div>
            ) : !fabrics?.length ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No fabric cost data for this period</p>
            ) : (
                <div className="space-y-0.5 max-h-[400px] sm:max-h-[500px] overflow-y-auto">
                    {/* Total row */}
                    {totals && (
                        <div className="flex items-center justify-between px-2 py-1.5 mb-1 bg-gray-50 rounded-lg">
                            <span className="text-[10px] sm:text-xs font-medium text-gray-500">
                                Total Fabric Cost
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-gray-900">
                                {formatCurrency(totals.totalFabricCost)}
                            </span>
                        </div>
                    )}

                    {fabrics.map((fg) => (
                        <FabricRow
                            key={fg.fabricId}
                            fabric={fg}
                            isExpanded={expanded.has(fg.fabricId)}
                            onToggle={() => toggle(fg.fabricId)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FabricRow({
    fabric,
    isExpanded,
    onToggle,
}: {
    fabric: FabricGroup;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const Arrow = isExpanded ? ChevronDown : ChevronRight;

    return (
        <div>
            {/* Fabric header row */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-1.5 sm:px-2 py-1.5 sm:py-2 rounded hover:bg-gray-50 transition-colors text-left"
            >
                <Arrow size={14} className="text-gray-400 flex-shrink-0" />

                {/* Name & material */}
                <div className="flex-1 min-w-0">
                    <span className="text-xs sm:text-sm font-medium text-gray-900 truncate block">
                        {fabric.fabricName}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-gray-400">
                        {fabric.materialName}
                    </span>
                </div>

                {/* Consumption */}
                <span className="text-[10px] sm:text-xs text-gray-500 flex-shrink-0">
                    {fabric.totalConsumption} {fabric.fabricUnit}
                </span>

                {/* Rate */}
                <span className="text-[10px] sm:text-xs text-gray-400 flex-shrink-0">
                    @ {formatCurrency(fabric.fabricRate)}/{fabric.fabricUnit}
                </span>

                {/* Total cost */}
                <span className="text-xs sm:text-sm font-semibold text-gray-900 flex-shrink-0 w-16 sm:w-20 text-right">
                    {formatCurrency(fabric.totalFabricCost)}
                </span>
            </button>

            {/* Expanded colour rows */}
            {isExpanded && fabric.colours.length > 0 && (
                <div className="ml-5 sm:ml-6 border-l-2 border-gray-100 pl-2 sm:pl-3 mb-1">
                    {fabric.colours.map((c) => (
                        <div
                            key={c.colourName}
                            className="flex items-center gap-2 px-1 py-1 sm:py-1.5 rounded hover:bg-gray-50/50 transition-colors"
                        >
                            {/* Colour Swatch */}
                            <div
                                className="w-4 h-4 sm:w-5 sm:h-5 rounded flex-shrink-0 border border-gray-200"
                                style={{ backgroundColor: c.colourHex || '#e5e7eb' }}
                                title={c.colourName}
                            />

                            {/* Name */}
                            <span className="flex-1 min-w-0 text-[11px] sm:text-xs text-gray-700 truncate">
                                {c.colourName}
                            </span>

                            {/* Units */}
                            <span className="text-[9px] sm:text-[10px] text-gray-400 flex-shrink-0">
                                {c.units}u
                            </span>

                            {/* Consumption */}
                            <span className="text-[9px] sm:text-[10px] text-gray-400 flex-shrink-0">
                                {c.consumption} {fabric.fabricUnit}
                            </span>

                            {/* Cost */}
                            <span className="text-[11px] sm:text-xs font-medium text-gray-700 flex-shrink-0 w-14 sm:w-18 text-right">
                                {formatCurrency(c.cost)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default FabricCostCard;
