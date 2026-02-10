/**
 * QtyStockCell - Simple quantity display
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface QtyStockCellProps {
    row: FlattenedOrderRow;
}

export const QtyStockCell = memo(function QtyStockCell({ row }: QtyStockCellProps) {
    const qty = row.qty || 0;

    return (
        <span className="font-semibold text-gray-700">{qty}</span>
    );
});
