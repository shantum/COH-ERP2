/**
 * ProfitabilityCard - "Are we making money?" at a glance
 *
 * Shows gross margin headline, revenue/cost/profit summary,
 * and top products by contribution margin.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@coh/shared';
import { getCostingDashboard, getProductContribution } from '../../server/functions/costing';
import type { CostingDashboardData, ProductContribution } from '../../server/functions/costing';
import { IndianRupee, AlertCircle, RefreshCcw, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const PERIODS = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: 'mtd', label: 'MTD' },
] as const;

type Period = (typeof PERIODS)[number]['value'];

function getMarginColor(pct: number) {
    if (pct >= 70) return { text: 'text-emerald-600', bg: 'bg-emerald-50' };
    if (pct >= 50) return { text: 'text-amber-600', bg: 'bg-amber-50' };
    return { text: 'text-red-600', bg: 'bg-red-50' };
}

function MarginBadge({ pct }: { pct: number }) {
    const color = getMarginColor(pct);
    const Icon = pct >= 70 ? TrendingUp : pct >= 50 ? Minus : TrendingDown;
    return (
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium ${color.bg} ${color.text}`}>
            <Icon size={10} className="sm:w-3 sm:h-3" />
            {pct.toFixed(1)}%
        </span>
    );
}

export function ProfitabilityCard() {
    const [period, setPeriod] = useState<Period>('30d');

    const dashboard = useQuery({
        queryKey: ['dashboard', 'costing', period],
        queryFn: () => getCostingDashboard({ data: { period, channel: 'all' } }),
        staleTime: 2 * 60 * 1000,
        retry: 2,
    });

    const products = useQuery({
        queryKey: ['dashboard', 'productContribution', period],
        queryFn: () => getProductContribution({ data: { period, channel: 'all', limit: 8 } }),
        staleTime: 2 * 60 * 1000,
        retry: 2,
    });

    const error = dashboard.error || products.error;
    const isLoading = dashboard.isLoading || products.isLoading;
    const refetch = () => { dashboard.refetch(); products.refetch(); };

    const summary = dashboard.data?.summary;
    const productData = products.data?.data;

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                    <IndianRupee className="w-4 h-4 sm:w-5 sm:h-5 text-teal-500" />
                    <h2 className="text-base sm:text-lg font-semibold">Profitability</h2>
                </div>

                {/* Period Toggle */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    {PERIODS.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => setPeriod(value)}
                            className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium transition-colors ${
                                period === value
                                    ? 'bg-teal-50 text-teal-600'
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
                    <p className="text-gray-500 text-sm mb-2">Failed to load profitability data</p>
                    <button
                        onClick={refetch}
                        className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700"
                    >
                        <RefreshCcw className="w-3 h-3" />
                        Try again
                    </button>
                </div>
            ) : isLoading ? (
                <div className="space-y-3">
                    <div className="h-16 bg-gray-100 rounded" />
                    <div className="grid grid-cols-3 gap-2">
                        {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}
                    </div>
                    <div className="space-y-2">
                        {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded" />)}
                    </div>
                </div>
            ) : !summary ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-sm">No data for this period</p>
            ) : (
                <div className="space-y-3 sm:space-y-4">
                    {/* Headline: Gross Margin */}
                    <GrossMarginHeadline summary={summary} />

                    {/* Summary Row: Revenue | BOM Cost | Gross Profit */}
                    <SummaryRow summary={summary} />

                    {/* Product Contribution Table */}
                    {productData && productData.length > 0 && (
                        <ProductTable products={productData} />
                    )}

                </div>
            )}
        </div>
    );
}

function GrossMarginHeadline({ summary }: { summary: CostingDashboardData['summary'] }) {
    const color = getMarginColor(summary.grossMarginPct);
    return (
        <div className={`rounded-lg p-3 sm:p-4 ${color.bg}`}>
            <div className="flex items-baseline gap-2">
                <span className={`text-2xl sm:text-3xl font-bold ${color.text}`}>
                    {summary.grossMarginPct.toFixed(1)}%
                </span>
                <span className="text-xs sm:text-sm text-gray-500">gross margin</span>
            </div>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-1">
                {summary.unitsSold} units sold · {formatCurrency(summary.avgSellingPrice)} avg price
            </p>
        </div>
    );
}

function SummaryRow({ summary }: { summary: CostingDashboardData['summary'] }) {
    return (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <StatBox label="Revenue" value={formatCurrency(summary.revenue)} />
            <StatBox label="BOM Cost" value={formatCurrency(summary.bomCost)} />
            <StatBox
                label="Gross Profit"
                value={formatCurrency(summary.grossProfit)}
                positive={summary.grossProfit >= 0}
            />
        </div>
    );
}

function StatBox({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
    return (
        <div className="bg-gray-50 rounded-lg p-2 sm:p-2.5 text-center">
            <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{label}</p>
            <p className={`text-xs sm:text-sm font-semibold ${
                positive === undefined ? 'text-gray-900' :
                positive ? 'text-emerald-600' : 'text-red-600'
            }`}>
                {value}
            </p>
        </div>
    );
}

function ProductTable({ products }: { products: ProductContribution[] }) {
    return (
        <div>
            <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1.5 sm:mb-2">
                Top Products by Contribution
            </p>
            <div className="space-y-1 max-h-[200px] sm:max-h-[280px] overflow-y-auto">
                {products.map((p, i) => (
                    <div
                        key={p.productId}
                        className="flex items-center gap-2 px-1.5 sm:px-2 py-1 sm:py-1.5 rounded hover:bg-gray-50 transition-colors"
                    >
                        {/* Rank */}
                        <span className={`w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full text-[9px] sm:text-[10px] font-bold flex-shrink-0 ${
                            i === 0 ? 'bg-amber-100 text-amber-700' :
                            i === 1 ? 'bg-gray-200 text-gray-700' :
                            i === 2 ? 'bg-orange-100 text-orange-700' :
                            'bg-gray-100 text-gray-500'
                        }`}>
                            {i + 1}
                        </span>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                            <span className="text-xs sm:text-sm text-gray-900 truncate block">
                                {p.productName}
                            </span>
                        </div>

                        {/* Units */}
                        <span className="text-[10px] sm:text-xs text-gray-500 flex-shrink-0">
                            {p.unitsSold}u
                        </span>

                        {/* Margin Badge */}
                        <MarginBadge pct={p.contributionPct} />

                        {/* Total Contribution */}
                        <span className="text-xs sm:text-sm font-medium text-gray-900 flex-shrink-0 w-16 sm:w-20 text-right">
                            {formatCurrency(p.totalContribution)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default ProfitabilityCard;
