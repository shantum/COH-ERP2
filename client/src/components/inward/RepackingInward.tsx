/**
 * Repacking/QC Inward Component
 * Handles QC processing of items in the repacking queue
 */

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { scanLookup, type ScanLookupResult } from '../../server/functions/returns';
import { processRepackingQueueItem } from '../../server/functions/returnsMutations';
import { Search, Check, AlertTriangle, X, RefreshCw, Plus } from 'lucide-react';
import RecentInwardsTable from './RecentInwardsTable';
import PendingQueuePanel from './PendingQueuePanel';

interface RepackingInwardProps {
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}

// Local type for matched repacking item from scan lookup
interface MatchedRepackingItem {
    queueId: string;
    qty: number;
    condition: string;
    returnRequestNumber?: string | null;
}

// QC decision options
const QC_DECISIONS = [
    { value: 'ready', label: 'Ready for Stock', description: 'Item passed QC, add to inventory', color: 'green' },
    { value: 'write_off', label: 'Write Off', description: 'Item cannot be sold', color: 'red' },
];

// Write-off reason options
const WRITE_OFF_REASONS = [
    { value: 'defective', label: 'Defective (Manufacturing/Quality defect)' },
    { value: 'destroyed', label: 'Destroyed (Damaged beyond repair)' },
    { value: 'wrong_product', label: 'Wrong Product (Customer returned wrong item)' },
    { value: 'stained', label: 'Stained / Soiled' },
    { value: 'other', label: 'Other' },
];

export default function RepackingInward({ onSuccess: _onSuccess, onError: _onError }: RepackingInwardProps) {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // Server function hooks
    const scanLookupFn = useServerFn(scanLookup);
    const processRepackingFn = useServerFn(processRepackingQueueItem);

    // State
    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
    const [matchedRepack, setMatchedRepack] = useState<MatchedRepackingItem | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [qcDecision, setQcDecision] = useState<'ready' | 'write_off'>('ready');
    const [writeOffReason, setWriteOffReason] = useState('defective');
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

    // Handle queue item selection - auto-scan the SKU
    const handleQueueItemSelect = (skuCode: string) => {
        setSearchInput(skuCode);
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
        setMatchedRepack(null);

        try {
            const result = await scanLookupFn({ data: { code: code.trim() } });

            const repackMatch = result.matches.find(m => m.source === 'repacking');
            if (!repackMatch) {
                setScanError('No matching QC item for this SKU');
                setSearchInput('');
                inputRef.current?.focus();
                return;
            }

            setScanResult(result);
            setMatchedRepack({
                queueId: repackMatch.data.queueId || repackMatch.data.lineId,
                qty: repackMatch.data.qty,
                condition: repackMatch.data.condition || 'unknown',
                returnRequestNumber: repackMatch.data.returnRequestNumber,
            });
            setQcDecision('ready');
            setWriteOffReason('defective');
            setNotes('');
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : 'SKU not found';
            setScanError(errMsg);
        } finally {
            setIsSearching(false);
            setSearchInput('');
            inputRef.current?.focus();
        }
    };

    // Handle scan lookup
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

    // Clear scan result
    const clearScan = () => {
        setScanResult(null);
        setMatchedRepack(null);
        setQcDecision('ready');
        setWriteOffReason('defective');
        setNotes('');
        inputRef.current?.focus();
    };

    // Process repacking mutation
    const processMutation = useMutation({
        mutationFn: async () => {
            if (!matchedRepack) throw new Error('No QC item selected');
            const result = await processRepackingFn({
                data: {
                    itemId: matchedRepack.queueId,
                    action: qcDecision,
                    writeOffReason: qcDecision === 'write_off' ? writeOffReason : undefined,
                    notes: notes || undefined,
                },
            });
            if (!result.success) {
                throw new Error(result.message || 'Failed to process item');
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards', 'repack_complete'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            queryClient.invalidateQueries({ queryKey: ['pendingQueue', 'repacking'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            const message = qcDecision === 'ready'
                ? `${scanResult?.sku.skuCode} added to stock`
                : `${scanResult?.sku.skuCode} written off`;
            setSuccessMessage(message);
            clearScan();
        },
        onError: (error: unknown) => {
            const errMsg = error instanceof Error ? error.message : 'Failed to process item';
            setScanError(errMsg);
        },
    });

    const handleSubmit = () => {
        processMutation.mutate();
    };

    // Get condition display color
    const getConditionColor = (condition: string) => {
        switch (condition) {
            case 'unused':
            case 'good':
                return 'text-green-700';
            case 'used':
                return 'text-yellow-700';
            case 'damaged':
            case 'wrong_product':
                return 'text-red-700';
            default:
                return 'text-gray-700';
        }
    };

    // Get decision border class
    const getDecisionBorderClass = (value: string, color: string) => {
        if (qcDecision !== value) return 'border-gray-200 hover:border-gray-300';
        return color === 'green'
            ? 'border-green-500 bg-green-50'
            : 'border-red-500 bg-red-50';
    };

    return (
        <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
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
                    <div className="flex items-center gap-3 mb-2">
                        <RefreshCw size={20} className="text-green-600" />
                        <h2 className="font-semibold text-lg">Scan QC Item</h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-lg">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Scan or type SKU code..."
                                className="input pl-10 w-full text-lg"
                                disabled={isSearching}
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={handleScan}
                            disabled={!searchInput.trim() || isSearching}
                            className="btn btn-primary"
                        >
                            {isSearching ? 'Searching...' : 'Lookup'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        Scan SKU to find item in QC queue
                    </p>
                </div>

                {/* Scan Result & Form */}
                {scanResult && matchedRepack && (
                    <div className="card border-2 border-green-200 bg-green-50/30">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-semibold">{scanResult.sku.productName}</h3>
                                <p className="text-gray-600">
                                    {scanResult.sku.colorName} / {scanResult.sku.size}
                                </p>
                                <p className="font-mono text-sm mt-1">{scanResult.sku.skuCode}</p>
                            </div>
                            <button onClick={clearScan} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        {/* QC Item Info */}
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                            <h4 className="font-medium text-green-800 mb-2">QC Queue Item</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-green-600">Condition:</span>{' '}
                                    <span className={`font-medium ${getConditionColor(matchedRepack.condition)}`}>
                                        {matchedRepack.condition}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-green-600">Qty:</span>{' '}
                                    {matchedRepack.qty}
                                </div>
                                {matchedRepack.returnRequestNumber && (
                                    <div className="col-span-2">
                                        <span className="text-green-600">Return:</span>{' '}
                                        <span className="font-mono">{matchedRepack.returnRequestNumber}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* QC Decision Selection */}
                        <div className="mb-4">
                            <label className="text-sm font-medium text-gray-700 block mb-2">QC Decision</label>
                            <div className="space-y-2">
                                {QC_DECISIONS.map((decision) => (
                                    <label
                                        key={decision.value}
                                        className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${getDecisionBorderClass(decision.value, decision.color)}`}
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

                        {/* Write-off Reason (conditional) */}
                        {qcDecision === 'write_off' && (
                            <div className="mb-4">
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

                        {/* Notes */}
                        <div className="mb-4">
                            <label className="text-sm font-medium text-gray-700 block mb-1">Notes (optional)</label>
                            <input
                                type="text"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Additional notes..."
                                className="input w-full"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            onClick={handleSubmit}
                            disabled={processMutation.isPending}
                            className={`btn w-full flex items-center justify-center gap-2 h-12 ${
                                qcDecision === 'ready'
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-red-600 hover:bg-red-700 text-white'
                            }`}
                        >
                            {qcDecision === 'ready' ? <Plus size={18} /> : <X size={18} />}
                            {processMutation.isPending
                                ? 'Processing...'
                                : qcDecision === 'ready'
                                    ? 'Add to Stock'
                                    : 'Write Off'
                            }
                        </button>

                        {processMutation.isError && (
                            <p className="text-red-600 text-sm mt-2">
                                {processMutation.error instanceof Error ? processMutation.error.message : 'Failed to process item'}
                            </p>
                        )}
                    </div>
                )}

            {/* Two-column layout: Queue + Recent Inwards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Pending Queue */}
                <div className="lg:col-span-1">
                    <PendingQueuePanel
                        source="repacking"
                        onSelectItem={handleQueueItemSelect}
                    />
                </div>

                {/* Recent Inwards Table */}
                <div className="lg:col-span-2">
                    <RecentInwardsTable
                        source="repack_complete"
                        title="Recent Repacking Inwards"
                        onSuccess={setSuccessMessage}
                        onError={setScanError}
                    />
                </div>
            </div>
        </div>
    );
}
