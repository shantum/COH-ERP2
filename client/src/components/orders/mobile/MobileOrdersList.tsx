/**
 * MobileOrdersList - Option 3: Bottom Sheet Action Panel
 *
 * Compact list view with multi-select and persistent bottom sheet
 * for bulk production date assignment.
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { Search, Filter, Check, ChevronRight, Package, Scissors, AlertTriangle } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';
import { MobileBottomSheet } from './MobileBottomSheet';

interface MobileOrdersListProps {
    rows: FlattenedOrderRow[];
    onAssignDates: (lineIds: string[], date: string) => void;
    onCancel: (lineIds: string[]) => void;
    isDateLocked: (date: string) => boolean;
    onRowClick?: (row: FlattenedOrderRow) => void;
}

export const MobileOrdersList = memo(function MobileOrdersList({
    rows,
    onAssignDates,
    onCancel,
    isDateLocked,
    onRowClick,
}: MobileOrdersListProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [showBottomSheet, setShowBottomSheet] = useState(false);

    // Filter rows
    const filteredRows = useMemo(() => {
        if (!searchQuery.trim()) return rows;
        const query = searchQuery.toLowerCase();
        return rows.filter(row =>
            row.orderNumber.toLowerCase().includes(query) ||
            row.customerName.toLowerCase().includes(query) ||
            row.productName.toLowerCase().includes(query)
        );
    }, [rows, searchQuery]);

    // Only pending rows can be selected for production assignment
    const selectableRows = useMemo(() =>
        filteredRows.filter(r => r.lineStatus === 'pending' && r.lineId),
        [filteredRows]
    );

    const toggleSelect = useCallback((lineId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(lineId)) {
                next.delete(lineId);
            } else {
                next.add(lineId);
            }
            // Show bottom sheet when items are selected
            if (next.size > 0) setShowBottomSheet(true);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        const allIds = selectableRows.map(r => r.lineId!);
        setSelectedIds(new Set(allIds));
        setShowBottomSheet(true);
    }, [selectableRows]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setShowBottomSheet(false);
    }, []);

    const handleAssignDate = useCallback((date: string) => {
        const lineIds = Array.from(selectedIds);
        onAssignDates(lineIds, date);
        clearSelection();
    }, [selectedIds, onAssignDates, clearSelection]);

    // Group rows by order for display
    const pendingCount = selectableRows.length;
    const selectedCount = selectedIds.size;

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
                <div className="flex items-center justify-between mb-3">
                    <h1 className="text-lg font-semibold text-slate-900">
                        Orders
                        <span className="text-slate-400 font-normal ml-2 text-sm">
                            ({pendingCount} pending)
                        </span>
                    </h1>
                    <button className="p-2 rounded-lg bg-slate-100 text-slate-600">
                        <Filter size={18} />
                    </button>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Search orders, customers..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 bg-slate-100 rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:bg-white transition-colors"
                    />
                </div>

                {/* Selection controls */}
                {pendingCount > 0 && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                        <button
                            onClick={selectedCount > 0 ? clearSelection : selectAll}
                            className="text-sm text-orange-600 font-medium"
                        >
                            {selectedCount > 0 ? 'Clear selection' : 'Select all'}
                        </button>
                        {selectedCount > 0 && (
                            <span className="text-sm text-slate-500">
                                {selectedCount} selected
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto pb-32">
                {filteredRows.map((row) => (
                    <MobileOrderListItem
                        key={row.lineId || `${row.orderId}-${row.skuCode}`}
                        row={row}
                        isSelected={row.lineId ? selectedIds.has(row.lineId) : false}
                        onSelect={row.lineId ? () => toggleSelect(row.lineId!) : undefined}
                        onClick={() => onRowClick?.(row)}
                        canSelect={row.lineStatus === 'pending' && !!row.lineId}
                    />
                ))}

                {filteredRows.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <Package size={48} strokeWidth={1} />
                        <p className="mt-2">No orders found</p>
                    </div>
                )}
            </div>

            {/* Bottom Sheet */}
            <MobileBottomSheet
                isOpen={showBottomSheet}
                onClose={() => setShowBottomSheet(false)}
                selectedCount={selectedCount}
                onAssignDate={handleAssignDate}
                onCancel={() => {
                    onCancel(Array.from(selectedIds));
                    clearSelection();
                }}
                isDateLocked={isDateLocked}
            />
        </div>
    );
});

// Individual list item
interface MobileOrderListItemProps {
    row: FlattenedOrderRow;
    isSelected: boolean;
    onSelect?: () => void;
    onClick?: () => void;
    canSelect: boolean;
}

const MobileOrderListItem = memo(function MobileOrderListItem({
    row,
    isSelected,
    onSelect,
    onClick,
    canSelect,
}: MobileOrderListItemProps) {
    const hasStock = row.skuStock >= row.qty;

    return (
        <div
            className={`
                flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100
                transition-colors
                ${isSelected ? 'bg-orange-50' : ''}
            `}
        >
            {/* Selection checkbox */}
            {canSelect && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect?.();
                    }}
                    className={`
                        w-6 h-6 rounded-full border-2 flex items-center justify-center
                        transition-all flex-shrink-0
                        ${isSelected
                            ? 'bg-orange-500 border-orange-500 scale-110'
                            : 'border-slate-300 bg-white'
                        }
                    `}
                >
                    {isSelected && <Check size={14} className="text-white" strokeWidth={3} />}
                </button>
            )}

            {/* Product image - optimized for mobile */}
            <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                {row.imageUrl ? (
                    <img
                        src={getOptimizedImageUrl(row.imageUrl, 'sm') || row.imageUrl}
                        alt={row.productName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Package size={18} className="text-slate-400" />
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0" onClick={onClick}>
                <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 text-sm">
                        #{row.orderNumber}
                    </span>
                    <span className="text-slate-400 text-xs">|</span>
                    <span className="text-slate-600 text-xs truncate">
                        {row.customerName}
                    </span>
                </div>

                <p className="text-sm text-slate-700 truncate mt-0.5">
                    {row.productName}
                </p>

                <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-500">
                        {row.colorName} / {row.size}
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="text-xs font-medium text-slate-700">x{row.qty}</span>

                    {/* Indicators */}
                    {row.isCustomized && (
                        <span className="w-4 h-4 rounded-full bg-violet-100 flex items-center justify-center">
                            <Scissors size={10} className="text-violet-600" />
                        </span>
                    )}
                    {!hasStock && row.lineStatus === 'pending' && (
                        <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center">
                            <AlertTriangle size={10} className="text-amber-600" />
                        </span>
                    )}
                </div>
            </div>

            {/* Status / Production date */}
            <div className="flex-shrink-0 text-right" onClick={onClick}>
                {row.productionDate ? (
                    <div className="px-2 py-1 bg-amber-100 rounded-lg">
                        <span className="text-[10px] text-amber-600 block">Prod</span>
                        <span className="text-xs font-medium text-amber-700">
                            {formatShortDate(row.productionDate)}
                        </span>
                    </div>
                ) : row.lineStatus === 'allocated' ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-lg bg-blue-100 text-blue-700">
                        Allocated
                    </span>
                ) : row.lineStatus === 'shipped' ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-lg bg-sky-100 text-sky-700">
                        Shipped
                    </span>
                ) : hasStock ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-lg bg-emerald-100 text-emerald-700">
                        Ready
                    </span>
                ) : (
                    <ChevronRight size={18} className="text-slate-300" />
                )}
            </div>
        </div>
    );
});

function formatShortDate(dateStr: string): string {
    const date = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
