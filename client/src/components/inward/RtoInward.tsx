/**
 * RTO Inward Mode Component
 * Handles Return-to-Origin package processing with line-by-line condition tracking.
 *
 * Flow:
 * 1. User scans SKU barcode/code
 * 2. System looks up matching RTO orders for that SKU
 * 3. User selects condition (unopened, good, damaged, wrong_product)
 * 4. System creates inventory inward (if good condition) or write-off
 *
 * Key features:
 * - Line-level processing (each order line tracked individually)
 * - Order progress display showing processed vs pending lines
 * - Condition-based inventory handling (good = stock, damaged = write-off)
 */

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { scanLookup, type ScanLookupResult } from '../../server/functions/returns';
import { rtoInwardLine } from '../../server/functions/inventoryMutations';
import {
    Package,
    Check,
    AlertTriangle,
    HelpCircle,
    ChevronRight,
    Truck,
    PackageOpen,
    Search
} from 'lucide-react';
import RecentInwardsTable from './RecentInwardsTable';
import PendingQueuePanel from './PendingQueuePanel';
import type { RtoScanMatchData, RtoCondition } from '../../types';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';

interface RtoInwardProps {
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}

// RTO condition options with visual styling
const RTO_CONDITIONS: Array<{
    value: RtoCondition;
    label: string;
    desc: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    bgClass: string;
    borderClass: string;
    textClass: string;
}> = [
    {
        value: 'unopened',
        label: 'Unopened',
        desc: 'Package sealed, never opened',
        icon: Package,
        bgClass: 'bg-green-50',
        borderClass: 'border-green-500',
        textClass: 'text-green-700'
    },
    {
        value: 'good',
        label: 'Good',
        desc: 'Opened but item unused',
        icon: Check,
        bgClass: 'bg-green-50',
        borderClass: 'border-green-500',
        textClass: 'text-green-700'
    },
    {
        value: 'damaged',
        label: 'Damaged',
        desc: 'Visible damage, marks, defects',
        icon: AlertTriangle,
        bgClass: 'bg-red-50',
        borderClass: 'border-red-500',
        textClass: 'text-red-700'
    },
    {
        value: 'wrong_product',
        label: 'Wrong Product',
        desc: 'Not the expected item',
        icon: HelpCircle,
        bgClass: 'bg-orange-50',
        borderClass: 'border-orange-500',
        textClass: 'text-orange-700'
    },
];

interface RtoInwardFormProps {
    scanResult: ScanLookupResult;
    rtoData: RtoScanMatchData;
    onSuccess: () => void;
    onCancel: () => void;
}

function RtoInwardForm({ scanResult, rtoData, onSuccess, onCancel }: RtoInwardFormProps) {
    const queryClient = useQueryClient();
    const [selectedCondition, setSelectedCondition] = useState<RtoCondition | null>(null);
    const [notes, setNotes] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Server function hook
    const rtoInwardLineFn = useServerFn(rtoInwardLine);

    const rtoInwardMutation = useMutation({
        mutationFn: async () => {
            if (!selectedCondition) throw new Error('Please select a condition');
            const result = await rtoInwardLineFn({
                data: {
                    lineId: rtoData.lineId,
                    condition: selectedCondition,
                    notes: notes || undefined,
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to process RTO inward');
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
            onSuccess();
        },
        onError: (err: Error) => {
            setError(err.message || 'Failed to process RTO inward');
        },
    });

    const getButtonConfig = () => {
        switch (selectedCondition) {
            case 'unopened':
            case 'good':
                return {
                    text: 'Receive - Add to Stock',
                    className: 'bg-green-600 hover:bg-green-700 text-white'
                };
            case 'damaged':
                return {
                    text: 'Receive - Write Off',
                    className: 'bg-red-600 hover:bg-red-700 text-white'
                };
            case 'wrong_product':
                return {
                    text: 'Flag for Investigation',
                    className: 'bg-orange-600 hover:bg-orange-700 text-white'
                };
            default:
                return {
                    text: 'Select a condition',
                    className: 'bg-gray-400 text-white cursor-not-allowed'
                };
        }
    };

    const buttonConfig = getButtonConfig();
    const isAtWarehouse = rtoData.trackingStatus === 'rto_delivered';

    // Calculate progress - orderLines includes all lines except current
    const otherLines = rtoData.orderLines.filter(l => !l.isCurrentLine);
    const processedCount = otherLines.filter(l => l.rtoCondition !== null).length;
    const totalLines = rtoData.orderLines.length;

    return (
        <div className="space-y-4">
            {/* Error Message */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm text-red-800">{error}</p>
                        <button
                            onClick={() => setError(null)}
                            className="text-xs text-red-600 hover:text-red-800 mt-1"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            {/* RTO Order Header */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                    <div>
                        <h4 className="font-semibold text-purple-900">
                            RTO ORDER: {rtoData.orderNumber}
                        </h4>
                        <p className="text-sm text-purple-700">
                            Customer: {rtoData.customerName}
                        </p>
                    </div>
                    {isAtWarehouse && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded flex items-center gap-1">
                            <Check size={12} /> At Warehouse
                        </span>
                    )}
                </div>
            </div>

            {/* Order Progress - Show if there are multiple lines */}
            {totalLines > 1 && (
                <div className="bg-gray-50 border rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                        ORDER PROGRESS: {processedCount}/{totalLines} items processed
                    </p>
                    <div className="space-y-1 text-xs">
                        {otherLines.map((line, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                {line.rtoCondition ? (
                                    <Check size={12} className="text-green-600" />
                                ) : (
                                    <span className="w-3 h-3 rounded-full border-2 border-gray-300" />
                                )}
                                <span className="font-mono">{line.skuCode}</span>
                                <span className="text-gray-400">x{line.qty}</span>
                                {line.rtoCondition && (
                                    <span className="text-gray-500">({line.rtoCondition})</span>
                                )}
                            </div>
                        ))}
                        {/* Current line indicator */}
                        <div className="flex items-center gap-2 font-medium text-purple-700">
                            <ChevronRight size={12} />
                            <span className="font-mono">{scanResult.sku.skuCode}</span>
                            <span className="text-gray-400">x{rtoData.qty}</span>
                            <span className="text-purple-500">CURRENT</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Current Item */}
            <div className="bg-white border-2 border-purple-200 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">CURRENT ITEM</p>
                <div className="flex items-center gap-3">
                    {scanResult.sku.imageUrl ? (
                        <img
                            src={getOptimizedImageUrl(scanResult.sku.imageUrl, 'sm') || scanResult.sku.imageUrl}
                            alt={scanResult.sku.productName}
                            className="w-12 h-12 object-cover rounded"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center">
                            <PackageOpen size={20} className="text-gray-400" />
                        </div>
                    )}
                    <div>
                        <p className="font-mono font-semibold">{scanResult.sku.skuCode}</p>
                        <p className="text-sm text-gray-600">
                            {scanResult.sku.productName} - {scanResult.sku.colorName} / {scanResult.sku.size}
                        </p>
                        <p className="text-xs text-gray-500">Qty: {rtoData.qty}</p>
                    </div>
                </div>
            </div>

            {/* Condition Selection - 2x2 grid */}
            <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                    Item Condition
                </label>
                <div className="grid grid-cols-2 gap-2">
                    {RTO_CONDITIONS.map((cond) => {
                        const Icon = cond.icon;
                        const isSelected = selectedCondition === cond.value;
                        return (
                            <label
                                key={cond.value}
                                className={`flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                    isSelected
                                        ? `${cond.borderClass} ${cond.bgClass}`
                                        : 'border-gray-200 hover:border-gray-300'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="rtoCondition"
                                    value={cond.value}
                                    checked={isSelected}
                                    onChange={(e) => setSelectedCondition(e.target.value as RtoCondition)}
                                    className="mt-1"
                                />
                                <div>
                                    <p className={`font-medium text-sm flex items-center gap-1 ${isSelected ? cond.textClass : 'text-gray-700'}`}>
                                        <Icon size={14} />
                                        {cond.label}
                                    </p>
                                    <p className="text-xs text-gray-500">{cond.desc}</p>
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>

            {/* Notes */}
            <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                    Notes (optional)
                </label>
                <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional notes about item condition..."
                    className="input w-full"
                />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
                <button
                    onClick={onCancel}
                    className="btn bg-gray-200 hover:bg-gray-300 text-gray-700 flex-1"
                >
                    Cancel
                </button>
                <button
                    onClick={() => rtoInwardMutation.mutate()}
                    disabled={!selectedCondition || rtoInwardMutation.isPending}
                    className={`btn flex-1 flex items-center justify-center gap-2 ${buttonConfig.className}`}
                >
                    {rtoInwardMutation.isPending ? (
                        <>
                            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                            Processing...
                        </>
                    ) : (
                        buttonConfig.text
                    )}
                </button>
            </div>
        </div>
    );
}

export default function RtoInward({ onSuccess: _onSuccess, onError: _onError }: RtoInwardProps) {
    const [scanCode, setScanCode] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
    const [rtoMatch, setRtoMatch] = useState<RtoScanMatchData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Server function hook
    const scanLookupFn = useServerFn(scanLookup);

    // Auto-focus input on mount and after operations
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Clear success message after 4 seconds
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    // Clear error message after 5 seconds
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    // Handle queue item selection - auto-scan the SKU
    const handleQueueItemSelect = (skuCode: string) => {
        setScanCode(skuCode);
        setTimeout(() => {
            inputRef.current?.focus();
            handleScanWithCode(skuCode);
        }, 0);
    };

    // Scan with a specific code
    const handleScanWithCode = async (code: string) => {
        if (!code.trim()) return;

        setIsSearching(true);
        setError(null);
        setScanResult(null);
        setRtoMatch(null);

        try {
            const result = await scanLookupFn({ data: { code: code.trim() } });
            setScanResult(result);

            const rtoMatchItem = result.matches.find(m => m.source === 'rto');
            if (!rtoMatchItem) {
                setError('No matching RTO order for this SKU');
                setScanCode('');
                inputRef.current?.focus();
                return;
            }

            setRtoMatch(rtoMatchItem.data as RtoScanMatchData);
            setScanCode('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to lookup SKU');
        } finally {
            setIsSearching(false);
            inputRef.current?.focus();
        }
    };

    const handleScan = async () => {
        if (!scanCode.trim()) return;
        await handleScanWithCode(scanCode.trim());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    const handleSuccess = () => {
        setSuccessMessage('RTO item processed successfully');
        setScanCode('');
        setScanResult(null);
        setRtoMatch(null);
        inputRef.current?.focus();
    };

    const handleCancel = () => {
        setScanCode('');
        setScanResult(null);
        setRtoMatch(null);
        setError(null);
        inputRef.current?.focus();
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

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                        <AlertTriangle size={20} />
                        <span>{error}</span>
                    </div>
                )}

                {/* Scan Input */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-2">
                        <Truck size={20} className="text-purple-600" />
                        <h2 className="font-semibold text-lg">Scan RTO Item</h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-lg">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                ref={inputRef}
                                type="text"
                                value={scanCode}
                                onChange={(e) => setScanCode(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Scan or type SKU code..."
                                className="input pl-10 w-full text-lg"
                                disabled={isSearching}
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={handleScan}
                            disabled={!scanCode.trim() || isSearching}
                            className="btn btn-primary"
                        >
                            {isSearching ? 'Searching...' : 'Lookup'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        Scan SKU to find matching RTO order for line-by-line processing
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column - Pending Queue */}
                    <div className="lg:col-span-1">
                        <PendingQueuePanel
                            source="rto"
                            onSelectItem={handleQueueItemSelect}
                        />

                        {/* Help Text - Show when idle and no queue */}
                        {!rtoMatch && (
                            <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 mt-4">
                                <h3 className="font-medium text-purple-900 mb-2">RTO Processing</h3>
                                <ul className="text-sm text-purple-700 space-y-1">
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">1.</span>
                                        Scan SKU barcode or click from queue
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">2.</span>
                                        Inspect item and select condition
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-400">3.</span>
                                        Good items → stock, damaged → write-off
                                    </li>
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Middle Column - RTO Form */}
                    <div className="lg:col-span-1">
                        {scanResult && rtoMatch && (
                            <div className="card border-2 border-purple-200 bg-purple-50/30">
                                <RtoInwardForm
                                    scanResult={scanResult}
                                    rtoData={rtoMatch}
                                    onSuccess={handleSuccess}
                                    onCancel={handleCancel}
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Column - Recent Inwards */}
                    <div className="lg:col-span-1">
                        <RecentInwardsTable
                            source="rto"
                            title="Recent RTO Inwards"
                            onSuccess={setSuccessMessage}
                            onError={setError}
                        />
                    </div>
                </div>
        </div>
    );
}
