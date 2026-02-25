import React, { useState, useMemo, useCallback } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    AlertTriangle, X, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MaterialsTreeView } from '../../components/materials/MaterialsTreeView';
import { createFabricColourTransaction } from '@/server/functions/fabricColourMutations';
import { getParties } from '@/server/functions/materialsMutations';
import type { MaterialNode } from '../../components/materials/types';
import type { Party } from '@/server/functions/materialsMutations';
import type { FabricsLoaderData } from '../../routes/_authenticated/fabrics';
import {
    fmt, fmtInt,
    type ReorderItem, type ConsumptionItem, type InwardTarget,
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
    const queryClient = useQueryClient();

    // Inward modal state
    const [showInward, setShowInward] = useState<InwardTarget | null>(null);
    const [inwardForm, setInwardForm] = useState({
        qty: '', notes: '', costPerUnit: '', partyId: '',
    });

    // Server functions
    const createColourTxnFn = useServerFn(createFabricColourTransaction);
    const getPartiesFn = useServerFn(getParties);

    // Fetch parties for inward modal
    const { data: partiesData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn(),
    });
    const parties: Party[] | undefined = partiesData?.parties;

    // Inward mutation
    const createInwardMutation = useMutation({
        mutationFn: (data: {
            fabricColourId: string;
            txnType: 'inward';
            qty: number;
            unit: 'meter' | 'kg' | 'yard';
            reason: string;
            notes?: string | null;
            costPerUnit?: number | null;
            partyId?: string | null;
        }) => createColourTxnFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            queryClient.invalidateQueries({ queryKey: ['fabricColour'] });
            setShowInward(null);
            setInwardForm({ qty: '', notes: '', costPerUnit: '', partyId: '' });
        },
        onError: (err: Error) => alert(err.message || 'Failed to create inward'),
    });

    const handleSubmitInward = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        const unit = (showInward.unit === 'kg' || showInward.unit === 'yard') ? showInward.unit : 'meter' as const;
        createInwardMutation.mutate({
            fabricColourId: showInward.id,
            txnType: 'inward',
            qty: parseFloat(inwardForm.qty),
            unit,
            reason: 'supplier_receipt',
            ...(inwardForm.notes ? { notes: inwardForm.notes } : {}),
            ...(inwardForm.costPerUnit ? { costPerUnit: parseFloat(inwardForm.costPerUnit) } : {}),
            ...(inwardForm.partyId ? { partyId: inwardForm.partyId } : {}),
        });
    }, [showInward, inwardForm, createInwardMutation]);

    // Handle add inward from tree view
    const handleAddInward = useCallback((node: MaterialNode) => {
        setShowInward({
            id: node.id,
            colourName: node.colourName,
            name: node.name,
            fabricName: node.fabricName,
            unit: node.unit,
        });
    }, []);

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
        <>
            <div className="flex flex-col gap-6 overflow-auto p-6" style={{ height: 'calc(100vh - 120px)' }}>
                {/* Summary Cards */}
                <SummaryCards
                    orderNowCount={orderNowCount}
                    orderSoonCount={orderSoonCount}
                    okCount={okCount}
                    totalBalance={health.totalBalance}
                />

                {/* Fabric Colours Table */}
                <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200" style={{ height: '500px' }}>
                    <MaterialsTreeView
                        onAddInward={handleAddInward}
                    />
                </div>

                {/* Reorder Alerts */}
                <ReorderAlerts items={reorderItems} />

                {/* Top Consumption */}
                <TopConsumptionChart items={topConsumption} />
            </div>

            {/* Add Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Stock Inward</h2>
                            <button onClick={() => setShowInward(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-500">
                                Colour: <span className="font-medium text-gray-900">{showInward.colourName || showInward.name}</span>
                            </p>
                            {showInward.fabricName && (
                                <p className="text-sm text-gray-500">
                                    Fabric: <span className="font-medium text-gray-900">{showInward.fabricName}</span>
                                </p>
                            )}
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div>
                                <label className="label">Quantity ({showInward.unit || 'm'})</label>
                                <input
                                    className="input"
                                    type="number"
                                    step="0.01"
                                    value={inwardForm.qty}
                                    onChange={(e) => setInwardForm(f => ({ ...f, qty: e.target.value }))}
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Cost/Unit (INR, optional)</label>
                                <input
                                    className="input"
                                    type="number"
                                    step="0.01"
                                    value={inwardForm.costPerUnit}
                                    onChange={(e) => setInwardForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                    placeholder="0.00"
                                />
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select
                                    className="input"
                                    value={inwardForm.partyId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, partyId: e.target.value }))}
                                >
                                    <option value="">Select supplier...</option>
                                    {parties?.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={inwardForm.notes}
                                    onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder="Invoice ref, quality notes..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowInward(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createInwardMutation.isPending}>
                                    {createInwardMutation.isPending ? 'Adding...' : 'Add Inward'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
