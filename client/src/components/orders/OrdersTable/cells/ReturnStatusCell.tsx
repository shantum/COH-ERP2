/**
 * ReturnStatusCell - Displays return status indicator for order lines
 */

import { memo } from 'react';
import { RotateCcw } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface ReturnStatusCellProps {
    row: FlattenedOrderRow;
}

// Return status configuration
const RETURN_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
    requested: { label: 'Requested', color: 'text-amber-700', bgColor: 'bg-amber-100' },
    pickup_scheduled: { label: 'Pickup', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    in_transit: { label: 'In Transit', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
    received: { label: 'Received', color: 'text-violet-700', bgColor: 'bg-violet-100' },
    complete: { label: 'Complete', color: 'text-green-700', bgColor: 'bg-green-100' },
    cancelled: { label: 'Cancelled', color: 'text-slate-500', bgColor: 'bg-slate-100' },
};

export const ReturnStatusCell = memo(function ReturnStatusCell({ row }: ReturnStatusCellProps) {
    // Only show for lines with active returns (not cancelled/complete)
    const returnStatus = row.returnStatus;

    if (!returnStatus || returnStatus === 'cancelled' || returnStatus === 'complete') {
        return null;
    }

    const config = RETURN_STATUS_CONFIG[returnStatus];
    if (!config) return null;

    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                config.bgColor,
                config.color
            )}
            title={`Return: ${config.label}`}
        >
            <RotateCcw size={12} />
            {config.label}
        </span>
    );
});
