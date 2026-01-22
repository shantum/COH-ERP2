/**
 * OrderValueCell - Displays order total value
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface OrderValueCellProps {
    row: FlattenedOrderRow;
}

export const OrderValueCell = memo(function OrderValueCell({ row }: OrderValueCellProps) {
    if (!row.isFirstLine) return null;

    const value = row.totalAmount;
    if (!value) return <span className="text-gray-300">-</span>;

    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(value);

    return (
        <span className="font-medium text-gray-700">
            {formatted}
        </span>
    );
});
