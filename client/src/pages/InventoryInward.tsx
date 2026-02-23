/**
 * Inventory Inward Page - Redesigned with Scan-First Workflow
 *
 * Flow:
 * 1. Scan SKU -> instant inward as "received" (unallocated)
 * 2. Recent inwards table shows all today's activity
 * 3. User can assign source later (Production/Repacking/Adjustment)
 *
 * Speed optimized for warehouse scanning operations.
 *
 * Migrated to Server Functions (Phase 4 TanStack Start migration)
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getRecentInwards, type RecentInwardItem } from '@/server/functions/inventory';
import {
    instantInwardBySkuCode,
    getTransactionMatches,
    allocateTransactionFn,
    updateTransactionTailor,
    type TransactionMatch,
    type TransactionMatchesResult,
} from '@/server/functions/inventoryMutations';
import { getProductionTailors, type TailorRow } from '@/server/functions/production';
import {
    Package,
    Scan,
    Check,
    AlertTriangle,
    Factory,
    RefreshCw,
    Wrench,
    X,
    ExternalLink,
} from 'lucide-react';

// Source type icons and colors
const SOURCE_CONFIG = {
    received: {
        icon: Package,
        label: 'Received',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
    },
    production: {
        icon: Factory,
        label: 'Production',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
    },
    repacking: {
        icon: RefreshCw,
        label: 'Repacking',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
    },
    adjustment: {
        icon: Wrench,
        label: 'Adjustment',
        color: 'text-gray-600',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200',
    },
    rto: {
        icon: Package,
        label: 'RTO',
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200',
    },
    return: {
        icon: Package,
        label: 'Return',
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
    },
};

interface SuccessFlash {
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    newBalance: number;
}

/** Inline editable tailor cell with datalist suggestions */
function TailorCell({
    transactionId,
    currentValue,
    tailors,
}: {
    transactionId: string;
    currentValue: string | null;
    tailors: TailorRow[];
}) {
    const queryClient = useQueryClient();
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(currentValue || '');
    const inputRef = useRef<HTMLInputElement>(null);
    const updateTailorFn = useServerFn(updateTransactionTailor);

    const saveMutation = useMutation({
        mutationFn: async (tailorNumber: string | null) => {
            const result = await updateTailorFn({
                data: { transactionId, tailorNumber },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update tailor');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            setIsEditing(false);
        },
    });

    const handleSave = useCallback(() => {
        const trimmed = value.trim();
        const newValue = trimmed || null;
        if (newValue !== currentValue) {
            saveMutation.mutate(newValue);
        } else {
            setIsEditing(false);
        }
    }, [value, currentValue, saveMutation]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                setValue(currentValue || '');
                setIsEditing(false);
            }
        },
        [handleSave, currentValue]
    );

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    // Sync external value changes
    useEffect(() => {
        if (!isEditing) {
            setValue(currentValue || '');
        }
    }, [currentValue, isEditing]);

    const datalistId = `tailors-${transactionId}`;

    if (isEditing) {
        return (
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    list={datalistId}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    disabled={saveMutation.isPending}
                    className="w-full px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                    placeholder="Tailor name..."
                />
                <datalist id={datalistId}>
                    {tailors.map((t) => (
                        <option key={t.id} value={t.name} />
                    ))}
                </datalist>
                {saveMutation.isPending && (
                    <div className="absolute right-1 top-1/2 -translate-y-1/2">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <button
            onClick={() => setIsEditing(true)}
            className="text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors cursor-pointer w-full text-left"
            title="Click to edit tailor"
        >
            {currentValue || <span className="text-gray-400">Add</span>}
        </button>
    );
}

interface SourceAssignmentModalProps {
    transaction: RecentInwardItem;
    onClose: () => void;
    onSuccess: () => void;
}

function SourceAssignmentModal({ transaction, onClose, onSuccess }: SourceAssignmentModalProps) {
    const queryClient = useQueryClient();
    const [selectedType, setSelectedType] = useState<'production' | 'rto' | 'adjustment' | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [rtoCondition, setRtoCondition] = useState<string>('good');

    // Server Functions
    const getTransactionMatchesFn = useServerFn(getTransactionMatches);
    const allocateTransactionMutation = useServerFn(allocateTransactionFn);

    // Fetch available matches
    const { data: matchData, isLoading } = useQuery({
        queryKey: ['transaction-matches', transaction.id],
        queryFn: async () => {
            const result = await getTransactionMatchesFn({ data: { transactionId: transaction.id } });
            return result as TransactionMatchesResult;
        },
    });

    // Allocate mutation
    const allocateMutation = useMutation({
        mutationFn: async () => {
            if (!selectedType) throw new Error('No allocation type selected');
            const result = await allocateTransactionMutation({
                data: {
                    transactionId: transaction.id,
                    allocationType: selectedType,
                    allocationId: selectedId || undefined,
                    rtoCondition: selectedType === 'rto' ? (rtoCondition as 'good' | 'unopened' | 'damaged' | 'wrong_product') : undefined,
                },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to allocate transaction');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            onSuccess();
            onClose();
        },
    });

    const productionMatches = matchData?.matches?.filter((m: TransactionMatch) => m.type === 'production') || [];
    const rtoMatches = matchData?.matches?.filter((m: TransactionMatch) => m.type === 'rto') || [];

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Assign Source</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {transaction.skuCode} - {transaction.productName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Current Allocation Info */}
                            {matchData?.isAllocated && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <p className="text-sm text-blue-800">
                                        <strong>Currently allocated:</strong> {matchData.currentAllocation?.type}
                                    </p>
                                    <p className="text-xs text-blue-600 mt-1">
                                        You can change the allocation by selecting a new source below.
                                    </p>
                                </div>
                            )}

                            {/* Source Type Selection */}
                            <div className="space-y-3">
                                {/* Keep as Adjustment */}
                                <button
                                    onClick={() => {
                                        setSelectedType('adjustment');
                                        setSelectedId(null);
                                    }}
                                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                                        selectedType === 'adjustment'
                                            ? 'border-gray-400 bg-gray-50'
                                            : 'border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Wrench size={20} className="text-gray-600" />
                                        <div>
                                            <div className="font-semibold text-gray-900">Keep as Adjustment</div>
                                            <div className="text-sm text-gray-600">Manual stock adjustment, no source link</div>
                                        </div>
                                    </div>
                                </button>

                                {/* Link to Production */}
                                {productionMatches.length > 0 && (
                                    <div
                                        className={`border-2 rounded-lg transition-all ${
                                            selectedType === 'production' ? 'border-blue-400' : 'border-gray-200'
                                        }`}
                                    >
                                        <button
                                            onClick={() => setSelectedType('production')}
                                            className="w-full text-left p-4 hover:bg-gray-50 transition-colors rounded-t-lg"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Factory size={20} className="text-blue-600" />
                                                <div>
                                                    <div className="font-semibold text-gray-900">
                                                        Link to Production Batch
                                                    </div>
                                                    <div className="text-sm text-gray-600">
                                                        {productionMatches.length} pending batch(es)
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                        {selectedType === 'production' && (
                                            <div className="border-t border-gray-200 p-4 space-y-2 bg-gray-50">
                                                {productionMatches.map((match: TransactionMatch) => (
                                                    <button
                                                        key={match.id}
                                                        onClick={() => setSelectedId(match.id)}
                                                        className={`w-full text-left p-3 rounded border transition-all ${
                                                            selectedId === match.id
                                                                ? 'border-blue-500 bg-blue-50'
                                                                : 'border-gray-200 bg-white hover:border-blue-300'
                                                        }`}
                                                    >
                                                        <div className="font-medium text-sm">{match.label}</div>
                                                        <div className="text-xs text-gray-600 mt-1">
                                                            {match.detail}
                                                            {match.pending && ` - ${match.pending} pending`}
                                                        </div>
                                                        {match.date && (
                                                            <div className="text-xs text-gray-500 mt-1">
                                                                {new Date(match.date as string).toLocaleDateString()}
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Link to RTO */}
                                {rtoMatches.length > 0 && (
                                    <div
                                        className={`border-2 rounded-lg transition-all ${
                                            selectedType === 'rto' ? 'border-purple-400' : 'border-gray-200'
                                        }`}
                                    >
                                        <button
                                            onClick={() => setSelectedType('rto')}
                                            className="w-full text-left p-4 hover:bg-gray-50 transition-colors rounded-t-lg"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Package size={20} className="text-purple-600" />
                                                <div>
                                                    <div className="font-semibold text-gray-900">Link to RTO Order</div>
                                                    <div className="text-sm text-gray-600">
                                                        {rtoMatches.length} pending RTO(s)
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                        {selectedType === 'rto' && (
                                            <div className="border-t border-gray-200 p-4 space-y-3 bg-gray-50">
                                                {/* RTO Condition Selector */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        Item Condition
                                                    </label>
                                                    <select
                                                        value={rtoCondition}
                                                        onChange={(e) => setRtoCondition(e.target.value)}
                                                        className="input w-full"
                                                    >
                                                        <option value="good">Good - Can resell</option>
                                                        <option value="unopened">Unopened</option>
                                                        <option value="damaged">Damaged</option>
                                                        <option value="wrong_product">Wrong Product</option>
                                                    </select>
                                                </div>

                                                {/* RTO Matches */}
                                                <div className="space-y-2">
                                                    {rtoMatches.map((match: TransactionMatch) => (
                                                        <button
                                                            key={match.id}
                                                            onClick={() => setSelectedId(match.id)}
                                                            className={`w-full text-left p-3 rounded border transition-all ${
                                                                selectedId === match.id
                                                                    ? 'border-purple-500 bg-purple-50'
                                                                    : 'border-gray-200 bg-white hover:border-purple-300'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <div className="font-medium text-sm">{match.label}</div>
                                                                    <div className="text-xs text-gray-600 mt-1">
                                                                        {match.detail}
                                                                    </div>
                                                                </div>
                                                                {match.atWarehouse && (
                                                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                                                                        At Warehouse
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* No matches available */}
                                {productionMatches.length === 0 && rtoMatches.length === 0 && (
                                    <div className="text-center py-6 text-gray-500">
                                        <Package size={40} className="mx-auto mb-2 text-gray-400" />
                                        <p className="text-sm">
                                            No pending production batches or RTOs for this SKU.
                                        </p>
                                        <p className="text-xs mt-1">You can keep it as an adjustment.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                    <button onClick={onClose} className="btn btn-secondary">
                        Cancel
                    </button>
                    <button
                        onClick={() => allocateMutation.mutate()}
                        disabled={!selectedType || allocateMutation.isPending || (selectedType !== 'adjustment' && !selectedId)}
                        className="btn btn-primary"
                    >
                        {allocateMutation.isPending ? 'Assigning...' : 'Assign Source'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function InventoryInward() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // State
    const [scanInput, setScanInput] = useState('');
    const [successFlash, setSuccessFlash] = useState<SuccessFlash | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [selectedTransaction, setSelectedTransaction] = useState<RecentInwardItem | null>(null);

    // Server Functions
    const getRecentInwardsFn = useServerFn(getRecentInwards);
    const instantInwardFn = useServerFn(instantInwardBySkuCode);
    const getProductionTailorsFn = useServerFn(getProductionTailors);

    // Fetch tailors for suggestions (cached, rarely changes)
    const { data: tailors = [] } = useQuery<TailorRow[]>({
        queryKey: ['production', 'tailors'],
        queryFn: async () => getProductionTailorsFn({}),
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    // Focus input on mount and after operations
    useEffect(() => {
        inputRef.current?.focus();
    }, [successFlash, error]);

    // Auto-clear messages
    useEffect(() => {
        if (successFlash) {
            const timer = setTimeout(() => setSuccessFlash(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [successFlash]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    // Fetch recent inwards using Server Function
    const { data: recentInwards = [], isLoading } = useQuery<RecentInwardItem[]>({
        queryKey: ['recent-inwards', sourceFilter],
        queryFn: async () => {
            const result = await getRecentInwardsFn({
                data: {
                    limit: 100,
                    source: sourceFilter === 'all' ? undefined : sourceFilter as 'production' | 'returns' | 'rto' | 'repacking' | 'adjustments' | 'received' | 'adjustment',
                },
            });
            return result;
        },
        refetchInterval: 10000,
    });

    // Today's count
    const todayCount = useMemo(() => {
        const today = new Date().toDateString();
        return recentInwards
            .filter(i => new Date(i.createdAt).toDateString() === today)
            .reduce((sum, i) => sum + i.qty, 0);
    }, [recentInwards]);

    // Track in-flight mutation count for UI indicator
    const [inflightCount, setInflightCount] = useState(0);

    // Instant inward mutation using Server Function
    const instantInwardMutation = useMutation({
        mutationFn: async (skuCode: string) => {
            const result = await instantInwardFn({ data: { skuCode } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to inward SKU');
            }
            return result.data;
        },
        onMutate: () => {
            setInflightCount(c => c + 1);
        },
        onSuccess: (data) => {
            if (data) {
                setSuccessFlash({
                    skuCode: data.skuCode,
                    productName: data.productName,
                    colorName: data.colorName,
                    size: data.size,
                    qty: data.qty,
                    newBalance: data.newBalance,
                });
            }
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
        },
        onError: (err: Error) => {
            setError(err.message || 'Failed to inward SKU');
        },
        onSettled: () => {
            setInflightCount(c => c - 1);
        },
    });

    const handleScan = () => {
        const code = scanInput.trim();
        if (!code) return;

        // Clear input immediately — don't wait for mutation response
        setScanInput('');
        setError(null);
        instantInwardMutation.mutate(code);
        // Input stays enabled + focused — ready for next scan instantly
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    // Source counts for filter badges
    const sourceCounts = useMemo(() => {
        const counts: Record<string, number> = {
            all: recentInwards.length,
            received: 0,
            production: 0,
            repacking: 0,
            adjustment: 0,
            rto: 0,
            return: 0,
        };
        recentInwards.forEach((txn) => {
            const source = txn.source || 'adjustment';
            if (counts[source] !== undefined) {
                counts[source]++;
            }
        });
        return counts;
    }, [recentInwards]);

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10 shadow-sm">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Package className="text-blue-600" size={28} />
                            <div>
                                <h1 className="text-xl font-bold text-gray-900">Inventory Inward</h1>
                                <p className="text-sm text-gray-600">Scan to receive inventory instantly</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-gray-600">Today</div>
                            <div className="text-2xl font-bold text-blue-600">{todayCount}</div>
                            <div className="text-xs text-gray-500">items</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 space-y-6">
                {/* Success Flash */}
                {successFlash && (
                    <div className="bg-green-500 text-white rounded-xl shadow-lg p-6 animate-pulse">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="bg-white/20 rounded-full p-3">
                                    <Check size={32} className="text-white" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold">+{successFlash.qty} {successFlash.skuCode}</div>
                                    <div className="text-lg opacity-90">
                                        {successFlash.productName} - {successFlash.colorName} / {successFlash.size}
                                    </div>
                                    <div className="text-sm opacity-75 mt-1">
                                        New balance: {successFlash.newBalance} pcs
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div className="bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
                        <AlertTriangle size={20} />
                        <span className="font-medium">{error}</span>
                    </div>
                )}

                {/* Scan Input - Large and Prominent */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center gap-4">
                        <Scan className="text-blue-600 flex-shrink-0" size={32} />
                        <div className="flex-1">
                            <input
                                ref={inputRef}
                                type="text"
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Scan SKU barcode or enter code..."
                                className="input text-2xl font-mono w-full py-4"
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={handleScan}
                            disabled={!scanInput.trim()}
                            className="btn btn-primary text-lg px-8 py-4 h-auto"
                        >
                            {inflightCount > 0 ? `Scan (${inflightCount})` : 'Scan'}
                        </button>
                    </div>
                    <p className="text-sm text-gray-500 mt-3 flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full animate-pulse ${inflightCount > 0 ? 'bg-yellow-500' : 'bg-green-500'}`}></span>
                        {inflightCount > 0
                            ? `Processing ${inflightCount} scan${inflightCount > 1 ? 's' : ''}... Keep scanning.`
                            : 'Ready to scan. Items are instantly received and can be assigned to a source later.'}
                    </p>
                </div>

                {/* Recent Inwards Section */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                    {/* Filter Tabs */}
                    <div className="border-b border-gray-200 px-4 py-3">
                        <div className="flex items-center gap-2 overflow-x-auto">
                            {[
                                { key: 'all', label: 'All' },
                                { key: 'received', label: 'Received' },
                                { key: 'production', label: 'Production' },
                                { key: 'repacking', label: 'Repacking' },
                                { key: 'rto', label: 'RTO' },
                                { key: 'adjustment', label: 'Adjustment' },
                            ].map((filter) => (
                                <button
                                    key={filter.key}
                                    onClick={() => setSourceFilter(filter.key)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                                        sourceFilter === filter.key
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                >
                                    {filter.label}
                                    {sourceCounts[filter.key] > 0 && (
                                        <span className="ml-2 opacity-75">({sourceCounts[filter.key]})</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="p-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            </div>
                        ) : recentInwards.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <Package size={48} className="mx-auto mb-3 text-gray-400" />
                                <p className="text-lg font-medium">No recent inwards</p>
                                <p className="text-sm mt-1">Scan SKUs to start receiving inventory</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-700">Time</th>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-700">SKU</th>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-700">Product</th>
                                            <th className="px-3 py-3 text-center font-semibold text-gray-700">Qty</th>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-700">Source</th>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-700">Tailor</th>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-700">Notes</th>
                                            <th className="px-3 py-3 text-center font-semibold text-gray-700">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {recentInwards.map((txn) => {
                                            const sourceConfig = SOURCE_CONFIG[txn.source as keyof typeof SOURCE_CONFIG] || SOURCE_CONFIG.adjustment;
                                            const SourceIcon = sourceConfig.icon;
                                            const isToday = new Date(txn.createdAt).toDateString() === new Date().toDateString();

                                            return (
                                                <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                                                        {isToday
                                                            ? new Date(txn.createdAt).toLocaleTimeString('en-IN', {
                                                                  hour: '2-digit',
                                                                  minute: '2-digit',
                                                              })
                                                            : new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                                                  day: '2-digit',
                                                                  month: 'short',
                                                              })}
                                                    </td>
                                                    <td className="px-3 py-3 font-mono text-xs font-medium">
                                                        {txn.skuCode}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="text-gray-900 font-medium">{txn.productName}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {txn.colorName} / {txn.size}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className="text-green-600 font-bold">+{txn.qty}</span>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sourceConfig.bgColor} ${sourceConfig.color}`}>
                                                            <SourceIcon size={14} />
                                                            {sourceConfig.label}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 min-w-[120px]">
                                                        <TailorCell
                                                            transactionId={txn.id}
                                                            currentValue={txn.tailorNumber}
                                                            tailors={tailors}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[200px] truncate">
                                                        {txn.notes || '-'}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <button
                                                            onClick={() => setSelectedTransaction(txn)}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        >
                                                            {txn.isAllocated ? 'Change' : 'Assign'}
                                                            <ExternalLink size={12} />
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
            </div>

            {/* Source Assignment Modal */}
            {selectedTransaction && (
                <SourceAssignmentModal
                    transaction={selectedTransaction}
                    onClose={() => setSelectedTransaction(null)}
                    onSuccess={() => {
                        setSuccessFlash({
                            skuCode: selectedTransaction.skuCode,
                            productName: selectedTransaction.productName,
                            colorName: selectedTransaction.colorName,
                            size: selectedTransaction.size,
                            qty: selectedTransaction.qty,
                            newBalance: 0, // Not relevant for assignment
                        });
                    }}
                />
            )}
        </div>
    );
}
