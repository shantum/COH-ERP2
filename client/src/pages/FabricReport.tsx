/**
 * Fabric Report Page
 *
 * Daily fabric stock report: summary cards, reorder alerts,
 * consumption chart, yesterday's activity, and stock overview.
 */

import { useMemo } from 'react';
import { Route, type FabricReportLoaderData } from '../routes/_authenticated/fabric-report';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle, Package } from 'lucide-react';

// ============================================
// HELPERS
// ============================================

function formatDate(date: Date): string {
    return date.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function fmt(n: number | string): string {
    const num = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtInt(n: number): string {
    return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ============================================
// SECTION: Summary Cards
// ============================================

function SummaryCards({
    orderNowCount,
    orderSoonCount,
    okCount,
    inwardCount,
    outwardCount,
}: {
    orderNowCount: number;
    orderSoonCount: number;
    okCount: number;
    inwardCount: number;
    outwardCount: number;
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
                <div className="text-sm font-medium text-slate-600">Yesterday</div>
                <div className="mt-2 flex items-center gap-3">
                    <span className="flex items-center gap-1 text-lg font-bold text-green-700">
                        <ArrowDownLeft className="h-4 w-4" /> {fmtInt(inwardCount)}
                    </span>
                    <span className="text-slate-300">/</span>
                    <span className="flex items-center gap-1 text-lg font-bold text-red-700">
                        <ArrowUpRight className="h-4 w-4" /> {fmtInt(outwardCount)}
                    </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">Inward / Outward</div>
            </div>
        </div>
    );
}

// ============================================
// SECTION: Reorder Alerts
// ============================================

function ReorderAlerts({
    items,
}: {
    items: Array<{
        fabricColourId: string;
        materialName: string;
        fabricName: string;
        colourName: string;
        currentBalance: string;
        avgDailyConsumption: string;
        daysOfStock: number | null;
        suggestedOrderQty: number;
        leadTimeDays: number | null;
        party: string;
        status: 'ORDER NOW' | 'ORDER SOON' | 'OK';
    }>;
}) {
    if (items.length === 0) {
        return (
            <Section title="Reorder Alerts">
                <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
                    <CheckCircle className="h-4 w-4" />
                    All items are adequately stocked.
                </div>
            </Section>
        );
    }

    return (
        <Section title="Reorder Alerts">
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
        </Section>
    );
}

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

// ============================================
// SECTION: Top Consumption Chart
// ============================================

function TopConsumptionChart({
    items,
}: {
    items: Array<{
        fabricName: string;
        colourName: string;
        consumed30d: number;
    }>;
}) {
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

// ============================================
// SECTION: Yesterday's Activity
// ============================================

function YesterdaysActivity({
    transactions,
}: {
    transactions: Array<{
        id: string;
        txnType: string;
        qty: number;
        reason: string;
        party: { id: string; name: string } | null;
        fabricColour: {
            colourName: string;
            fabric: {
                name: string;
                material: { name: string } | null;
            };
        };
    }>;
}) {
    const inward = transactions.filter((t) => t.txnType === 'inward');
    const outward = transactions.filter((t) => t.txnType === 'outward');

    return (
        <Section title="Yesterday's Activity">
            <div className="grid gap-6 md:grid-cols-2">
                <ActivityTable label="Inward" icon={<ArrowDownLeft className="h-4 w-4 text-green-600" />} rows={inward} />
                <ActivityTable label="Outward" icon={<ArrowUpRight className="h-4 w-4 text-red-600" />} rows={outward} />
            </div>
        </Section>
    );
}

function ActivityTable({
    label,
    icon,
    rows,
}: {
    label: string;
    icon: React.ReactNode;
    rows: Array<{
        id: string;
        qty: number;
        reason: string;
        party: { id: string; name: string } | null;
        fabricColour: {
            colourName: string;
            fabric: {
                name: string;
                material: { name: string } | null;
            };
        };
    }>;
}) {
    return (
        <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                {icon} {label}
                <span className="ml-1 text-xs font-normal text-slate-400">({rows.length})</span>
            </h4>
            {rows.length === 0 ? (
                <p className="text-sm text-slate-400">No activity yesterday</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                                <th className="py-2 pr-3">Material &gt; Fabric &gt; Colour</th>
                                <th className="py-2 pr-3 text-right">Qty</th>
                                <th className="py-2 pr-3">Reason</th>
                                {label === 'Inward' && <th className="py-2">Supplier</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {rows.map((row) => (
                                <tr key={row.id} className="hover:bg-slate-50">
                                    <td className="py-2 pr-3 text-slate-700">
                                        <span className="text-slate-400">
                                            {row.fabricColour.fabric.material?.name ?? 'Unknown'} &gt;{' '}
                                        </span>
                                        {row.fabricColour.fabric.name}
                                        <span className="text-slate-400"> &gt; </span>
                                        {row.fabricColour.colourName}
                                    </td>
                                    <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmt(row.qty)}</td>
                                    <td className="py-2 pr-3 capitalize text-slate-600">
                                        {row.reason.replace(/_/g, ' ')}
                                    </td>
                                    {label === 'Inward' && (
                                        <td className="py-2 text-slate-600">{row.party?.name ?? '--'}</td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ============================================
// SECTION: Stock Overview by Material
// ============================================

function StockOverview({
    data,
}: {
    data: Array<{
        materialName: string;
        fabrics: Array<{
            fabricName: string;
            totalBalance: number;
            unit: string;
            colours: Array<{
                colourName: string;
                colourHex: string | null;
                balance: number;
            }>;
        }>;
        totalBalance: number;
    }>;
}) {
    return (
        <Section title="Stock Overview by Material">
            {data.length === 0 ? (
                <p className="text-sm text-slate-500">No stock data available.</p>
            ) : (
                <div className="space-y-2">
                    {data.map((material) => (
                        <details
                            key={material.materialName}
                            className="group rounded-lg border border-slate-200 bg-white"
                        >
                            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                                <span className="flex items-center gap-2">
                                    <Package className="h-4 w-4 text-slate-400" />
                                    {material.materialName}
                                </span>
                                <span className="text-xs font-normal text-slate-500">
                                    Total: {fmt(material.totalBalance)}
                                </span>
                            </summary>
                            <div className="border-t border-slate-100 px-4 py-3">
                                {material.fabrics.map((fabric) => (
                                    <div key={fabric.fabricName} className="mb-3 last:mb-0">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-medium text-slate-700">{fabric.fabricName}</span>
                                            <span className="text-xs text-slate-500">
                                                {fmt(fabric.totalBalance)} {fabric.unit}
                                            </span>
                                        </div>
                                        <div className="ml-4 mt-1 space-y-0.5">
                                            {fabric.colours.map((colour) => (
                                                <div
                                                    key={colour.colourName}
                                                    className="flex items-center justify-between text-xs text-slate-500"
                                                >
                                                    <span className="flex items-center gap-1.5">
                                                        {colour.colourHex && (
                                                            <span
                                                                className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-slate-200"
                                                                style={{ backgroundColor: colour.colourHex }}
                                                            />
                                                        )}
                                                        {colour.colourName}
                                                    </span>
                                                    <span className="tabular-nums">{fmt(colour.balance)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </details>
                    ))}
                </div>
            )}
        </Section>
    );
}

// ============================================
// SHARED
// ============================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="mb-4 text-base font-semibold text-slate-800">{title}</h3>
            {children}
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function FabricReport() {
    const { analysis, health, yesterdayTransactions, error } = Route.useLoaderData() as FabricReportLoaderData;

    const analysisItems = analysis.analysis;

    // Summary counts
    const orderNowCount = useMemo(
        () => analysisItems.filter((a) => a.status === 'ORDER NOW').length,
        [analysisItems]
    );
    const orderSoonCount = useMemo(
        () => analysisItems.filter((a) => a.status === 'ORDER SOON').length,
        [analysisItems]
    );
    const okCount = useMemo(
        () => analysisItems.filter((a) => a.status === 'OK').length,
        [analysisItems]
    );

    const txns = yesterdayTransactions.transactions;
    const inwardCount = useMemo(() => txns.filter((t) => t.txnType === 'inward').length, [txns]);
    const outwardCount = useMemo(() => txns.filter((t) => t.txnType === 'outward').length, [txns]);

    // Reorder alerts sorted by urgency
    const reorderItems = useMemo(() => {
        return analysisItems
            .filter((a) => a.status === 'ORDER NOW' || a.status === 'ORDER SOON')
            .sort((a, b) => {
                if (a.status === 'ORDER NOW' && b.status !== 'ORDER NOW') return -1;
                if (a.status !== 'ORDER NOW' && b.status === 'ORDER NOW') return 1;
                const aDays = a.daysOfStock ?? Infinity;
                const bDays = b.daysOfStock ?? Infinity;
                return aDays - bDays;
            });
    }, [analysisItems]);

    // Top 10 consumption by 30-day window
    const topConsumption = useMemo(() => {
        const allColours: Array<{ fabricName: string; colourName: string; consumed30d: number }> = [];
        for (const row of health.data) {
            for (const colour of row.colours) {
                allColours.push({
                    fabricName: row.fabricName,
                    colourName: colour.colourName,
                    consumed30d: colour.consumption.consumed30d,
                });
            }
        }
        allColours.sort((a, b) => b.consumed30d - a.consumed30d);
        return allColours.slice(0, 10);
    }, [health.data]);

    // Stock overview grouped by material
    const stockByMaterial = useMemo(() => {
        const map = new Map<
            string,
            {
                materialName: string;
                fabrics: Array<{
                    fabricName: string;
                    totalBalance: number;
                    unit: string;
                    colours: Array<{ colourName: string; colourHex: string | null; balance: number }>;
                }>;
                totalBalance: number;
            }
        >();

        for (const row of health.data) {
            const key = row.materialName;
            if (!map.has(key)) {
                map.set(key, { materialName: key, fabrics: [], totalBalance: 0 });
            }
            const entry = map.get(key)!;
            entry.totalBalance += row.totalBalance;
            entry.fabrics.push({
                fabricName: row.fabricName,
                totalBalance: row.totalBalance,
                unit: row.unit,
                colours: row.colours.map((c) => ({
                    colourName: c.colourName,
                    colourHex: c.colourHex,
                    balance: c.balance,
                })),
            });
        }

        return Array.from(map.values()).sort((a, b) => a.materialName.localeCompare(b.materialName));
    }, [health.data]);

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl space-y-6 p-6">
                {/* Header */}
                <div className="flex items-baseline justify-between">
                    <h1 className="text-2xl font-bold text-slate-900">Fabric Report</h1>
                    <time className="text-sm text-slate-500">{formatDate(new Date())}</time>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {error}
                    </div>
                )}

                {/* 1. Summary Cards */}
                <SummaryCards
                    orderNowCount={orderNowCount}
                    orderSoonCount={orderSoonCount}
                    okCount={okCount}
                    inwardCount={inwardCount}
                    outwardCount={outwardCount}
                />

                {/* 2. Reorder Alerts */}
                <ReorderAlerts items={reorderItems} />

                {/* 3. Top Consumption */}
                <TopConsumptionChart items={topConsumption} />

                {/* 4. Yesterday's Activity */}
                <YesterdaysActivity transactions={txns} />

                {/* 5. Stock Overview */}
                <StockOverview data={stockByMaterial} />
            </div>
        </div>
    );
}
