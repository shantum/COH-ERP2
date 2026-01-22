/**
 * CustomerLtvCell - Displays customer lifetime value
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface CustomerLtvCellProps {
    row: FlattenedOrderRow;
}

export const CustomerLtvCell = memo(function CustomerLtvCell({ row }: CustomerLtvCellProps) {
    if (!row.isFirstLine) return null;

    const ltv = row.customerLtv || 0;
    if (ltv === 0) return <span className="text-gray-300">-</span>;

    const formatted = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(ltv);

    return (
        <span className="text-gray-700 font-medium">
            {formatted}
        </span>
    );
});
