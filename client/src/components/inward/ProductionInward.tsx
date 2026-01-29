/**
 * Production Inward Component
 * Handles scanning and receiving items from production batches
 */

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { scanLookup, type ScanLookupResult } from '../../server/functions/returns';
import { quickInwardBySkuCode } from '../../server/functions/inventoryMutations';
import { Search, Plus, X, Check, AlertTriangle, Package } from 'lucide-react';
import RecentInwardsTable from './RecentInwardsTable';
import PendingQueuePanel from './PendingQueuePanel';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';
interface ProductionInwardProps {
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}

// Local type for matched production item from scan lookup
interface MatchedProductionItem {
    batchId: string;
    batchCode: string;
    qtyPlanned: number;
    qtyCompleted: number;
    qtyPending: number;
    batchDate: string;
}

export default function ProductionInward({ onSuccess, onError }: ProductionInwardProps) {
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
    const [customConfirmed, setCustomConfirmed] = useState(false);

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

    // Get matched production item from scan result
    const prodMatch = scanResult?.matches?.find(m => m.source === 'production');
    const matchedItem: MatchedProductionItem | null = prodMatch ? {
        batchId: prodMatch.data.batchId || '',
        batchCode: prodMatch.data.batchCode || '',
        qtyPlanned: prodMatch.data.qtyPlanned || 0,
        qtyCompleted: prodMatch.data.qtyCompleted || 0,
        qtyPending: prodMatch.data.qtyPending || 0,
        batchDate: prodMatch.data.batchDate || new Date().toISOString(),
    } : null;

    // Check if this is a custom SKU
    const skuCode = scanResult?.sku?.skuCode || '';
    const isCustomByPattern = /-C\d{2}$/.test(skuCode);
    const isCustomSku = (scanResult?.sku as any)?.isCustomSku || (matchedItem as any)?.isCustomSku || isCustomByPattern;
    const maxQty = matchedItem?.qtyPending || 999;

    // Handle queue item selection - auto-scan the SKU
    const handleQueueItemSelect = (skuCode: string) => {
        setSearchInput(skuCode);
        // Trigger scan after state updates
        setTimeout(() => {
            inputRef.current?.focus();
            handleScanWithCode(skuCode);
        }, 0);
    };

    // Scan with a specific code
    const handleScanWithCode = async (code: string) => {
        if (!code.trim()) return;

        setIsSearching(true);
        setScanError(null);
        setScanResult(null);

        try {
            const result = await scanLookupFn({ data: { code: code.trim() } });

            const productionMatch = result.matches?.find(m => m.source === 'production');
            if (!productionMatch) {
                setScanError('No matching production batch for this SKU');
                setSearchInput('');
                inputRef.current?.focus();
                return;
            }

            setScanResult(result);
            setQuantity(1);
            setCustomConfirmed(false);
            setSearchInput('');
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : 'SKU not found';
            setScanError(errMsg);
        } finally {
            setIsSearching(false);
            inputRef.current?.focus();
        }
    };

    // Scan handler - just delegates to handleScanWithCode
    const handleScan = async () => {
        if (!searchInput.trim()) return;
        await handleScanWithCode(searchInput.trim());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    // Production inward mutation
    const productionInwardMutation = useMutation({
        mutationFn: async () => {
            if (!scanResult?.sku) throw new Error('No SKU selected');
            const result = await quickInwardFn({
                data: {
                    skuCode: scanResult.sku.skuCode,
                    qty: quantity,
                    reason: 'production',
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to complete inward');
            }
            return result;
        },
        onSuccess: () => {
            const msg = `+${quantity} ${scanResult?.sku.skuCode} added from production`;
            setSuccessMessage(msg);
            onSuccess?.(msg);
            clearScan();
            queryClient.invalidateQueries({ queryKey: ['recent-inwards', 'production'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
        },
        onError: (error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Failed to complete inward';
            setScanError(msg);
            onError?.(msg);
        },
    });

    const clearScan = () => {
        setScanResult(null);
        setQuantity(1);
        setCustomConfirmed(false);
        inputRef.current?.focus();
    };

    const handleSubmit = () => {
        if (!scanResult) return;
        productionInwardMutation.mutate();
    };

    const isSubmitting = productionInwardMutation.isPending;

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
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
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
                    Scan a SKU barcode or enter code manually. Only SKUs with pending production batches will be accepted.
                </p>
            </div>

            {/* Scan Result & Form */}
            {scanResult && (
                <div className="card border-2 border-blue-200 bg-blue-50/30">
                    <div className="flex gap-6">
                        {/* SKU Image */}
                        <div className="w-32 h-32 bg-white rounded-lg overflow-hidden flex-shrink-0 border">
                            {scanResult.sku.imageUrl ? (
                                <img
                                    src={getOptimizedImageUrl(scanResult.sku.imageUrl, 'lg') || scanResult.sku.imageUrl}
                                    alt={scanResult.sku.skuCode}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
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

                        {/* Production Form */}
                        <div className="flex-shrink-0 border-l pl-6 min-w-[320px]">
                            <div className="space-y-4">
                                {/* Production Batch Info */}
                                {matchedItem && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <h4 className="font-medium text-blue-800 mb-2">Production Batch Match</h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div>
                                                <span className="text-blue-600">Batch:</span>{' '}
                                                <span className="font-mono font-medium">{matchedItem.batchCode}</span>
                                            </div>
                                            <div>
                                                <span className="text-blue-600">Date:</span>{' '}
                                                {new Date(matchedItem.batchDate).toLocaleDateString('en-IN')}
                                            </div>
                                            <div>
                                                <span className="text-blue-600">Planned:</span> {matchedItem.qtyPlanned}
                                            </div>
                                            <div>
                                                <span className="text-blue-600">Completed:</span> {matchedItem.qtyCompleted}
                                            </div>
                                            <div className="col-span-2">
                                                <span className="text-blue-600">Pending:</span>{' '}
                                                <span className="font-semibold text-blue-800">{matchedItem.qtyPending}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Custom SKU Confirmation */}
                                {isCustomSku && (
                                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={customConfirmed}
                                                onChange={(e) => setCustomConfirmed(e.target.checked)}
                                                className="w-5 h-5 mt-0.5 text-amber-600 border-2 border-amber-400 rounded focus:ring-amber-500"
                                            />
                                            <div>
                                                <p className="font-medium text-amber-800">Custom SKU - Confirm Customisation</p>
                                                <p className="text-sm text-amber-700">
                                                    Please confirm that customisation has been completed and quality checked before inwarding.
                                                </p>
                                            </div>
                                        </label>
                                    </div>
                                )}

                                {/* Quantity & Submit */}
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
                                        {matchedItem && (
                                            <p className="text-xs text-gray-500 mt-1">Max: {maxQty}</p>
                                        )}
                                    </div>

                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting || (isCustomSku && !customConfirmed)}
                                        className={`btn flex items-center gap-2 h-12 flex-1 ${
                                            isCustomSku && !customConfirmed
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                : 'btn-primary'
                                        }`}
                                    >
                                        <Plus size={18} />
                                        {isSubmitting ? 'Adding...' : 'Add to Stock'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Two-column layout: Queue + Recent Inwards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Pending Queue */}
                <div className="lg:col-span-1">
                    <PendingQueuePanel
                        source="production"
                        onSelectItem={handleQueueItemSelect}
                    />
                </div>

                {/* Recent Inwards Table */}
                <div className="lg:col-span-2">
                    <RecentInwardsTable
                        source="production"
                        title="Recent Production Inwards"
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
            </div>
        </div>
    );
}
