/**
 * InventoryReconciliation - Physical inventory count reconciliation
 * Similar to FabricReconciliation but for SKU inventory
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import {
    ClipboardList, RefreshCw, AlertTriangle, CheckCircle, Search,
    Plus, History, Send, Trash2, Upload, Download, Eye, X
} from 'lucide-react';

interface ReconciliationItem {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
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
        { value: 'damaged', label: 'Damaged' },
        { value: 'theft', label: 'Theft/Loss' },
        { value: 'counting_error', label: 'Counting Error' },
        { value: 'expired', label: 'Expired' },
        { value: 'misplaced', label: 'Misplaced' },
    ],
    overage: [
        { value: 'found', label: 'Found/Uncounted' },
        { value: 'counting_error', label: 'Counting Error' },
        { value: 'unrecorded_production', label: 'Unrecorded Production' },
        { value: 'unrecorded_return', label: 'Unrecorded Return' },
    ],
};

export default function InventoryReconciliation() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
    const [currentRecon, setCurrentRecon] = useState<Reconciliation | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [localItems, setLocalItems] = useState<ReconciliationItem[]>([]);
    const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string; results?: any } | null>(null);
    const [viewingReconId, setViewingReconId] = useState<string | null>(null);
    const [historySearchTerm, setHistorySearchTerm] = useState('');
    const [submittingFromHistory, setSubmittingFromHistory] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch history
    const { data: history, isLoading: historyLoading } = useQuery({
        queryKey: ['inventoryReconciliationHistory'],
        queryFn: () => inventoryApi.getReconciliationHistory(50).then(r => r.data),
    });

    // Fetch details for viewing
    const { data: viewingRecon, isLoading: viewingLoading } = useQuery({
        queryKey: ['inventoryReconciliation', viewingReconId],
        queryFn: () => inventoryApi.getReconciliation(viewingReconId!).then(r => r.data),
        enabled: !!viewingReconId,
    });

    // Start new reconciliation
    const startMutation = useMutation({
        mutationFn: () => inventoryApi.startReconciliation(),
        onSuccess: (res) => {
            setCurrentRecon(res.data);
            setLocalItems(res.data.items);
            setUploadResult(null);
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
        },
    });

    // Update reconciliation
    const updateMutation = useMutation({
        mutationFn: (items: ReconciliationItem[]) =>
            inventoryApi.updateReconciliation(currentRecon!.id, items.map(item => ({
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
        mutationFn: () => inventoryApi.submitReconciliation(currentRecon!.id),
        onSuccess: (res) => {
            const adjustments = res.data.adjustmentsMade || 0;
            setCurrentRecon(null);
            setLocalItems([]);
            setUploadResult(null);
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
            queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] });
            alert(`Reconciliation submitted successfully!\n\n${adjustments} inventory adjustments created.`);
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to submit reconciliation');
        },
    });

    // Delete draft (from current working reconciliation)
    const deleteMutation = useMutation({
        mutationFn: () => inventoryApi.deleteReconciliation(currentRecon!.id),
        onSuccess: () => {
            setCurrentRecon(null);
            setLocalItems([]);
            setUploadResult(null);
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
        },
    });

    // Delete draft from history
    const deleteFromHistoryMutation = useMutation({
        mutationFn: (id: string) => inventoryApi.deleteReconciliation(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
        },
    });

    // Upload CSV
    const uploadMutation = useMutation({
        mutationFn: (file: File) => inventoryApi.uploadReconciliationCsv(currentRecon!.id, file),
        onSuccess: (res) => {
            setUploadResult({
                success: true,
                message: res.data.message,
                results: res.data.results,
            });
            // Refresh the reconciliation data
            inventoryApi.getReconciliation(currentRecon!.id).then(r => {
                setCurrentRecon(r.data);
                setLocalItems(r.data.items);
            });
        },
        onError: (err: any) => {
            setUploadResult({
                success: false,
                message: err.response?.data?.error || 'Failed to upload CSV',
            });
        },
    });

    // Handle file selection
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            uploadMutation.mutate(file);
        }
        // Reset input so same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Download CSV template (SSR-safe - DOM/URL APIs only available in browser)
    const downloadTemplate = () => {
        if (typeof window === 'undefined') return;

        const headers = 'SKU Code,Physical Qty\n';
        const sampleData = localItems.slice(0, 3).map(i => `${i.skuCode},`).join('\n');
        const csv = headers + sampleData;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inventory-count-template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    // Handle physical qty change
    const handlePhysicalQtyChange = (itemId: string, value: string) => {
        const numValue = value === '' ? null : parseInt(value, 10);
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
        item.skuCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.colorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.size.toLowerCase().includes(searchTerm.toLowerCase())
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
                        <ClipboardList className="text-primary-600" />
                        Inventory Count
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
                            <ClipboardList size={64} className="mx-auto text-gray-300 mb-4" />
                            <h2 className="text-xl font-semibold text-gray-700 mb-2">
                                Start a New Inventory Count
                            </h2>
                            <p className="text-gray-500 mb-6">
                                This will load all active SKUs with their current system balances.
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
                                    <p className="text-sm text-gray-500">Total SKUs</p>
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
                                        {stats.netChange >= 0 ? '+' : ''}{stats.netChange}
                                    </p>
                                    <p className="text-sm text-gray-500">Net Change</p>
                                </div>
                            </div>

                            {/* Upload Result Banner */}
                            {uploadResult && (
                                <div className={`mb-4 p-4 rounded-lg ${uploadResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className={`font-medium ${uploadResult.success ? 'text-green-800' : 'text-red-800'}`}>
                                                {uploadResult.message}
                                            </p>
                                            {uploadResult.results && (
                                                <div className="mt-2 text-sm text-gray-600">
                                                    <p>Matched: {uploadResult.results.matched} | Updated: {uploadResult.results.updated}</p>
                                                    {/* Show diagnostic info if parsing seems off */}
                                                    {uploadResult.results.matched < uploadResult.results.total * 0.5 && (
                                                        <>
                                                            {uploadResult.results.columns && (
                                                                <p className="text-blue-600">
                                                                    Columns found: {uploadResult.results.columns.join(', ')} (delimiter: {uploadResult.results.delimiter || 'comma'})
                                                                </p>
                                                            )}
                                                            {uploadResult.results.reconItemCount !== undefined && (
                                                                <p className="text-blue-600">
                                                                    SKUs in reconciliation: {uploadResult.results.reconItemCount}
                                                                </p>
                                                            )}
                                                        </>
                                                    )}
                                                    {(uploadResult.results.notFoundCount > 0 || uploadResult.results.notFound?.length > 0) && (
                                                        <p className="text-orange-600">
                                                            SKUs not found in system: {uploadResult.results.notFoundCount || uploadResult.results.notFound?.length}
                                                            {uploadResult.results.notFound?.length > 0 && (
                                                                <span className="text-gray-500 text-xs ml-2">
                                                                    (e.g., {uploadResult.results.notFound.slice(0, 5).join(', ')}{uploadResult.results.notFound.length > 5 ? '...' : ''})
                                                                </span>
                                                            )}
                                                        </p>
                                                    )}
                                                    {(uploadResult.results.errorsCount > 0 || uploadResult.results.errors?.length > 0) && (
                                                        <p className="text-red-600">
                                                            Errors: {uploadResult.results.errorsCount || uploadResult.results.errors?.length}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setUploadResult(null)}
                                            className="text-gray-400 hover:text-gray-600"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Search & Actions */}
                            <div className="flex justify-between items-center mb-4">
                                <div className="relative">
                                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        className="input pl-10 w-64"
                                        placeholder="Search SKU, product..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className="btn btn-secondary flex items-center gap-2"
                                        onClick={downloadTemplate}
                                        title="Download CSV template"
                                    >
                                        <Download size={16} /> Template
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".csv"
                                        className="hidden"
                                        onChange={handleFileSelect}
                                    />
                                    <button
                                        className="btn btn-secondary flex items-center gap-2"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploadMutation.isPending}
                                        title="Upload CSV with physical quantities"
                                    >
                                        {uploadMutation.isPending ? (
                                            <RefreshCw size={16} className="animate-spin" />
                                        ) : (
                                            <Upload size={16} />
                                        )}
                                        Upload CSV
                                    </button>
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
                                            <>
                                                <RefreshCw size={16} className="animate-spin" />
                                                Submitting {stats.variances} adjustments...
                                            </>
                                        ) : (
                                            <>
                                                <Send size={16} />
                                                Submit Reconciliation
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="card overflow-hidden">
                                <table className="w-full">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">SKU</th>
                                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Product</th>
                                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 w-24">System</th>
                                            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-28">Physical</th>
                                            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-24">Variance</th>
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
                                                    <span className="font-mono text-sm font-medium text-gray-900">
                                                        {item.skuCode}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="text-sm text-gray-900">{item.productName}</div>
                                                    <div className="text-xs text-gray-500">
                                                        {item.colorName} / {item.size}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">
                                                    {item.systemQty}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        className="input text-center w-full"
                                                        placeholder="0"
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
                                                                    {item.variance}
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
                                {filteredItems.length === 0 && (
                                    <div className="text-center py-8 text-gray-500">
                                        {searchTerm ? 'No SKUs match your search.' : 'No SKUs to display.'}
                                    </div>
                                )}
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
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">SKUs</th>
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Adjustments</th>
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-24">Actions</th>
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
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => setViewingReconId(r.id)}
                                                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-primary-600"
                                                    title="View details"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                                {r.status === 'draft' && (
                                                    <button
                                                        onClick={() => {
                                                            if (confirm('Delete this draft reconciliation?')) {
                                                                deleteFromHistoryMutation.mutate(r.id);
                                                            }
                                                        }}
                                                        className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"
                                                        title="Delete draft"
                                                        disabled={deleteFromHistoryMutation.isPending}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
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

            {/* View Details Modal */}
            {viewingReconId && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Reconciliation Details</h2>
                                {viewingRecon && (
                                    <p className="text-sm text-gray-500">
                                        {new Date(viewingRecon.createdAt).toLocaleDateString('en-IN', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                                            viewingRecon.status === 'submitted'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-yellow-100 text-yellow-700'
                                        }`}>
                                            {viewingRecon.status}
                                        </span>
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => setViewingReconId(null)}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-auto p-6">
                            {viewingLoading ? (
                                <div className="flex justify-center py-12">
                                    <RefreshCw className="animate-spin text-gray-400" size={32} />
                                </div>
                            ) : viewingRecon ? (
                                <>
                                    {/* Summary Stats */}
                                    <div className="grid grid-cols-4 gap-4 mb-6">
                                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                                            <p className="text-xl font-bold text-gray-900">{viewingRecon.items.length}</p>
                                            <p className="text-xs text-gray-500">Total SKUs</p>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                                            <p className="text-xl font-bold text-primary-600">
                                                {viewingRecon.items.filter((i: ReconciliationItem) => i.physicalQty !== null).length}
                                            </p>
                                            <p className="text-xs text-gray-500">Counted</p>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                                            <p className="text-xl font-bold text-orange-600">
                                                {viewingRecon.items.filter((i: ReconciliationItem) => i.variance !== null && i.variance !== 0).length}
                                            </p>
                                            <p className="text-xs text-gray-500">Variances</p>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                                            <p className={`text-xl font-bold ${
                                                viewingRecon.items.reduce((sum: number, i: ReconciliationItem) => sum + (i.variance || 0), 0) >= 0
                                                    ? 'text-green-600'
                                                    : 'text-red-600'
                                            }`}>
                                                {viewingRecon.items.reduce((sum: number, i: ReconciliationItem) => sum + (i.variance || 0), 0) >= 0 ? '+' : ''}
                                                {viewingRecon.items.reduce((sum: number, i: ReconciliationItem) => sum + (i.variance || 0), 0)}
                                            </p>
                                            <p className="text-xs text-gray-500">Net Change</p>
                                        </div>
                                    </div>

                                    {/* Search */}
                                    <div className="mb-4">
                                        <div className="relative">
                                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="text"
                                                className="input pl-10 w-64"
                                                placeholder="Search SKU, product..."
                                                value={historySearchTerm}
                                                onChange={(e) => setHistorySearchTerm(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    {/* Items Table */}
                                    <div className="border rounded-lg overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 text-left font-semibold text-gray-700">SKU</th>
                                                    <th className="px-4 py-2 text-left font-semibold text-gray-700">Product</th>
                                                    <th className="px-4 py-2 text-right font-semibold text-gray-700 w-20">System</th>
                                                    <th className="px-4 py-2 text-right font-semibold text-gray-700 w-20">Physical</th>
                                                    <th className="px-4 py-2 text-center font-semibold text-gray-700 w-20">Variance</th>
                                                    <th className="px-4 py-2 text-left font-semibold text-gray-700">Reason</th>
                                                    <th className="px-4 py-2 text-left font-semibold text-gray-700">Notes</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {viewingRecon.items
                                                    .filter((item: ReconciliationItem) =>
                                                        !historySearchTerm ||
                                                        item.skuCode.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
                                                        item.productName.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
                                                        item.colorName.toLowerCase().includes(historySearchTerm.toLowerCase())
                                                    )
                                                    .map((item: ReconciliationItem) => (
                                                        <tr key={item.id} className={
                                                            item.variance !== null && item.variance !== 0
                                                                ? item.variance > 0
                                                                    ? 'bg-blue-50'
                                                                    : 'bg-orange-50'
                                                                : ''
                                                        }>
                                                            <td className="px-4 py-2 font-mono text-xs">{item.skuCode}</td>
                                                            <td className="px-4 py-2">
                                                                <div className="text-gray-900">{item.productName}</div>
                                                                <div className="text-xs text-gray-500">{item.colorName} / {item.size}</div>
                                                            </td>
                                                            <td className="px-4 py-2 text-right font-mono">{item.systemQty}</td>
                                                            <td className="px-4 py-2 text-right font-mono">{item.physicalQty ?? '-'}</td>
                                                            <td className="px-4 py-2 text-center">
                                                                {item.variance !== null && (
                                                                    <span className={`font-mono font-medium ${
                                                                        item.variance === 0
                                                                            ? 'text-green-600'
                                                                            : item.variance > 0
                                                                                ? 'text-blue-600'
                                                                                : 'text-orange-600'
                                                                    }`}>
                                                                        {item.variance === 0 ? (
                                                                            <CheckCircle size={14} className="inline" />
                                                                        ) : (
                                                                            <>{item.variance > 0 ? '+' : ''}{item.variance}</>
                                                                        )}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-2 text-gray-600">{item.adjustmentReason || '-'}</td>
                                                            <td className="px-4 py-2 text-gray-500 text-xs">{item.notes || '-'}</td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            ) : (
                                <p className="text-center text-gray-500 py-8">Failed to load reconciliation details.</p>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setViewingReconId(null);
                                    setHistorySearchTerm('');
                                }}
                                className="btn btn-secondary"
                            >
                                Close
                            </button>
                            {viewingRecon?.status === 'draft' && (
                                <button
                                    onClick={async () => {
                                        if (!viewingReconId || submittingFromHistory) return;
                                        setSubmittingFromHistory(true);
                                        try {
                                            const result = await inventoryApi.submitReconciliation(viewingReconId);
                                            queryClient.invalidateQueries({ queryKey: ['inventoryReconciliationHistory'] });
                                            setViewingReconId(null);
                                            setHistorySearchTerm('');
                                            alert(`Reconciliation submitted successfully!\n\n${result.data.adjustmentsMade} inventory adjustments created.`);
                                        } catch (err: any) {
                                            alert(err.response?.data?.error || 'Failed to submit reconciliation');
                                        } finally {
                                            setSubmittingFromHistory(false);
                                        }
                                    }}
                                    disabled={submittingFromHistory}
                                    className="btn btn-primary flex items-center gap-2"
                                >
                                    {submittingFromHistory ? (
                                        <>
                                            <RefreshCw size={16} className="animate-spin" />
                                            Submitting...
                                        </>
                                    ) : (
                                        'Submit Reconciliation'
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
