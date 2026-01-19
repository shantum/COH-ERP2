/**
 * AssignStockCell - Clear allocate/assign stock button
 * Shows active green button when stock available, inactive gray when not
 */

import { memo } from 'react';
import { Square, Check, Loader2 } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';
import { cn } from '../../../../lib/utils';

interface AssignStockCellProps {
    row: FlattenedOrderRow;
    handlersRef: React.MutableRefObject<DynamicColumnHandlers>;
}

export const AssignStockCell = memo(function AssignStockCell({ row, handlersRef }: AssignStockCellProps) {
    const status = row.lineStatus || 'pending';
    const lineId = row.lineId;
    const qty = row.qty || 0;
    const stock = row.skuStock ?? 0;
    const hasStock = stock >= qty && qty > 0;

    const { onAllocate, onUnallocate, allocatingLines } = handlersRef.current;
    const isLoading = lineId ? allocatingLines?.has(lineId) || false : false;

    const isPending = status === 'pending';
    const isAllocated = status === 'allocated';
    const isPostAllocated = ['picked', 'packed', 'shipped'].includes(status);
    const isCancelled = status === 'cancelled';

    // Already allocated - show assigned state
    if (isAllocated) {
        return (
            <div className="flex items-center">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (lineId) onUnallocate?.(lineId);
                    }}
                    disabled={isLoading}
                    className={cn(
                        'flex items-center justify-center gap-1 w-[82px] py-1 rounded-md transition-colors text-xs font-medium',
                        isLoading
                            ? 'bg-emerald-50 text-emerald-400'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    )}
                    title="Click to unallocate"
                >
                    {isLoading ? (
                        <Loader2 size={12} className="animate-spin" />
                    ) : (
                        <Check size={12} />
                    )}
                    Allocated
                </button>
            </div>
        );
    }

    // Post-allocated (picked/packed/shipped) - show completed state
    if (isPostAllocated) {
        return (
            <div className="flex items-center">
                <span className="flex items-center justify-center gap-1 w-[82px] py-1 text-xs text-gray-400">
                    <Check size={12} />
                    Allocated
                </span>
            </div>
        );
    }

    // Cancelled - show nothing
    if (isCancelled) {
        return (
            <div className="flex items-center">
                <span className="w-[82px] text-center text-xs text-gray-300">-</span>
            </div>
        );
    }

    // Pending - show assign button (active or inactive based on stock)
    if (isPending) {
        if (hasStock) {
            return (
                <div className="flex items-center">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (lineId) onAllocate?.(lineId);
                        }}
                        disabled={isLoading}
                        className={cn(
                            'flex items-center justify-center gap-1 w-[82px] py-1 rounded-md transition-colors text-xs font-medium',
                            isLoading
                                ? 'bg-emerald-50 text-emerald-400'
                                : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm'
                        )}
                        title="Allocate stock to this line"
                    >
                        {isLoading ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <Square size={12} />
                        )}
                        Allocate
                    </button>
                </div>
            );
        } else {
            return (
                <div className="flex items-center">
                    <span
                        className="w-[82px] text-center text-[11px] text-amber-600 bg-amber-50 py-1 rounded-md"
                        title="Insufficient stock"
                    >
                        No stock
                    </span>
                </div>
            );
        }
    }

    return null;
}, (prev, next) => (
    prev.row.lineId === next.row.lineId &&
    prev.row.lineStatus === next.row.lineStatus &&
    prev.row.skuStock === next.row.skuStock &&
    prev.row.qty === next.row.qty &&
    prev.handlersRef.current.allocatingLines === next.handlersRef.current.allocatingLines
));
