/**
 * UnitPriceCell - Display unit price in INR format
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface UnitPriceCellProps {
    row: FlattenedOrderRow;
}

export const UnitPriceCell = memo(function UnitPriceCell({ row }: UnitPriceCellProps) {
    const price = row.unitPrice || 0;
    if (!price) return <span className="text-gray-400">-</span>;

    return (
        <span className="text-gray-700 font-medium">
            {'\u20B9'}{price.toLocaleString('en-IN')}
        </span>
    );
});
