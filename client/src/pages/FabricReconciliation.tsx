/**
 * FabricReconciliation - Physical inventory count reconciliation
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fabricsApi } from '../services/api';
import {
    ClipboardCheck, RefreshCw, AlertTriangle, CheckCircle, Search,
    Plus, History, Send, Trash2
} from 'lucide-react';

interface ReconciliationItem {
    id: string;
    fabricId: string;
    fabricName: string;
    colorName: string;
    unit: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
}

interface Reconciliation {
    id: string;
    status: string;
    createdAt: string;
    items: ReconciliationItem[];
}

const ADJUSTMENT_REASONS = {
    shortage: [
        { value: 'shrinkage', label: 'Shrinkage' },
        { value: 'wastage', label: 'Wastage' },
        { value: 'damaged', label: 'Damaged' },
        { value: 'loss', label: 'Loss/Theft' },
        { value: 'measurement_error', label: 'Measurement Error' },
    ],
    overage: [
        { value: 'found', label: 'Found/Uncounted' },
        { value: 'supplier_bonus', label: 'Supplier Bonus' },
        { value: 'measurement_error', label: 'Measurement Error' },
    ],
};

export default function FabricReconciliation() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
    const [currentRecon, setCurrentRecon] = useState<Reconciliation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [localItems, setLocalItems] = useState<ReconciliationItem[]>([]);

    // Fetch history
    const { data: history, isLoading: historyLoading } = useQuery({
        queryKey: ['reconciliationHistory'],
        queryFn: () => fabricsApi.getReconciliationHistory(20).then(r => r.data),
    });

    // Start new reconciliation
    const startMutation = useMutation({
        mutationFn: () => fabricsApi.startReconciliation(),
        onSuccess: (res) => {
            setCurrentRecon(res.data);
            setLocalItems(res.data.items);
            queryClient.invalidateQueries({ queryKey: ['reconciliationHistory'] });
        },
    });

    // Update reconciliation
    const updateMutation = useMutation({
        mutationFn: (items: ReconciliationItem[]) =>
            fabricsApi.updateReconciliation(currentRecon!.id, items.map(item => ({
                id: item.id,
                physicalQty: item.physicalQty,
                systemQty: item.systemQty,
                adjustmentReason: item.adjustmentReason || undefined,
                notes: item.notes || undefined,
            }))),
        onSuccess: (res) => {
            setCurrentRecon(res.data);
            setLocalItems(res.data.items);
        },
    });

    // Submit reconciliation
    const submitMutation = useMutation({
        mutationFn: () => fabricsApi.submitReconciliation(currentRecon!.id),
        onSuccess: () => {
            setCurrentRecon(null);
            setLocalItems([]);
            queryClient.invalidateQueries({ queryKey: ['reconciliationHistory'] });
            queryClient.invalidateQueries({ queryKey: ['fabrics'] });
        },
    });

    // Delete draft
    const deleteMutation = useMutation({
        mutationFn: () => fabricsApi.deleteReconciliation(currentRecon!.id),
        onSuccess: () => {
            setCurrentRecon(null);
            setLocalItems([]);
            queryClient.invalidateQueries({ queryKey: ['reconciliationHistory'] });
        },
    });

    // Handle physical qty change
    const handlePhysicalQtyChange = (itemId: string, value: string) => {
        const numValue = value === '' ? null : parseFloat(value);
        setLocalItems(prev =>
            prev.map(item => {
                if (item.id !== itemId) return item;
                const variance = numValue !== null ? numValue - item.systemQty : null;
                return { ...item, physicalQty: numValue, variance };
            })
        );
    };

    // Handle reason change
    const handleReasonChange = (itemId: string, value: string) => {
        setLocalItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, adjustmentReason: value || null } : item
            )
        );
    };

    // Handle notes change
    const handleNotesChange = (itemId: string, value: string) => {
        setLocalItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, notes: value || null } : item
            )
        );
    };

    // Save progress
    const handleSave = () => {
        updateMutation.mutate(localItems);
    };

    // Submit
    const handleSubmit = () => {
        if (!confirm('This will create adjustment transactions for all variances. Continue?')) return;
        // First save, then submit
        updateMutation.mutate(localItems, {
            onSuccess: () => submitMutation.mutate(),
        });
    };

    // Filter items
    const filteredItems = localItems.filter(item =>
        item.fabricName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.colorName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Stats
    const stats = {
        total: localItems.length,
        entered: localItems.filter(i => i.physicalQty !== null).length,
        variances: localItems.filter(i => i.variance !== null && i.variance !== 0).length,
        netChange: localItems.reduce((sum, i) => sum + (i.variance || 0), 0),
    };

    return (
        <div className="p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <ClipboardCheck className="text-primary-600" />
                        Fabric Reconciliation
                    </h1>
                    <p className="text-gray-500 mt-1">
                        Compare physical stock with system records and adjust variances
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                <button
                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${activeTab === 'new'
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    onClick={() => setActiveTab('new')}
                >
                    <Plus size={18} /> New Count
                </button>
                <button
                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${activeTab === 'history'
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    onClick={() => setActiveTab('history')}
                >
                    <History size={18} /> History
                </button>
            </div>

            {/* New Reconciliation Tab */}
            {activeTab === 'new' && (
                <div>
                    {!currentRecon ? (
                        <div className="card text-center py-12">
                            <ClipboardCheck size={64} className="mx-auto text-gray-300 mb-4" />
                            <h2 className="text-xl font-semibold text-gray-700 mb-2">
                                Start a New Reconciliation
                            </h2>
                            <p className="text-gray-500 mb-6">
                                This will load all active fabrics with their current system balances.
                            </p>
                            <button
                                className="btn btn-primary"
                                onClick={() => startMutation.mutate()}
                                disabled={startMutation.isPending}
                            >
                                {startMutation.isPending ? (
                                    <RefreshCw size={18} className="animate-spin mr-2" />
                                ) : (
                                    <Plus size={18} className="mr-2" />
                                )}
                                Start Reconciliation
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Stats Bar */}
                            <div className="grid grid-cols-4 gap-4 mb-4">
                                <div className="card py-3 text-center">
                                    <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                                    <p className="text-sm text-gray-500">Total Fabrics</p>
                                </div>
                                <div className="card py-3 text-center">
                                    <p className="text-2xl font-bold text-primary-600">{stats.entered}</p>
                                    <p className="text-sm text-gray-500">Counted</p>
                                </div>
                                <div className="card py-3 text-center">
                                    <p className="text-2xl font-bold text-orange-600">{stats.variances}</p>
                                    <p className="text-sm text-gray-500">Variances</p>
                                </div>
                                <div className="card py-3 text-center">
                                    <p className={`text-2xl font-bold ${stats.netChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {stats.netChange >= 0 ? '+' : ''}{stats.netChange.toFixed(2)}
                                    </p>
                                    <p className="text-sm text-gray-500">Net Change</p>
                                </div>
                            </div>

                            {/* Search & Actions */}
                            <div className="flex justify-between items-center mb-4">
                                <div className="relative">
                                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        className="input pl-10 w-64"
                                        placeholder="Search fabrics..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className="btn btn-secondary flex items-center gap-2"
                                        onClick={() => deleteMutation.mutate()}
                                        disabled={deleteMutation.isPending}
                                    >
                                        <Trash2 size={16} /> Discard
                                    </button>
                                    <button
                                        className="btn btn-secondary flex items-center gap-2"
                                        onClick={handleSave}
                                        disabled={updateMutation.isPending}
                                    >
                                        {updateMutation.isPending ? (
                                            <RefreshCw size={16} className="animate-spin" />
                                        ) : (
                                            <CheckCircle size={16} />
                                        )}
                                        Save Progress
                                    </button>
                                    <button
                                        className="btn btn-primary flex items-center gap-2"
                                        onClick={handleSubmit}
                                        disabled={submitMutation.isPending || stats.entered === 0}
                                    >
                                        {submitMutation.isPending ? (
                                            <RefreshCw size={16} className="animate-spin" />
                                        ) : (
                                            <Send size={16} />
                                        )}
                                        Submit Reconciliation
                                    </button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="card overflow-hidden">
                                <table className="w-full">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Fabric</th>
                                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-28">System Qty</th>
                                            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-32">Physical Qty</th>
                                            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-28">Variance</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-44">Reason</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredItems.map((item) => (
                                            <tr key={item.id} className={
                                                item.variance !== null && item.variance !== 0
                                                    ? item.variance > 0
                                                        ? 'bg-blue-50'
                                                        : 'bg-orange-50'
                                                    : ''
                                            }>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-gray-900">{item.fabricName}</div>
                                                    <div className="text-sm text-gray-500">{item.colorName}</div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">
                                                    {item.systemQty.toFixed(2)} {item.unit}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="input text-center w-full"
                                                        placeholder="0.00"
                                                        value={item.physicalQty ?? ''}
                                                        onChange={(e) => handlePhysicalQtyChange(item.id, e.target.value)}
                                                    />
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {item.variance !== null && (
                                                        <span className={`font-mono font-medium ${item.variance === 0
                                                            ? 'text-green-600'
                                                            : item.variance > 0
                                                                ? 'text-blue-600'
                                                                : 'text-orange-600'
                                                            }`}>
                                                            {item.variance === 0 ? (
                                                                <CheckCircle size={18} className="inline" />
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
                                                            {(item.variance < 0 ? ADJUSTMENT_REASONS.shortage : ADJUSTMENT_REASONS.overage).map(r => (
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
                </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4">Reconciliation History</h2>
                    {historyLoading ? (
                        <div className="flex justify-center py-8">
                            <RefreshCw className="animate-spin text-gray-400" />
                        </div>
                    ) : history && history.length > 0 ? (
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Status</th>
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Fabrics</th>
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Adjustments</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {history.map((r: { id: string; date: string; status: string; itemsCount: number; adjustments: number }) => (
                                    <tr key={r.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            {new Date(r.date).toLocaleDateString('en-IN', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                            })}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${r.status === 'submitted'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">{r.itemsCount}</td>
                                        <td className="px-4 py-3 text-center">
                                            {r.adjustments > 0 && (
                                                <span className="flex items-center justify-center gap-1 text-orange-600">
                                                    <AlertTriangle size={14} /> {r.adjustments}
                                                </span>
                                            )}
                                            {r.adjustments === 0 && (
                                                <span className="text-green-600">
                                                    <CheckCircle size={18} className="inline" />
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-gray-500 text-center py-8">No reconciliations yet.</p>
                    )}
                </div>
            )}
        </div>
    );
}
