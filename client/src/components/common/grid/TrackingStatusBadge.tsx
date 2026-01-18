/**
 * Tracking status badge component for shipping/delivery status
 */

import { Package, CheckCircle, AlertTriangle } from 'lucide-react';
import { TRACKING_STATUS_STYLES, GRID_COLORS } from '../../../utils/gridFormatting';

interface TrackingStatusBadgeProps {
    status: string;
    daysInTransit?: number;
    ofdCount?: number;
}

const STATUS_ICONS: Record<string, any> = {
    in_transit: Package,
    manifested: Package,
    picked_up: Package,
    reached_destination: Package,
    out_for_delivery: Package,
    undelivered: AlertTriangle,
    delivered: CheckCircle,
    delivery_delayed: AlertTriangle,
    rto_pending: AlertTriangle,
    rto_initiated: AlertTriangle,
    rto_in_transit: Package,
    rto_delivered: CheckCircle,
    rto_received: CheckCircle,
    cancelled: AlertTriangle,
};

/**
 * Get color classes for in_transit based on days in transit
 * - 0-3 days: info (blue)
 * - 4-5 days: warning (yellow)
 * - 6+ days: danger (red)
 */
function getInTransitColors(days: number): { bg: string; text: string } {
    if (days <= 3) {
        return GRID_COLORS.info.tailwind;
    } else if (days <= 5) {
        return GRID_COLORS.warning.tailwind;
    } else {
        return GRID_COLORS.danger.tailwind;
    }
}

export function TrackingStatusBadge({ status, daysInTransit, ofdCount }: TrackingStatusBadgeProps) {
    const baseConfig = TRACKING_STATUS_STYLES[status] || TRACKING_STATUS_STYLES.in_transit;
    const Icon = STATUS_ICONS[status] || Package;

    // For in_transit, apply color thresholds based on days
    const isInTransit = status === 'in_transit';
    const days = daysInTransit ?? 0;
    const colors = isInTransit ? getInTransitColors(days) : { bg: baseConfig.bg, text: baseConfig.text };

    // Show OFD count for NDR/undelivered
    const showOfd = (status === 'undelivered' || status === 'out_for_delivery') && ofdCount && ofdCount > 0;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${colors.bg} ${colors.text}`}>
            <Icon size={12} />
            {baseConfig.label}
            {showOfd ? ` (${ofdCount})` : (isInTransit && days > 0 ? ` (${days}d)` : '')}
        </span>
    );
}
