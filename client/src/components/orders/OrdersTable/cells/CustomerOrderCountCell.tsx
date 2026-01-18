/**
 * CustomerOrderCountCell - Displays customer's total order count
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface CustomerOrderCountCellProps {
    row: FlattenedOrderRow;
}

export function CustomerOrderCountCell({ row }: CustomerOrderCountCellProps) {
    if (!row.isFirstLine) return null;

    const count = row.customerOrderCount || 0;
    const isNewCustomer = count <= 1;
    const isRepeat = count > 1;

    return (
        <span
            className={cn(
                'font-medium',
                isNewCustomer && 'text-gray-500',
                isRepeat && 'text-green-600'
            )}
            title={`${count} total order(s)`}
        >
            {count}
        </span>
    );
}
