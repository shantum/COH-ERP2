/**
 * QtyCell - Displays quantity ordered
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface QtyCellProps {
    row: FlattenedOrderRow;
}

export const QtyCell = memo(function QtyCell({ row }: QtyCellProps) {
    return (
        <span className="font-medium">
            {row.qty || 0}
        </span>
    );
});
