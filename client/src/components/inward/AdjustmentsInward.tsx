/**
 * Adjustments Inward Component
 * Handles manual stock adjustments - found stock, corrections, etc.
 */

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { scanLookup, type ScanLookupResult } from '../../server/functions/returns';
import { quickInwardBySkuCode } from '../../server/functions/inventoryMutations';
import { Search, Plus, X, Check, AlertTriangle, Package } from 'lucide-react';
import RecentInwardsTable from './RecentInwardsTable';

interface AdjustmentsInwardProps {
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}

const ADJUSTMENT_REASONS = [
    { value: 'adjustment', label: 'Stock Adjustment' },
    { value: 'found_stock', label: 'Found Stock' },
    { value: 'correction', label: 'Inventory Correction' },
    { value: 'other', label: 'Other' },
];

export default function AdjustmentsInward({ onSuccess, onError }: AdjustmentsInwardProps) {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // Server function hooks
    const scanLookupFn = useServerFn(scanLookup);
    const quickInwardFn = useServerFn(quickInwardBySkuCode);

    // State
    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Form state
    const [quantity, setQuantity] = useState(1);
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

    // Scan handler - any SKU is valid for adjustments
    const handleScan = async () => {
        if (!searchInput.trim()) return;

        setIsSearching(true);
        setScanError(null);
        setScanResult(null);

        try {
            const result = await scanLookupFn({ data: { code: searchInput.trim() } });

            setScanResult(result);
            setQuantity(1);
            setAdjustmentReason('adjustment');
            setNotes('');
            setSearchInput('');
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : 'SKU not found';
            setScanError(errMsg);
        } finally {
            setIsSearching(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    // Adjustment inward mutation
    const adjustmentMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku) throw new Error('No SKU selected');
            const result = await quickInwardFn({
                data: {
                    skuCode: scanResult.sku.skuCode,
                    qty: quantity,
                    reason: adjustmentReason,
                    notes: notes || undefined,
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to add adjustment');
            }
            return result;
        },
        onSuccess: () => {
            const reasonLabel = ADJUSTMENT_REASONS.find(r => r.value === adjustmentReason)?.label || adjustmentReason;
            const msg = `+${quantity} ${scanResult?.sku.skuCode} added (${reasonLabel})`;
            setSuccessMessage(msg);
            onSuccess?.(msg);
            clearScan();
            queryClient.invalidateQueries({ queryKey: ['recent-inwards', 'adjustments'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
        },
        onError: (error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Failed to add adjustment';
            setScanError(msg);
            onError?.(msg);
        },
    });

    const clearScan = () => {
        setScanResult(null);
        setQuantity(1);
        setAdjustmentReason('adjustment');
        setNotes('');
        inputRef.current?.focus();
    };

    const handleSubmit = () => {
        if (!scanResult) return;
        adjustmentMutation.mutate();
    };

    const isSubmitting = adjustmentMutation.isPending;

    return (
        <div className="space-y-6 max-w-5xl mx-auto p-4">
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
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Scan or type SKU code..."
                            className="input pl-10 w-full text-lg"
                            autoFocus
                            disabled={isSearching}
                        />
                        {isSearching && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-600 border-t-transparent"></div>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleScan}
                        disabled={!searchInput.trim() || isSearching}
                        className="btn btn-primary"
                    >
                        Scan
                    </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    Scan any SKU barcode or enter code manually. Use this for found stock, corrections, or manual adjustments.
                </p>
            </div>

            {/* Scan Result & Form */}
            {scanResult && (
                <div className="card border-2 border-gray-200 bg-gray-50/30">
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
                            </div>
                        </div>

                        {/* Adjustment Form */}
                        <div className="flex-shrink-0 border-l pl-6 min-w-[320px]">
                            <div className="space-y-4">
                                {/* Info Box */}
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                    <div className="flex items-center gap-2 text-gray-700 mb-2">
                                        <AlertTriangle size={18} />
                                        <span className="font-medium">Manual Adjustment</span>
                                    </div>
                                    <p className="text-sm text-gray-600">
                                        Add inventory with a reason for adjustment.
                                    </p>
                                </div>

                                {/* Quantity & Reason */}
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

                                {/* Notes */}
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

                                {/* Submit */}
                                <button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting}
                                    className="btn btn-primary w-full flex items-center justify-center gap-2 h-12"
                                >
                                    <Plus size={18} />
                                    {isSubmitting ? 'Adding...' : 'Add Adjustment'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Recent Inwards Table */}
            <RecentInwardsTable
                source="adjustments"
                title="Recent Adjustments"
                onSuccess={(msg) => {
                    setSuccessMessage(msg);
                    onSuccess?.(msg);
                }}
                onError={(msg) => {
                    setScanError(msg);
                    onError?.(msg);
                }}
            />
        </div>
    );
}
