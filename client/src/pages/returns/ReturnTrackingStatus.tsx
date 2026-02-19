/**
 * Displays iThink tracking status for a return shipment
 * Shows logo, status label, and last update time
 */

import { useIThinkTracking } from '../../hooks/useIThinkTracking';
import ithinkLogo from '../../assets/ithinklogistics.png';
import { formatLastUpdate } from '../../components/orders/OrdersTable/utils/dateFormatters';
import { TRACKING_STATUS_STYLES } from '../../components/orders/OrdersTable/rowStyling';
import { cn } from '../../lib/utils';

interface ReturnTrackingStatusProps {
    awbNumber: string;
}

export function ReturnTrackingStatus({ awbNumber }: ReturnTrackingStatusProps) {
    const { data: tracking, isLoading, error } = useIThinkTracking({
        awbNumber,
        enabled: !!awbNumber,
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <div className="w-3 h-3 border border-gray-300 border-t-transparent rounded-full animate-spin" />
                <span>Loading...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-1.5 text-xs text-red-500 mt-1">
                <span>Tracking error</span>
            </div>
        );
    }

    if (!tracking?.currentStatus) {
        return null;
    }

    const style = TRACKING_STATUS_STYLES[tracking.currentStatus] || {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        label: tracking.currentStatus.replace(/_/g, ' '),
    };

    // Try lastScan first, then fall back to most recent scan in history
    const lastScanTime = tracking.lastScan?.datetime
        || (tracking.scanHistory && tracking.scanHistory.length > 0 ? tracking.scanHistory[0].datetime : null);
    const lastUpdate = formatLastUpdate(lastScanTime);
    const lastLocation = tracking.lastScan?.location
        || (tracking.scanHistory && tracking.scanHistory.length > 0 ? tracking.scanHistory[0].location : null);

    return (
        <div className="flex items-center gap-1.5 mt-1">
            <img
                src={ithinkLogo}
                alt="iThink"
                className="w-3.5 h-3.5 object-contain shrink-0"
            />
            <div className="flex flex-col leading-tight min-w-0">
                <span
                    className={cn(
                        'font-medium whitespace-nowrap text-[11px]',
                        style.text
                    )}
                >
                    {style.label}
                </span>
                {(lastUpdate || lastLocation) && (
                    <span className="text-[10px] text-gray-400 truncate max-w-[150px]">
                        {lastUpdate}{lastUpdate && lastLocation ? ' · ' : ''}{lastLocation}
                    </span>
                )}
            </div>
        </div>
    );
}
