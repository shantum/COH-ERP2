/**
 * QtyCell - Displays quantity ordered
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface QtyCellProps {
    row: FlattenedOrderRow;
}

export function QtyCell({ row }: QtyCellProps) {
    return (
        <span className="font-medium">
            {row.qty || 0}
        </span>
    );
}
