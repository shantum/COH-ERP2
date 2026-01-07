/**
 * Centralized Inward Hub
 * Single page for all inventory inward operations: Production, Returns, RTO, Repacking, Adjustments
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, ordersApi, returnsApi, repackingApi } from '../services/api';
import {
    Package, Search, Plus, X, Check, AlertTriangle, Undo2,
    Factory, RotateCcw, Truck, RefreshCw, ClipboardList
} from 'lucide-react';
import type {
    PendingSources,
    ScanLookupResult,
    RecentInward,
    PendingProductionItem,
    PendingReturnItem,
    PendingRtoItem,
    PendingRepackingItem,
} from '../types';

// ============================================
// TYPES
// ============================================

interface SourceCardProps {
    title: string;
    count: number;
    icon: React.ReactNode;
    colorClass: string;
    onClick?: () => void;
}

// ============================================
// CONSTANTS
// ============================================

const CONDITIONS = [
    { value: 'unused', label: 'Unused / New', description: 'Item is brand new, tags attached', color: 'green' },
    { value: 'used', label: 'Used / Worn', description: 'Item shows signs of use', color: 'yellow' },
    { value: 'damaged', label: 'Damaged', description: 'Item is damaged', color: 'red' },
    { value: 'wrong_product', label: 'Wrong Product', description: 'Different item than expected', color: 'orange' },
];

const ADJUSTMENT_REASONS = [
    { value: 'adjustment', label: 'Stock Adjustment' },
    { value: 'found_stock', label: 'Found Stock' },
    { value: 'correction', label: 'Inventory Correction' },
    { value: 'other', label: 'Other' },
];

const QC_DECISIONS = [
    { value: 'ready', label: 'Ready for Stock', description: 'Item passed QC, add to inventory', color: 'green' },
    { value: 'write_off', label: 'Write Off', description: 'Item cannot be sold', color: 'red' },
];

const WRITE_OFF_REASONS = [
    { value: 'defective', label: 'Defective (Manufacturing/Quality defect)' },
    { value: 'destroyed', label: 'Destroyed (Damaged beyond repair)' },
    { value: 'wrong_product', label: 'Wrong Product (Customer returned wrong item)' },
    { value: 'stained', label: 'Stained / Soiled' },
    { value: 'other', label: 'Other' },
];

// ============================================
// HELPER COMPONENTS
// ============================================

function SourceCard({ title, count, icon, colorClass, onClick }: SourceCardProps) {
    return (
        <div
            onClick={onClick}
            className={`rounded-lg border-2 p-4 cursor-pointer transition-all hover:shadow-md ${colorClass}`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {icon}
                    <span className="font-medium">{title}</span>
                </div>
                <span className="text-2xl font-bold">{count}</span>
            </div>
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function InwardHub() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // State
    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Form state
    const [quantity, setQuantity] = useState(1);
    const [selectedCondition, setSelectedCondition] = useState('unused');
    const [qcDecision, setQcDecision] = useState<'ready' | 'write_off'>('ready');
    const [writeOffReason, setWriteOffReason] = useState('defective');
    const [adjustmentReason, setAdjustmentReason] = useState('adjustment');
    const [notes, setNotes] = useState('');

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Auto-clear messages
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    useEffect(() => {
        if (scanError) {
            const timer = setTimeout(() => setScanError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [scanError]);

    // ============================================
    // QUERIES
    // ============================================

    // Fetch pending sources counts
    const { data: pendingSources } = useQuery<PendingSources>({
        queryKey: ['pending-sources'],
        queryFn: async () => {
            const res = await inventoryApi.getPendingSources();
            return res.data;
        },
        refetchInterval: 30000,
    });

    // Fetch recent inwards
    const { data: recentInwards = [], isLoading: loadingRecent } = useQuery<RecentInward[]>({
        queryKey: ['recent-inwards'],
        queryFn: async () => {
            const res = await inventoryApi.getRecentInwards(50);
            return res.data;
        },
        refetchInterval: 15000,
    });

    // ============================================
    // DERIVED DATA
    // ============================================

    const todayTotal = useMemo(() => {
        const today = new Date().toDateString();
        return recentInwards
            .filter(i => new Date(i.createdAt).toDateString() === today)
            .reduce((sum, i) => sum + i.qty, 0);
    }, [recentInwards]);

    // Get the matched item based on recommended source
    const matchedItem = useMemo(() => {
        if (!scanResult?.matches?.length) return null;
        const recommended = scanResult.matches.find(m => m.source === scanResult.recommendedSource);
        return recommended?.data || null;
    }, [scanResult]);

    // ============================================
    // MUTATIONS
    // ============================================

    // Production inward mutation
    const productionInwardMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku) throw new Error('No SKU selected');
            return inventoryApi.quickInward({
                skuCode: scanResult.sku.skuCode,
                qty: quantity,
                reason: 'production',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            setSuccessMessage(`+${quantity} ${scanResult?.sku.skuCode} added from production`);
            clearScan();
        },
        onError: (error: any) => {
            setScanError(error.response?.data?.error || 'Failed to complete inward');
        },
    });

    // Return receive mutation
    const returnReceiveMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku || !matchedItem) throw new Error('No return selected');
            const returnItem = matchedItem as PendingReturnItem;
            return returnsApi.receiveItem(returnItem.requestId, {
                lineId: returnItem.lineId,
                condition: selectedCondition as 'good' | 'used' | 'damaged' | 'wrong_product',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            const returnItem = matchedItem as PendingReturnItem;
            setSuccessMessage(`Return ${returnItem.requestNumber} received - item sent to QC queue`);
            clearScan();
        },
        onError: (error: any) => {
            setScanError(error.response?.data?.error || 'Failed to receive return');
        },
    });

    // RTO receive mutation
    const rtoReceiveMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku || !matchedItem) throw new Error('No RTO order selected');
            const rtoItem = matchedItem as PendingRtoItem;
            return ordersApi.receiveRto(rtoItem.orderId);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            const rtoItem = matchedItem as PendingRtoItem;
            setSuccessMessage(`RTO ${rtoItem.orderNumber} received and added to stock`);
            clearScan();
        },
        onError: (error: any) => {
            setScanError(error.response?.data?.error || 'Failed to receive RTO');
        },
    });

    // Repacking process mutation
    const repackingProcessMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku || !matchedItem) throw new Error('No repacking item selected');
            const repackItem = matchedItem as PendingRepackingItem;
            return repackingApi.process({
                itemId: repackItem.queueId,
                action: qcDecision,
                writeOffReason: qcDecision === 'write_off' ? writeOffReason : undefined,
                notes: notes || undefined,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            setSuccessMessage(qcDecision === 'ready'
                ? `Item added to stock`
                : `Item written off`);
            clearScan();
        },
        onError: (error: any) => {
            setScanError(error.response?.data?.error || 'Failed to process item');
        },
    });

    // Adjustment mutation
    const adjustmentMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku) throw new Error('No SKU selected');
            return inventoryApi.quickInward({
                skuCode: scanResult.sku.skuCode,
                qty: quantity,
                reason: adjustmentReason,
                notes: notes || undefined,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            setSuccessMessage(`+${quantity} ${scanResult?.sku.skuCode} added (${adjustmentReason})`);
            clearScan();
        },
        onError: (error: any) => {
            setScanError(error.response?.data?.error || 'Failed to add adjustment');
        },
    });

    // Undo transaction mutation
    const undoMutation = useMutation({
        mutationFn: async (id: string) => {
            return inventoryApi.undoTransaction(id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            setSuccessMessage('Transaction undone');
        },
        onError: (error: any) => {
            setScanError(error.response?.data?.error || 'Failed to undo transaction');
        },
    });

    // ============================================
    // HANDLERS
    // ============================================

    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        setIsSearching(true);
        setScanError(null);
        setScanResult(null);

        try {
            const res = await inventoryApi.scanLookup(searchInput.trim());
            setScanResult(res.data);
            setQuantity(1);
            setSelectedCondition('unused');
            setQcDecision('ready');
            setWriteOffReason('defective');
            setAdjustmentReason('adjustment');
            setNotes('');
        } catch (error: any) {
            setScanError(error.response?.data?.error || 'SKU not found');
        } finally {
            setIsSearching(false);
            setSearchInput('');
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        }
    };

    const clearScan = () => {
        setScanResult(null);
        setQuantity(1);
        setSelectedCondition('unused');
        setQcDecision('ready');
        setNotes('');
        inputRef.current?.focus();
    };

    const handleSubmit = () => {
        if (!scanResult) return;

        switch (scanResult.recommendedSource) {
            case 'production':
                productionInwardMutation.mutate();
                break;
            case 'return':
                returnReceiveMutation.mutate();
                break;
            case 'rto':
                rtoReceiveMutation.mutate();
                break;
            case 'repacking':
                repackingProcessMutation.mutate();
                break;
            case 'adjustment':
            default:
                adjustmentMutation.mutate();
                break;
        }
    };

    const handleUndo = (id: string) => {
        if (window.confirm('Are you sure you want to undo this inward?')) {
            undoMutation.mutate(id);
        }
    };

    const isSubmitting = productionInwardMutation.isPending
        || returnReceiveMutation.isPending
        || rtoReceiveMutation.isPending
        || repackingProcessMutation.isPending
        || adjustmentMutation.isPending;

    // ============================================
    // RENDER HELPERS
    // ============================================

    const getSourceLabel = (source: string): string => {
        const labels: Record<string, string> = {
            production: 'Production',
            return: 'Return',
            rto: 'RTO',
            repacking: 'Repacking',
            adjustment: 'Adjustment',
            return_receipt: 'Return',
        };
        return labels[source] || source;
    };

    const getSourceColor = (source: string): string => {
        const colors: Record<string, string> = {
            production: 'bg-blue-100 text-blue-700',
            return: 'bg-orange-100 text-orange-700',
            rto: 'bg-purple-100 text-purple-700',
            repacking: 'bg-green-100 text-green-700',
            adjustment: 'bg-gray-100 text-gray-700',
            return_receipt: 'bg-orange-100 text-orange-700',
        };
        return colors[source] || 'bg-gray-100 text-gray-700';
    };

    const renderSourceForm = () => {
        if (!scanResult) return null;

        const source = scanResult.recommendedSource;

        switch (source) {
            case 'production':
                return renderProductionForm();
            case 'return':
                return renderReturnForm();
            case 'rto':
                return renderRtoForm();
            case 'repacking':
                return renderRepackingForm();
            case 'adjustment':
            default:
                return renderAdjustmentForm();
        }
    };

    const renderProductionForm = () => {
        const prodItem = matchedItem as PendingProductionItem | null;
        const maxQty = prodItem?.qtyPending || 999;

        return (
            <div className="space-y-4">
                {prodItem && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="font-medium text-blue-800 mb-2">Production Batch Match</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                                <span className="text-blue-600">Batch:</span>{' '}
                                <span className="font-mono font-medium">{prodItem.batchCode}</span>
                            </div>
                            <div>
                                <span className="text-blue-600">Date:</span>{' '}
                                {new Date(prodItem.batchDate).toLocaleDateString('en-IN')}
                            </div>
                            <div>
                                <span className="text-blue-600">Planned:</span> {prodItem.qtyPlanned}
                            </div>
                            <div>
                                <span className="text-blue-600">Completed:</span> {prodItem.qtyCompleted}
                            </div>
                            <div className="col-span-2">
                                <span className="text-blue-600">Pending:</span>{' '}
                                <span className="font-semibold text-blue-800">{prodItem.qtyPending}</span>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-4">
                    <div>
                        <label className="text-sm text-gray-600 block mb-1">Quantity</label>
                        <input
                            type="number"
                            min={1}
                            max={maxQty}
                            value={quantity}
                            onChange={(e) => setQuantity(Math.min(maxQty, Math.max(1, parseInt(e.target.value) || 1)))}
                            className="input w-24 text-center text-lg"
                        />
                        {prodItem && (
                            <p className="text-xs text-gray-500 mt-1">Max: {maxQty}</p>
                        )}
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="btn btn-primary flex items-center gap-2 h-12 flex-1"
                    >
                        <Plus size={18} />
                        {isSubmitting ? 'Adding...' : 'Add to Stock'}
                    </button>
                </div>
            </div>
        );
    };

    const renderReturnForm = () => {
        const returnItem = matchedItem as PendingReturnItem | null;

        return (
            <div className="space-y-4">
                {returnItem && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <h4 className="font-medium text-orange-800 mb-2">Return Ticket Match</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                                <span className="text-orange-600">Ticket:</span>{' '}
                                <span className="font-mono font-medium">{returnItem.requestNumber}</span>
                            </div>
                            <div>
                                <span className="text-orange-600">Customer:</span>{' '}
                                {returnItem.customerName}
                            </div>
                            <div className="col-span-2">
                                <span className="text-orange-600">Reason:</span>{' '}
                                {returnItem.reasonCategory.replace(/_/g, ' ')}
                            </div>
                        </div>
                    </div>
                )}

                <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">Item Condition</label>
                    <div className="grid grid-cols-2 gap-2">
                        {CONDITIONS.map((cond) => (
                            <label
                                key={cond.value}
                                className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                    selectedCondition === cond.value
                                        ? cond.color === 'green' ? 'border-green-500 bg-green-50' :
                                          cond.color === 'yellow' ? 'border-yellow-500 bg-yellow-50' :
                                          cond.color === 'red' ? 'border-red-500 bg-red-50' :
                                          'border-orange-500 bg-orange-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="condition"
                                    value={cond.value}
                                    checked={selectedCondition === cond.value}
                                    onChange={(e) => setSelectedCondition(e.target.value)}
                                    className="mt-1"
                                />
                                <div>
                                    <p className="font-medium text-sm">{cond.label}</p>
                                    <p className="text-xs text-gray-500">{cond.description}</p>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="btn bg-orange-600 hover:bg-orange-700 text-white w-full flex items-center justify-center gap-2 h-12"
                >
                    <Check size={18} />
                    {isSubmitting ? 'Receiving...' : 'Receive Return'}
                </button>
            </div>
        );
    };

    const renderRtoForm = () => {
        const rtoItem = matchedItem as PendingRtoItem | null;

        return (
            <div className="space-y-4">
                {rtoItem && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                        <h4 className="font-medium text-purple-800 mb-2">RTO Order Match</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                                <span className="text-purple-600">Order:</span>{' '}
                                <span className="font-mono font-medium">{rtoItem.orderNumber}</span>
                            </div>
                            <div>
                                <span className="text-purple-600">Customer:</span>{' '}
                                {rtoItem.customerName}
                            </div>
                            <div>
                                <span className="text-purple-600">Qty:</span> {rtoItem.qty}
                            </div>
                            <div>
                                <span className="text-purple-600">RTO Date:</span>{' '}
                                {new Date(rtoItem.rtoInitiatedAt).toLocaleDateString('en-IN')}
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="btn bg-purple-600 hover:bg-purple-700 text-white w-full flex items-center justify-center gap-2 h-12"
                >
                    <Truck size={18} />
                    {isSubmitting ? 'Receiving...' : 'Receive RTO'}
                </button>
            </div>
        );
    };

    const renderRepackingForm = () => {
        const repackItem = matchedItem as PendingRepackingItem | null;

        return (
            <div className="space-y-4">
                {repackItem && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h4 className="font-medium text-green-800 mb-2">QC Queue Item</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                                <span className="text-green-600">Condition:</span>{' '}
                                <span className={`font-medium ${
                                    repackItem.condition === 'unused' ? 'text-green-700' :
                                    repackItem.condition === 'used' ? 'text-yellow-700' :
                                    'text-red-700'
                                }`}>
                                    {repackItem.condition}
                                </span>
                            </div>
                            <div>
                                <span className="text-green-600">Qty:</span> {repackItem.qty}
                            </div>
                            {repackItem.returnRequestNumber && (
                                <div className="col-span-2">
                                    <span className="text-green-600">Return:</span>{' '}
                                    <span className="font-mono">{repackItem.returnRequestNumber}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">QC Decision</label>
                    <div className="space-y-2">
                        {QC_DECISIONS.map((decision) => (
                            <label
                                key={decision.value}
                                className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                    qcDecision === decision.value
                                        ? decision.color === 'green' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="qcDecision"
                                    value={decision.value}
                                    checked={qcDecision === decision.value}
                                    onChange={(e) => setQcDecision(e.target.value as 'ready' | 'write_off')}
                                    className="mt-1"
                                />
                                <div>
                                    <p className="font-medium text-sm">{decision.label}</p>
                                    <p className="text-xs text-gray-500">{decision.description}</p>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                {qcDecision === 'write_off' && (
                    <div>
                        <label className="text-sm font-medium text-gray-700 block mb-1">Write-off Reason</label>
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

                <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">Notes (optional)</label>
                    <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Additional notes..."
                        className="input w-full"
                    />
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className={`btn w-full flex items-center justify-center gap-2 h-12 ${
                        qcDecision === 'ready'
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-red-600 hover:bg-red-700 text-white'
                    }`}
                >
                    {qcDecision === 'ready' ? <Plus size={18} /> : <X size={18} />}
                    {isSubmitting ? 'Processing...' :
                        qcDecision === 'ready' ? 'Add to Stock' : 'Write Off'}
                </button>
            </div>
        );
    };

    const renderAdjustmentForm = () => {
        return (
            <div className="space-y-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-gray-700 mb-2">
                        <AlertTriangle size={18} />
                        <span className="font-medium">No Pending Source Found</span>
                    </div>
                    <p className="text-sm text-gray-600">
                        This SKU doesn't match any pending production, returns, RTO, or repacking items.
                        You can add it as an inventory adjustment.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 block mb-1">Quantity</label>
                        <input
                            type="number"
                            min={1}
                            value={quantity}
                            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                            className="input w-full text-center text-lg"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium text-gray-700 block mb-1">Reason</label>
                        <select
                            value={adjustmentReason}
                            onChange={(e) => setAdjustmentReason(e.target.value)}
                            className="input w-full"
                        >
                            {ADJUSTMENT_REASONS.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">Notes (optional)</label>
                    <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Reason for adjustment..."
                        className="input w-full"
                    />
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="btn btn-primary w-full flex items-center justify-center gap-2 h-12"
                >
                    <Plus size={18} />
                    {isSubmitting ? 'Adding...' : 'Add Adjustment'}
                </button>
            </div>
        );
    };

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Package className="text-blue-600" size={28} />
                    <div>
                        <h1 className="text-2xl font-bold">Inward Hub</h1>
                        <p className="text-sm text-gray-500">Centralized inventory receiving</p>
                    </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
                    <span className="text-green-600 text-sm">Today's Total:</span>{' '}
                    <span className="text-green-700 font-bold text-lg">+{todayTotal}</span>
                    <span className="text-green-600 text-sm ml-1">pcs</span>
                </div>
            </div>

            {/* Messages */}
            {successMessage && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <Check size={20} />
                    <span>{successMessage}</span>
                </div>
            )}

            {scanError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertTriangle size={20} />
                    <span>{scanError}</span>
                </div>
            )}

            {/* Scan Input */}
            <div className="card">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-lg">
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
                    <button
                        onClick={handleSearch}
                        disabled={isSearching}
                        className="btn btn-primary"
                    >
                        {isSearching ? 'Searching...' : 'Search'}
                    </button>
                </div>
            </div>

            {/* Source Cards */}
            <div className="grid grid-cols-4 gap-4">
                <SourceCard
                    title="Production"
                    count={pendingSources?.counts.production ?? 0}
                    icon={<Factory size={20} className="text-blue-600" />}
                    colorClass="bg-blue-50 border-blue-200 hover:bg-blue-100"
                />
                <SourceCard
                    title="Returns"
                    count={pendingSources?.counts.returns ?? 0}
                    icon={<RotateCcw size={20} className="text-orange-600" />}
                    colorClass="bg-orange-50 border-orange-200 hover:bg-orange-100"
                />
                <SourceCard
                    title="RTO"
                    count={pendingSources?.counts.rto ?? 0}
                    icon={<Truck size={20} className="text-purple-600" />}
                    colorClass="bg-purple-50 border-purple-200 hover:bg-purple-100"
                />
                <SourceCard
                    title="Repacking"
                    count={pendingSources?.counts.repacking ?? 0}
                    icon={<RefreshCw size={20} className="text-green-600" />}
                    colorClass="bg-green-50 border-green-200 hover:bg-green-100"
                />
            </div>

            {/* Scan Result */}
            {scanResult && (
                <div className={`card border-2 ${
                    scanResult.recommendedSource === 'production' ? 'border-blue-200 bg-blue-50/30' :
                    scanResult.recommendedSource === 'return' ? 'border-orange-200 bg-orange-50/30' :
                    scanResult.recommendedSource === 'rto' ? 'border-purple-200 bg-purple-50/30' :
                    scanResult.recommendedSource === 'repacking' ? 'border-green-200 bg-green-50/30' :
                    'border-gray-200 bg-gray-50/30'
                }`}>
                    <div className="flex gap-6">
                        {/* SKU Image */}
                        <div className="w-32 h-32 bg-white rounded-lg overflow-hidden flex-shrink-0 border">
                            {scanResult.sku.imageUrl ? (
                                <img
                                    src={scanResult.sku.imageUrl}
                                    alt={scanResult.sku.skuCode}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <Package size={40} />
                                </div>
                            )}
                        </div>

                        {/* SKU Info */}
                        <div className="flex-1 space-y-2">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold">{scanResult.sku.productName}</h2>
                                    <p className="text-gray-600">
                                        {scanResult.sku.colorName} / {scanResult.sku.size}
                                    </p>
                                </div>
                                <button onClick={clearScan} className="text-gray-400 hover:text-gray-600">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex gap-6 text-sm">
                                <div>
                                    <span className="text-gray-500">SKU:</span>{' '}
                                    <span className="font-mono font-medium">{scanResult.sku.skuCode}</span>
                                </div>
                                {scanResult.sku.barcode && (
                                    <div>
                                        <span className="text-gray-500">Barcode:</span>{' '}
                                        <span className="font-mono">{scanResult.sku.barcode}</span>
                                    </div>
                                )}
                                <div>
                                    <span className="text-gray-500">MRP:</span>{' '}
                                    <span className="font-medium">Rs {scanResult.sku.mrp}</span>
                                </div>
                            </div>

                            <div className="flex gap-4 text-sm pt-2">
                                <div className="bg-white px-3 py-1 rounded border">
                                    <span className="text-gray-500">Current Stock:</span>{' '}
                                    <span className="font-semibold text-blue-600">{scanResult.currentBalance} pcs</span>
                                </div>
                                <div className="bg-white px-3 py-1 rounded border">
                                    <span className="text-gray-500">Available:</span>{' '}
                                    <span className="font-semibold text-green-600">{scanResult.availableBalance} pcs</span>
                                </div>
                                <div className={`px-3 py-1 rounded ${getSourceColor(scanResult.recommendedSource)}`}>
                                    <span className="font-medium">
                                        Source: {getSourceLabel(scanResult.recommendedSource)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Source Form */}
                        <div className="flex-shrink-0 border-l pl-6 min-w-[320px]">
                            {renderSourceForm()}
                        </div>
                    </div>
                </div>
            )}

            {/* Recent Activity Feed */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <ClipboardList size={20} className="text-gray-500" />
                        <h3 className="text-lg font-semibold">Recent Inwards</h3>
                    </div>
                    <span className="text-sm text-gray-500">
                        {recentInwards.length} transactions
                    </span>
                </div>

                {loadingRecent ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    </div>
                ) : recentInwards.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No recent inward transactions</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Time</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">SKU</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                                    <th className="px-3 py-2 text-center font-medium text-gray-600">Qty</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Source</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Notes</th>
                                    <th className="px-3 py-2 text-center font-medium text-gray-600">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {recentInwards.map((txn) => {
                                    const isToday = new Date(txn.createdAt).toDateString() === new Date().toDateString();
                                    return (
                                        <tr
                                            key={txn.id}
                                            className={`hover:bg-gray-50 transition-colors ${
                                                undoMutation.isPending && undoMutation.variables === txn.id
                                                    ? 'opacity-50'
                                                    : ''
                                            }`}
                                        >
                                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                                {isToday
                                                    ? new Date(txn.createdAt).toLocaleTimeString('en-IN', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })
                                                    : new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                                        day: '2-digit',
                                                        month: 'short',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })
                                                }
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">{txn.skuCode}</td>
                                            <td className="px-3 py-2">
                                                {txn.productName} - {txn.colorName} / {txn.size}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="text-green-600 font-semibold">+{txn.qty}</span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getSourceColor(txn.source || txn.reason)}`}>
                                                    {getSourceLabel(txn.source || txn.reason)}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate">
                                                {txn.notes || '-'}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <button
                                                    onClick={() => handleUndo(txn.id)}
                                                    disabled={undoMutation.isPending}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                    title="Undo"
                                                >
                                                    <Undo2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
