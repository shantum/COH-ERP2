/**
 * UnitPriceCell - Display order total in INR format
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface UnitPriceCellProps {
    row: FlattenedOrderRow;
}

export const UnitPriceCell = memo(function UnitPriceCell({ row }: UnitPriceCellProps) {
    // Show totalAmount (order-level) instead of single line price
    const amount = row.totalAmount || 0;
    if (!amount) return <span className="text-gray-400">-</span>;

    return (
        <span className="text-gray-700 font-medium">
            {'\u20B9'}{amount.toLocaleString('en-IN')}
        </span>
    );
});
