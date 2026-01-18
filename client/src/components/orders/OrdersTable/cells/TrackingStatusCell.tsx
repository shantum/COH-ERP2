/**
 * TrackingStatusCell - Displays tracking status with color-coded badge
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { TRACKING_STATUS_STYLES } from '../rowStyling';
import { cn } from '../../../../lib/utils';

interface TrackingStatusCellProps {
    row: FlattenedOrderRow;
}

export function TrackingStatusCell({ row }: TrackingStatusCellProps) {
    const status = row.lineTrackingStatus;
    if (!status) return <span className="text-gray-300">—</span>;

    const style = TRACKING_STATUS_STYLES[status] || {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        label: status,
    };

    return (
        <span
            className={cn(
                'px-1.5 py-0.5 rounded font-medium whitespace-nowrap',
                style.bg,
                style.text
            )}
        >
            {style.label}
        </span>
    );
}
