/**
 * FabricStockHealthCard - Fabric balance + burn rate + days of stock
 *
 * Shows current stock alongside consumption data and "days of stock remaining"
 * color-coded by urgency. Toggle burn rate window (30d/60d/90d) client-side —
 * all windows come from a single query, no refetch needed.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFabricStockHealth } from '../../server/functions/fabricColours';
import type { FabricStockHealthRow, StockHealthColour } from '../../server/functions/fabricColours';
import {
    Activity,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    RefreshCcw,
    TrendingUp,
    TrendingDown,
    Minus,
    AlertTriangle,
} from 'lucide-react';

type BurnWindow = 30 | 60 | 90;

interface DerivedMetrics {
    avgDaily: number;
    daysOfStock: number | null;
    healthStatus: 'critical' | 'warning' | 'healthy' | 'safe' | 'no-usage';
    trendDirection: 'up' | 'down' | 'flat';
}

function deriveMetrics(
    totalBalance: number,
    consumption: FabricStockHealthRow['consumption'],
    burnWindow: BurnWindow
): DerivedMetrics {
    // Pick the right consumption total for the window
    const consumedInWindow =
        burnWindow === 30
            ? consumption.consumed30d
            : burnWindow === 60
              ? consumption.consumed60d
              : consumption.consumed90d;

    const avgDaily = consumedInWindow > 0 ? consumedInWindow / burnWindow : 0;

    const daysOfStock =
        avgDaily > 0 ? Math.floor(totalBalance / avgDaily) : totalBalance > 0 ? null : null;

    // Health status based on days of stock
    let healthStatus: DerivedMetrics['healthStatus'];
    if (avgDaily === 0) {
        healthStatus = 'no-usage';
    } else if (daysOfStock !== null && daysOfStock < 7) {
        healthStatus = 'critical';
    } else if (daysOfStock !== null && daysOfStock < 14) {
        healthStatus = 'warning';
    } else if (daysOfStock !== null && daysOfStock < 30) {
        healthStatus = 'healthy';
    } else {
        healthStatus = 'safe';
    }

    // Trend: compare 7d daily rate vs 30d daily rate
    const rate7d = consumption.consumed7d > 0 ? consumption.consumed7d / 7 : 0;
    const rate30d = consumption.consumed30d > 0 ? consumption.consumed30d / 30 : 0;
    let trendDirection: DerivedMetrics['trendDirection'] = 'flat';
    if (rate30d > 0) {
        const ratio = rate7d / rate30d;
        if (ratio > 1.2) trendDirection = 'up'; // usage accelerating
        else if (ratio < 0.8) trendDirection = 'down'; // usage slowing
    }

    return { avgDaily, daysOfStock, healthStatus, trendDirection };
}

const statusColors = {
    critical: { bg: 'bg-red-100', text: 'text-red-700', bar: 'bg-red-500', label: 'Critical' },
    warning: { bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-500', label: 'Low' },
    healthy: { bg: 'bg-green-100', text: 'text-green-700', bar: 'bg-green-500', label: 'OK' },
    safe: { bg: 'bg-blue-100', text: 'text-blue-700', bar: 'bg-blue-500', label: 'Good' },
    'no-usage': { bg: 'bg-gray-100', text: 'text-gray-500', bar: 'bg-gray-300', label: 'No usage' },
};

// Kept for future use when sorting by health status is re-enabled
// const statusSortOrder: Record<DerivedMetrics['healthStatus'], number> = {
//     critical: 0,
//     warning: 1,
//     healthy: 2,
//     safe: 3,
//     'no-usage': 4,
// };

export function FabricStockHealthCard() {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [burnWindow, setBurnWindow] = useState<BurnWindow>(30);

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['dashboard', 'fabricStockHealth'],
        queryFn: () => getFabricStockHealth(),
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

    // Derive metrics for all fabrics — recalculated when burn window changes (no refetch)
    const enriched = useMemo(() => {
        if (!data?.data) return [];
        return data.data.map((fabric) => ({
            ...fabric,
            metrics: deriveMetrics(fabric.totalBalance, fabric.consumption, burnWindow),
        }));
    }, [data, burnWindow]);

    const atRiskCount = enriched.filter(
        (f) => f.metrics.healthStatus === 'critical' || f.metrics.healthStatus === 'warning'
    ).length;

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500" />
                <h2 className="text-base sm:text-lg font-semibold flex-1">Fabric Stock Health</h2>
                {/* Burn window toggle */}
                <div className="flex bg-gray-100 rounded-md p-0.5 text-[10px] sm:text-xs">
                    {([30, 60, 90] as BurnWindow[]).map((w) => (
                        <button
                            key={w}
                            onClick={() => setBurnWindow(w)}
                            className={`px-2 py-0.5 rounded transition-colors ${
                                burnWindow === w
                                    ? 'bg-white text-indigo-700 font-medium shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {w}d
                        </button>
                    ))}
                </div>
            </div>

            {/* Summary strip */}
            {!isLoading && !error && data && (
                <div className="flex gap-3 sm:gap-4 mb-3 text-[10px] sm:text-xs text-gray-500">
                    <span>
                        <span className="font-semibold text-gray-900">{enriched.length}</span> fabrics
                    </span>
                    <span>
                        <span
                            className={`font-semibold ${atRiskCount > 0 ? 'text-red-600' : 'text-gray-900'}`}
                        >
                            {atRiskCount}
                        </span>{' '}
                        at risk
                    </span>
                    <span>
                        <span className="font-semibold text-gray-900">
                            {formatBalance(data.totalBalance)}
                        </span>{' '}
                        total
                    </span>
                </div>
            )}

            {/* Content */}
            {error ? (
                <div className="py-6 text-center">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-gray-500 text-sm mb-2">Failed to load stock health</p>
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
                        <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
                    ))}
                </div>
            ) : !enriched.length ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No active fabrics found</p>
            ) : (
                <div className="space-y-0.5 max-h-[400px] sm:max-h-[500px] overflow-y-auto">
                    {enriched.map((fabric) => (
                        <FabricHealthRow
                            key={fabric.fabricId}
                            fabric={fabric}
                            metrics={fabric.metrics}
                            isExpanded={expanded.has(fabric.fabricId)}
                            onToggle={() => toggle(fabric.fabricId)}
                            burnWindow={burnWindow}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Helpers ──────────────────────────────────────────

function formatBalance(value: number): string {
    if (value === 0) return '0';
    if (Number.isInteger(value)) return value.toLocaleString('en-IN');
    return value.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatRate(rate: number): string {
    if (rate === 0) return '0';
    if (rate < 0.1) return rate.toFixed(2);
    if (rate < 1) return rate.toFixed(1);
    return rate.toFixed(1);
}

function balanceColor(value: number): string {
    if (value <= 0) return 'text-red-600';
    if (value < 5) return 'text-amber-600';
    return 'text-gray-900';
}

// ── Fabric Row ──────────────────────────────────────

function FabricHealthRow({
    fabric,
    metrics,
    isExpanded,
    onToggle,
    burnWindow,
}: {
    fabric: FabricStockHealthRow;
    metrics: DerivedMetrics;
    isExpanded: boolean;
    onToggle: () => void;
    burnWindow: BurnWindow;
}) {
    const Arrow = isExpanded ? ChevronDown : ChevronRight;
    const colors = statusColors[metrics.healthStatus];

    const TrendIcon =
        metrics.trendDirection === 'up'
            ? TrendingUp
            : metrics.trendDirection === 'down'
              ? TrendingDown
              : Minus;

    const trendColor =
        metrics.trendDirection === 'up'
            ? 'text-red-500' // accelerating usage = bad
            : metrics.trendDirection === 'down'
              ? 'text-green-500' // slowing usage = good
              : 'text-gray-400';

    // Progress bar width: cap at 30 days for visual
    const progressWidth =
        metrics.daysOfStock !== null ? Math.min(100, (metrics.daysOfStock / 30) * 100) : 0;

    return (
        <div>
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1.5 sm:py-2 rounded hover:bg-gray-50 transition-colors text-left"
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

                {/* Burn rate + trend */}
                <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-gray-400">
                        {formatRate(metrics.avgDaily)}/d
                    </span>
                    <TrendIcon size={10} className={trendColor} />
                </div>

                {/* Days of stock badge */}
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0 w-16 sm:w-20">
                    <span className={`text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                        {metrics.healthStatus === 'no-usage'
                            ? 'No usage'
                            : metrics.daysOfStock !== null
                              ? `${metrics.daysOfStock}d`
                              : '—'}
                    </span>
                    {/* Mini progress bar */}
                    {metrics.healthStatus !== 'no-usage' && (
                        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${colors.bar}`}
                                style={{ width: `${progressWidth}%` }}
                            />
                        </div>
                    )}
                </div>

                {/* Balance */}
                <span
                    className={`text-xs sm:text-sm font-semibold flex-shrink-0 w-16 sm:w-24 text-right ${balanceColor(fabric.totalBalance)}`}
                >
                    {formatBalance(fabric.totalBalance)} {fabric.unit}
                </span>

                {/* At-risk indicator */}
                {(metrics.healthStatus === 'critical' || metrics.healthStatus === 'warning') && (
                    <AlertTriangle
                        size={14}
                        className={`flex-shrink-0 ${metrics.healthStatus === 'critical' ? 'text-red-500' : 'text-amber-500'}`}
                    />
                )}
            </button>

            {/* Expanded colour rows */}
            {isExpanded && fabric.colours.length > 0 && (
                <div className="ml-5 sm:ml-6 border-l-2 border-gray-100 pl-2 sm:pl-3 mb-1">
                    {fabric.colours.map((c) => (
                        <ColourRow key={c.colourName} colour={c} unit={fabric.unit} burnWindow={burnWindow} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Colour Row ──────────────────────────────────────

function ColourRow({ colour, unit, burnWindow }: { colour: StockHealthColour; unit: string; burnWindow: BurnWindow }) {
    const metrics = deriveMetrics(colour.balance, colour.consumption, burnWindow);
    const colors = statusColors[metrics.healthStatus];

    return (
        <div className="flex items-center gap-2 px-1 py-1 sm:py-1.5 rounded hover:bg-gray-50/50 transition-colors">
            <div
                className="w-4 h-4 sm:w-5 sm:h-5 rounded flex-shrink-0 border border-gray-200"
                style={{ backgroundColor: colour.colourHex || '#e5e7eb' }}
                title={colour.colourName}
            />
            <span className="flex-1 min-w-0 text-[11px] sm:text-xs text-gray-700 truncate">
                {colour.colourName}
            </span>
            {/* Per-colour burn rate */}
            <span className="hidden sm:inline text-[10px] text-gray-400 flex-shrink-0">
                {formatRate(metrics.avgDaily)}/d
            </span>
            {/* Per-colour days of stock */}
            <span className={`text-[10px] px-1 py-0.5 rounded flex-shrink-0 ${colors.bg} ${colors.text}`}>
                {metrics.healthStatus === 'no-usage'
                    ? 'No usage'
                    : metrics.daysOfStock !== null
                      ? `${metrics.daysOfStock}d`
                      : '—'}
            </span>
            <span
                className={`text-[11px] sm:text-xs font-medium flex-shrink-0 w-16 sm:w-24 text-right ${balanceColor(colour.balance)}`}
            >
                {formatBalance(colour.balance)} {unit}
            </span>
        </div>
    );
}

export default FabricStockHealthCard;
