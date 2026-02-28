/**
 * Order Search Page - Dedicated page for searching orders across all tabs
 *
 * Features:
 * - Large, prominent search interface
 * - Search across all order statuses (open, shipped, RTO, etc.)
 * - Results grouped by status
 * - Navigate to correct page (Orders or Shipments) with tab and orderId
 * - Keyboard navigable (Enter to select first result)
 *
 * Uses Server Functions for data fetching (TanStack Start migration)
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search, Loader2, ChevronRight, Package, User } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';
import {
    searchAllOrders,
    type SearchResultOrder,
    type TabResult,
    type SearchAllResponse,
} from '../server/functions/orders';

const getTabColor = (tab: string) => {
    switch (tab) {
        case 'open': return 'bg-blue-100 text-blue-700';
        case 'cancelled': return 'bg-red-100 text-red-700';
        case 'shipped': return 'bg-green-100 text-green-700';
        case 'rto': return 'bg-orange-100 text-orange-700';
        case 'cod_pending': return 'bg-amber-100 text-amber-700';
        case 'archived': return 'bg-gray-100 text-gray-600';
        default: return 'bg-gray-100 text-gray-600';
    }
};

export default function OrderSearch() {
    const [searchInput, setSearchInput] = useState('');
    const searchQuery = useDebounce(searchInput, 300);
    const inputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Search query using Server Function
    const { data: searchResults, isLoading } = useQuery<SearchAllResponse>({
        queryKey: ['orderSearchAll', searchQuery],
        queryFn: () => searchAllOrders({ data: { q: searchQuery, limit: 50 } }),
        enabled: searchQuery.length >= 2,
        staleTime: 30000, // Cache for 30s
    });

    const handleSelectOrder = (orderNumber: string) => {
        navigate({ to: '/orders/$orderId', params: { orderId: orderNumber } });
    };

    // Keyboard navigation: Enter to select first result
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && searchResults?.results && searchResults.results.length > 0) {
            const firstTab = searchResults.results[0];
            const firstOrder = firstTab?.orders[0];
            if (firstOrder) {
                handleSelectOrder(firstOrder.orderNumber);
            }
        }
    };

    const hasResults = searchResults?.results && searchResults.results.length > 0;
    const showResults = searchQuery.length >= 2;

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-2xl mb-4">
                    <Search size={32} className="text-primary-600" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Search Orders</h1>
                <p className="text-gray-600">Search by order number, customer name, AWB, or phone number</p>
            </div>

            {/* Search Input */}
            <div className="relative mb-8">
                <Search size={24} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Start typing to search..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full pl-14 pr-6 py-4 text-lg border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 shadow-sm"
                    autoComplete="off"
                />
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                    <Loader2 size={32} className="animate-spin mb-3" />
                    <p className="text-lg">Searching...</p>
                </div>
            )}

            {/* No Results */}
            {!isLoading && showResults && !hasResults && (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                    <Package size={48} className="mb-4 text-gray-300" />
                    <p className="text-lg font-medium mb-1">No orders found</p>
                    <p className="text-sm">Try searching with a different term</p>
                </div>
            )}

            {/* Results */}
            {!isLoading && hasResults && searchResults && (
                <div className="space-y-6">
                    {/* Total count */}
                    <div className="text-sm text-gray-600">
                        Found <span className="font-semibold text-gray-900">{searchResults.totalResults}</span> order{searchResults.totalResults !== 1 ? 's' : ''} for "{searchResults.query}"
                    </div>

                    {/* Results grouped by tab */}
                    {searchResults.results.map((tabResult: TabResult) => (
                        <div key={tabResult.tab} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            {/* Tab header */}
                            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-semibold px-3 py-1 rounded-full ${getTabColor(tabResult.tab)}`}>
                                        {tabResult.tabName}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                        {tabResult.count} result{tabResult.count !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </div>

                            {/* Orders in this tab */}
                            <div className="divide-y divide-gray-100">
                                {tabResult.orders.map((order: SearchResultOrder) => (
                                    <div
                                        key={order.id}
                                        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 text-left transition-colors group"
                                    >
                                        <button
                                            onClick={() => handleSelectOrder(order.orderNumber)}
                                            className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-md"
                                        >
                                            <div className="flex items-center gap-3 mb-1">
                                                <span className="font-semibold text-gray-900 text-lg">
                                                    #{order.orderNumber}
                                                </span>
                                                {order.paymentMethod && (
                                                    <span className={`text-xs px-2 py-1 rounded font-medium ${order.paymentMethod === 'COD'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-green-100 text-green-700'
                                                        }`}>
                                                        {order.paymentMethod}
                                                    </span>
                                                )}
                                                {order.totalAmount != null && (
                                                    <span className="text-sm font-medium text-gray-900">
                                                        ₹{order.totalAmount.toLocaleString('en-IN')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                {order.customerName || '-'}
                                            </div>
                                            {order.awbNumber && (
                                                <div className="text-xs text-gray-500 mt-1">
                                                    AWB: {order.awbNumber}
                                                    {order.trackingStatus && (
                                                        <span className="ml-2">• {order.trackingStatus}</span>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                                            {order.customerId && (
                                                <button
                                                    onClick={() => navigate({ to: '/customers/$customerId', params: { customerId: order.customerId! } })}
                                                    className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                                    title={`View customer: ${order.customerName || 'Unknown'}`}
                                                >
                                                    <User size={18} />
                                                </button>
                                            )}
                                            <ChevronRight size={20} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Empty state (before search) */}
            {!showResults && (
                <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
                        <Search size={32} className="text-gray-400" />
                    </div>
                    <p className="text-gray-500 text-lg mb-2">Start typing to search</p>
                    <p className="text-gray-400 text-sm">Enter at least 2 characters</p>

                    {/* Search tips */}
                    <div className="mt-8 max-w-md mx-auto text-left">
                        <p className="text-sm font-medium text-gray-700 mb-3">Search tips:</p>
                        <ul className="text-sm text-gray-600 space-y-2">
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">•</span>
                                <span>Search by order number (e.g., "1001" or "#1001")</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">•</span>
                                <span>Search by customer name</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">•</span>
                                <span>Search by AWB number</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">•</span>
                                <span>Search by phone number</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary-500 mt-0.5">•</span>
                                <span>Press Enter to jump to the first result</span>
                            </li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
