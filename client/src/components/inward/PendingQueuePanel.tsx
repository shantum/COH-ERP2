/**
 * Pending Queue Panel Component
 * Shows pending items for a specific inward source with click-to-scan functionality
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getPendingQueue } from '../../server/functions/returns';
import { Package, Search, Clock, AlertTriangle } from 'lucide-react';
import type { PendingQueueResponse, QueuePanelItemResponse } from '../../server/functions/returns';
import { getOptimizedImageUrl } from '../../utils/imageOptimization';

interface PendingQueuePanelProps {
    source: 'production' | 'returns' | 'rto' | 'repacking';
    onSelectItem: (skuCode: string) => void;
    title?: string;
    className?: string;
}

// Source-specific styling
const SOURCE_STYLES: Record<string, { bgColor: string; borderColor: string; textColor: string; accentColor: string }> = {
    production: {
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        textColor: 'text-blue-900',
        accentColor: 'text-blue-600',
    },
    returns: {
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
        textColor: 'text-orange-900',
        accentColor: 'text-orange-600',
    },
    rto: {
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200',
        textColor: 'text-purple-900',
        accentColor: 'text-purple-600',
    },
    repacking: {
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        textColor: 'text-green-900',
        accentColor: 'text-green-600',
    },
};

const DEFAULT_TITLES: Record<string, string> = {
    production: 'Pending Production',
    returns: 'Pending Returns',
    rto: 'Pending RTO',
    repacking: 'QC Queue',
};

export default function PendingQueuePanel({ source, onSelectItem, title, className = '' }: PendingQueuePanelProps) {
    const [searchInput, setSearchInput] = useState('');
    const styles = SOURCE_STYLES[source] || SOURCE_STYLES.returns;
    const displayTitle = title || DEFAULT_TITLES[source] || 'Pending Items';

    const getPendingQueueFn = useServerFn(getPendingQueue);

    // Fetch pending queue
    const { data: queueData, isLoading } = useQuery<PendingQueueResponse>({
        queryKey: ['pendingQueue', source],
        queryFn: () => getPendingQueueFn({ data: { source, limit: 50 } }),
        refetchInterval: 30000,
    });

    // Filter items based on search
    const filteredItems = useMemo(() => {
        if (!queueData?.items) return [];
        if (!searchInput.trim()) return queueData.items;

        const search = searchInput.toLowerCase();
        return queueData.items.filter(item =>
            item.skuCode.toLowerCase().includes(search) ||
            item.productName.toLowerCase().includes(search) ||
            item.contextValue.toLowerCase().includes(search) ||
            item.customerName?.toLowerCase().includes(search)
        );
    }, [queueData?.items, searchInput]);

    // Get urgency styling for RTO items
    const getUrgencyStyles = (item: QueuePanelItemResponse) => {
        if (source !== 'rto' || !item.daysInRto) return '';
        if (item.daysInRto > 14) return 'border-l-4 border-l-red-500';
        if (item.daysInRto > 7) return 'border-l-4 border-l-orange-400';
        return '';
    };

    const totalCount = queueData?.total || 0;

    if (totalCount === 0 && !isLoading) {
        return null; // Don't show panel if no pending items
    }

    return (
        <div className={`card ${className}`}>
            {/* Header */}
            <div className={`flex items-center justify-between mb-3 pb-3 border-b ${styles.borderColor}`}>
                <h3 className={`font-semibold ${styles.textColor}`}>{displayTitle}</h3>
                <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${styles.bgColor} ${styles.accentColor}`}>
                    {totalCount} items
                </span>
            </div>

            {/* Search */}
            {totalCount > 5 && (
                <div className="relative mb-3">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search SKU, product, or batch..."
                        className="input pl-8 py-1.5 text-sm w-full"
                    />
                </div>
            )}

            {/* Items List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {isLoading ? (
                    <div className="flex justify-center py-6">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">
                        {searchInput ? 'No matching items' : 'No pending items'}
                    </p>
                ) : (
                    filteredItems.map((item) => (
                        <div
                            key={item.id}
                            className={`flex gap-3 p-2 rounded-lg border ${styles.borderColor} hover:${styles.bgColor} cursor-pointer transition-colors ${getUrgencyStyles(item)}`}
                            onClick={() => onSelectItem(item.skuCode)}
                        >
                            {/* Image */}
                            <div className="w-12 h-12 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                                {item.imageUrl ? (
                                    <img src={getOptimizedImageUrl(item.imageUrl, 'sm') || item.imageUrl} alt={item.skuCode} className="w-full h-full object-cover" loading="lazy" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                        <Package size={20} />
                                    </div>
                                )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="font-mono text-sm font-medium truncate">{item.skuCode}</p>
                                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${styles.bgColor} ${styles.accentColor}`}>
                                        x{item.qty}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-600 truncate">
                                    {item.productName} - {item.colorName}/{item.size}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-gray-500">
                                        {item.contextLabel}: <span className="font-medium">{item.contextValue}</span>
                                    </span>
                                    {item.atWarehouse && (
                                        <span className="text-xs px-1 py-0.5 bg-green-100 text-green-700 rounded">
                                            At WH
                                        </span>
                                    )}
                                </div>
                                {item.daysInRto !== undefined && item.daysInRto > 0 && (
                                    <div className={`flex items-center gap-1 mt-0.5 text-xs ${
                                        item.daysInRto > 14 ? 'text-red-600' :
                                        item.daysInRto > 7 ? 'text-orange-600' : 'text-gray-500'
                                    }`}>
                                        {item.daysInRto > 7 ? (
                                            <AlertTriangle size={12} />
                                        ) : (
                                            <Clock size={12} />
                                        )}
                                        <span>{item.daysInRto}d in RTO</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Show more indicator */}
            {filteredItems.length > 0 && filteredItems.length < totalCount && (
                <p className="text-xs text-gray-500 text-center mt-2 pt-2 border-t">
                    Showing {filteredItems.length} of {totalCount} items
                </p>
            )}
        </div>
    );
}
