/**
 * OrderDateCell - Displays order date in a formatted way
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface OrderDateCellProps {
    row: FlattenedOrderRow;
}

export function OrderDateCell({ row }: OrderDateCellProps) {
    if (!row.isFirstLine) return null;

    const date = new Date(row.orderDate);
    const formattedDate = date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
    });

    return (
        <span className="font-medium" title={date.toLocaleString('en-IN')}>
            {formattedDate}
        </span>
    );
}
