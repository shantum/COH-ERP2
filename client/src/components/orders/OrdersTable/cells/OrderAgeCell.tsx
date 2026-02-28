/**
 * OrderAgeCell - Displays how old an order is in days
 */

import { memo, useState } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface OrderAgeCellProps {
    row: FlattenedOrderRow;
}

export const OrderAgeCell = memo(function OrderAgeCell({ row }: OrderAgeCellProps) {
    const [now] = useState(() => Date.now());

    if (!row.isFirstLine || !row.orderDate) return null;

    const orderDate = new Date(row.orderDate);
    const daysOld = Math.floor((now - orderDate.getTime()) / (1000 * 60 * 60 * 24));

    return (
        <span
            className={cn(
                'font-medium',
                daysOld > 5 && 'text-red-600',
                daysOld >= 3 && daysOld <= 5 && 'text-amber-600',
                daysOld < 3 && 'text-gray-500'
            )}
        >
            {daysOld}d
        </span>
    );
});
