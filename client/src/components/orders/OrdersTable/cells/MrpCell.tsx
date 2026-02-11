/**
 * MrpCell - Display SKU MRP (Shopify listed price)
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface MrpCellProps {
    row: FlattenedOrderRow;
}

export const MrpCell = memo(function MrpCell({ row }: MrpCellProps) {
    const mrp = row.mrp || 0;
    if (!mrp) return <span className="text-gray-400">-</span>;

    return (
        <span className="text-gray-700 font-medium">
            {'\u20B9'}{mrp.toLocaleString('en-IN')}
        </span>
    );
});
