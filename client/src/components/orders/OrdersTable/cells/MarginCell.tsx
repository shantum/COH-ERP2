/**
 * MarginCell - Display margin percentage with color coding
 * Green: >= 50%, Yellow: 20-49%, Red: < 20%
 */
import { memo } from 'react';
import { cn } from '../../../../lib/utils';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface MarginCellProps {
    row: FlattenedOrderRow;
}

export const MarginCell = memo(function MarginCell({ row }: MarginCellProps) {
    const margin = row.margin;
    if (margin == null || (!row.bomCost && !row.unitPrice)) {
        return <span className="text-gray-400">-</span>;
    }

    const colorClass = margin >= 50
        ? 'text-green-600'
        : margin >= 20
            ? 'text-amber-600'
            : 'text-red-600';

    return (
        <span className={cn('font-medium', colorClass)}>
            {margin}%
        </span>
    );
});
