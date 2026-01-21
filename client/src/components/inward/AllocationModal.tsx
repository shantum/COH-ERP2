/**
 * Allocation Modal Component
 * Allows users to allocate unallocated inward transactions to return/RTO orders
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getTransactionMatches, allocateTransactionFn } from '../../server/functions/inventoryMutations';
import { searchRtoOrders, getReturnsAll } from '../../server/functions/returns';
import { X, Search, Package, Truck, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import type { TransactionMatchesResult, TransactionMatch } from '../../server/functions/inventoryMutations';

interface AllocationMatch {
    type: 'rto' | 'production';
    id: string;
    label: string;
    detail: string;
    date?: string | null;
    orderId?: string;
}

interface RecentInward {
    id: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
}

interface AllocationModalProps {
    transaction: RecentInward;
    onClose: () => void;
    onSuccess: () => void;
}

export default function AllocationModal({
    transaction,
    onClose,
    onSuccess,
}: AllocationModalProps) {
    const queryClient = useQueryClient();
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMatch, setSelectedMatch] = useState<AllocationMatch | null>(null);
    const [rtoCondition, setRtoCondition] = useState<'good' | 'unopened' | 'damaged' | 'wrong_product'>('good');
    const [error, setError] = useState<string | null>(null);

    // Server functions
    const getTransactionMatchesFn = useServerFn(getTransactionMatches);
    const searchRtoOrdersFn = useServerFn(searchRtoOrders);
    const getReturnsAllFn = useServerFn(getReturnsAll);
    const allocateTransactionMutationFn = useServerFn(allocateTransactionFn);

    // Auto-focus search input
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    // Get suggested matches for this transaction
    const { data: matchesResult, isLoading: matchesLoading } = useQuery<TransactionMatchesResult>({
        queryKey: ['transaction-matches', transaction.id],
        queryFn: () => getTransactionMatchesFn({ data: { transactionId: transaction.id } }),
    });

    // Transform matches to the UI format
    const matches: AllocationMatch[] = (matchesResult?.matches || []).map((m: TransactionMatch) => ({
        type: m.type as 'rto' | 'production',
        id: m.id,
        label: m.label,
        detail: m.detail,
        date: typeof m.date === 'string' ? m.date : m.date instanceof Date ? m.date.toISOString() : null,
        orderId: m.orderId,
    }));

    // Search for orders/returns by order number or AWB
    const { data: searchResults, isLoading: searchLoading } = useQuery<AllocationMatch[]>({
        queryKey: ['allocation-search', searchQuery],
        queryFn: async () => {
            if (searchQuery.length < 3) return [];

            const results: AllocationMatch[] = [];

            // Search RTO orders
            try {
                const rtoRes = await searchRtoOrdersFn({ data: { search: searchQuery, limit: 5 } });
                const rtoOrders = rtoRes.orders || [];
                rtoOrders.forEach((order) => {
                    results.push({
                        type: 'rto',
                        id: order.id,
                        label: `RTO Order ${order.orderNumber}`,
                        detail: `${order.customerName || 'Unknown'} - AWB: ${order.awbNumber || 'N/A'}`,
                        date: order.rtoInitiatedAt || order.orderDate,
                        orderId: order.id,
                    });
                });
            } catch {
                // Ignore search errors
            }

            // Search return requests
            try {
                const returnsRes = await getReturnsAllFn();
                const returns = returnsRes || [];
                // Filter returns by search query
                const filteredReturns = returns.filter(ret =>
                    ret.requestNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (ret.customerName && ret.customerName.toLowerCase().includes(searchQuery.toLowerCase()))
                ).slice(0, 5);

                filteredReturns.forEach((ret) => {
                    results.push({
                        type: 'production', // Returns use 'production' type in backend
                        id: ret.id,
                        label: `Return ${ret.requestNumber}`,
                        detail: `${ret.customerName || 'Unknown'} - ${ret.status}`,
                        date: ret.createdAt,
                    });
                });
            } catch {
                // Ignore search errors
            }

            return results;
        },
        enabled: searchQuery.length >= 3,
    });

    // Combine matches and search results
    const allMatches = [
        ...(matches || []),
        ...(searchResults || []).filter(
            (sr) => !matches?.some((m) => m.id === sr.id && m.type === sr.type)
        ),
    ];

    // Allocate mutation
    const allocateMutation = useMutation({
        mutationFn: async () => {
            if (!selectedMatch) throw new Error('No match selected');

            const allocationType = selectedMatch.type === 'rto' ? 'rto' : 'production';
            const allocationId = allocationType === 'rto' ? selectedMatch.orderId : selectedMatch.id;

            const result = await allocateTransactionMutationFn({
                data: {
                    transactionId: transaction.id,
                    allocationType,
                    allocationId,
                    rtoCondition: allocationType === 'rto' ? rtoCondition : undefined,
                },
            });

            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to allocate transaction');
            }

            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['transaction-matches'] });
            onSuccess();
        },
        onError: (err: Error) => {
            setError(err.message || 'Failed to allocate transaction');
        },
    });

    const handleAllocate = () => {
        if (!selectedMatch) return;
        allocateMutation.mutate();
    };

    const getMatchIcon = (type: string) => {
        switch (type) {
            case 'rto':
                return <Truck size={16} className="text-purple-600" />;
            case 'production':
                return <RotateCcw size={16} className="text-orange-600" />;
            default:
                return <Package size={16} className="text-gray-600" />;
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">Allocate Item</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Link this inward to a return or RTO order
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {/* Transaction Details */}
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-orange-800 mb-2">Item Details</h3>
                        <div className="space-y-1 text-sm">
                            <div>
                                <span className="font-medium">SKU:</span>{' '}
                                <span className="font-mono">{transaction.skuCode}</span>
                            </div>
                            <div>
                                <span className="font-medium">Product:</span> {transaction.productName}
                            </div>
                            <div>
                                <span className="font-medium">Color / Size:</span> {transaction.colorName} /{' '}
                                {transaction.size}
                            </div>
                            <div>
                                <span className="font-medium">Qty:</span>{' '}
                                <span className="text-green-600 font-semibold">+{transaction.qty}</span>
                            </div>
                        </div>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                            <AlertTriangle size={20} />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Search Input */}
                    <div>
                        <label className="text-sm font-medium text-gray-700 block mb-2">
                            Search by Order Number or AWB
                        </label>
                        <div className="relative">
                            <Search
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                                size={18}
                            />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Enter order number or AWB..."
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                            />
                        </div>
                        {searchLoading && (
                            <p className="text-xs text-gray-500 mt-1">Searching...</p>
                        )}
                    </div>

                    {/* Matches List */}
                    <div>
                        <label className="text-sm font-medium text-gray-700 block mb-2">
                            {searchQuery.length >= 3
                                ? 'Search Results'
                                : 'Suggested Matches (Recent Orders)'}
                        </label>

                        {matchesLoading ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600"></div>
                            </div>
                        ) : allMatches.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                                <Package size={32} className="mx-auto mb-2 text-gray-300" />
                                <p className="text-sm">
                                    {searchQuery.length >= 3
                                        ? 'No matching orders found'
                                        : 'No suggested matches'}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                    Try searching by order number or AWB
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                                {allMatches.map((match) => (
                                    <button
                                        key={`${match.type}-${match.id}`}
                                        onClick={() => setSelectedMatch(match)}
                                        className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                                            selectedMatch?.id === match.id &&
                                            selectedMatch?.type === match.type
                                                ? 'border-orange-500 bg-orange-50'
                                                : 'border-transparent hover:border-gray-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5">{getMatchIcon(match.type)}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm text-gray-900">
                                                    {match.label}
                                                </div>
                                                <div className="text-xs text-gray-600 mt-0.5">
                                                    {match.detail}
                                                </div>
                                                {match.date && (
                                                    <div className="text-xs text-gray-400 mt-0.5">
                                                        {new Date(match.date).toLocaleDateString('en-IN', {
                                                            day: '2-digit',
                                                            month: 'short',
                                                            year: 'numeric',
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                            {selectedMatch?.id === match.id &&
                                                selectedMatch?.type === match.type && (
                                                    <Check size={20} className="text-orange-600 mt-0.5" />
                                                )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* RTO Condition (only if RTO selected) */}
                    {selectedMatch?.type === 'rto' && (
                        <div>
                            <label className="text-sm font-medium text-gray-700 block mb-2">
                                Item Condition
                            </label>
                            <div className="space-y-2">
                                {[
                                    { value: 'good', label: 'Good', color: 'green' },
                                    { value: 'unopened', label: 'Unopened', color: 'blue' },
                                    { value: 'damaged', label: 'Damaged', color: 'red' },
                                    { value: 'wrong_product', label: 'Wrong Product', color: 'yellow' },
                                ].map((cond) => (
                                    <label
                                        key={cond.value}
                                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                                            rtoCondition === cond.value
                                                ? `border-${cond.color}-500 bg-${cond.color}-50`
                                                : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="rtoCondition"
                                            value={cond.value}
                                            checked={rtoCondition === cond.value}
                                            onChange={(e) =>
                                                setRtoCondition(e.target.value as 'good' | 'unopened' | 'damaged' | 'wrong_product')
                                            }
                                        />
                                        <span className="text-sm font-medium">{cond.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        disabled={allocateMutation.isPending}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleAllocate}
                        disabled={!selectedMatch || allocateMutation.isPending}
                        className="px-6 py-2 text-sm font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {allocateMutation.isPending ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Allocating...
                            </>
                        ) : (
                            <>
                                <Check size={16} />
                                Allocate
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
