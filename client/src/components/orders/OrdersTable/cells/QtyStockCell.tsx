/**
 * QtyStockCell - Combined quantity and stock display
 * Line 1: qty required
 * Line 2: stock available (green if >0, gray if 0)
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface QtyStockCellProps {
    row: FlattenedOrderRow;
}

export function QtyStockCell({ row }: QtyStockCellProps) {
    const qty = row.qty || 0;
    const stock = row.skuStock ?? 0;
    const hasStock = stock > 0;

    return (
        <div className="flex flex-col leading-tight">
            <span className="font-medium text-gray-800">
                {qty}
            </span>
            <span
                className={cn(
                    'text-[10px]',
                    hasStock ? 'text-emerald-600' : 'text-gray-400'
                )}
                title={`${stock} in stock`}
            >
                {stock} avl
            </span>
        </div>
    );
}
