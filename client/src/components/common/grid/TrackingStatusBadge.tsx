/**
 * Tracking status badge component for shipping/delivery status
 */

import { Package, CheckCircle, AlertTriangle } from 'lucide-react';
import { TRACKING_STATUS_STYLES } from '../../orders/ordersGrid/formatting';

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

export function TrackingStatusBadge({ status, daysInTransit, ofdCount }: TrackingStatusBadgeProps) {
    const config = TRACKING_STATUS_STYLES[status] || TRACKING_STATUS_STYLES.in_transit;
    const Icon = STATUS_ICONS[status] || Package;

    // Show OFD count for NDR/undelivered
    const showOfd = (status === 'undelivered' || status === 'out_for_delivery') && ofdCount && ofdCount > 0;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            <Icon size={12} />
            {config.label}
            {showOfd ? ` (${ofdCount})` : (status === 'in_transit' && daysInTransit ? ` (${daysInTransit}d)` : '')}
        </span>
    );
}
