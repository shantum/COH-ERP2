/**
 * Fabrics Page - Consolidated fabric management
 *
 * 6 tabs: Overview, Transactions, Reconciliation, Invoices, Trims, Services.
 * Overview is fully implemented; others are placeholders for now.
 *
 * Replaces 5 scattered pages with a single dashboard that shows:
 * - Summary cards (stock status counts + total balance)
 * - Full fabric colours CRUD table (MaterialsTreeView)
 * - Reorder alerts from stock analysis
 * - Top 30-day consumption chart from stock health data
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Route, type FabricsLoaderData } from '../routes/_authenticated/fabrics';
import { useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { AlertTriangle, X, ChevronDown, ChevronRight, Trash2, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MaterialsTreeView } from '../components/materials/MaterialsTreeView';
import { createColourTransaction, getParties } from '@/server/functions/materialsMutations';
import { getAllFabricColourTransactions } from '@/server/functions/fabricColours';
import { createFabricColourTransaction, deleteFabricColourTransaction } from '@/server/functions/fabricColourMutations';
import { getCatalogFilters } from '../server/functions/products';
import { useAuth } from '../hooks/useAuth';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import type { MaterialNode } from '../components/materials/types';
import type { Party } from '@/server/functions/materialsMutations';

// ============================================
// HELPERS
// ============================================

/** Format number with en-IN locale, up to 2 decimal places */
function fmt(n: number | string): string {
    const num = typeof n === 'string' ? parseFloat(n) : n;
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Format integer with en-IN locale */
function fmtInt(n: number): string {
    return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Status badge for reorder alerts */
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

/** Reusable section wrapper */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="mb-4 text-base font-semibold text-slate-800">{title}</h3>
            {children}
        </div>
    );
}

// ============================================
// SECTION: Summary Cards
// ============================================

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

// ============================================
// SECTION: Reorder Alerts
// ============================================

interface ReorderItem {
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

// ============================================
// SECTION: Top Consumption Chart
// ============================================

interface ConsumptionItem {
    fabricName: string;
    colourName: string;
    consumed30d: number;
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

// ============================================
// SECTION: Overview Tab
// ============================================

/** Inward modal state */
interface InwardTarget {
    id: string;
    colourName?: string;
    name: string;
    fabricName?: string;
    unit?: string;
}

function OverviewTab({
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
    const createColourTxnFn = useServerFn(createColourTransaction);
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
            colourId: string;
            qty: number;
            reason: string;
            notes?: string | null;
            costPerUnit?: number | null;
            partyId?: string | null;
        }) => createColourTxnFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setShowInward(null);
            setInwardForm({ qty: '', notes: '', costPerUnit: '', partyId: '' });
        },
        onError: (err: Error) => alert(err.message || 'Failed to create inward'),
    });

    const handleSubmitInward = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInwardMutation.mutate({
            colourId: showInward.id,
            qty: parseFloat(inwardForm.qty),
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

// ============================================
// SECTION: Transactions Tab
// ============================================

/** Transaction row from server */
interface TxnRow {
    id: string;
    fabricColourId: string;
    txnType: string;
    qty: number;
    unit: string;
    reason: string;
    costPerUnit: number | null;
    referenceId: string | null;
    notes: string | null;
    partyId: string | null;
    createdById: string;
    createdAt: Date;
    fabricColour: {
        id: string;
        colourName: string;
        colourHex: string | null;
        fabric: {
            id: string;
            name: string;
            material: { id: string; name: string } | null;
        };
    };
    party: { id: string; name: string } | null;
    createdBy: { id: string; name: string } | null;
}

/** Colour swatch + name cell renderer */
const ColourCellRenderer = React.memo(function ColourCellRenderer(
    params: ICellRendererParams<TxnRow>
) {
    const row = params.data;
    if (!row) return null;
    const hex = row.fabricColour.colourHex;
    return (
        <div className="flex items-center gap-2">
            {hex && (
                <span
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-slate-200"
                    style={{ backgroundColor: hex }}
                />
            )}
            <span>{row.fabricColour.colourName}</span>
        </div>
    );
});

/** Type badge cell renderer */
const TypeBadgeCellRenderer = React.memo(function TypeBadgeCellRenderer(
    params: ICellRendererParams<TxnRow>
) {
    const txnType = params.data?.txnType;
    if (!txnType) return null;
    const isIn = txnType === 'inward';
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                isIn ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            )}
        >
            {isIn ? 'In' : 'Out'}
        </span>
    );
});


function TransactionsTab() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    // Filter state
    const [typeFilter, setTypeFilter] = useState<'all' | 'inward' | 'outward'>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [searchText, setSearchText] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 100;

    // Record inward modal
    const [showRecordInward, setShowRecordInward] = useState(false);
    const [inwardForm, setInwardForm] = useState({
        fabricColourId: '', qty: '', unit: 'meter' as 'meter' | 'kg' | 'yard',
        reason: 'supplier_receipt', costPerUnit: '', partyId: '', notes: '',
    });

    // Confirm delete
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Server functions
    const getAllTxnsFn = useServerFn(getAllFabricColourTransactions);
    const createTxnFn = useServerFn(createFabricColourTransaction);
    const deleteTxnFn = useServerFn(deleteFabricColourTransaction);
    const getPartiesFn = useServerFn(getParties);
    const getCatalogFiltersFn = useServerFn(getCatalogFilters);

    // Build server params (only server-supported filters)
    const serverParams = useMemo(() => ({
        limit: pageSize,
        offset: page * pageSize,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
    }), [page, startDate, endDate]);

    // Fetch transactions
    const { data: txnData, isLoading } = useQuery({
        queryKey: ['materials', 'transactions', 'getAllFabricColourTransactions', serverParams],
        queryFn: () => getAllTxnsFn({ data: serverParams }),
    });

    // Fetch parties
    const { data: partiesData } = useQuery({
        queryKey: ['parties'],
        queryFn: () => getPartiesFn(),
    });
    const parties: Party[] = partiesData?.parties ?? [];

    // Fetch catalog filters for fabric colour picker
    const { data: catalogData } = useQuery({
        queryKey: ['catalogFilters'],
        queryFn: () => getCatalogFiltersFn(),
        enabled: showRecordInward,
    });
    const fabricColours = catalogData?.fabricColours ?? [];

    // Client-side filtering (type, search, supplier)
    const filteredTransactions = useMemo(() => {
        const txns = (txnData?.transactions ?? []) as TxnRow[];
        return txns.filter((txn) => {
            // Type filter
            if (typeFilter !== 'all' && txn.txnType !== typeFilter) return false;
            // Supplier filter
            if (supplierFilter && txn.partyId !== supplierFilter) return false;
            // Search text
            if (searchText) {
                const q = searchText.toLowerCase();
                const matchesColour = txn.fabricColour.colourName.toLowerCase().includes(q);
                const matchesFabric = txn.fabricColour.fabric.name.toLowerCase().includes(q);
                const matchesMaterial = txn.fabricColour.fabric.material?.name.toLowerCase().includes(q) ?? false;
                if (!matchesColour && !matchesFabric && !matchesMaterial) return false;
            }
            return true;
        });
    }, [txnData?.transactions, typeFilter, supplierFilter, searchText]);

    // Stats
    const stats = useMemo(() => {
        const txns = filteredTransactions;
        let totalInward = 0;
        let totalOutward = 0;
        const colourSet = new Set<string>();
        for (const txn of txns) {
            if (txn.txnType === 'inward') totalInward += txn.qty;
            else totalOutward += txn.qty;
            colourSet.add(txn.fabricColourId);
        }
        return {
            total: txns.length,
            totalInward,
            totalOutward,
            distinctColours: colourSet.size,
        };
    }, [filteredTransactions]);

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: (txnId: string) => deleteTxnFn({ data: { txnId } }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['materials', 'transactions'] });
            queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setDeleteConfirmId(null);
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Failed to delete';
            alert(msg);
        },
    });

    // Create mutation
    const createMutation = useMutation({
        mutationFn: (data: {
            fabricColourId: string;
            txnType: 'inward' | 'outward';
            qty: number;
            unit: 'meter' | 'kg' | 'yard';
            reason: string;
            costPerUnit?: number | null;
            partyId?: string | null;
            notes?: string | null;
        }) => createTxnFn({ data }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['allFabricColourTransactions'] });
            queryClient.invalidateQueries({ queryKey: ['materials', 'transactions'] });
            queryClient.invalidateQueries({ queryKey: ['fabricReceipts'] });
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            setShowRecordInward(false);
            setInwardForm({
                fabricColourId: '', qty: '', unit: 'meter', reason: 'supplier_receipt',
                costPerUnit: '', partyId: '', notes: '',
            });
        },
        onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Failed to create transaction';
            alert(msg);
        },
    });

    const handleSubmitInward = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!inwardForm.fabricColourId || !inwardForm.qty) return;
        createMutation.mutate({
            fabricColourId: inwardForm.fabricColourId,
            txnType: 'inward',
            qty: parseFloat(inwardForm.qty),
            unit: inwardForm.unit,
            reason: inwardForm.reason,
            ...(inwardForm.costPerUnit ? { costPerUnit: parseFloat(inwardForm.costPerUnit) } : {}),
            ...(inwardForm.partyId ? { partyId: inwardForm.partyId } : {}),
            ...(inwardForm.notes ? { notes: inwardForm.notes } : {}),
        });
    }, [inwardForm, createMutation]);

    const handleDelete = useCallback((id: string) => {
        setDeleteConfirmId(id);
    }, []);

    const confirmDelete = useCallback(() => {
        if (deleteConfirmId) {
            deleteMutation.mutate(deleteConfirmId);
        }
    }, [deleteConfirmId, deleteMutation]);

    // AG-Grid column defs
    const columnDefs = useMemo((): ColDef<TxnRow>[] => [
        {
            headerName: 'Date',
            field: 'createdAt',
            width: 140,
            valueFormatter: (params) => {
                if (!params.value) return '';
                return new Date(params.value).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                });
            },
            sortable: true,
        },
        {
            headerName: 'Material',
            width: 120,
            valueGetter: (params) => params.data?.fabricColour.fabric.material?.name ?? '--',
            sortable: true,
        },
        {
            headerName: 'Fabric',
            width: 130,
            valueGetter: (params) => params.data?.fabricColour.fabric.name ?? '--',
            sortable: true,
        },
        {
            headerName: 'Colour',
            width: 150,
            cellRenderer: ColourCellRenderer,
            valueGetter: (params) => params.data?.fabricColour.colourName ?? '',
            sortable: true,
        },
        {
            headerName: 'Type',
            width: 80,
            cellRenderer: TypeBadgeCellRenderer,
            valueGetter: (params) => params.data?.txnType ?? '',
            sortable: true,
        },
        {
            headerName: 'Qty',
            width: 100,
            valueGetter: (params) => {
                if (!params.data) return '';
                return `${fmt(params.data.qty)} ${params.data.unit}`;
            },
            sortable: true,
        },
        {
            headerName: 'Reason',
            field: 'reason',
            width: 140,
            valueFormatter: (params) => {
                if (!params.value) return '';
                return String(params.value).replace(/_/g, ' ');
            },
        },
        {
            headerName: 'Cost/Unit',
            field: 'costPerUnit',
            width: 100,
            valueFormatter: (params) => params.value != null ? `₹${fmt(params.value)}` : '--',
            sortable: true,
        },
        {
            headerName: 'Supplier',
            width: 130,
            valueGetter: (params) => params.data?.party?.name ?? '--',
            sortable: true,
        },
        {
            headerName: 'Created By',
            width: 120,
            valueGetter: (params) => params.data?.createdBy?.name ?? '--',
        },
        ...(isAdmin ? [{
            headerName: '',
            width: 50,
            cellRenderer: (params: ICellRendererParams<TxnRow>) => {
                if (!params.data) return null;
                return (
                    <button
                        type="button"
                        onClick={() => handleDelete(params.data!.id)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1"
                        title="Delete transaction"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                );
            },
            sortable: false,
            filter: false,
        } as ColDef<TxnRow>] : []),
    ], [isAdmin, handleDelete]);

    const defaultColDef = useMemo((): ColDef => ({
        resizable: true,
        suppressMovable: true,
    }), []);

    const totalPages = Math.ceil((txnData?.total ?? 0) / pageSize);

    return (
        <>
            <div className="flex flex-col gap-4 overflow-auto p-6" style={{ height: 'calc(100vh - 120px)' }}>
                {/* Header with Record Inward button */}
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-800">Fabric Colour Transactions</h2>
                    <button
                        type="button"
                        onClick={() => setShowRecordInward(true)}
                        className="btn-primary flex items-center gap-1.5 text-sm"
                    >
                        <Plus className="h-4 w-4" />
                        Record Inward
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-4 shadow-sm ring-1 ring-slate-200">
                        <div className="text-xs font-medium text-slate-500">Total Transactions</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{fmtInt(stats.total)}</div>
                    </div>
                    <div className="rounded-xl bg-green-50 p-4 shadow-sm ring-1 ring-green-100">
                        <div className="text-xs font-medium text-green-700">Total Inward</div>
                        <div className="mt-1 text-2xl font-bold text-green-900">{fmt(stats.totalInward)}</div>
                    </div>
                    <div className="rounded-xl bg-red-50 p-4 shadow-sm ring-1 ring-red-100">
                        <div className="text-xs font-medium text-red-700">Total Outward</div>
                        <div className="mt-1 text-2xl font-bold text-red-900">{fmt(stats.totalOutward)}</div>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-4 shadow-sm ring-1 ring-blue-100">
                        <div className="text-xs font-medium text-blue-700">Distinct Colours</div>
                        <div className="mt-1 text-2xl font-bold text-blue-900">{fmtInt(stats.distinctColours)}</div>
                    </div>
                </div>

                {/* Filter Bar */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
                    <select
                        className="input w-32 text-sm"
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value as 'all' | 'inward' | 'outward'); setPage(0); }}
                    >
                        <option value="all">All Types</option>
                        <option value="inward">Inward</option>
                        <option value="outward">Outward</option>
                    </select>
                    <input
                        type="date"
                        className="input w-36 text-sm"
                        value={startDate}
                        onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
                        placeholder="Start date"
                    />
                    <input
                        type="date"
                        className="input w-36 text-sm"
                        value={endDate}
                        onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
                        placeholder="End date"
                    />
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            className="input w-48 pl-8 text-sm"
                            value={searchText}
                            onChange={(e) => { setSearchText(e.target.value); setPage(0); }}
                            placeholder="Search colour/fabric..."
                        />
                    </div>
                    <select
                        className="input w-40 text-sm"
                        value={supplierFilter}
                        onChange={(e) => { setSupplierFilter(e.target.value); setPage(0); }}
                    >
                        <option value="">All Suppliers</option>
                        {parties.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    {(typeFilter !== 'all' || startDate || endDate || searchText || supplierFilter) && (
                        <button
                            type="button"
                            onClick={() => {
                                setTypeFilter('all');
                                setStartDate('');
                                setEndDate('');
                                setSearchText('');
                                setSupplierFilter('');
                                setPage(0);
                            }}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                            Clear filters
                        </button>
                    )}
                </div>

                {/* AG-Grid Table */}
                <div className="ag-theme-alpine flex-1 rounded-xl bg-white shadow-sm ring-1 ring-slate-200" style={{ minHeight: '400px' }}>
                    <AgGridReact<TxnRow>
                        rowData={filteredTransactions}
                        columnDefs={columnDefs}
                        defaultColDef={defaultColDef}
                        rowHeight={36}
                        headerHeight={38}
                        loading={isLoading}
                        overlayNoRowsTemplate="No transactions found"
                        suppressCellFocus
                        animateRows={false}
                    />
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between text-sm text-slate-600">
                        <span>
                            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, txnData?.total ?? 0)} of {fmtInt(txnData?.total ?? 0)}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={page === 0}
                                onClick={() => setPage(p => p - 1)}
                                className="rounded border px-3 py-1 text-sm disabled:opacity-40 hover:bg-slate-50"
                            >
                                Prev
                            </button>
                            <span>Page {page + 1} of {totalPages}</span>
                            <button
                                type="button"
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage(p => p + 1)}
                                className="rounded border px-3 py-1 text-sm disabled:opacity-40 hover:bg-slate-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Record Inward Modal */}
            {showRecordInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Record Inward</h2>
                            <button onClick={() => setShowRecordInward(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div>
                                <label className="label">Fabric Colour *</label>
                                <select
                                    className="input"
                                    value={inwardForm.fabricColourId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, fabricColourId: e.target.value }))}
                                    required
                                >
                                    <option value="">Select fabric colour...</option>
                                    {fabricColours.map((fc) => (
                                        <option key={fc.id} value={fc.id}>
                                            {fc.materialName} &gt; {fc.fabricName} &gt; {fc.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="label">Quantity *</label>
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
                                    <label className="label">Unit</label>
                                    <select
                                        className="input"
                                        value={inwardForm.unit}
                                        onChange={(e) => setInwardForm(f => ({ ...f, unit: e.target.value as 'meter' | 'kg' | 'yard' }))}
                                    >
                                        <option value="meter">Meter</option>
                                        <option value="kg">Kg</option>
                                        <option value="yard">Yard</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Reason</label>
                                <select
                                    className="input"
                                    value={inwardForm.reason}
                                    onChange={(e) => setInwardForm(f => ({ ...f, reason: e.target.value }))}
                                >
                                    <option value="supplier_receipt">Supplier Receipt</option>
                                    <option value="return">Return</option>
                                    <option value="transfer_in">Transfer In</option>
                                    <option value="adjustment">Adjustment</option>
                                    <option value="other">Other</option>
                                </select>
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
                                    {parties.map((p) => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
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
                                <button type="button" onClick={() => setShowRecordInward(false)} className="btn-secondary flex-1">
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>
                                    {createMutation.isPending ? 'Adding...' : 'Record Inward'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-sm">
                        <h3 className="text-lg font-semibold mb-2">Confirm Delete</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Are you sure you want to delete this transaction? This cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="btn-secondary flex-1"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmDelete}
                                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                disabled={deleteMutation.isPending}
                            >
                                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ============================================
// PLACEHOLDER TABS
// ============================================

function PlaceholderTab({ title }: { title: string }) {
    return (
        <div className="flex h-[60vh] items-center justify-center">
            <div className="text-center">
                <h3 className="text-lg font-semibold text-slate-700">{title}</h3>
                <p className="mt-2 text-sm text-slate-500">Coming soon</p>
            </div>
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function Fabrics() {
    const { analysis, health, error } = Route.useLoaderData() as FabricsLoaderData;
    const search = Route.useSearch();
    const navigate = useNavigate();

    const activeTab = search.tab;

    const setActiveTab = useCallback((tab: string) => {
        navigate({
            to: '/fabrics',
            search: { tab } as { tab: 'overview' | 'transactions' | 'reconciliation' | 'invoices' | 'trims' | 'services' },
            replace: true,
        });
    }, [navigate]);

    return (
        <div className="flex h-full flex-col">
            {/* Error Banner */}
            {error && (
                <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b bg-white px-6 pt-4">
                    <div className="flex items-center justify-between">
                        <h1 className="text-xl font-semibold text-slate-900">Fabrics</h1>
                    </div>
                    <TabsList className="mt-3 mb-0 w-auto">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="transactions">Transactions</TabsTrigger>
                        <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
                        <TabsTrigger value="invoices">Invoices</TabsTrigger>
                        <TabsTrigger value="trims">Trims</TabsTrigger>
                        <TabsTrigger value="services">Services</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-hidden">
                    <TabsContent value="overview" className="h-full m-0">
                        <OverviewTab analysis={analysis} health={health} />
                    </TabsContent>
                    <TabsContent value="transactions" className="h-full m-0">
                        <TransactionsTab />
                    </TabsContent>
                    <TabsContent value="reconciliation" className="h-full m-0">
                        <PlaceholderTab title="Reconciliation" />
                    </TabsContent>
                    <TabsContent value="invoices" className="h-full m-0">
                        <PlaceholderTab title="Invoices" />
                    </TabsContent>
                    <TabsContent value="trims" className="h-full m-0">
                        <PlaceholderTab title="Trims" />
                    </TabsContent>
                    <TabsContent value="services" className="h-full m-0">
                        <PlaceholderTab title="Services" />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
