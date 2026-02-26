/**
 * TrackingStatusCell - Displays tracking status with iThink logo
 * Two-line layout: status on line 1, last update time on line 2
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { TRACKING_STATUS_STYLES } from '../rowStyling';
import { cn } from '../../../../lib/utils';
import ithinkLogo from '../../../../assets/ithinklogistics.png';
import { formatLastUpdate } from '../utils/dateFormatters';

interface TrackingStatusCellProps {
    row: FlattenedOrderRow;
}

export const TrackingStatusCell = memo(function TrackingStatusCell({ row }: TrackingStatusCellProps) {
    const status = row.lineTrackingStatus;

    // Use order-level lastScanAt (courier's scan time) or fall back to line-level lastTrackingUpdate
    const lastTrackingTime = (row.order?.lastScanAt as string | null | undefined) || row.lineLastTrackingUpdate;

    // Only show tracking status if there's actual tracking data from iThink
    // The default 'in_transit' status is set when orders ship, but without real tracking data it's misleading
    const hasRealTrackingData = !!lastTrackingTime;

    // Show dash if no status OR if status is just the default 'in_transit' without real tracking data
    if (!status || (status === 'in_transit' && !hasRealTrackingData)) {
        return <span className="text-gray-300">—</span>;
    }

    const style = TRACKING_STATUS_STYLES[status] || {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        label: status,
    };

    const lastUpdate = formatLastUpdate(lastTrackingTime ?? null);

    return (
        <div className="flex flex-col gap-1">
            {/* Fulfillment status pill badge */}
            <span
                className={cn(
                    'inline-flex items-center w-fit px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                    style.bg, style.text
                )}
            >
                {style.label}
            </span>
            {lastUpdate && (
                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <img
                        src={ithinkLogo}
                        alt="iThink"
                        className="w-3 h-3 object-contain shrink-0"
                    />
                    {lastUpdate}
                </span>
            )}
        </div>
    );
});
