/**
 * StockCell - Displays available stock with color coding
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';
import { STOCK_COLORS } from '../styleConfig';

interface StockCellProps {
    row: FlattenedOrderRow;
}

export const StockCell = memo(function StockCell({ row }: StockCellProps) {
    const stock = row.skuStock ?? 0;
    const qty = row.qty || 0;
    const hasEnough = stock >= qty;

    return (
        <span
            className={cn(
                'font-medium',
                hasEnough ? STOCK_COLORS.sufficient : STOCK_COLORS.insufficient
            )}
            title={`Available: ${stock}, Required: ${qty}`}
        >
            {stock}
        </span>
    );
});
