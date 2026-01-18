/**
 * StockCell - Displays available stock with color coding
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface StockCellProps {
    row: FlattenedOrderRow;
}

export function StockCell({ row }: StockCellProps) {
    const stock = row.skuStock ?? 0;
    const qty = row.qty || 0;
    const hasEnough = stock >= qty;

    return (
        <span
            className={cn(
                'font-medium',
                hasEnough ? 'text-green-600' : 'text-red-600'
            )}
            title={`Available: ${stock}, Required: ${qty}`}
        >
            {stock}
        </span>
    );
}
