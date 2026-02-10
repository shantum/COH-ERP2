/**
 * FabricBalanceCard - Current fabric stock at a glance
 *
 * Shows fabric balances grouped by Fabric with collapsible colour rows.
 * Uses the materialized currentBalance field (no heavy aggregation).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFabricBalances } from '../../server/functions/fabricColours';
import type { FabricBalanceGroup } from '../../server/functions/fabricColours';
import { Warehouse, ChevronDown, ChevronRight, AlertCircle, RefreshCcw } from 'lucide-react';

export function FabricBalanceCard() {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['dashboard', 'fabricBalances'],
        queryFn: () => getFabricBalances(),
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

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Warehouse className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500" />
                <h2 className="text-base sm:text-lg font-semibold">Fabric Balances</h2>
            </div>

            {/* Content */}
            {error ? (
                <div className="py-6 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-gray-500 text-sm mb-2">Failed to load balances</p>
                    <button
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                    >
                        <RefreshCcw className="w-3 h-3" />
                        Try again
                    </button>
                </div>
            ) : isLoading ? (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-10 bg-gray-100 rounded" />
                    ))}
                </div>
            ) : !fabrics?.length ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No active fabrics found</p>
            ) : (
                <div className="space-y-0.5 max-h-[400px] sm:max-h-[500px] overflow-y-auto">
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

function formatBalance(value: number): string {
    if (value === 0) return '0';
    if (Number.isInteger(value)) return value.toLocaleString('en-IN');
    return value.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function balanceColor(value: number): string {
    if (value <= 0) return 'text-red-600';
    if (value < 5) return 'text-amber-600';
    return 'text-gray-900';
}

function FabricRow({
    fabric,
    isExpanded,
    onToggle,
}: {
    fabric: FabricBalanceGroup;
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

                {/* Colour count */}
                <span className="text-[10px] sm:text-xs text-gray-400 flex-shrink-0">
                    {fabric.colours.length} colours
                </span>

                {/* Total balance */}
                <span className={`text-xs sm:text-sm font-semibold flex-shrink-0 w-20 sm:w-24 text-right ${balanceColor(fabric.totalBalance)}`}>
                    {formatBalance(fabric.totalBalance)} {fabric.unit}
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

                            {/* Balance */}
                            <span className={`text-[11px] sm:text-xs font-medium flex-shrink-0 w-20 sm:w-24 text-right ${balanceColor(c.balance)}`}>
                                {formatBalance(c.balance)} {fabric.unit}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default FabricBalanceCard;
