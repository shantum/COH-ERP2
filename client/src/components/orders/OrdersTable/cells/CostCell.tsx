/**
 * CostCell - Display BOM cost in INR format
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface CostCellProps {
    row: FlattenedOrderRow;
}

export const CostCell = memo(function CostCell({ row }: CostCellProps) {
    const cost = row.bomCost || 0;
    if (!cost) return <span className="text-gray-400">-</span>;

    return (
        <span className="text-gray-600">
            {'\u20B9'}{cost.toLocaleString('en-IN')}
        </span>
    );
});
