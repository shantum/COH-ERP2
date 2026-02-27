import React, { useState, useMemo } from 'react';
import {
    AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FabricsLoaderData } from '../../routes/_authenticated/fabrics';
import {
    fmt, fmtInt,
    type ReorderItem, type ConsumptionItem,
} from './shared';

// ── Sub-components ──────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const isNow = status === 'ORDER NOW';
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                isNow ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
            )}
        >
            {status}
        </span>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="mb-4 text-base font-semibold text-slate-800">{title}</h3>
            {children}
        </div>
    );
}

function SummaryCards({
    orderNowCount,
    orderSoonCount,
    okCount,
    totalBalance,
}: {
    orderNowCount: number;
    orderSoonCount: number;
    okCount: number;
    totalBalance: number;
}) {
    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl bg-red-50 p-5 shadow-sm ring-1 ring-red-100">
                <div className="text-sm font-medium text-red-700">Order Now</div>
                <div className="mt-2 text-3xl font-bold text-red-900">{fmtInt(orderNowCount)}</div>
                <div className="mt-1 text-xs text-red-600">Immediate reorder needed</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-5 shadow-sm ring-1 ring-amber-100">
                <div className="text-sm font-medium text-amber-700">Order Soon</div>
                <div className="mt-2 text-3xl font-bold text-amber-900">{fmtInt(orderSoonCount)}</div>
                <div className="mt-1 text-xs text-amber-600">Approaching reorder point</div>
            </div>
            <div className="rounded-xl bg-green-50 p-5 shadow-sm ring-1 ring-green-100">
                <div className="text-sm font-medium text-green-700">In Stock</div>
                <div className="mt-2 text-3xl font-bold text-green-900">{fmtInt(okCount)}</div>
                <div className="mt-1 text-xs text-green-600">Adequate stock levels</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-5 shadow-sm ring-1 ring-slate-200">
                <div className="text-sm font-medium text-slate-600">Total Balance</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{fmt(totalBalance)}</div>
                <div className="mt-1 text-xs text-slate-500">Across all fabrics</div>
            </div>
        </div>
    );
}

function ReorderAlerts({ items }: { items: ReorderItem[] }) {
    const [isOpen, setIsOpen] = useState(true);

    if (items.length === 0) {
        return (
            <Section title="Reorder Alerts">
                <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
                    All items are adequately stocked.
                </div>
            </Section>
        );
    }

    return (
        <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex w-full items-center justify-between p-6 text-left"
            >
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <h3 className="text-base font-semibold text-slate-800">
                        Reorder Alerts ({items.length})
                    </h3>
                </div>
                {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
            </button>

            {isOpen && (
                <div className="border-t border-slate-200 px-6 pb-6">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                                    <th className="py-3 pr-4">Status</th>
                                    <th className="py-3 pr-4">Material &gt; Fabric &gt; Colour</th>
                                    <th className="py-3 pr-4 text-right">Balance</th>
                                    <th className="py-3 pr-4 text-right">Avg Daily</th>
                                    <th className="py-3 pr-4 text-right">Days Left</th>
                                    <th className="py-3 pr-4 text-right">Suggested Qty</th>
                                    <th className="py-3 pr-4 text-right">Lead Time</th>
                                    <th className="py-3">Supplier</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {items.map((item) => (
                                    <tr key={item.fabricColourId} className="hover:bg-slate-50">
                                        <td className="py-2.5 pr-4">
                                            <StatusBadge status={item.status} />
                                        </td>
                                        <td className="py-2.5 pr-4 font-medium text-slate-800">
                                            <span className="text-slate-400">{item.materialName} &gt; </span>
                                            {item.fabricName}
                                            <span className="text-slate-400"> &gt; </span>
                                            {item.colourName}
                                        </td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{fmt(item.currentBalance)}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">{fmt(item.avgDailyConsumption)}</td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">
                                            {item.daysOfStock != null ? fmtInt(item.daysOfStock) : '--'}
                                        </td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums font-medium">
                                            {fmtInt(item.suggestedOrderQty)}
                                        </td>
                                        <td className="py-2.5 pr-4 text-right tabular-nums">
                                            {item.leadTimeDays != null ? `${item.leadTimeDays}d` : '--'}
                                        </td>
                                        <td className="py-2.5 text-slate-600">{item.party || '--'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function TopConsumptionChart({ items }: { items: ConsumptionItem[] }) {
    const maxVal = items.length > 0 ? items[0].consumed30d : 1;

    return (
        <Section title="Top Consumption (30-day)">
            {items.length === 0 ? (
                <p className="text-sm text-slate-500">No consumption data available.</p>
            ) : (
                <div className="space-y-2.5">
                    {items.map((item, i) => {
                        const pct = maxVal > 0 ? (item.consumed30d / maxVal) * 100 : 0;
                        return (
                            <div key={`${item.fabricName}-${item.colourName}-${i}`} className="flex items-center gap-3">
                                <div className="w-48 shrink-0 truncate text-sm text-slate-700">
                                    <span className="text-slate-400">{item.fabricName} &gt; </span>
                                    {item.colourName}
                                </div>
                                <div className="relative flex-1">
                                    <div className="h-7 w-full rounded bg-slate-100" />
                                    <div
                                        className="absolute inset-y-0 left-0 rounded bg-blue-500 transition-all"
                                        style={{ width: `${Math.max(pct, 1)}%` }}
                                    />
                                    <div className="absolute inset-y-0 right-2 flex items-center text-xs font-medium text-slate-600">
                                        {fmt(item.consumed30d)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Section>
    );
}

// ── Main Tab ────────────────────────────────────────────────

export default function OverviewTab({
    analysis,
    health,
}: {
    analysis: FabricsLoaderData['analysis'];
    health: FabricsLoaderData['health'];
}) {
    // Derive summary counts
    const analysisItems = analysis.analysis;
    const { orderNowCount, orderSoonCount, okCount } = useMemo(() => {
        let now = 0;
        let soon = 0;
        let ok = 0;
        for (const item of analysisItems) {
            if (item.status === 'ORDER NOW') now++;
            else if (item.status === 'ORDER SOON') soon++;
            else ok++;
        }
        return { orderNowCount: now, orderSoonCount: soon, okCount: ok };
    }, [analysisItems]);

    // Reorder alerts: only ORDER NOW and ORDER SOON
    const reorderItems = useMemo(
        () => analysisItems.filter(
            (item) => item.status === 'ORDER NOW' || item.status === 'ORDER SOON'
        ) as ReorderItem[],
        [analysisItems]
    );

    // Top consumption: flatten health colours, sort by consumed30d, take top 10
    const topConsumption = useMemo(() => {
        const flat: ConsumptionItem[] = [];
        for (const row of health.data) {
            for (const colour of row.colours) {
                flat.push({
                    fabricName: row.fabricName,
                    colourName: colour.colourName,
                    consumed30d: colour.consumption.consumed30d,
                });
            }
        }
        flat.sort((a, b) => b.consumed30d - a.consumed30d);
        return flat.slice(0, 10);
    }, [health.data]);

    return (
        <div className="flex flex-col gap-6 overflow-auto p-6" style={{ height: 'calc(100vh - 120px)' }}>
            {/* Summary Cards */}
            <SummaryCards
                orderNowCount={orderNowCount}
                orderSoonCount={orderSoonCount}
                okCount={okCount}
                totalBalance={health.totalBalance}
            />

            {/* Fabric Balances */}
            <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="px-4 py-3 border-b bg-slate-50">
                    <h3 className="text-sm font-semibold text-slate-800">
                        Fabric Balances
                    </h3>
                </div>
                <div style={{ maxHeight: 500, overflow: 'auto' }}>
                    {health.data.map((fabric) => (
                        <div key={fabric.fabricId} className="border-b border-slate-100">
                            <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50">
                                <div>
                                    <span className="font-medium text-slate-800 text-sm">{fabric.fabricName}</span>
                                    <span className="ml-2 text-xs text-slate-400">{fabric.materialName}</span>
                                    <span className="ml-2 text-xs text-slate-400">({fabric.colours.length} colours)</span>
                                </div>
                                <span className="font-semibold text-sm tabular-nums text-slate-800">
                                    {fmt(fabric.totalBalance)} {fabric.unit === 'kg' ? 'kg' : 'mtr'}
                                </span>
                            </div>
                            {fabric.colours.map((colour) => (
                                <div
                                    key={colour.colourName}
                                    className="flex items-center justify-between px-4 py-1.5 pl-8 hover:bg-blue-50/30"
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-3 h-3 rounded-full border border-slate-300"
                                            style={{ backgroundColor: colour.colourHex || '#ccc' }}
                                        />
                                        <span className="text-sm text-slate-600">{colour.colourName}</span>
                                    </div>
                                    <span className={cn(
                                        'text-sm tabular-nums font-medium',
                                        colour.balance === 0 ? 'text-red-500' : 'text-slate-700'
                                    )}>
                                        {fmt(colour.balance)} {fabric.unit === 'kg' ? 'kg' : 'mtr'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Reorder Alerts */}
            <ReorderAlerts items={reorderItems} />

            {/* Top Consumption */}
            <TopConsumptionChart items={topConsumption} />
        </div>
    );
}
