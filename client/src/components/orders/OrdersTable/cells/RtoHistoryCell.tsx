/**
 * RtoHistoryCell - Displays customer's RTO history/risk
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface RtoHistoryCellProps {
    row: FlattenedOrderRow;
}

export function RtoHistoryCell({ row }: RtoHistoryCellProps) {
    if (!row.isFirstLine) return null;

    const rtoCount = row.customerRtoCount || 0;

    if (rtoCount === 0) {
        return <span className="text-gray-300">-</span>;
    }

    // Color code based on RTO count
    const isHighRisk = rtoCount >= 3;
    const isMediumRisk = rtoCount >= 1;

    return (
        <span
            className={cn(
                'px-1.5 py-0.5 rounded font-medium',
                isHighRisk && 'bg-red-100 text-red-700',
                isMediumRisk && !isHighRisk && 'bg-amber-100 text-amber-700'
            )}
            title={`${rtoCount} RTO(s) in history`}
        >
            {rtoCount} RTO
        </span>
    );
}
