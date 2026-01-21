/**
 * Returns Inward Component
 * Handles receiving customer returns via return ticket scanning
 */

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { scanLookup, type ScanLookupResult } from '../../server/functions/returns';
import { receiveReturnItem } from '../../server/functions/returnsMutations';
import { Search, Check, AlertTriangle, X, RotateCcw } from 'lucide-react';
import RecentInwardsTable from './RecentInwardsTable';
import PendingQueuePanel from './PendingQueuePanel';

interface ReturnsInwardProps {
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}

// Local type for matched return item from scan lookup
interface MatchedReturnItem {
    lineId: string;
    requestId: string;
    requestNumber: string;
    reasonCategory?: string | null;
    customerName?: string;
}

// Condition options for return items
const CONDITIONS = [
    { value: 'unused', label: 'Unused / New', description: 'Item is brand new, tags attached', color: 'green' },
    { value: 'used', label: 'Used / Worn', description: 'Item shows signs of use', color: 'yellow' },
    { value: 'damaged', label: 'Damaged', description: 'Item is damaged', color: 'red' },
    { value: 'wrong_product', label: 'Wrong Product', description: 'Different item than expected', color: 'orange' },
];

export default function ReturnsInward({ onSuccess: _onSuccess, onError: _onError }: ReturnsInwardProps) {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // Server function hooks
    const scanLookupFn = useServerFn(scanLookup);
    const receiveReturnFn = useServerFn(receiveReturnItem);

    // State
    const [searchInput, setSearchInput] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
    const [matchedReturn, setMatchedReturn] = useState<MatchedReturnItem | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [selectedCondition, setSelectedCondition] = useState('unused');

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
        setMatchedReturn(null);

        try {
            const result = await scanLookupFn({ data: { code: code.trim() } });

            const returnMatch = result.matches.find(m => m.source === 'return');
            if (!returnMatch) {
                setScanError('No matching return ticket for this SKU');
                setSearchInput('');
                inputRef.current?.focus();
                return;
            }

            setScanResult(result);
            setMatchedReturn({
                lineId: returnMatch.data.lineId,
                requestId: returnMatch.data.requestId || '',
                requestNumber: returnMatch.data.requestNumber || '',
                reasonCategory: returnMatch.data.reasonCategory,
                customerName: returnMatch.data.customerName,
            });
            setSelectedCondition('unused');
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
        setMatchedReturn(null);
        setSelectedCondition('unused');
        inputRef.current?.focus();
    };

    // Receive return mutation
    const receiveReturnMutation = useMutation({
        mutationFn: async () => {
            if (!matchedReturn) throw new Error('No return selected');
            const result = await receiveReturnFn({
                data: {
                    requestId: matchedReturn.requestId,
                    lineId: matchedReturn.lineId,
                    condition: selectedCondition as 'unused' | 'used' | 'damaged' | 'wrong_product',
                },
            });
            if (!result.success) {
                throw new Error('Failed to receive return');
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards', 'returns'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            queryClient.invalidateQueries({ queryKey: ['pendingQueue', 'returns'] });
            setSuccessMessage(`Return ${matchedReturn?.requestNumber} received - item sent to QC queue`);
            clearScan();
        },
        onError: (error: unknown) => {
            const errMsg = error instanceof Error ? error.message : 'Failed to receive return';
            setScanError(errMsg);
        },
    });

    const handleSubmit = () => {
        receiveReturnMutation.mutate();
    };

    // Get border color class for condition
    const getConditionBorderClass = (condValue: string, condColor: string) => {
        if (selectedCondition !== condValue) return 'border-gray-200 hover:border-gray-300';
        switch (condColor) {
            case 'green': return 'border-green-500 bg-green-50';
            case 'yellow': return 'border-yellow-500 bg-yellow-50';
            case 'red': return 'border-red-500 bg-red-50';
            case 'orange': return 'border-orange-500 bg-orange-50';
            default: return 'border-gray-500 bg-gray-50';
        }
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
                        <RotateCcw size={20} className="text-orange-600" />
                        <h2 className="font-semibold text-lg">Scan Return Item</h2>
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
                        Scan SKU to find matching return ticket
                    </p>
                </div>

                {/* Scan Result & Form */}
                {scanResult && matchedReturn && (
                    <div className="card border-2 border-orange-200 bg-orange-50/30">
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

                        {/* Return Ticket Info */}
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
                            <h4 className="font-medium text-orange-800 mb-2">Return Ticket Match</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-orange-600">Ticket:</span>{' '}
                                    <span className="font-mono font-medium">{matchedReturn.requestNumber}</span>
                                </div>
                                <div>
                                    <span className="text-orange-600">Customer:</span>{' '}
                                    {matchedReturn.customerName}
                                </div>
                                <div className="col-span-2">
                                    <span className="text-orange-600">Reason:</span>{' '}
                                    {(matchedReturn.reasonCategory || '').replace(/_/g, ' ')}
                                </div>
                            </div>
                        </div>

                        {/* Condition Selection */}
                        <div className="mb-4">
                            <label className="text-sm font-medium text-gray-700 block mb-2">Item Condition</label>
                            <div className="grid grid-cols-2 gap-2">
                                {CONDITIONS.map((cond) => (
                                    <label
                                        key={cond.value}
                                        className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${getConditionBorderClass(cond.value, cond.color)}`}
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

                        {/* Submit Button */}
                        <button
                            onClick={handleSubmit}
                            disabled={receiveReturnMutation.isPending}
                            className="btn bg-orange-600 hover:bg-orange-700 text-white w-full flex items-center justify-center gap-2 h-12"
                        >
                            <Check size={18} />
                            {receiveReturnMutation.isPending ? 'Receiving...' : 'Receive Return'}
                        </button>

                        {receiveReturnMutation.isError && (
                            <p className="text-red-600 text-sm mt-2">
                                {receiveReturnMutation.error instanceof Error ? receiveReturnMutation.error.message : 'Failed to receive return'}
                            </p>
                        )}
                    </div>
                )}

            {/* Two-column layout: Queue + Recent Inwards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Pending Queue */}
                <div className="lg:col-span-1">
                    <PendingQueuePanel
                        source="returns"
                        onSelectItem={handleQueueItemSelect}
                    />
                </div>

                {/* Recent Inwards Table */}
                <div className="lg:col-span-2">
                    <RecentInwardsTable
                        source="return_receipt"
                        title="Recent Returns Inwards"
                        onSuccess={setSuccessMessage}
                        onError={setScanError}
                    />
                </div>
            </div>
        </div>
    );
}
