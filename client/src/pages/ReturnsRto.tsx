/**
 * Returns & RTO Inward Page
 *
 * Shows pending returns and RTO orders that need processing.
 * The "queue" below shows items in the repacking queue (awaiting QC/inspection).
 *
 * Workflow:
 * 1. Returns/RTO arrive at warehouse
 * 2. User scans item → looks up matching return/RTO order
 * 3. Item goes through QC → added to repacking queue
 * 4. QC decision: Ready for stock OR Write-off
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, repackingApi } from '../services/api';
import {
    Search,
    PackageX,
    Check,
    AlertTriangle,
    Clock,
    Package,
    RotateCcw,
    Truck,
    RefreshCw,
    X,
    Plus,
} from 'lucide-react';
import type { ScanLookupResult, PendingQueueResponse, QueuePanelItem } from '../types';

// QC decision options for repacking items
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

// RTO condition options when processing RTO line
const RTO_CONDITIONS = [
    { value: 'good', label: 'Good', description: 'Item is in sellable condition' },
    { value: 'unopened', label: 'Unopened', description: 'Package was never opened' },
    { value: 'damaged', label: 'Damaged', description: 'Item is damaged (will be written off)' },
    { value: 'wrong_product', label: 'Wrong Product', description: 'Wrong item returned (will be written off)' },
];

type TabType = 'repacking' | 'returns' | 'rto';

export default function ReturnsRto() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // State
    const [scanInput, setScanInput] = useState('');
    const [scanFeedback, setScanFeedback] = useState<{
        type: 'success' | 'error' | 'info';
        message: string;
    } | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('repacking');

    // Scan result state (for RTO/Return processing)
    const [scanResult, setScanResult] = useState<ScanLookupResult | null>(null);
    const [matchedSource, setMatchedSource] = useState<{
        type: 'rto' | 'return' | 'repacking';
        data: any;
    } | null>(null);

    // RTO processing state
    const [rtoCondition, setRtoCondition] = useState('good');
    const [rtoNotes, setRtoNotes] = useState('');

    // QC processing state (for repacking items)
    const [qcDecision, setQcDecision] = useState<'ready' | 'write_off'>('ready');
    const [writeOffReason, setWriteOffReason] = useState('defective');
    const [qcNotes, setQcNotes] = useState('');

    // Pagination
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchFilter, setSearchFilter] = useState('');

    // Auto-focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Auto-clear feedback after 4 seconds
    useEffect(() => {
        if (scanFeedback) {
            const timer = setTimeout(() => setScanFeedback(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [scanFeedback]);

    // Fetch pending counts for tabs
    const { data: pendingSources } = useQuery({
        queryKey: ['pending-sources'],
        queryFn: async () => {
            const res = await inventoryApi.getPendingSources();
            return res.data;
        },
        refetchInterval: 30000,
    });

    // Fetch queue data based on active tab
    const { data: queueData, isLoading: isLoadingQueue } = useQuery<PendingQueueResponse>({
        queryKey: ['pendingQueue', activeTab],
        queryFn: async () => {
            const res = await inventoryApi.getPendingQueue(activeTab, { limit: 200 });
            return res.data;
        },
        refetchInterval: 15000,
    });

    // Filter and paginate queue items
    const filteredItems = useMemo(() => {
        if (!queueData?.items) return [];
        if (!searchFilter.trim()) return queueData.items;

        const search = searchFilter.toLowerCase();
        return queueData.items.filter(item =>
            item.skuCode.toLowerCase().includes(search) ||
            item.productName.toLowerCase().includes(search) ||
            item.contextValue?.toLowerCase().includes(search) ||
            item.customerName?.toLowerCase().includes(search)
        );
    }, [queueData?.items, searchFilter]);

    const totalPages = Math.ceil(filteredItems.length / pageSize);
    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    // Clear scan result
    const clearScan = () => {
        setScanResult(null);
        setMatchedSource(null);
        setRtoCondition('good');
        setRtoNotes('');
        setQcDecision('ready');
        setWriteOffReason('defective');
        setQcNotes('');
        inputRef.current?.focus();
    };

    // Handle scan lookup
    const handleScan = async () => {
        const code = scanInput.trim();
        if (!code || isScanning) return;

        setIsScanning(true);
        setScanFeedback(null);
        setScanResult(null);
        setMatchedSource(null);

        try {
            const res = await inventoryApi.scanLookup(code);
            const result = res.data as ScanLookupResult;

            // Priority: repacking > return > rto
            const repackMatch = result.matches.find(m => m.source === 'repacking');
            const returnMatch = result.matches.find(m => m.source === 'return');
            const rtoMatch = result.matches.find(m => m.source === 'rto');

            if (repackMatch) {
                setScanResult(result);
                setMatchedSource({ type: 'repacking', data: repackMatch.data });
                setActiveTab('repacking');
            } else if (returnMatch) {
                setScanResult(result);
                setMatchedSource({ type: 'return', data: returnMatch.data });
                setActiveTab('returns');
            } else if (rtoMatch) {
                setScanResult(result);
                setMatchedSource({ type: 'rto', data: rtoMatch.data });
                setActiveTab('rto');
            } else {
                setScanFeedback({
                    type: 'info',
                    message: `${result.sku.productName} - No pending return/RTO found for this SKU`,
                });
            }

            setScanInput('');
        } catch (error: any) {
            setScanFeedback({
                type: 'error',
                message: error.response?.data?.error || 'SKU not found',
            });
            setScanInput('');
        } finally {
            setIsScanning(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    // Handle queue item click - auto-scan
    const handleQueueItemClick = (item: QueuePanelItem) => {
        setScanInput(item.skuCode);
        setTimeout(() => handleScan(), 0);
    };

    // RTO inward mutation
    const rtoInwardMutation = useMutation({
        mutationFn: async () => {
            if (!matchedSource || matchedSource.type !== 'rto') {
                throw new Error('No RTO order selected');
            }
            return inventoryApi.rtoInwardLine({
                lineId: matchedSource.data.lineId,
                condition: rtoCondition,
                notes: rtoNotes || undefined,
            });
        },
        onSuccess: (res) => {
            const data = res.data;
            queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-balance'] });

            const isWriteOff = rtoCondition === 'damaged' || rtoCondition === 'wrong_product';
            setScanFeedback({
                type: 'success',
                message: isWriteOff
                    ? `RTO written off as ${rtoCondition}`
                    : `RTO processed - ${data.line?.qty || 1} unit(s) added to inventory`,
            });
            clearScan();
        },
        onError: (error: any) => {
            setScanFeedback({
                type: 'error',
                message: error.response?.data?.error || 'Failed to process RTO',
            });
        },
    });

    // Repacking QC mutation
    const repackingMutation = useMutation({
        mutationFn: async () => {
            if (!matchedSource || matchedSource.type !== 'repacking') {
                throw new Error('No QC item selected');
            }
            return repackingApi.process({
                itemId: matchedSource.data.queueItemId,
                action: qcDecision,
                writeOffReason: qcDecision === 'write_off' ? writeOffReason : undefined,
                notes: qcNotes || undefined,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-balance'] });

            setScanFeedback({
                type: 'success',
                message: qcDecision === 'ready'
                    ? `${scanResult?.sku.skuCode} added to stock`
                    : `${scanResult?.sku.skuCode} written off`,
            });
            clearScan();
        },
        onError: (error: any) => {
            setScanFeedback({
                type: 'error',
                message: error.response?.data?.error || 'Failed to process item',
            });
        },
    });

    // Get urgency styling for RTO items
    const getUrgencyBadge = (item: QueuePanelItem) => {
        if (!item.daysInRto) return null;
        if (item.daysInRto > 14) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    <AlertTriangle size={12} />
                    {item.daysInRto}d
                </span>
            );
        }
        if (item.daysInRto > 7) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                    <Clock size={12} />
                    {item.daysInRto}d
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                <Clock size={12} />
                {item.daysInRto}d
            </span>
        );
    };

    // Condition badge helper
    const getConditionBadge = (condition: string) => {
        const colors: Record<string, string> = {
            good: 'bg-green-100 text-green-700',
            unused: 'bg-green-100 text-green-700',
            used: 'bg-yellow-100 text-yellow-700',
            damaged: 'bg-red-100 text-red-700',
            wrong_product: 'bg-red-100 text-red-700',
        };
        return (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[condition] || 'bg-gray-100 text-gray-600'}`}>
                {condition}
            </span>
        );
    };

    const counts = pendingSources?.counts || { repacking: 0, returns: 0, rto: 0, rtoUrgent: 0 };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <PackageX size={24} className="text-orange-600" />
                            <h1 className="text-xl font-semibold">Returns & RTO Processing</h1>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                            <span className="text-gray-600">
                                Repacking: <span className="font-semibold text-green-600">{counts.repacking}</span>
                            </span>
                            <span className="text-gray-600">
                                Returns: <span className="font-semibold text-orange-600">{counts.returns}</span>
                            </span>
                            <span className="text-gray-600">
                                RTO: <span className="font-semibold text-purple-600">{counts.rto}</span>
                                {counts.rtoUrgent > 0 && (
                                    <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs font-medium">
                                        {counts.rtoUrgent} urgent
                                    </span>
                                )}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 space-y-6">
                {/* Scan Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold mb-4">Scan Item</h2>

                    {/* Feedback */}
                    {scanFeedback && (
                        <div
                            className={`mb-4 px-4 py-3 rounded-lg border flex items-center gap-2 ${
                                scanFeedback.type === 'success'
                                    ? 'bg-green-50 border-green-200 text-green-800'
                                    : scanFeedback.type === 'error'
                                    ? 'bg-red-50 border-red-200 text-red-800'
                                    : 'bg-blue-50 border-blue-200 text-blue-800'
                            }`}
                        >
                            {scanFeedback.type === 'success' ? (
                                <Check size={20} />
                            ) : scanFeedback.type === 'error' ? (
                                <AlertTriangle size={20} />
                            ) : (
                                <Package size={20} />
                            )}
                            <span className="font-medium">{scanFeedback.message}</span>
                        </div>
                    )}

                    {/* Scan Input */}
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                            <input
                                ref={inputRef}
                                type="text"
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Scan barcode or enter SKU code..."
                                className="w-full pl-14 pr-4 py-4 text-xl border-2 border-gray-300 rounded-lg focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:bg-gray-50"
                                disabled={isScanning}
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={handleScan}
                            disabled={!scanInput.trim() || isScanning}
                            className="px-6 py-4 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            {isScanning ? 'Looking up...' : 'Lookup'}
                        </button>
                    </div>

                    <p className="text-sm text-gray-500 mt-2">
                        Scan to find matching return, RTO, or repacking queue item
                    </p>
                </div>

                {/* Scan Result - Processing Form */}
                {scanResult && matchedSource && (
                    <div className="bg-white rounded-lg shadow-sm border-2 border-orange-200 p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-4">
                                {/* Product Image */}
                                <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden">
                                    {scanResult.sku.imageUrl ? (
                                        <img src={scanResult.sku.imageUrl} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                                            <Package size={24} />
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold">{scanResult.sku.productName}</h3>
                                    <p className="text-gray-600">{scanResult.sku.colorName} / {scanResult.sku.size}</p>
                                    <p className="font-mono text-sm text-gray-500">{scanResult.sku.skuCode}</p>
                                </div>
                            </div>
                            <button onClick={clearScan} className="text-gray-400 hover:text-gray-600">
                                <X size={24} />
                            </button>
                        </div>

                        {/* Source Info Badge */}
                        <div className={`rounded-lg p-4 mb-4 ${
                            matchedSource.type === 'rto' ? 'bg-purple-50 border border-purple-200' :
                            matchedSource.type === 'return' ? 'bg-orange-50 border border-orange-200' :
                            'bg-green-50 border border-green-200'
                        }`}>
                            <div className="flex items-center gap-2 mb-2">
                                {matchedSource.type === 'rto' && <Truck size={18} className="text-purple-600" />}
                                {matchedSource.type === 'return' && <RotateCcw size={18} className="text-orange-600" />}
                                {matchedSource.type === 'repacking' && <RefreshCw size={18} className="text-green-600" />}
                                <span className="font-medium capitalize">{matchedSource.type === 'repacking' ? 'QC Queue Item' : `${matchedSource.type.toUpperCase()} Order`}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                {matchedSource.type === 'rto' && (
                                    <>
                                        <div>Order: <span className="font-medium">{matchedSource.data.orderNumber}</span></div>
                                        <div>Customer: <span className="font-medium">{matchedSource.data.customerName}</span></div>
                                        <div>Qty: <span className="font-medium">{matchedSource.data.qty}</span></div>
                                        {matchedSource.data.atWarehouse && (
                                            <div><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">At Warehouse</span></div>
                                        )}
                                    </>
                                )}
                                {matchedSource.type === 'return' && (
                                    <>
                                        <div>Request: <span className="font-medium">{matchedSource.data.requestNumber}</span></div>
                                        <div>Reason: <span className="font-medium">{matchedSource.data.reasonCategory}</span></div>
                                        <div>Qty: <span className="font-medium">{matchedSource.data.qty}</span></div>
                                    </>
                                )}
                                {matchedSource.type === 'repacking' && (
                                    <>
                                        <div>Condition: {getConditionBadge(matchedSource.data.condition)}</div>
                                        <div>Qty: <span className="font-medium">{matchedSource.data.qty}</span></div>
                                        {matchedSource.data.returnRequestNumber && (
                                            <div className="col-span-2">From: <span className="font-mono text-xs">{matchedSource.data.returnRequestNumber}</span></div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* RTO Processing Form */}
                        {matchedSource.type === 'rto' && (
                            <>
                                <div className="mb-4">
                                    <label className="text-sm font-medium text-gray-700 block mb-2">Condition</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {RTO_CONDITIONS.map((c) => (
                                            <label
                                                key={c.value}
                                                className={`flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                                    rtoCondition === c.value
                                                        ? c.value === 'damaged' || c.value === 'wrong_product'
                                                            ? 'border-red-500 bg-red-50'
                                                            : 'border-green-500 bg-green-50'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="rtoCondition"
                                                    value={c.value}
                                                    checked={rtoCondition === c.value}
                                                    onChange={(e) => setRtoCondition(e.target.value)}
                                                    className="mt-0.5"
                                                />
                                                <div>
                                                    <p className="font-medium text-sm">{c.label}</p>
                                                    <p className="text-xs text-gray-500">{c.description}</p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <label className="text-sm font-medium text-gray-700 block mb-1">Notes (optional)</label>
                                    <input
                                        type="text"
                                        value={rtoNotes}
                                        onChange={(e) => setRtoNotes(e.target.value)}
                                        placeholder="Additional notes..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-orange-500"
                                    />
                                </div>

                                <button
                                    onClick={() => rtoInwardMutation.mutate()}
                                    disabled={rtoInwardMutation.isPending}
                                    className={`w-full py-3 font-medium rounded-lg flex items-center justify-center gap-2 ${
                                        rtoCondition === 'damaged' || rtoCondition === 'wrong_product'
                                            ? 'bg-red-600 hover:bg-red-700 text-white'
                                            : 'bg-green-600 hover:bg-green-700 text-white'
                                    } disabled:opacity-50`}
                                >
                                    {rtoCondition === 'damaged' || rtoCondition === 'wrong_product' ? (
                                        <>
                                            <X size={18} />
                                            {rtoInwardMutation.isPending ? 'Processing...' : 'Write Off'}
                                        </>
                                    ) : (
                                        <>
                                            <Plus size={18} />
                                            {rtoInwardMutation.isPending ? 'Processing...' : 'Add to Inventory'}
                                        </>
                                    )}
                                </button>
                            </>
                        )}

                        {/* QC Processing Form (Repacking) */}
                        {matchedSource.type === 'repacking' && (
                            <>
                                <div className="mb-4">
                                    <label className="text-sm font-medium text-gray-700 block mb-2">QC Decision</label>
                                    <div className="space-y-2">
                                        {QC_DECISIONS.map((d) => (
                                            <label
                                                key={d.value}
                                                className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                                    qcDecision === d.value
                                                        ? d.color === 'green'
                                                            ? 'border-green-500 bg-green-50'
                                                            : 'border-red-500 bg-red-50'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="qcDecision"
                                                    value={d.value}
                                                    checked={qcDecision === d.value}
                                                    onChange={(e) => setQcDecision(e.target.value as 'ready' | 'write_off')}
                                                    className="mt-1"
                                                />
                                                <div>
                                                    <p className="font-medium text-sm">{d.label}</p>
                                                    <p className="text-xs text-gray-500">{d.description}</p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {qcDecision === 'write_off' && (
                                    <div className="mb-4">
                                        <label className="text-sm font-medium text-gray-700 block mb-1">Write-off Reason</label>
                                        <select
                                            value={writeOffReason}
                                            onChange={(e) => setWriteOffReason(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-orange-500"
                                        >
                                            {WRITE_OFF_REASONS.map((r) => (
                                                <option key={r.value} value={r.value}>{r.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="mb-4">
                                    <label className="text-sm font-medium text-gray-700 block mb-1">Notes (optional)</label>
                                    <input
                                        type="text"
                                        value={qcNotes}
                                        onChange={(e) => setQcNotes(e.target.value)}
                                        placeholder="QC notes..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-orange-500"
                                    />
                                </div>

                                <button
                                    onClick={() => repackingMutation.mutate()}
                                    disabled={repackingMutation.isPending}
                                    className={`w-full py-3 font-medium rounded-lg flex items-center justify-center gap-2 ${
                                        qcDecision === 'write_off'
                                            ? 'bg-red-600 hover:bg-red-700 text-white'
                                            : 'bg-green-600 hover:bg-green-700 text-white'
                                    } disabled:opacity-50`}
                                >
                                    {qcDecision === 'write_off' ? (
                                        <>
                                            <X size={18} />
                                            {repackingMutation.isPending ? 'Processing...' : 'Write Off'}
                                        </>
                                    ) : (
                                        <>
                                            <Plus size={18} />
                                            {repackingMutation.isPending ? 'Processing...' : 'Add to Stock'}
                                        </>
                                    )}
                                </button>
                            </>
                        )}

                        {/* Return handling - redirect info */}
                        {matchedSource.type === 'return' && (
                            <div className="text-center py-4">
                                <p className="text-gray-600 mb-2">Return processing requires inspection.</p>
                                <p className="text-sm text-gray-500">
                                    After inspection, item will be added to the QC queue for final processing.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Queue Tabs */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    {/* Tab Headers */}
                    <div className="border-b border-gray-200">
                        <div className="flex">
                            <button
                                onClick={() => { setActiveTab('repacking'); setCurrentPage(1); }}
                                className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'repacking'
                                        ? 'border-green-500 text-green-600 bg-green-50'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <RefreshCw size={16} className="inline mr-2" />
                                Repacking Queue ({counts.repacking})
                            </button>
                            <button
                                onClick={() => { setActiveTab('returns'); setCurrentPage(1); }}
                                className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'returns'
                                        ? 'border-orange-500 text-orange-600 bg-orange-50'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <RotateCcw size={16} className="inline mr-2" />
                                Pending Returns ({counts.returns})
                            </button>
                            <button
                                onClick={() => { setActiveTab('rto'); setCurrentPage(1); }}
                                className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'rto'
                                        ? 'border-purple-500 text-purple-600 bg-purple-50'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <Truck size={16} className="inline mr-2" />
                                Pending RTO ({counts.rto})
                                {counts.rtoUrgent > 0 && (
                                    <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs">
                                        {counts.rtoUrgent}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Search & Controls */}
                    <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input
                                type="text"
                                value={searchFilter}
                                onChange={(e) => { setSearchFilter(e.target.value); setCurrentPage(1); }}
                                placeholder="Search SKU, product, order..."
                                className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-orange-500 w-64"
                            />
                        </div>
                        <select
                            value={pageSize}
                            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                            className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                        >
                            <option value={25}>25 per page</option>
                            <option value={50}>50 per page</option>
                            <option value={100}>100 per page</option>
                        </select>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        {isLoadingQueue ? (
                            <div className="flex justify-center py-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                            </div>
                        ) : paginatedItems.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <Package size={48} className="mx-auto mb-3 text-gray-300" />
                                <p>No items in queue</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium text-gray-600">SKU Code</th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-600">Color / Size</th>
                                        <th className="px-4 py-3 text-center font-medium text-gray-600">Qty</th>
                                        <th className="px-4 py-3 text-left font-medium text-gray-600">
                                            {activeTab === 'repacking' ? 'Condition' : activeTab === 'rto' ? 'Order' : 'Request'}
                                        </th>
                                        {activeTab === 'rto' && (
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                                        )}
                                        <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {paginatedItems.map((item) => (
                                        <tr key={item.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 font-mono text-xs">{item.skuCode}</td>
                                            <td className="px-4 py-3">{item.productName}</td>
                                            <td className="px-4 py-3 text-gray-600">{item.colorName} / {item.size}</td>
                                            <td className="px-4 py-3 text-center font-semibold">{item.qty}</td>
                                            <td className="px-4 py-3">
                                                {activeTab === 'repacking' && item.condition && getConditionBadge(item.condition)}
                                                {activeTab === 'rto' && <span className="font-medium">{item.orderNumber}</span>}
                                                {activeTab === 'returns' && <span className="font-mono text-xs">{item.requestNumber}</span>}
                                            </td>
                                            {activeTab === 'rto' && (
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        {item.atWarehouse && (
                                                            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">At WH</span>
                                                        )}
                                                        {getUrgencyBadge(item)}
                                                    </div>
                                                </td>
                                            )}
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    onClick={() => handleQueueItemClick(item)}
                                                    className="px-3 py-1 text-xs font-medium bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                                                >
                                                    Process
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between p-4 border-t border-gray-200">
                            <div className="text-sm text-gray-600">
                                Showing {(currentPage - 1) * pageSize + 1} to{' '}
                                {Math.min(currentPage * pageSize, filteredItems.length)} of{' '}
                                {filteredItems.length} items
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Previous
                                </button>
                                <span className="text-sm text-gray-600">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
