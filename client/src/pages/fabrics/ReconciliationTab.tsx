import { useState, useMemo, useCallback } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    AlertTriangle, Trash2, Plus, Search, RefreshCw,
    CheckCircle, Send, Eye, ArrowLeft, User, TrendingUp, TrendingDown,
    History, ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    getFabricColourReconciliations,
    startFabricColourReconciliation,
    getFabricColourReconciliation,
} from '@/server/functions/fabricColours';
import {
    updateFabricColourReconciliationItems,
    submitFabricColourReconciliation,
    deleteFabricColourReconciliation,
} from '@/server/functions/fabricColourMutations';
import {
    fmtInt, ADJUSTMENT_REASONS,
    type ReconciliationItem, type Reconciliation, type ReconciliationHistoryItem,
} from './shared';

export default function ReconciliationTab() {
    const queryClient = useQueryClient();
    const [subView, setSubView] = useState<'new' | 'history'>('new');
    const [currentRecon, setCurrentRecon] = useState<Reconciliation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [localItems, setLocalItems] = useState<ReconciliationItem[]>([]);
    const [viewingReconId, setViewingReconId] = useState<string | null>(null);

    // Server Function wrappers
    const getHistoryFn = useServerFn(getFabricColourReconciliations);
    const startReconFn = useServerFn(startFabricColourReconciliation);
    const updateReconFn = useServerFn(updateFabricColourReconciliationItems);
    const submitReconFn = useServerFn(submitFabricColourReconciliation);
    const deleteReconFn = useServerFn(deleteFabricColourReconciliation);
    const getReconDetailFn = useServerFn(getFabricColourReconciliation);

    // Fetch history
    const { data: history, isLoading: historyLoading } = useQuery({
        queryKey: ['fabricColourReconciliationHistory'],
        queryFn: async () => {
            const result = await getHistoryFn({ data: { limit: 20 } });
            if (!result.success) {
                throw new Error('Failed to fetch reconciliation history');
            }
            return result.history as ReconciliationHistoryItem[];
        },
    });

    // Fetch specific reconciliation detail
    const { data: reconDetail, isLoading: reconDetailLoading } = useQuery({
        queryKey: ['fabricColourReconciliation', viewingReconId],
        queryFn: async () => {
            if (!viewingReconId) return null;
            const result = await getReconDetailFn({ data: { id: viewingReconId } });
            if (!result.success) {
                throw new Error('Failed to fetch reconciliation details');
            }
            return result.reconciliation;
        },
        enabled: !!viewingReconId,
    });

    // Start new reconciliation
    const startMutation = useMutation({
        mutationFn: async () => {
            const result = await startReconFn({ data: {} });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to start reconciliation');
            }
            return result.data;
        },
        onSuccess: (data) => {
            if (data) {
                const recon: Reconciliation = {
                    id: data.id,
                    status: data.status,
                    createdAt: data.createdAt,
                    items: data.items,
                };
                setCurrentRecon(recon);
                setLocalItems(data.items);
            }
            queryClient.invalidateQueries({ queryKey: ['fabricColourReconciliationHistory'] });
        },
        onError: (error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            alert(`Failed to start reconciliation: ${msg}`);
        },
    });

    // Update reconciliation
    const updateMutation = useMutation({
        mutationFn: async (items: ReconciliationItem[]) => {
            const result = await updateReconFn({
                data: {
                    reconciliationId: currentRecon!.id,
                    items: items.map(item => ({
                        id: item.id,
                        physicalQty: item.physicalQty,
                        systemQty: item.systemQty,
                        adjustmentReason: item.adjustmentReason || null,
                        notes: item.notes || null,
                    })),
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update reconciliation');
            }
            return result.data;
        },
        onSuccess: (data) => {
            if (data) {
                const recon: Reconciliation = {
                    id: data.id,
                    status: data.status,
                    createdAt: data.createdAt,
                    items: data.items,
                };
                setCurrentRecon(recon);
                setLocalItems(data.items);
            }
        },
        onError: (error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            alert(`Failed to save: ${msg}`);
        },
    });

    // Submit reconciliation
    const submitMutation = useMutation({
        mutationFn: async () => {
            const result = await submitReconFn({
                data: { reconciliationId: currentRecon!.id },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to submit reconciliation');
            }
            return result.data;
        },
        onSuccess: () => {
            setCurrentRecon(null);
            setLocalItems([]);
            queryClient.invalidateQueries({ queryKey: ['fabricColourReconciliationHistory'] });
            queryClient.invalidateQueries({ queryKey: ['fabricColours'] });
            queryClient.invalidateQueries({ queryKey: ['materialsTree'] });
            alert('Reconciliation submitted successfully!');
        },
        onError: (error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            alert(`Failed to submit: ${msg}`);
        },
    });

    // Delete draft
    const deleteReconMutation = useMutation({
        mutationFn: async () => {
            const result = await deleteReconFn({
                data: { reconciliationId: currentRecon!.id },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to delete reconciliation');
            }
            return result.data;
        },
        onSuccess: () => {
            setCurrentRecon(null);
            setLocalItems([]);
            queryClient.invalidateQueries({ queryKey: ['fabricColourReconciliationHistory'] });
        },
        onError: (error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            alert(`Failed to delete: ${msg}`);
        },
    });

    // Handle physical qty change
    const handlePhysicalQtyChange = useCallback((itemId: string, value: string) => {
        const numValue = value === '' ? null : parseFloat(value);
        setLocalItems(prev =>
            prev.map(item => {
                if (item.id !== itemId) return item;
                const variance = numValue !== null ? numValue - item.systemQty : null;
                return { ...item, physicalQty: numValue, variance };
            })
        );
    }, []);

    // Handle reason change
    const handleReasonChange = useCallback((itemId: string, value: string) => {
        setLocalItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, adjustmentReason: value || null } : item
            )
        );
    }, []);

    // Handle notes change
    const handleNotesChange = useCallback((itemId: string, value: string) => {
        setLocalItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, notes: value || null } : item
            )
        );
    }, []);

    // Save progress
    const handleSave = useCallback(() => {
        updateMutation.mutate(localItems);
    }, [updateMutation, localItems]);

    // Submit
    const handleSubmit = useCallback(() => {
        if (!confirm('This will create adjustment transactions for all variances. Continue?')) return;
        updateMutation.mutate(localItems, {
            onSuccess: () => submitMutation.mutate(),
        });
    }, [updateMutation, submitMutation, localItems]);

    // Filter items
    const filteredItems = useMemo(() =>
        localItems.filter(item =>
            item.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.fabricName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.colourName.toLowerCase().includes(searchTerm.toLowerCase())
        ),
        [localItems, searchTerm]
    );

    // Stats
    const stats = useMemo(() => ({
        total: localItems.length,
        entered: localItems.filter(i => i.physicalQty !== null).length,
        variances: localItems.filter(i => i.variance !== null && i.variance !== 0).length,
        netChange: localItems.reduce((sum, i) => sum + (i.variance || 0), 0),
    }), [localItems]);

    return (
        <div className="flex flex-col gap-4 overflow-auto p-6" style={{ height: 'calc(100vh - 120px)' }}>
            {/* Sub-view toggle */}
            <div className="flex gap-2">
                <button
                    type="button"
                    className={cn(
                        'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
                        subView === 'new'
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    )}
                    onClick={() => setSubView('new')}
                >
                    <Plus className="h-4 w-4" /> New Count
                </button>
                <button
                    type="button"
                    className={cn(
                        'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
                        subView === 'history'
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    )}
                    onClick={() => setSubView('history')}
                >
                    <History className="h-4 w-4" /> History
                </button>
            </div>

            {/* New Count sub-view */}
            {subView === 'new' && (
                <>
                    {!currentRecon ? (
                        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-sm ring-1 ring-slate-200">
                            <ClipboardCheck className="mb-4 h-16 w-16 text-slate-300" />
                            <h2 className="text-lg font-semibold text-slate-700">Start a New Reconciliation</h2>
                            <p className="mt-2 text-sm text-slate-500">
                                This will load all active fabric colours with their current system balances.
                            </p>
                            <button
                                type="button"
                                className="btn-primary mt-6 flex items-center gap-2"
                                onClick={() => startMutation.mutate()}
                                disabled={startMutation.isPending}
                            >
                                {startMutation.isPending ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Plus className="h-4 w-4" />
                                )}
                                Start Reconciliation
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Stats Bar */}
                            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                <div className="rounded-xl bg-slate-50 p-4 text-center shadow-sm ring-1 ring-slate-200">
                                    <p className="text-2xl font-bold text-slate-900">{fmtInt(stats.total)}</p>
                                    <p className="text-xs text-slate-500">Total Colours</p>
                                </div>
                                <div className="rounded-xl bg-blue-50 p-4 text-center shadow-sm ring-1 ring-blue-100">
                                    <p className="text-2xl font-bold text-blue-700">{fmtInt(stats.entered)}</p>
                                    <p className="text-xs text-slate-500">Counted</p>
                                </div>
                                <div className="rounded-xl bg-amber-50 p-4 text-center shadow-sm ring-1 ring-amber-100">
                                    <p className="text-2xl font-bold text-amber-700">{fmtInt(stats.variances)}</p>
                                    <p className="text-xs text-slate-500">Variances</p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-4 text-center shadow-sm ring-1 ring-slate-200">
                                    <p className={cn(
                                        'text-2xl font-bold',
                                        stats.netChange >= 0 ? 'text-green-700' : 'text-red-700'
                                    )}>
                                        {stats.netChange >= 0 ? '+' : ''}{stats.netChange.toFixed(2)}
                                    </p>
                                    <p className="text-xs text-slate-500">Net Change</p>
                                </div>
                            </div>

                            {/* Search & Actions */}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        className="input w-64 pl-8 text-sm"
                                        placeholder="Search materials, fabrics, colours..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="btn-secondary flex items-center gap-1.5 text-sm"
                                        onClick={() => deleteReconMutation.mutate()}
                                        disabled={deleteReconMutation.isPending}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" /> Discard
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-secondary flex items-center gap-1.5 text-sm"
                                        onClick={handleSave}
                                        disabled={updateMutation.isPending}
                                    >
                                        {updateMutation.isPending ? (
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <CheckCircle className="h-3.5 w-3.5" />
                                        )}
                                        Save Progress
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-primary flex items-center gap-1.5 text-sm"
                                        onClick={handleSubmit}
                                        disabled={submitMutation.isPending || stats.entered === 0}
                                    >
                                        {submitMutation.isPending ? (
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Send className="h-3.5 w-3.5" />
                                        )}
                                        Submit Reconciliation
                                    </button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50">
                                        <tr className="text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                                            <th className="px-4 py-3">Material / Fabric / Colour</th>
                                            <th className="px-4 py-3 text-right w-28">System Qty</th>
                                            <th className="px-4 py-3 text-center w-32">Physical Qty</th>
                                            <th className="px-4 py-3 text-center w-28">Variance</th>
                                            <th className="px-4 py-3 text-left w-44">Reason</th>
                                            <th className="px-4 py-3 text-left">Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredItems.map((item) => (
                                            <tr
                                                key={item.id}
                                                className={cn(
                                                    item.variance !== null && item.variance !== 0
                                                        ? item.variance > 0 ? 'bg-blue-50' : 'bg-orange-50'
                                                        : ''
                                                )}
                                            >
                                                <td className="px-4 py-3">
                                                    <div className="text-xs text-slate-400">
                                                        {item.materialName} &gt; {item.fabricName}
                                                    </div>
                                                    <div className="font-medium text-slate-800">{item.colourName}</div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono tabular-nums">
                                                    {item.systemQty.toFixed(2)} {item.unit}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="input w-full text-center"
                                                        placeholder="0.00"
                                                        value={item.physicalQty ?? ''}
                                                        onChange={(e) => handlePhysicalQtyChange(item.id, e.target.value)}
                                                    />
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {item.variance !== null && (
                                                        <span className={cn(
                                                            'font-mono font-medium',
                                                            item.variance === 0
                                                                ? 'text-green-600'
                                                                : item.variance > 0 ? 'text-blue-600' : 'text-orange-600'
                                                        )}>
                                                            {item.variance === 0 ? (
                                                                <CheckCircle className="inline h-4 w-4" />
                                                            ) : (
                                                                <>
                                                                    {item.variance > 0 ? '+' : ''}
                                                                    {item.variance.toFixed(2)}
                                                                </>
                                                            )}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {item.variance !== null && item.variance !== 0 && (
                                                        <select
                                                            className="input w-full text-sm"
                                                            value={item.adjustmentReason || ''}
                                                            onChange={(e) => handleReasonChange(item.id, e.target.value)}
                                                        >
                                                            <option value="">Select reason...</option>
                                                            {(item.variance < 0
                                                                ? ADJUSTMENT_REASONS.shortage
                                                                : ADJUSTMENT_REASONS.overage
                                                            ).map(r => (
                                                                <option key={r.value} value={r.value}>{r.label}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {item.variance !== null && item.variance !== 0 && (
                                                        <input
                                                            type="text"
                                                            className="input w-full text-sm"
                                                            placeholder="Optional notes..."
                                                            value={item.notes || ''}
                                                            onChange={(e) => handleNotesChange(item.id, e.target.value)}
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            )}

            {/* History sub-view */}
            {subView === 'history' && (
                <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                    {/* Detail View */}
                    {viewingReconId ? (
                        <div className="p-6">
                            <button
                                type="button"
                                className="mb-4 flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
                                onClick={() => setViewingReconId(null)}
                            >
                                <ArrowLeft className="h-4 w-4" /> Back to History
                            </button>

                            {reconDetailLoading ? (
                                <div className="flex justify-center py-8">
                                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                                </div>
                            ) : reconDetail ? (
                                <div>
                                    <div className="mb-4 flex items-center justify-between">
                                        <h2 className="text-base font-semibold text-slate-800">
                                            Reconciliation Details
                                        </h2>
                                        <span className={cn(
                                            'rounded-full px-3 py-1 text-xs font-medium',
                                            reconDetail.status === 'submitted'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-amber-100 text-amber-700'
                                        )}>
                                            {reconDetail.status}
                                        </span>
                                    </div>

                                    <div className="mb-4 text-sm text-slate-500">
                                        Created: {new Date(reconDetail.createdAt).toLocaleDateString('en-IN', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                        {reconDetail.notes && (
                                            <span className="ml-4">Notes: {reconDetail.notes}</span>
                                        )}
                                    </div>

                                    {/* Summary Stats */}
                                    <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                                        <div className="rounded-lg bg-slate-50 py-3 text-center">
                                            <p className="text-xl font-bold text-slate-900">{reconDetail.items.length}</p>
                                            <p className="text-xs text-slate-500">Total Items</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 py-3 text-center">
                                            <p className="text-xl font-bold text-blue-700">
                                                {reconDetail.items.filter((i: ReconciliationItem) => i.physicalQty !== null).length}
                                            </p>
                                            <p className="text-xs text-slate-500">Counted</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 py-3 text-center">
                                            <p className="text-xl font-bold text-amber-700">
                                                {reconDetail.items.filter((i: ReconciliationItem) => i.variance !== null && i.variance !== 0).length}
                                            </p>
                                            <p className="text-xs text-slate-500">With Variance</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 py-3 text-center">
                                            <p className={cn(
                                                'text-xl font-bold',
                                                reconDetail.items.reduce((sum: number, i: ReconciliationItem) => sum + (i.variance || 0), 0) >= 0
                                                    ? 'text-green-700'
                                                    : 'text-red-700'
                                            )}>
                                                {reconDetail.items.reduce((sum: number, i: ReconciliationItem) => sum + (i.variance || 0), 0) >= 0 ? '+' : ''}
                                                {reconDetail.items.reduce((sum: number, i: ReconciliationItem) => sum + (i.variance || 0), 0).toFixed(2)}
                                            </p>
                                            <p className="text-xs text-slate-500">Net Change</p>
                                        </div>
                                    </div>

                                    {/* Items with Variance Only */}
                                    <h3 className="mb-2 text-sm font-semibold text-slate-700">Adjustments Made</h3>
                                    {reconDetail.items.filter((i: ReconciliationItem) => i.variance !== null && i.variance !== 0).length === 0 ? (
                                        <p className="rounded-lg bg-slate-50 py-4 text-center text-sm text-slate-500">
                                            No adjustments were made in this reconciliation.
                                        </p>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-slate-50">
                                                    <tr className="text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                                                        <th className="px-4 py-2">Material / Fabric / Colour</th>
                                                        <th className="px-4 py-2 text-right">System</th>
                                                        <th className="px-4 py-2 text-right">Physical</th>
                                                        <th className="px-4 py-2 text-center">Variance</th>
                                                        <th className="px-4 py-2 text-left">Reason</th>
                                                        <th className="px-4 py-2 text-left">Notes</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {reconDetail.items
                                                        .filter((i: ReconciliationItem) => i.variance !== null && i.variance !== 0)
                                                        .sort((a: ReconciliationItem, b: ReconciliationItem) =>
                                                            Math.abs(b.variance || 0) - Math.abs(a.variance || 0)
                                                        )
                                                        .map((item: ReconciliationItem) => (
                                                            <tr
                                                                key={item.id}
                                                                className={cn(
                                                                    item.variance && item.variance > 0
                                                                        ? 'bg-blue-50'
                                                                        : 'bg-orange-50'
                                                                )}
                                                            >
                                                                <td className="px-4 py-2">
                                                                    <div className="text-xs text-slate-400">
                                                                        {item.materialName} &gt; {item.fabricName}
                                                                    </div>
                                                                    <div className="font-medium text-slate-800">
                                                                        {item.colourName}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-2 text-right font-mono tabular-nums">
                                                                    {item.systemQty.toFixed(2)} {item.unit}
                                                                </td>
                                                                <td className="px-4 py-2 text-right font-mono tabular-nums">
                                                                    {item.physicalQty?.toFixed(2)} {item.unit}
                                                                </td>
                                                                <td className="px-4 py-2 text-center">
                                                                    <span className={cn(
                                                                        'inline-flex items-center gap-1 font-mono font-medium',
                                                                        item.variance && item.variance > 0
                                                                            ? 'text-blue-600'
                                                                            : 'text-orange-600'
                                                                    )}>
                                                                        {item.variance && item.variance > 0 ? (
                                                                            <TrendingUp className="h-3.5 w-3.5" />
                                                                        ) : (
                                                                            <TrendingDown className="h-3.5 w-3.5" />
                                                                        )}
                                                                        {item.variance && item.variance > 0 ? '+' : ''}
                                                                        {item.variance?.toFixed(2)}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2 capitalize">
                                                                    {item.adjustmentReason?.replace(/_/g, ' ') || '-'}
                                                                </td>
                                                                <td className="px-4 py-2 text-slate-600">
                                                                    {item.notes || '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="py-8 text-center text-sm text-slate-500">
                                    Failed to load details.
                                </p>
                            )}
                        </div>
                    ) : (
                        /* History List */
                        <div className="p-6">
                            <h2 className="mb-4 text-base font-semibold text-slate-800">
                                Reconciliation History
                            </h2>
                            {historyLoading ? (
                                <div className="flex justify-center py-8">
                                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                                </div>
                            ) : history && history.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50">
                                            <tr className="text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                                                <th className="px-4 py-3">Date</th>
                                                <th className="px-4 py-3">By</th>
                                                <th className="px-4 py-3 text-center">Status</th>
                                                <th className="px-4 py-3 text-center">Colours</th>
                                                <th className="px-4 py-3 text-center">Adjustments</th>
                                                <th className="px-4 py-3 text-right">Net Change</th>
                                                <th className="px-4 py-3 text-center">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {history.map((r) => (
                                                <tr key={r.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 text-slate-700">
                                                        {r.date
                                                            ? new Date(r.date).toLocaleDateString('en-IN', {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                year: 'numeric',
                                                            })
                                                            : 'No date'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {r.createdByName ? (
                                                            <span className="flex items-center gap-1 text-slate-600">
                                                                <User className="h-3.5 w-3.5" /> {r.createdByName}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">Unknown</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={cn(
                                                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                                            r.status === 'submitted'
                                                                ? 'bg-green-100 text-green-700'
                                                                : 'bg-amber-100 text-amber-700'
                                                        )}>
                                                            {r.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center tabular-nums">{r.itemsCount}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        {r.adjustments > 0 ? (
                                                            <span className="flex items-center justify-center gap-1 text-amber-600">
                                                                <AlertTriangle className="h-3.5 w-3.5" /> {r.adjustments}
                                                            </span>
                                                        ) : (
                                                            <span className="text-green-600">
                                                                <CheckCircle className="inline h-4 w-4" />
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {r.netChange !== 0 ? (
                                                            <span className={cn(
                                                                'font-mono font-medium',
                                                                r.netChange > 0 ? 'text-blue-600' : 'text-orange-600'
                                                            )}>
                                                                {r.netChange > 0 ? '+' : ''}{r.netChange.toFixed(2)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            type="button"
                                                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                                            onClick={() => setViewingReconId(r.id)}
                                                            title="View details"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="py-8 text-center text-sm text-slate-500">
                                    No reconciliations yet.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
