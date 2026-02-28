/**
 * Returns & RTO Inward Page
 *
 * SCAN-FIRST WORKFLOW:
 * 1. Scan SKU → Item added to repacking queue immediately
 * 2. Queue shows all items awaiting processing
 * 3. User can allocate items to return/RTO orders (optional)
 * 4. Processing (QC) happens in Inventory Inward page
 *
 * This allows fast scanning without needing to match to orders upfront.
 *
 * MIGRATED TO SERVER FUNCTIONS: Uses TanStack Start Server Functions
 * instead of Axios API calls.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    getPendingSources,
    getPendingQueue,
    scanLookup,
    type PendingQueueResponse,
    type QueuePanelItemResponse,
    type ScanLookupMatch,
} from '@/server/functions/returns';
import {
    addToRepackingQueue,
    updateRepackingQueueItem,
    deleteRepackingQueueItem,
} from '@/server/functions/repacking';
import { reportError } from '@/utils/errorReporter';
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
    Link,
} from 'lucide-react';

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
    const [activeTab, setActiveTab] = useState<TabType>('repacking');

    // Selected item for allocation
    const [selectedItem, setSelectedItem] = useState<QueuePanelItemResponse | null>(null);
    const [showAllocateModal, setShowAllocateModal] = useState(false);

    // Pagination
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchFilter, setSearchFilter] = useState('');

    // Server Function hooks
    const getPendingSourcesFn = useServerFn(getPendingSources);
    const getPendingQueueFn = useServerFn(getPendingQueue);
    const addToQueueFn = useServerFn(addToRepackingQueue);
    const deleteFromQueueFn = useServerFn(deleteRepackingQueueItem);

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
        queryFn: () => getPendingSourcesFn(),
        refetchInterval: 30000,
    });

    // Fetch queue data based on active tab
    const { data: queueData, isLoading: isLoadingQueue } = useQuery<PendingQueueResponse>({
        queryKey: ['pendingQueue', activeTab],
        queryFn: () => getPendingQueueFn({ data: { source: activeTab, limit: 200 } }),
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

    // Add to repacking queue mutation (scan-first, no condition yet)
    const addToQueueMutation = useMutation({
        mutationFn: async (skuCode: string) => {
            return addToQueueFn({
                data: {
                    skuCode,
                    qty: 1,
                },
            });
        },
        onSuccess: (_, skuCode) => {
            queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });

            setScanFeedback({
                type: 'success',
                message: `${skuCode} added to repacking queue`,
            });
            setScanInput('');
            inputRef.current?.focus();
        },
        onError: (error: Error) => {
            setScanFeedback({
                type: 'error',
                message: error.message || 'Failed to add to queue',
            });
            setScanInput('');
            inputRef.current?.focus();
        },
    });

    // Delete from queue mutation
    const deleteFromQueueMutation = useMutation({
        mutationFn: async (itemId: string) => {
            return deleteFromQueueFn({ data: { itemId } });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });

            setScanFeedback({
                type: 'success',
                message: 'Item removed from queue',
            });
        },
        onError: (error: Error) => {
            setScanFeedback({
                type: 'error',
                message: error.message || 'Failed to remove item',
            });
        },
    });

    // Handle scan - add to repacking queue directly (fast path)
    const handleScan = () => {
        const code = scanInput.trim();
        if (!code || addToQueueMutation.isPending) return;

        setScanFeedback(null);
        // Call addToQueue directly - it handles SKU validation
        // This avoids the expensive scanLookup call (5+ queries)
        addToQueueMutation.mutate(code);
        setScanInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    const closeModal = () => {
        setShowAllocateModal(false);
        setSelectedItem(null);
        inputRef.current?.focus();
    };

    // Handle delete from queue
    const handleDeleteClick = (item: QueuePanelItemResponse) => {
        if (confirm(`Remove ${item.skuCode} from queue?`)) {
            deleteFromQueueMutation.mutate(item.queueItemId || item.id);
        }
    };

    // Handle allocate click from repacking queue
    const handleAllocateClick = (item: QueuePanelItemResponse) => {
        setSelectedItem(item);
        setShowAllocateModal(true);
    };

    // Get urgency badge for RTO items
    const getUrgencyBadge = (item: QueuePanelItemResponse) => {
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
                                Queue: <span className="font-semibold text-green-600">{counts.repacking}</span>
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
                {/* Quick Scan Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold mb-4">Quick Scan to Queue</h2>

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

                    {/* Scan Input - Fast scan, no selections */}
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
                                disabled={addToQueueMutation.isPending}
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={handleScan}
                            disabled={!scanInput.trim() || addToQueueMutation.isPending}
                            className="px-8 py-4 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            {addToQueueMutation.isPending ? 'Adding...' : 'Add'}
                        </button>
                    </div>

                    <p className="text-sm text-gray-500 mt-2">
                        Scan items to add to queue. Process them in Inventory Inward.
                    </p>
                </div>

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
                                        {activeTab === 'repacking' && (
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">Linked To</th>
                                        )}
                                        {activeTab === 'rto' && (
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                                        )}
                                        {activeTab === 'repacking' && (
                                            <th className="px-4 py-3 text-center font-medium text-gray-600">Actions</th>
                                        )}
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
                                                {activeTab === 'repacking' && (
                                                    item.condition
                                                        ? getConditionBadge(item.condition)
                                                        : <span className="text-xs text-gray-400 italic">Pending</span>
                                                )}
                                                {activeTab === 'rto' && <span className="font-medium">{item.orderNumber}</span>}
                                                {activeTab === 'returns' && <span className="font-mono text-xs">{item.requestNumber}</span>}
                                            </td>
                                            {activeTab === 'repacking' && (
                                                <td className="px-4 py-3">
                                                    {item.rtoOrderNumber ? (
                                                        <span className="text-xs text-purple-600">
                                                            RTO: #{item.rtoOrderNumber}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-gray-400 italic">Unallocated</span>
                                                    )}
                                                </td>
                                            )}
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
                                            {activeTab === 'repacking' && (
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {!item.rtoOrderNumber && !item.orderLineId && (
                                                            <button
                                                                onClick={() => handleAllocateClick(item)}
                                                                className="px-2 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                                                                title="Link to return/RTO"
                                                            >
                                                                <Link size={14} className="inline mr-1" />
                                                                Allocate
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleDeleteClick(item)}
                                                            disabled={deleteFromQueueMutation.isPending}
                                                            className="px-2 py-1 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                                                            title="Remove from queue"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
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

            {/* Allocate Modal */}
            {showAllocateModal && selectedItem && (
                <AllocationModalContent
                    item={selectedItem}
                    onClose={closeModal}
                    onSuccess={() => {
                        queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
                        setScanFeedback({
                            type: 'success',
                            message: 'Item allocated successfully',
                        });
                        closeModal();
                    }}
                />
            )}
        </div>
    );
}

// Simple allocation modal content
function AllocationModalContent({
    item,
    onClose,
    onSuccess,
}: {
    item: QueuePanelItemResponse;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);

    // Server Function hooks
    const scanLookupFn = useServerFn(scanLookup);
    const updateQueueItemFn = useServerFn(updateRepackingQueueItem);

    // Fetch matching returns and RTOs for this SKU
    const { data: matchData, isLoading: isLoadingMatches } = useQuery({
        queryKey: ['allocation-matches', item.skuId],
        queryFn: () => scanLookupFn({ data: { code: item.skuCode } }),
    });

    const returnMatches: ScanLookupMatch[] = matchData?.matches.filter((m: ScanLookupMatch) => m.source === 'return') || [];
    const rtoMatches: ScanLookupMatch[] = matchData?.matches.filter((m: ScanLookupMatch) => m.source === 'rto') || [];

    const handleAllocate = async (_type: 'return' | 'rto', lineId: string) => {
        setIsLoading(true);
        try {
            // Both return and RTO use orderLineId now
            await updateQueueItemFn({
                data: {
                    id: item.queueItemId || item.id,
                    orderLineId: lineId,
                },
            });
            onSuccess();
        } catch (error) {
            console.error('Failed to allocate:', error);
            reportError(error, { page: 'ReturnsRto', action: 'allocate' });
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-lg font-semibold">Allocate to Return/RTO</h3>
                            <p className="text-sm text-gray-500 mt-1">{item.skuCode} - {item.productName}</p>
                        </div>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {isLoadingMatches ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mb-3"></div>
                            <p className="text-sm text-gray-500">Loading matching orders...</p>
                        </div>
                    ) : returnMatches.length === 0 && rtoMatches.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <Package size={48} className="mx-auto mb-3 text-gray-300" />
                            <p>No matching returns or RTO orders found for this SKU</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Return Matches */}
                            {returnMatches.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                        <RotateCcw size={16} className="text-orange-600" />
                                        Pending Returns
                                    </h4>
                                    <div className="space-y-2">
                                        {returnMatches.map((match) => (
                                            <button
                                                key={match.data.lineId}
                                                onClick={() => handleAllocate('return', match.data.lineId)}
                                                disabled={isLoading}
                                                className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-colors disabled:opacity-50"
                                            >
                                                <div className="flex justify-between">
                                                    <span className="font-medium">{match.data.requestNumber}</span>
                                                    <span className="text-sm text-gray-500">Qty: {match.data.qty}</span>
                                                </div>
                                                <p className="text-sm text-gray-600">{match.data.reasonCategory || ''}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* RTO Matches */}
                            {rtoMatches.length > 0 && (
                                <div>
                                    <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                        <Truck size={16} className="text-purple-600" />
                                        Pending RTO Orders
                                    </h4>
                                    <div className="space-y-2">
                                        {rtoMatches.map((match) => (
                                            <button
                                                key={match.data.lineId}
                                                onClick={() => handleAllocate('rto', match.data.lineId)}
                                                disabled={isLoading}
                                                className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors disabled:opacity-50"
                                            >
                                                <div className="flex justify-between">
                                                    <span className="font-medium">Order #{match.data.orderNumber}</span>
                                                    <span className="text-sm text-gray-500">Qty: {match.data.qty}</span>
                                                </div>
                                                <p className="text-sm text-gray-600">{match.data.customerName || ''}</p>
                                                {match.data.atWarehouse && (
                                                    <span className="inline-block mt-1 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                                        At Warehouse
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-white"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
