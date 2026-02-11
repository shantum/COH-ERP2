/**
 * DiscountCell - Display discount % (order price vs MRP)
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface DiscountCellProps {
    row: FlattenedOrderRow;
}

export const DiscountCell = memo(function DiscountCell({ row }: DiscountCellProps) {
    const discount = row.discountPercent || 0;
    if (!discount) return <span className="text-gray-400">-</span>;

    return (
        <span className={`font-medium ${discount >= 30 ? 'text-red-600' : discount >= 15 ? 'text-amber-600' : 'text-green-600'}`}>
            {discount}%
        </span>
    );
});
