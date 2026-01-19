/**
 * QtyStockCell - Horizontal qty | stock display with status divider
 * Layout: [qty] | [stock] with colored divider indicating stock status
 *
 * Divider color:
 * - Green: stock >= qty (sufficient, ready to allocate)
 * - Amber: stock < qty (insufficient, including 0)
 * - Red: reserved for fabric out of stock (future)
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface QtyStockCellProps {
    row: FlattenedOrderRow;
}

export const QtyStockCell = memo(function QtyStockCell({ row }: QtyStockCellProps) {
    const qty = row.qty || 0;
    const stock = row.skuStock ?? 0;
    const status = row.lineStatus || 'pending';

    // Determine stock status
    const isSufficient = stock >= qty;
    const isAllocated = ['allocated', 'picked', 'packed', 'shipped'].includes(status);

    // Green if allocated OR sufficient stock
    const showGreen = isAllocated || isSufficient;

    const getStatusTitle = () => {
        if (isAllocated) return 'Allocated';
        if (isSufficient) return 'Ready to allocate';
        if (stock > 0) return `Need ${qty - stock} more`;
        return 'Out of stock';
    };

    return (
        <div className="flex items-center gap-2 py-1" title={getStatusTitle()}>
            {/* Qty */}
            <div className="flex flex-col items-center">
                <span className="font-semibold text-gray-700">{qty}</span>
                <span className="text-[10px] text-gray-400">qty.</span>
            </div>

            {/* Status divider */}
            <div className={cn(
                'w-0.5 h-7 rounded-full',
                showGreen ? 'bg-emerald-400' : 'bg-amber-400'
            )} />

            {/* Stock */}
            <div className="flex flex-col items-center">
                <span className={cn(
                    'font-semibold',
                    showGreen ? 'text-gray-700' : 'text-amber-600'
                )}>
                    {stock}
                </span>
                <span className="text-[10px] text-gray-400">stock</span>
            </div>
        </div>
    );
}, (prev, next) => (
    prev.row.qty === next.row.qty &&
    prev.row.skuStock === next.row.skuStock &&
    prev.row.lineStatus === next.row.lineStatus
));
