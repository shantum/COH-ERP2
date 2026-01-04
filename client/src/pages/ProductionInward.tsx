/**
 * Unified Inward Page
 * Handles both Production Queue and Repacking Queue inward flows
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productionApi, productsApi, repackingApi } from '../services/api';
import { Package, Search, Plus, Trash2, Edit2, X, Check, RefreshCw, AlertTriangle } from 'lucide-react';

type InwardSource = 'production' | 'repacking';
type ProcessAction = 'ready' | 'write_off';

interface SkuInfo {
    id: string;
    skuCode: string;
    barcode: string | null;
    size: string;
    mrp: number;
    variation: {
        id: string;
        colorName: string;
        imageUrl: string | null;
        product: {
            id: string;
            name: string;
            imageUrl: string | null;
        };
    };
}

interface InwardTransaction {
    id: string;
    skuId: string;
    qty: number;
    reason: string;
    notes: string | null;
    createdAt: string;
    sku: {
        skuCode: string;
        size: string;
        variation: {
            colorName: string;
            product: { name: string };
        };
    };
    productName: string;
    colorName: string;
    size: string;
    imageUrl: string | null;
    batchCode: string | null;
    createdBy: { name: string };
}

interface PendingBatch {
    id: string;
    batchCode: string;
    batchDate: string;
    qtyPlanned: number;
    qtyCompleted: number;
    qtyPending: number;
    status: string;
}

interface RepackingQueueItem {
    id: string;
    skuId: string;
    qty: number;
    status: string;
    condition: string;
    inspectionNotes: string | null;
    writeOffReason: string | null;
    createdAt: string;
    processedAt: string | null;
    productName: string;
    colorName: string;
    size: string;
    skuCode: string;
    imageUrl: string | null;
    returnRequest?: {
        requestNumber: string;
        requestType: string;
        reasonCategory: string;
    };
    processedBy?: { id: string; name: string };
}

interface QueueStats {
    pending: { count: number; qty: number };
    inspecting: { count: number; qty: number };
    repacking: { count: number; qty: number };
    ready: { count: number; qty: number };
    write_off: { count: number; qty: number };
}

const WRITE_OFF_REASONS = [
    { value: 'defective', label: 'Defective (Manufacturing/Quality defect)' },
    { value: 'destroyed', label: 'Destroyed (Damaged beyond repair)' },
    { value: 'wrong_product', label: 'Wrong Product (Customer returned wrong item)' },
    { value: 'expired', label: 'Expired (Past usability)' },
    { value: 'other', label: 'Other' },
];

export default function ProductionInward() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // Source toggle
    const [source, setSource] = useState<InwardSource>('production');

    // Shared state
    const [searchInput, setSearchInput] = useState('');
    const [selectedSku, setSelectedSku] = useState<SkuInfo | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [currentStock, setCurrentStock] = useState<number | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Production-specific state
    const [pendingBatches, setPendingBatches] = useState<PendingBatch[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editQty, setEditQty] = useState(1);

    // Repacking-specific state
    const [selectedQueueItem, setSelectedQueueItem] = useState<RepackingQueueItem | null>(null);
    const [processAction, setProcessAction] = useState<ProcessAction>('ready');
    const [writeOffReason, setWriteOffReason] = useState('defective');
    const [processNotes, setProcessNotes] = useState('');

    // Focus input on mount and source change
    useEffect(() => {
        inputRef.current?.focus();
    }, [source]);

    // Auto-clear messages
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    useEffect(() => {
        if (errorMessage) {
            const timer = setTimeout(() => setErrorMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [errorMessage]);

    // Fetch today's inward history (production)
    const { data: inwardHistory = [], isLoading: historyLoading } = useQuery({
        queryKey: ['inward-history'],
        queryFn: async () => {
            const res = await inventoryApi.getInwardHistory('today');
            return res.data as InwardTransaction[];
        },
        refetchInterval: 30000,
        enabled: source === 'production',
    });

    // Fetch repacking queue
    const { data: repackingQueue = [], isLoading: queueLoading, refetch: refetchQueue } = useQuery({
        queryKey: ['repacking-queue'],
        queryFn: async () => {
            const res = await repackingApi.getQueue({ limit: 100 });
            return res.data as RepackingQueueItem[];
        },
        refetchInterval: 30000,
        enabled: source === 'repacking',
    });

    // Fetch repacking queue stats
    const { data: queueStats } = useQuery({
        queryKey: ['repacking-queue-stats'],
        queryFn: async () => {
            const res = await repackingApi.getQueueStats();
            return res.data as QueueStats;
        },
        enabled: source === 'repacking',
    });

    // Search for SKU (Production mode)
    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        try {
            const res = await productsApi.getAllSkus();
            const skus = res.data as SkuInfo[];

            const found = skus.find(
                (s) =>
                    s.barcode === searchInput.trim() ||
                    s.skuCode.toLowerCase() === searchInput.trim().toLowerCase()
            );

            if (found) {
                setSelectedSku(found);
                setQuantity(1);

                // Fetch pending batches
                const pendingRes = await productionApi.getPendingBySku(found.id);
                setPendingBatches(pendingRes.data.batches || []);

                // Fetch current stock
                const balanceRes = await inventoryApi.getSkuBalance(found.id);
                setCurrentStock(balanceRes.data.currentBalance || 0);
            } else {
                setErrorMessage('SKU not found');
                setSelectedSku(null);
                setPendingBatches([]);
                setCurrentStock(null);
            }
        } catch (error) {
            console.error('Search error:', error);
            setErrorMessage('Failed to search SKU');
        }

        setSearchInput('');
        inputRef.current?.focus();
    };

    // Search in repacking queue by barcode/SKU
    const handleRepackingSearch = async () => {
        if (!searchInput.trim()) return;

        const found = repackingQueue.find(
            (item) =>
                item.skuCode === searchInput.trim() ||
                item.skuCode.toLowerCase() === searchInput.trim().toLowerCase()
        );

        if (found) {
            setSelectedQueueItem(found);
            setProcessAction('ready');
            setWriteOffReason('defective');
            setProcessNotes('');

            // Fetch current stock
            const balanceRes = await inventoryApi.getSkuBalance(found.skuId);
            setCurrentStock(balanceRes.data.currentBalance || 0);
        } else {
            setErrorMessage('Item not found in repacking queue');
            setSelectedQueueItem(null);
        }

        setSearchInput('');
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (source === 'production') {
                handleSearch();
            } else {
                handleRepackingSearch();
            }
        }
    };

    // Production inward mutation
    const inwardMutation = useMutation({
        mutationFn: async () => {
            if (!selectedSku) throw new Error('No SKU selected');
            return inventoryApi.quickInward({
                skuCode: selectedSku.skuCode,
                qty: quantity,
                reason: 'production',
            });
        },
        onSuccess: (res) => {
            const data = res.data;
            queryClient.invalidateQueries({ queryKey: ['inward-history'] });

            let msg = `+${quantity} ${selectedSku?.skuCode} inwarded`;
            if (data.matchedBatch) {
                msg += ` → Matched to ${data.matchedBatch.batchCode} (${data.matchedBatch.qtyCompleted}/${data.matchedBatch.qtyPlanned})`;
            }
            setSuccessMessage(msg);
            setCurrentStock(data.newBalance);

            if (selectedSku) {
                productionApi.getPendingBySku(selectedSku.id).then((r) => {
                    setPendingBatches(r.data.batches || []);
                });
            }

            setQuantity(1);
            inputRef.current?.focus();
        },
        onError: (error: any) => {
            setErrorMessage(error.response?.data?.error || 'Failed to inward');
        },
    });

    // Repacking process mutation
    const processMutation = useMutation({
        mutationFn: async () => {
            if (!selectedQueueItem) throw new Error('No item selected');
            return repackingApi.process({
                itemId: selectedQueueItem.id,
                action: processAction,
                writeOffReason: processAction === 'write_off' ? writeOffReason : undefined,
                notes: processNotes || undefined,
            });
        },
        onSuccess: (res) => {
            const data = res.data;
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue-stats'] });
            setSuccessMessage(data.message);
            setSelectedQueueItem(null);
            setProcessNotes('');
            inputRef.current?.focus();
        },
        onError: (error: any) => {
            setErrorMessage(error.response?.data?.error || 'Failed to process item');
        },
    });

    // Edit mutation (Production)
    const editMutation = useMutation({
        mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
            return inventoryApi.editInward(id, { qty });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inward-history'] });
            setEditingId(null);
        },
        onError: (error: any) => {
            setErrorMessage(error.response?.data?.error || 'Failed to edit');
        },
    });

    // Delete mutation (Production)
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            return inventoryApi.deleteInward(id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inward-history'] });
        },
        onError: (error: any) => {
            setErrorMessage(error.response?.data?.error || 'Failed to delete');
        },
    });

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this inward entry?')) {
            deleteMutation.mutate(id);
        }
    };

    const clearSelection = () => {
        setSelectedSku(null);
        setSelectedQueueItem(null);
        setPendingBatches([]);
        setCurrentStock(null);
        inputRef.current?.focus();
    };

    const totalPending = pendingBatches.reduce((sum, b) => sum + b.qtyPending, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Package className="text-blue-600" size={28} />
                    <h1 className="text-2xl font-bold">Inward</h1>
                </div>

                {/* Source Toggle */}
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                    <button
                        onClick={() => { setSource('production'); clearSelection(); }}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            source === 'production'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        Production Queue
                    </button>
                    <button
                        onClick={() => { setSource('repacking'); clearSelection(); }}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            source === 'repacking'
                                ? 'bg-white text-orange-600 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                        }`}
                    >
                        Repacking Queue
                        {queueStats && queueStats.pending.count > 0 && (
                            <span className="ml-2 bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-xs">
                                {queueStats.pending.count}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Messages */}
            {successMessage && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <Check size={20} />
                    <span>{successMessage}</span>
                </div>
            )}

            {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertTriangle size={20} />
                    <span>{errorMessage}</span>
                </div>
            )}

            {/* Search Input */}
            <div className="card">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={source === 'production'
                                ? "Scan barcode or enter SKU code..."
                                : "Scan barcode to find in repacking queue..."}
                            className="input pl-10 w-full text-lg"
                            autoFocus
                        />
                    </div>
                    <button
                        onClick={source === 'production' ? handleSearch : handleRepackingSearch}
                        className="btn btn-primary"
                    >
                        Search
                    </button>
                </div>
            </div>

            {/* Production Mode: SKU Preview Card */}
            {source === 'production' && selectedSku && (
                <div className="card border-2 border-blue-200 bg-blue-50/30">
                    <div className="flex gap-6">
                        {/* Image */}
                        <div className="w-32 h-32 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                            {(selectedSku.variation.imageUrl || selectedSku.variation.product.imageUrl) ? (
                                <img
                                    src={selectedSku.variation.imageUrl || selectedSku.variation.product.imageUrl || ''}
                                    alt={selectedSku.skuCode}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <Package size={40} />
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 space-y-2">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold">{selectedSku.variation.product.name}</h2>
                                    <p className="text-gray-600">
                                        {selectedSku.variation.colorName} / {selectedSku.size}
                                    </p>
                                </div>
                                <button onClick={clearSelection} className="text-gray-400 hover:text-gray-600">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex gap-6 text-sm">
                                <div>
                                    <span className="text-gray-500">SKU:</span>{' '}
                                    <span className="font-mono font-medium">{selectedSku.skuCode}</span>
                                </div>
                                {selectedSku.barcode && (
                                    <div>
                                        <span className="text-gray-500">Barcode:</span>{' '}
                                        <span className="font-mono">{selectedSku.barcode}</span>
                                    </div>
                                )}
                                <div>
                                    <span className="text-gray-500">MRP:</span>{' '}
                                    <span className="font-medium">₹{selectedSku.mrp}</span>
                                </div>
                            </div>

                            <div className="flex gap-6 text-sm pt-2">
                                <div className="bg-white px-3 py-1 rounded border">
                                    <span className="text-gray-500">Current Stock:</span>{' '}
                                    <span className="font-semibold text-blue-600">{currentStock ?? '...'} pcs</span>
                                </div>
                                <div className="bg-white px-3 py-1 rounded border">
                                    <span className="text-gray-500">Pending in Production:</span>{' '}
                                    <span className="font-semibold text-orange-600">{totalPending} pcs</span>
                                </div>
                            </div>

                            {pendingBatches.length > 0 && (
                                <div className="text-xs text-gray-500 pt-1">
                                    Batches: {pendingBatches.map((b) => `${b.batchCode} (${b.qtyPending} pending)`).join(', ')}
                                </div>
                            )}
                        </div>

                        {/* Inward Form */}
                        <div className="flex-shrink-0 flex items-center gap-3 border-l pl-6">
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">Quantity</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={quantity}
                                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="input w-20 text-center text-lg"
                                />
                            </div>
                            <button
                                onClick={() => inwardMutation.mutate()}
                                disabled={inwardMutation.isPending}
                                className="btn btn-primary flex items-center gap-2 h-12"
                            >
                                <Plus size={18} />
                                {inwardMutation.isPending ? 'Adding...' : 'Inward to Stock'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Repacking Mode: Queue Item Card */}
            {source === 'repacking' && selectedQueueItem && (
                <div className="card border-2 border-orange-200 bg-orange-50/30">
                    <div className="flex gap-6">
                        {/* Image */}
                        <div className="w-32 h-32 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                            {selectedQueueItem.imageUrl ? (
                                <img
                                    src={selectedQueueItem.imageUrl}
                                    alt={selectedQueueItem.skuCode}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <RefreshCw size={40} />
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 space-y-2">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold">{selectedQueueItem.productName}</h2>
                                    <p className="text-gray-600">
                                        {selectedQueueItem.colorName} / {selectedQueueItem.size}
                                    </p>
                                </div>
                                <button onClick={clearSelection} className="text-gray-400 hover:text-gray-600">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex gap-6 text-sm">
                                <div>
                                    <span className="text-gray-500">SKU:</span>{' '}
                                    <span className="font-mono font-medium">{selectedQueueItem.skuCode}</span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Qty:</span>{' '}
                                    <span className="font-medium">{selectedQueueItem.qty}</span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Condition:</span>{' '}
                                    <span className={`font-medium ${
                                        selectedQueueItem.condition === 'unused' ? 'text-green-600' :
                                        selectedQueueItem.condition === 'used' ? 'text-blue-600' :
                                        'text-red-600'
                                    }`}>
                                        {selectedQueueItem.condition}
                                    </span>
                                </div>
                            </div>

                            {selectedQueueItem.returnRequest && (
                                <div className="text-sm text-gray-600">
                                    Return: {selectedQueueItem.returnRequest.requestNumber} ({selectedQueueItem.returnRequest.requestType})
                                    {selectedQueueItem.returnRequest.reasonCategory && ` - ${selectedQueueItem.returnRequest.reasonCategory}`}
                                </div>
                            )}

                            {selectedQueueItem.inspectionNotes && (
                                <div className="text-sm text-gray-500 italic">
                                    Notes: {selectedQueueItem.inspectionNotes}
                                </div>
                            )}

                            <div className="flex gap-6 text-sm pt-2">
                                <div className="bg-white px-3 py-1 rounded border">
                                    <span className="text-gray-500">Current Stock:</span>{' '}
                                    <span className="font-semibold text-blue-600">{currentStock ?? '...'} pcs</span>
                                </div>
                            </div>
                        </div>

                        {/* Process Form */}
                        <div className="flex-shrink-0 border-l pl-6 space-y-4 min-w-[280px]">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Action</label>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="action"
                                            checked={processAction === 'ready'}
                                            onChange={() => setProcessAction('ready')}
                                            className="text-green-600"
                                        />
                                        <span className="text-green-700">Ready for Stock (repacked, QC passed)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="action"
                                            checked={processAction === 'write_off'}
                                            onChange={() => setProcessAction('write_off')}
                                            className="text-red-600"
                                        />
                                        <span className="text-red-700">Write Off (defective/destroyed)</span>
                                    </label>
                                </div>
                            </div>

                            {processAction === 'write_off' && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700">Reason</label>
                                    <select
                                        value={writeOffReason}
                                        onChange={(e) => setWriteOffReason(e.target.value)}
                                        className="input w-full"
                                    >
                                        {WRITE_OFF_REASONS.map((r) => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
                                <input
                                    type="text"
                                    value={processNotes}
                                    onChange={(e) => setProcessNotes(e.target.value)}
                                    placeholder="Additional notes..."
                                    className="input w-full"
                                />
                            </div>

                            <button
                                onClick={() => processMutation.mutate()}
                                disabled={processMutation.isPending}
                                className={`btn w-full flex items-center justify-center gap-2 ${
                                    processAction === 'ready'
                                        ? 'bg-green-600 hover:bg-green-700 text-white'
                                        : 'bg-red-600 hover:bg-red-700 text-white'
                                }`}
                            >
                                {processMutation.isPending ? 'Processing...' : 'Process'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Production Mode: Inward History */}
            {source === 'production' && (
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Today's Inwards</h3>

                    {historyLoading ? (
                        <p className="text-gray-500">Loading...</p>
                    ) : inwardHistory.length === 0 ? (
                        <p className="text-gray-500">No inwards recorded today</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">Time</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">SKU</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600">Qty</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">Batch</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">By</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {inwardHistory.map((txn) => (
                                        <tr key={txn.id} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 text-gray-600">
                                                {new Date(txn.createdAt).toLocaleTimeString('en-IN', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">{txn.sku?.skuCode}</td>
                                            <td className="px-3 py-2">
                                                {txn.productName} - {txn.colorName} / {txn.size}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {editingId === txn.id ? (
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={editQty}
                                                        onChange={(e) => setEditQty(parseInt(e.target.value) || 1)}
                                                        className="input w-16 text-center text-sm py-1"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className="text-green-600 font-medium">+{txn.qty}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-gray-500 text-xs">
                                                {txn.batchCode || '-'}
                                            </td>
                                            <td className="px-3 py-2 text-gray-500 text-xs">
                                                {txn.createdBy?.name || '-'}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {editingId === txn.id ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => editMutation.mutate({ id: txn.id, qty: editQty })}
                                                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                                                            title="Save"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingId(null)}
                                                            className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                                            title="Cancel"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => {
                                                                setEditingId(txn.id);
                                                                setEditQty(txn.qty);
                                                            }}
                                                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                                            title="Edit"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(txn.id)}
                                                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {inwardHistory.length > 0 && (
                        <div className="mt-4 pt-4 border-t flex justify-between text-sm">
                            <span className="text-gray-500">
                                {inwardHistory.length} inward{inwardHistory.length !== 1 ? 's' : ''} today
                            </span>
                            <span className="font-medium text-green-600">
                                Total: +{inwardHistory.reduce((sum, t) => sum + t.qty, 0)} pcs
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Repacking Mode: Queue List */}
            {source === 'repacking' && (
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Repacking Queue</h3>
                        <button
                            onClick={() => refetchQueue()}
                            className="btn btn-secondary flex items-center gap-2"
                        >
                            <RefreshCw size={16} />
                            Refresh
                        </button>
                    </div>

                    {/* Stats */}
                    {queueStats && (
                        <div className="flex gap-4 mb-4">
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
                                <span className="text-yellow-700 font-medium">{queueStats.pending.count}</span>
                                <span className="text-yellow-600 text-sm ml-1">Pending</span>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
                                <span className="text-blue-700 font-medium">{queueStats.inspecting.count}</span>
                                <span className="text-blue-600 text-sm ml-1">Inspecting</span>
                            </div>
                            <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2">
                                <span className="text-purple-700 font-medium">{queueStats.repacking.count}</span>
                                <span className="text-purple-600 text-sm ml-1">Repacking</span>
                            </div>
                            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
                                <span className="text-green-700 font-medium">{queueStats.ready.count}</span>
                                <span className="text-green-600 text-sm ml-1">Ready</span>
                            </div>
                            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                                <span className="text-red-700 font-medium">{queueStats.write_off.count}</span>
                                <span className="text-red-600 text-sm ml-1">Written Off</span>
                            </div>
                        </div>
                    )}

                    {queueLoading ? (
                        <p className="text-gray-500">Loading...</p>
                    ) : repackingQueue.length === 0 ? (
                        <p className="text-gray-500">No items in repacking queue</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">Added</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">SKU</th>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600">Qty</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600">Condition</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600">Status</th>
                                        <th className="px-3 py-2 text-center font-medium text-gray-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {repackingQueue.map((item) => (
                                        <tr
                                            key={item.id}
                                            className={`hover:bg-gray-50 ${
                                                item.status === 'ready' ? 'bg-green-50/50' :
                                                item.status === 'write_off' ? 'bg-red-50/50' : ''
                                            }`}
                                        >
                                            <td className="px-3 py-2 text-gray-600">
                                                {new Date(item.createdAt).toLocaleDateString('en-IN', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                })}
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">{item.skuCode}</td>
                                            <td className="px-3 py-2">
                                                {item.productName} - {item.colorName} / {item.size}
                                            </td>
                                            <td className="px-3 py-2 text-center font-medium">{item.qty}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`text-xs px-2 py-1 rounded ${
                                                    item.condition === 'unused' ? 'bg-green-100 text-green-700' :
                                                    item.condition === 'used' ? 'bg-blue-100 text-blue-700' :
                                                    item.condition === 'damaged' ? 'bg-orange-100 text-orange-700' :
                                                    'bg-red-100 text-red-700'
                                                }`}>
                                                    {item.condition}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`text-xs px-2 py-1 rounded ${
                                                    item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                                    item.status === 'inspecting' ? 'bg-blue-100 text-blue-700' :
                                                    item.status === 'repacking' ? 'bg-purple-100 text-purple-700' :
                                                    item.status === 'ready' ? 'bg-green-100 text-green-700' :
                                                    'bg-red-100 text-red-700'
                                                }`}>
                                                    {item.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {item.status !== 'ready' && item.status !== 'write_off' && (
                                                    <button
                                                        onClick={() => {
                                                            setSelectedQueueItem(item);
                                                            setProcessAction('ready');
                                                            setWriteOffReason('defective');
                                                            setProcessNotes('');
                                                            inventoryApi.getSkuBalance(item.skuId).then((r) => {
                                                                setCurrentStock(r.data.currentBalance || 0);
                                                            });
                                                        }}
                                                        className="btn btn-sm btn-primary"
                                                    >
                                                        Process
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
