/**
 * Returns Analytics Tab
 *
 * Internal analytics from OrderLine return data:
 * - Summary cards
 * - Status breakdown
 * - Reason breakdown
 * - Top returned SKUs
 * - Monthly trend
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getInternalReturnAnalytics,
    type InternalReturnAnalytics,
} from '../../../server/functions/returns';
import { formatCurrency } from '../../../utils/formatting';
import { getStatusBadge } from '../types';

interface Props {
    period: string;
}

export function AnalyticsTab({ period }: Props) {
    const getAnalyticsFn = useServerFn(getInternalReturnAnalytics);
    const { data, isLoading } = useQuery({
        queryKey: ['returns', 'internalAnalytics', period],
        queryFn: () => getAnalyticsFn({ data: { period: period as '7d' | '30d' | '90d' | '1y' | 'all' } }),
        staleTime: 60 * 1000,
    });

    if (isLoading) {
        return (
            <div className="space-y-6">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white rounded-lg border p-6">
                        <div className="h-6 w-40 bg-gray-100 rounded animate-pulse mb-4" />
                        <div className="h-32 bg-gray-50 rounded animate-pulse" />
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
                <StatusBreakdown byStatus={data.byStatus} />
                <ReasonBreakdown byReason={data.byReason} />
            </div>
            <TopReturnedSkus skus={data.topReturnedSkus} />
            <MonthlyTrend trend={data.monthlyTrend} />
        </div>
    );
}

// ============================================
// SUMMARY CARDS
// ============================================

function SummaryCards({ summary }: { summary: InternalReturnAnalytics['summary'] }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
                label="Total Returns"
                value={summary.totalReturns.toLocaleString()}
                subValue={`${summary.activeReturns} active`}
            />
            <StatCard
                label="Refunds"
                value={summary.refunds.toLocaleString()}
                subValue={formatCurrency(summary.totalRefundValue)}
                valueColor="text-red-600"
            />
            <StatCard
                label="Exchanges"
                value={summary.exchanges.toLocaleString()}
                subValue={`${summary.totalReturns > 0 ? Math.round((summary.exchanges / summary.totalReturns) * 100) : 0}% of returns`}
                valueColor="text-blue-600"
            />
            <StatCard
                label="Avg Resolution"
                value={`${summary.avgResolutionDays}d`}
                subValue={`${summary.completedReturns} completed`}
                valueColor={summary.avgResolutionDays > 7 ? 'text-amber-600' : 'text-green-600'}
            />
        </div>
    );
}

function StatCard({
    label,
    value,
    subValue,
    valueColor,
}: {
    label: string;
    value: string;
    subValue: string;
    valueColor?: string;
}) {
    return (
        <div className="bg-white rounded-lg border p-4">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${valueColor || 'text-gray-900'}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{subValue}</p>
        </div>
    );
}

// ============================================
// STATUS BREAKDOWN
// ============================================

function StatusBreakdown({ byStatus }: { byStatus: InternalReturnAnalytics['byStatus'] }) {
    const total = byStatus.reduce((s, r) => s + r.count, 0);

    return (
        <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">By Status</h3>
            {byStatus.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No data</p>
            ) : (
                <div className="space-y-2">
                    {byStatus.map((row) => {
                        const pct = total > 0 ? (row.count / total) * 100 : 0;
                        return (
                            <div key={row.status} className="flex items-center gap-3">
                                <span className={`px-2 py-0.5 text-xs font-medium rounded min-w-[100px] text-center ${getStatusBadge(row.status)}`}>
                                    {row.status.replace(/_/g, ' ')}
                                </span>
                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 rounded-full"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                <span className="text-xs text-gray-600 font-medium min-w-[50px] text-right">
                                    {row.count} ({pct.toFixed(0)}%)
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ============================================
// REASON BREAKDOWN
// ============================================

function ReasonBreakdown({ byReason }: { byReason: InternalReturnAnalytics['byReason'] }) {
    return (
        <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">By Reason</h3>
            {byReason.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No classified reasons</p>
            ) : (
                <div className="space-y-2">
                    {byReason.map((row) => (
                        <div key={row.category} className="flex items-center gap-3">
                            <span className="text-xs text-gray-700 min-w-[120px] truncate">
                                {row.label}
                            </span>
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-purple-500 rounded-full"
                                    style={{ width: `${row.pct}%` }}
                                />
                            </div>
                            <span className="text-xs text-gray-600 font-medium min-w-[60px] text-right">
                                {row.count} ({row.pct}%)
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================
// TOP RETURNED SKUS
// ============================================

function TopReturnedSkus({ skus }: { skus: InternalReturnAnalytics['topReturnedSkus'] }) {
    if (skus.length === 0) return null;

    return (
        <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Returned SKUs</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-xs text-gray-500">
                            <th className="text-left py-2 pr-2 font-medium">SKU</th>
                            <th className="text-left py-2 px-2 font-medium">Product</th>
                            <th className="text-left py-2 px-2 font-medium">Color / Size</th>
                            <th className="text-right py-2 pl-2 font-medium">Returns</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {skus.map((row, i) => (
                            <tr key={row.skuCode} className={i < 3 ? 'bg-red-50/30' : ''}>
                                <td className="py-2 pr-2 font-mono text-xs text-gray-600">{row.skuCode}</td>
                                <td className="py-2 px-2 font-medium text-gray-800 truncate max-w-[200px]">{row.productName}</td>
                                <td className="py-2 px-2 text-gray-600">{row.colorName} / {row.size}</td>
                                <td className="text-right py-2 pl-2 font-bold text-red-600">{row.count}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ============================================
// MONTHLY TREND
// ============================================

function MonthlyTrend({ trend }: { trend: InternalReturnAnalytics['monthlyTrend'] }) {
    if (trend.length === 0) return null;

    const maxCount = Math.max(...trend.map(t => t.returns + t.exchanges), 1);

    return (
        <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Trend (Last 6 Months)</h3>
            <div className="flex items-end gap-2 h-32">
                {trend.map((row) => {
                    const total = row.returns + row.exchanges;
                    const returnsPct = maxCount > 0 ? (row.returns / maxCount) * 100 : 0;
                    const exchangesPct = maxCount > 0 ? (row.exchanges / maxCount) * 100 : 0;

                    return (
                        <div key={row.month} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex flex-col items-center" style={{ height: '100px' }}>
                                <div className="w-full max-w-[40px] flex flex-col justify-end h-full gap-0.5">
                                    <div
                                        className="bg-red-400 rounded-t"
                                        style={{ height: `${returnsPct}%`, minHeight: row.returns > 0 ? '2px' : '0' }}
                                        title={`Returns: ${row.returns}`}
                                    />
                                    <div
                                        className="bg-blue-400 rounded-b"
                                        style={{ height: `${exchangesPct}%`, minHeight: row.exchanges > 0 ? '2px' : '0' }}
                                        title={`Exchanges: ${row.exchanges}`}
                                    />
                                </div>
                            </div>
                            <span className="text-[10px] text-gray-500 font-medium">{total}</span>
                            <span className="text-[10px] text-gray-400">
                                {new Date(row.month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-4 mt-3 justify-center">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <div className="w-3 h-3 bg-red-400 rounded" />
                    Refunds
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <div className="w-3 h-3 bg-blue-400 rounded" />
                    Exchanges
                </div>
            </div>
        </div>
    );
}
