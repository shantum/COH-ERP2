/**
 * Returns & RTO Inward Page
 *
 * NEW SCAN-FIRST WORKFLOW:
 * 1. Scan SKU → immediate inward (no mode selection required)
 * 2. Recent inwards shows unallocated items (this IS the repacking queue)
 * 3. User allocates items to return/RTO orders from the recent inwards section
 *
 * Fast warehouse scanning optimized for speed - no confirmations needed
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import {
    Search,
    PackageX,
    Check,
    AlertTriangle,
    Clock,
    Package,
} from 'lucide-react';
import type { RecentInward, ScanLookupResult } from '../types';
import AllocationModal from '../components/inward/AllocationModal';

export default function ReturnsRto() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);

    // State
    const [scanInput, setScanInput] = useState('');
    const [scanFeedback, setScanFeedback] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);
    const [isScanning, setIsScanning] = useState(false);

    // Allocation modal state
    const [selectedTransaction, setSelectedTransaction] = useState<RecentInward | null>(null);
    const [showAllocationModal, setShowAllocationModal] = useState(false);

    // Pagination state
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [filterStatus, setFilterStatus] = useState<'all' | 'unallocated' | 'allocated'>('all');

    // Auto-focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Auto-clear feedback after 3 seconds
    useEffect(() => {
        if (scanFeedback) {
            const timer = setTimeout(() => {
                setScanFeedback(null);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [scanFeedback]);

    // Fetch recent inwards for repacking queue (showing items that may need allocation)
    const { data: recentInwards = [], isLoading } = useQuery<RecentInward[]>({
        queryKey: ['recent-inwards', 'adjustments'],
        queryFn: async () => {
            const res = await inventoryApi.getRecentInwards(200, 'adjustments');
            return res.data;
        },
        refetchInterval: 10000, // Refresh every 10 seconds
    });

    // Filter and paginate inwards
    const filteredInwards = recentInwards.filter((item) => {
        if (filterStatus === 'unallocated') return item.isAllocated === false;
        if (filterStatus === 'allocated') return item.isAllocated === true;
        return true;
    });

    const totalPages = Math.ceil(filteredInwards.length / pageSize);
    const paginatedInwards = filteredInwards.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    // Count today's scans
    const todayCount = recentInwards.filter((item) => {
        const itemDate = new Date(item.createdAt).toDateString();
        const today = new Date().toDateString();
        return itemDate === today;
    }).length;

    // Instant inward mutation - fast scan with no confirmation
    const instantInwardMutation = useMutation({
        mutationFn: async (code: string) => {
            // First do scan lookup to get product details
            const scanRes = await inventoryApi.scanLookup(code);
            const scanResult = scanRes.data as ScanLookupResult;

            // Then do instant inward
            await inventoryApi.instantInward(scanResult.sku.skuCode);

            return scanResult;
        },
        onSuccess: (scanResult) => {
            // Success feedback with product name
            setScanFeedback({
                type: 'success',
                message: `${scanResult.sku.productName} - ${scanResult.sku.colorName} / ${scanResult.sku.size} (+1)`,
            });

            // Clear input and refocus
            setScanInput('');
            inputRef.current?.focus();

            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-balance'] });
        },
        onError: (error: any) => {
            setScanFeedback({
                type: 'error',
                message: error.response?.data?.error || 'SKU not found',
            });
            setScanInput('');
            inputRef.current?.focus();
        },
        onSettled: () => {
            setIsScanning(false);
        },
    });

    // Handle scan
    const handleScan = async () => {
        const code = scanInput.trim();
        if (!code || isScanning) return;

        setIsScanning(true);
        instantInwardMutation.mutate(code);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    // Handle allocation button click
    const handleAllocateClick = (transaction: RecentInward) => {
        setSelectedTransaction(transaction);
        setShowAllocationModal(true);
    };

    // Status badge helper
    const getStatusBadge = (item: RecentInward) => {
        if (item.isAllocated === false) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    <Clock size={12} />
                    Unallocated
                </span>
            );
        }
        if (item.isAllocated === true) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <Check size={12} />
                    Allocated
                </span>
            );
        }
        // Auto-allocated (like production)
        return (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                <Package size={12} />
                Auto
            </span>
        );
    };

    // Source label helper
    const getSourceLabel = (reason: string) => {
        const labels: Record<string, string> = {
            received: 'Received',
            return_receipt: 'Return',
            rto_received: 'RTO',
            production: 'Production',
            adjustment: 'Adjustment',
            found_stock: 'Found Stock',
            correction: 'Correction',
            repack_complete: 'Repacking',
        };
        return labels[reason] || reason;
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-4">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <PackageX size={24} className="text-orange-600" />
                            <h1 className="text-xl font-semibold">Returns & RTO Inward</h1>
                        </div>
                        <div className="text-sm text-gray-600">
                            Today: <span className="font-semibold text-gray-900">{todayCount}</span> items scanned
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 space-y-6">
                {/* Quick Scan Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h2 className="text-lg font-semibold mb-4">Quick Scan Inward</h2>

                    {/* Scan Feedback */}
                    {scanFeedback && (
                        <div
                            className={`mb-4 px-4 py-3 rounded-lg border flex items-center gap-2 ${
                                scanFeedback.type === 'success'
                                    ? 'bg-green-50 border-green-200 text-green-800'
                                    : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                        >
                            {scanFeedback.type === 'success' ? (
                                <Check size={20} />
                            ) : (
                                <AlertTriangle size={20} />
                            )}
                            <span className="font-medium">{scanFeedback.message}</span>
                        </div>
                    )}

                    {/* Scan Input */}
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                                size={24}
                            />
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
                            {isScanning ? 'Scanning...' : 'Scan'}
                        </button>
                    </div>

                    <p className="text-sm text-gray-500 mt-2">
                        Scan SKU to instantly add to inventory. Items will appear below for allocation if needed.
                    </p>
                </div>

                {/* Recent Inwards (Repacking Queue) */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-lg font-semibold">Recent Inwards</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Manage and allocate scanned items to orders
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            {/* Status Filter */}
                            <select
                                value={filterStatus}
                                onChange={(e) => {
                                    setFilterStatus(e.target.value as any);
                                    setCurrentPage(1);
                                }}
                                className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                            >
                                <option value="all">All</option>
                                <option value="unallocated">Unallocated</option>
                                <option value="allocated">Allocated</option>
                            </select>

                            {/* Page Size */}
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="text-sm border border-gray-300 rounded-lg px-3 py-2"
                            >
                                <option value={25}>25 per page</option>
                                <option value={50}>50 per page</option>
                                <option value={100}>100 per page</option>
                            </select>
                        </div>
                    </div>

                    {/* Table */}
                    {isLoading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                        </div>
                    ) : filteredInwards.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <PackageX size={48} className="mx-auto mb-3 text-gray-300" />
                            <p>No items found</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                SKU Code
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                Product
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                Color
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                Size
                                            </th>
                                            <th className="px-4 py-3 text-center font-medium text-gray-600">
                                                Qty
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                Scanned At
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                Status
                                            </th>
                                            <th className="px-4 py-3 text-left font-medium text-gray-600">
                                                Source
                                            </th>
                                            <th className="px-4 py-3 text-center font-medium text-gray-600">
                                                Action
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {paginatedInwards.map((item) => {
                                            const isToday =
                                                new Date(item.createdAt).toDateString() ===
                                                new Date().toDateString();

                                            return (
                                                <tr
                                                    key={item.id}
                                                    className="hover:bg-gray-50 transition-colors"
                                                >
                                                    <td className="px-4 py-3 font-mono text-xs">
                                                        {item.skuCode}
                                                    </td>
                                                    <td className="px-4 py-3">{item.productName}</td>
                                                    <td className="px-4 py-3">{item.colorName}</td>
                                                    <td className="px-4 py-3">{item.size}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className="text-green-600 font-semibold">
                                                            +{item.qty}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                                        {isToday
                                                            ? new Date(item.createdAt).toLocaleTimeString(
                                                                  'en-IN',
                                                                  {
                                                                      hour: '2-digit',
                                                                      minute: '2-digit',
                                                                  }
                                                              )
                                                            : new Date(item.createdAt).toLocaleDateString(
                                                                  'en-IN',
                                                                  {
                                                                      day: '2-digit',
                                                                      month: 'short',
                                                                      hour: '2-digit',
                                                                      minute: '2-digit',
                                                                  }
                                                              )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {getStatusBadge(item)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-xs text-gray-600">
                                                            {getSourceLabel(item.reason)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {item.isAllocated === false ? (
                                                            <button
                                                                onClick={() =>
                                                                    handleAllocateClick(item)
                                                                }
                                                                className="px-3 py-1 text-xs font-medium bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                                                            >
                                                                Allocate
                                                            </button>
                                                        ) : (
                                                            <span className="text-xs text-gray-400">
                                                                -
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                                    <div className="text-sm text-gray-600">
                                        Showing {(currentPage - 1) * pageSize + 1} to{' '}
                                        {Math.min(currentPage * pageSize, filteredInwards.length)} of{' '}
                                        {filteredInwards.length} items
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Previous
                                        </button>
                                        <span className="text-sm text-gray-600">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <button
                                            onClick={() =>
                                                setCurrentPage((p) => Math.min(totalPages, p + 1))
                                            }
                                            disabled={currentPage === totalPages}
                                            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Allocation Modal */}
            {showAllocationModal && selectedTransaction && (
                <AllocationModal
                    transaction={selectedTransaction}
                    onClose={() => {
                        setShowAllocationModal(false);
                        setSelectedTransaction(null);
                    }}
                    onSuccess={() => {
                        queryClient.invalidateQueries({ queryKey: ['recent-inwards'] });
                        setShowAllocationModal(false);
                        setSelectedTransaction(null);
                        setScanFeedback({
                            type: 'success',
                            message: 'Item allocated successfully',
                        });
                    }}
                />
            )}
        </div>
    );
}
