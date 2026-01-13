/**
 * GlobalOrderSearch - Cross-tab order search with dropdown results
 * Searches across all tabs and shows which tab each result is in
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, ChevronRight, Loader2 } from 'lucide-react';
import { ordersApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import type { OrderTab } from '../../hooks/useOrdersData';
import type { ShipmentTab } from '../../hooks/useShipmentsData';

type AllTabs = OrderTab | ShipmentTab;

interface SearchResult {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    paymentMethod: string;
    totalAmount: number;
    trackingStatus?: string;
    awbNumber?: string;
}

interface TabResult {
    tab: string;
    tabName: string;
    count: number;
    orders: SearchResult[];
}

interface GlobalOrderSearchProps {
    onSelectOrder: (orderId: string, tab: AllTabs, page: 'orders' | 'shipments') => void;
}

// Map API tab names to tab types
const tabMapping: Record<string, AllTabs> = {
    open: 'open',
    cancelled: 'cancelled',
    shipped: 'shipped',
    rto: 'rto',
    cod_pending: 'cod-pending',
    archived: 'archived',
};

// Tabs that belong to the Orders page (open, cancelled)
// All other tabs (shipped, rto, cod-pending, archived) go to Shipments page
const ordersPageTabs: OrderTab[] = ['open', 'cancelled'];

export function GlobalOrderSearch({ onSelectOrder }: GlobalOrderSearchProps) {
    const [searchInput, setSearchInput] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const searchQuery = useDebounce(searchInput, 300);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Search query
    const { data: searchResults, isLoading } = useQuery({
        queryKey: ['orderSearchAll', searchQuery],
        queryFn: () => ordersApi.searchAll(searchQuery, 5).then(r => r.data),
        enabled: searchQuery.length >= 2,
        staleTime: 30000, // Cache for 30s
    });

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Open dropdown when there are results
    useEffect(() => {
        if (searchQuery.length >= 2 && searchResults?.results?.length > 0) {
            setIsOpen(true);
        }
    }, [searchQuery, searchResults]);

    const handleSelect = (orderId: string, tab: string) => {
        const mappedTab = tabMapping[tab] || 'open';
        const page = ordersPageTabs.includes(mappedTab) ? 'orders' : 'shipments';
        onSelectOrder(orderId, mappedTab, page);
        setSearchInput('');
        setIsOpen(false);
    };

    const handleClear = () => {
        setSearchInput('');
        setIsOpen(false);
        inputRef.current?.focus();
    };

    const getTabColor = (tab: string) => {
        switch (tab) {
            case 'open': return 'bg-blue-100 text-blue-700';
            case 'shipped': return 'bg-green-100 text-green-700';
            case 'rto': return 'bg-orange-100 text-orange-700';
            case 'cod_pending': return 'bg-amber-100 text-amber-700';
            case 'archived': return 'bg-gray-100 text-gray-600';
            default: return 'bg-gray-100 text-gray-600';
        }
    };

    const hasResults = searchResults?.results?.length > 0;
    const showDropdown = isOpen && searchQuery.length >= 2 && (hasResults || isLoading);

    return (
        <div ref={containerRef} className="relative flex-1 sm:flex-none">
            {/* Search Input */}
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
            <input
                ref={inputRef}
                type="text"
                placeholder="Search all orders..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => searchQuery.length >= 2 && hasResults && setIsOpen(true)}
                className="pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg w-full sm:w-56 md:w-64 focus:outline-none focus:ring-2 focus:ring-primary-100 focus:border-primary-300 bg-gray-50/50"
            />
            {searchInput && (
                <button
                    onClick={handleClear}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 z-10"
                >
                    <X size={14} />
                </button>
            )}

            {/* Results Dropdown */}
            {showDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            <Loader2 size={20} className="animate-spin mr-2" />
                            Searching...
                        </div>
                    ) : hasResults ? (
                        <div className="py-1">
                            {/* Total count header */}
                            <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                                Found {searchResults.totalResults} order{searchResults.totalResults !== 1 ? 's' : ''} for "{searchResults.query}"
                            </div>

                            {/* Results grouped by tab */}
                            {searchResults.results.map((tabResult: TabResult) => (
                                <div key={tabResult.tab}>
                                    {/* Tab header */}
                                    <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getTabColor(tabResult.tab)}`}>
                                            {tabResult.tabName}
                                        </span>
                                        <span className="text-xs text-gray-400 ml-2">
                                            {tabResult.count} result{tabResult.count !== 1 ? 's' : ''}
                                        </span>
                                    </div>

                                    {/* Orders in this tab */}
                                    {tabResult.orders.map((order: SearchResult) => (
                                        <button
                                            key={order.id}
                                            onClick={() => handleSelect(order.id, tabResult.tab)}
                                            className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 text-left transition-colors"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-gray-900">
                                                        #{order.orderNumber}
                                                    </span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                        order.paymentMethod === 'COD' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                                                    }`}>
                                                        {order.paymentMethod}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {order.customerName}
                                                    {order.awbNumber && (
                                                        <span className="ml-2 text-gray-400">AWB: {order.awbNumber}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <ChevronRight size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ) : searchQuery.length >= 2 ? (
                        <div className="py-8 text-center text-gray-500 text-sm">
                            No orders found for "{searchQuery}"
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
