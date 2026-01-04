/**
 * Production Inward Page
 * Warehouse team page for inwarding production pieces via barcode scanner
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productionApi, productsApi } from '../services/api';
import { Package, Search, Plus, Trash2, Edit2, X, Check } from 'lucide-react';

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

export default function ProductionInward() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    const [searchInput, setSearchInput] = useState('');
    const [selectedSku, setSelectedSku] = useState<SkuInfo | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [pendingBatches, setPendingBatches] = useState<PendingBatch[]>([]);
    const [currentStock, setCurrentStock] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editQty, setEditQty] = useState(1);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Auto-clear success message
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    // Fetch today's inward history
    const { data: inwardHistory = [], isLoading: historyLoading } = useQuery({
        queryKey: ['inward-history'],
        queryFn: async () => {
            const res = await inventoryApi.getInwardHistory('today');
            return res.data as InwardTransaction[];
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    // Search for SKU
    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        try {
            // Try to find by barcode or SKU code
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
                alert('SKU not found');
                setSelectedSku(null);
                setPendingBatches([]);
                setCurrentStock(null);
            }
        } catch (error) {
            console.error('Search error:', error);
            alert('Failed to search SKU');
        }

        setSearchInput('');
        inputRef.current?.focus();
    };

    // Handle barcode scanner input (ends with Enter)
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        }
    };

    // Quick inward mutation
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

            // Show success message
            let msg = `+${quantity} ${selectedSku?.skuCode} inwarded`;
            if (data.matchedBatch) {
                msg += ` → Matched to ${data.matchedBatch.batchCode} (${data.matchedBatch.qtyCompleted}/${data.matchedBatch.qtyPlanned})`;
            }
            setSuccessMessage(msg);

            // Update current stock
            setCurrentStock(data.newBalance);

            // Refresh pending batches
            if (selectedSku) {
                productionApi.getPendingBySku(selectedSku.id).then((r) => {
                    setPendingBatches(r.data.batches || []);
                });
            }

            // Reset quantity
            setQuantity(1);
            inputRef.current?.focus();
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to inward');
        },
    });

    // Edit mutation
    const editMutation = useMutation({
        mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
            return inventoryApi.editInward(id, { qty });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inward-history'] });
            setEditingId(null);
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to edit');
        },
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            return inventoryApi.deleteInward(id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inward-history'] });
        },
        onError: (error: any) => {
            alert(error.response?.data?.error || 'Failed to delete');
        },
    });

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this inward entry?')) {
            deleteMutation.mutate(id);
        }
    };

    const totalPending = pendingBatches.reduce((sum, b) => sum + b.qtyPending, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Package className="text-blue-600" size={28} />
                <h1 className="text-2xl font-bold">Production Inward</h1>
            </div>

            {/* Success Message */}
            {successMessage && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <Check size={20} />
                    <span>{successMessage}</span>
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
                            placeholder="Scan barcode or enter SKU code..."
                            className="input pl-10 w-full text-lg"
                            autoFocus
                        />
                    </div>
                    <button onClick={handleSearch} className="btn btn-primary">
                        Search
                    </button>
                </div>
            </div>

            {/* SKU Preview Card */}
            {selectedSku && (
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
                                <button
                                    onClick={() => {
                                        setSelectedSku(null);
                                        setPendingBatches([]);
                                        setCurrentStock(null);
                                        inputRef.current?.focus();
                                    }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
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

                            {/* Pending Batches */}
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
                                {inwardMutation.isPending ? 'Adding...' : 'Inward'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Inward History */}
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

                {/* Summary */}
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
        </div>
    );
}
