/**
 * Returns Analytics Tab
 *
 * Shows return/exchange breakdown with business context:
 * - Summary cards (returns vs exchanges, rates, value at risk)
 * - By Size table (with units sold context)
 * - By Product table (sorted by return rate, flagged)
 * - By Reason donut chart
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    ArrowDown,
    ArrowUp,
    AlertTriangle,
    TrendingDown,
    ShieldAlert,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { getReturnsAnalytics, type ReturnsAnalyticsData } from '../../../server/functions/returns';
import { returnPrimeQueryKeys } from '../../../constants/queryKeys';
import { formatCurrency } from '../../../utils/formatting';

const PIE_COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981', '#06B6D4', '#64748B'];

interface Props {
    period: string;
}

export function AnalyticsTab({ period }: Props) {
    const getAnalyticsFn = useServerFn(getReturnsAnalytics);
    const { data, isLoading } = useQuery({
        queryKey: returnPrimeQueryKeys.returnsAnalytics(period),
        queryFn: () => getAnalyticsFn({ data: { period: period as '7d' | '30d' | '90d' | '1y' | 'all' } }),
        staleTime: 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="space-y-6">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white rounded-lg border p-6">
                        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse mb-4" />
                        <div className="h-48 bg-gray-50 rounded animate-pulse" />
                    </div>
                ))}
            </div>
        );
    }

    if (!data) {
        return (
            <div className="text-center py-12 text-gray-500">
                No analytics data available
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SummaryCards summary={data.summary} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BySizeTable bySize={data.bySize} />
                <ByReasonChart byReason={data.byReason} />
            </div>
            <ByProductTable byProduct={data.byProduct} />
        </div>
    );
}

// ============================================
// SUMMARY CARDS
// ============================================

function SummaryCards({ summary }: { summary: ReturnsAnalyticsData['summary'] }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
                label="Total Orders"
                value={summary.totalOrders.toLocaleString('en-IN')}
                subValue="in period"
            />
            <StatCard
                label="Returns"
                value={summary.returns.toString()}
                subValue={`${(summary.totalOrders > 0 ? (summary.returns / summary.totalOrders * 100) : 0).toFixed(1)}% of orders`}
                valueColor="text-red-600"
                detail={`${formatCurrency(summary.returnValue)} at risk`}
            />
            <StatCard
                label="Exchanges"
                value={summary.exchanges.toString()}
                subValue={`${(summary.totalOrders > 0 ? (summary.exchanges / summary.totalOrders * 100) : 0).toFixed(1)}% of orders`}
                valueColor="text-amber-600"
                detail={`${formatCurrency(summary.exchangeValue)} at risk`}
            />
            <StatCard
                label="Total Rate"
                value={`${summary.returnRatePct.toFixed(1)}%`}
                subValue={`${summary.totalRequests} requests`}
                valueColor={summary.returnRatePct > 15 ? 'text-red-600' : summary.returnRatePct > 10 ? 'text-amber-600' : 'text-green-600'}
                detail={`${formatCurrency(summary.returnValue + summary.exchangeValue)} total risk`}
            />
        </div>
    );
}

function StatCard({
    label,
    value,
    subValue,
    detail,
    valueColor,
}: {
    label: string;
    value: string;
    subValue: string;
    detail?: string;
    valueColor?: string;
}) {
    return (
        <div className="bg-white rounded-lg border p-4">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${valueColor || 'text-gray-900'}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{subValue}</p>
            {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
        </div>
    );
}

// ============================================
// BY SIZE TABLE
// ============================================

function BySizeTable({ bySize }: { bySize: ReturnsAnalyticsData['bySize'] }) {
    const validSizes = bySize.filter(s => ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].includes(s.size));
    if (validSizes.length === 0) {
        return (
            <div className="bg-white rounded-lg border p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">By Size</h3>
                <p className="text-sm text-gray-500 text-center py-8">No size data available</p>
            </div>
        );
    }

    const avgRate = validSizes.reduce((sum, s) => sum + s.returnRate, 0) / validSizes.length;
    const bestSize = validSizes.reduce((best, s) => s.returnRate < best.returnRate ? s : best);
    const worstSize = validSizes.reduce((worst, s) => s.returnRate > worst.returnRate ? s : worst);

    return (
        <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">By Size</h3>
                <span className="text-xs text-gray-400">Avg rate: {avgRate.toFixed(1)}%</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-xs text-gray-500">
                            <th className="text-left py-2 pr-2 font-medium">Size</th>
                            <th className="text-right py-2 px-2 font-medium">Sold</th>
                            <th className="text-right py-2 px-2 font-medium">Ret</th>
                            <th className="text-right py-2 px-2 font-medium">Exc</th>
                            <th className="text-right py-2 px-2 font-medium">Total</th>
                            <th className="text-right py-2 pl-2 font-medium">Rate</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {validSizes.map((row) => {
                            const isBest = row.size === bestSize.size;
                            const isWorst = row.size === worstSize.size;
                            return (
                                <tr key={row.size} className={isWorst ? 'bg-red-50/50' : isBest ? 'bg-green-50/50' : ''}>
                                    <td className="py-2 pr-2 font-medium text-gray-900">
                                        {row.size}
                                        {isWorst && <ArrowUp className="inline w-3 h-3 ml-1 text-red-500" />}
                                        {isBest && <ArrowDown className="inline w-3 h-3 ml-1 text-green-500" />}
                                    </td>
                                    <td className="text-right py-2 px-2 text-gray-600">{row.unitsSold.toLocaleString('en-IN')}</td>
                                    <td className="text-right py-2 px-2 text-red-600">{row.returns}</td>
                                    <td className="text-right py-2 px-2 text-amber-600">{row.exchanges}</td>
                                    <td className="text-right py-2 px-2 font-medium">{row.total}</td>
                                    <td className={`text-right py-2 pl-2 font-semibold ${
                                        row.returnRate > 15 ? 'text-red-600' :
                                        row.returnRate > 10 ? 'text-amber-600' :
                                        'text-green-600'
                                    }`}>
                                        {row.returnRate.toFixed(1)}%
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ============================================
// BY REASON CHART
// ============================================

function ByReasonChart({ byReason }: { byReason: ReturnsAnalyticsData['byReason'] }) {
    if (byReason.length === 0) {
        return (
            <div className="bg-white rounded-lg border p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">By Reason</h3>
                <p className="text-sm text-gray-500 text-center py-8">No reason data available</p>
            </div>
        );
    }

    // Filter out 'other' for cleaner chart, show it separately
    const classified = byReason.filter(r => r.category !== 'other');
    const other = byReason.find(r => r.category === 'other');
    const totalClassified = classified.reduce((sum, r) => sum + r.count, 0);
    const total = byReason.reduce((sum, r) => sum + r.count, 0);

    return (
        <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">By Reason</h3>
                <span className="text-xs text-gray-400">
                    {totalClassified} classified / {total} total
                </span>
            </div>

            {classified.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                        <Pie
                            data={classified}
                            dataKey="count"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            innerRadius={40}
                            label={({ payload }) => `${(payload as { pct: number }).pct}%`}
                            labelLine={false}
                        >
                            {classified.map((_, index) => (
                                <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value, name) => [`${value} returns`, name]}
                            contentStyle={{ fontSize: '12px', borderRadius: '8px' }}
                        />
                        <Legend
                            layout="vertical"
                            verticalAlign="middle"
                            align="right"
                            wrapperStyle={{ fontSize: '11px' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            ) : null}

            {/* Reason list with counts */}
            <div className="mt-3 space-y-1.5">
                {classified.map((r, i) => (
                    <div key={r.category} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="text-gray-700">{r.label}</span>
                        </div>
                        <span className="font-medium text-gray-900">{r.count} ({r.pct}%)</span>
                    </div>
                ))}
                {other && other.count > 0 && (
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t">
                        <span className="text-gray-400">Unclassified</span>
                        <span className="text-gray-400">{other.count} ({other.pct}%)</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// BY PRODUCT TABLE
// ============================================

function ByProductTable({ byProduct }: { byProduct: ReturnsAnalyticsData['byProduct'] }) {
    if (byProduct.length === 0) {
        return (
            <div className="bg-white rounded-lg border p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">By Product</h3>
                <p className="text-sm text-gray-500 text-center py-8">No products with 5+ returns in this period</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">By Product</h3>
                <span className="text-xs text-gray-400">{byProduct.length} products with 5+ requests</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-xs text-gray-500">
                            <th className="text-left py-2 pr-2 font-medium">Product</th>
                            <th className="text-right py-2 px-2 font-medium">Ret</th>
                            <th className="text-right py-2 px-2 font-medium">Exc</th>
                            <th className="text-right py-2 px-2 font-medium">Total</th>
                            <th className="text-right py-2 px-2 font-medium">Sold</th>
                            <th className="text-right py-2 px-2 font-medium">Rate</th>
                            <th className="text-right py-2 pl-2 font-medium">Value at Risk</th>
                            <th className="py-2 pl-3 font-medium w-8"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {byProduct.map((row) => {
                            const flag = getProductFlag(row);
                            return (
                                <tr key={row.productName} className={flag?.bg || ''}>
                                    <td className="py-2 pr-2 font-medium text-gray-900 max-w-[200px] truncate">
                                        {row.productName}
                                    </td>
                                    <td className="text-right py-2 px-2 text-red-600">{row.returns}</td>
                                    <td className="text-right py-2 px-2 text-amber-600">{row.exchanges}</td>
                                    <td className="text-right py-2 px-2 font-medium">{row.total}</td>
                                    <td className="text-right py-2 px-2 text-gray-600">{row.unitsSold.toLocaleString('en-IN')}</td>
                                    <td className={`text-right py-2 px-2 font-semibold ${
                                        row.returnRate > 25 ? 'text-red-600' :
                                        row.returnRate > 15 ? 'text-amber-600' :
                                        'text-gray-900'
                                    }`}>
                                        {row.returnRate.toFixed(1)}%
                                    </td>
                                    <td className="text-right py-2 pl-2 text-gray-600">
                                        {formatCurrency(row.valueAtRisk)}
                                    </td>
                                    <td className="py-2 pl-3">
                                        {flag && (
                                            <span title={flag.label}>
                                                {flag.icon}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function getProductFlag(row: ReturnsAnalyticsData['byProduct'][number]): { icon: React.ReactNode; label: string; bg: string } | null {
    if (row.returnRate > 30) {
        return {
            icon: <ShieldAlert className="w-4 h-4 text-red-500" />,
            label: `Crisis: ${row.returnRate.toFixed(0)}% return rate`,
            bg: 'bg-red-50/50',
        };
    }
    if (row.returnRate > 20) {
        return {
            icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
            label: row.exchanges > row.returns
                ? 'High exchanges — likely sizing issue'
                : 'High return rate',
            bg: 'bg-amber-50/50',
        };
    }
    if (row.valueAtRisk > 100000) {
        return {
            icon: <TrendingDown className="w-4 h-4 text-red-400" />,
            label: `High value at risk: ${formatCurrency(row.valueAtRisk)}`,
            bg: '',
        };
    }
    return null;
}
