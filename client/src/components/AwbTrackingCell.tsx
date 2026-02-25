/**
 * AwbTrackingCell — Reusable AWB + courier + live tracking status cell
 *
 * Shows:
 * 1. AWB number (monospace, click-to-copy)
 * 2. Courier name (from live tracking API — returns real carrier e.g. BlueDart, Delhivery)
 * 3. Live tracking status (grouped) + last scan location/time
 *
 * Usage:
 *   <AwbTrackingCell awbNumber="28449571923692" courier="Delhivery" />
 */

import { useState, useCallback } from 'react';
import { useIThinkTracking } from '../hooks/useIThinkTracking';
import { formatLastUpdate } from './orders/OrdersTable/utils/dateFormatters';
import { cn } from '../lib/utils';

interface AwbTrackingCellProps {
    /** AWB / waybill number */
    awbNumber: string | null | undefined;
    /** Courier name from DB (Delhivery, Bluedart, etc.) */
    courier?: string | null;
    /** Max width for truncation (default: 160px) */
    maxWidth?: number;
}

interface StatusGroup { label: string; color: string; dot: string }

const DEFAULT_GROUP: StatusGroup = { label: 'Unknown', color: 'text-gray-500', dot: 'bg-gray-400' };

/**
 * Resolve raw iThink status text + code to a display group.
 * Matches on raw text (e.g. "In Transit", "Delivered") and status codes (e.g. "IT", "DL").
 * Priority-ordered: RTO > Delivered > OFD > In Transit > Picked > Manifested
 */
function resolveStatusGroup(currentStatus: string, statusCode: string): StatusGroup {
    const text = (currentStatus || '').toLowerCase();
    const code = (statusCode || '').toUpperCase();

    // Cancelled
    if (text.includes('cancel') || code === 'CA') {
        return { label: 'Cancelled', color: 'text-red-600', dot: 'bg-red-500' };
    }

    // RTO Delivered
    if ((text.includes('rto') && text.includes('deliver')) || code === 'RTD' || code === 'RTOD') {
        return { label: 'RTO Delivered', color: 'text-purple-600', dot: 'bg-purple-500' };
    }

    // RTO In Transit
    if (text.includes('rto') || text.includes('return to origin') || ['RTO', 'RTI', 'RTP'].includes(code)) {
        return { label: 'RTO', color: 'text-orange-600', dot: 'bg-orange-500' };
    }

    // Delivered
    if ((text.includes('deliver') && !text.includes('undeliver') && !text.includes('out for')) || code === 'DL') {
        return { label: 'Delivered', color: 'text-green-600', dot: 'bg-green-500' };
    }

    // Undelivered / NDR
    if (text.includes('undeliver') || text.includes('not deliver') || text.includes('ndr') || code === 'NDR') {
        return { label: 'Undelivered', color: 'text-amber-600', dot: 'bg-amber-500' };
    }

    // Out for delivery
    if (text.includes('out for delivery') || code === 'OFD') {
        return { label: 'Out for Delivery', color: 'text-blue-600', dot: 'bg-blue-500' };
    }

    // Reached destination
    if (text.includes('reached') || text.includes('destination') || code === 'RAD') {
        return { label: 'At Destination', color: 'text-blue-600', dot: 'bg-blue-500' };
    }

    // In transit
    if (text.includes('transit') || code === 'IT' || code === 'OT') {
        return { label: 'In Transit', color: 'text-blue-600', dot: 'bg-blue-500' };
    }

    // Picked up
    if ((text.includes('pick') && !text.includes('not pick')) || code === 'PP') {
        return { label: 'Picked Up', color: 'text-blue-600', dot: 'bg-blue-500' };
    }

    // Not picked / pickup failed
    if (text.includes('not pick') || text.includes('pickup fail') || code === 'NP') {
        return { label: 'Pickup Failed', color: 'text-amber-600', dot: 'bg-amber-500' };
    }

    // Manifested
    if (text.includes('manifest') || code === 'M') {
        return { label: 'Awaiting Pickup', color: 'text-gray-600', dot: 'bg-gray-400' };
    }

    // Reverse logistics
    if (text.includes('reverse deliver') || code === 'REVD') {
        return { label: 'Delivered', color: 'text-green-600', dot: 'bg-green-500' };
    }
    if (text.includes('reverse') || code === 'REVI' || code === 'REVP') {
        return { label: 'In Transit', color: 'text-blue-600', dot: 'bg-blue-500' };
    }

    return DEFAULT_GROUP;
}

export function AwbTrackingCell({ awbNumber, courier, maxWidth = 160 }: AwbTrackingCellProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        if (!awbNumber) return;
        navigator.clipboard.writeText(awbNumber).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
    }, [awbNumber]);

    if (!awbNumber) {
        return <span className="text-gray-400 text-xs">-</span>;
    }

    // Use DB courier as fallback, but prefer live API courier (see LiveTrackingStatus)
    const dbCourier = courier && courier.toLowerCase() !== 'ithink' ? courier : null;

    return (
        <div className="space-y-0.5">
            {/* AWB number — click to copy */}
            <div
                className="font-mono text-xs text-gray-700 cursor-pointer hover:text-blue-600 transition-colors"
                onClick={handleCopy}
                title={copied ? 'Copied!' : `Click to copy ${awbNumber}`}
            >
                {copied ? (
                    <span className="text-green-600 text-[11px]">Copied!</span>
                ) : (
                    awbNumber
                )}
            </div>

            {/* Live tracking status (includes courier name from API) */}
            <LiveTrackingStatus awbNumber={awbNumber} maxWidth={maxWidth} dbCourier={dbCourier} />
        </div>
    );
}

/** Fetches live tracking and shows courier + grouped status + last scan */
function LiveTrackingStatus({ awbNumber, maxWidth, dbCourier }: { awbNumber: string; maxWidth: number; dbCourier: string | null }) {
    const { data: tracking, isLoading, error } = useIThinkTracking({
        awbNumber,
        enabled: !!awbNumber,
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <div className="w-2 h-2 border border-gray-300 border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px]">Tracking...</span>
            </div>
        );
    }

    if (error || !tracking?.currentStatus) {
        // Even if tracking fails, show DB courier if available
        if (dbCourier) {
            return <div className="text-[10px] text-gray-400">{dbCourier}</div>;
        }
        return null;
    }

    // Prefer API courier (real carrier name), fall back to DB courier
    const apiCourier = tracking.courier && tracking.courier.toLowerCase() !== 'ithink' ? tracking.courier : null;
    const courierName = apiCourier || dbCourier;

    const group = resolveStatusGroup(tracking.currentStatus, tracking.statusCode);

    const lastScanTime = tracking.lastScan?.datetime
        || (tracking.scanHistory?.length ? tracking.scanHistory[0].datetime : null);
    const lastUpdate = formatLastUpdate(lastScanTime);
    const lastLocation = tracking.lastScan?.location
        || (tracking.scanHistory?.length ? tracking.scanHistory[0].location : null);

    return (
        <>
            {/* Courier name from API */}
            {courierName && (
                <div className="text-[10px] text-gray-400">{courierName}</div>
            )}
            {/* Status badge */}
            <div className="flex items-center gap-1.5">
                <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', group.dot)} />
                <span className={cn('text-[11px] font-medium', group.color)}>
                    {group.label}
                </span>
            </div>
            {/* Last scan info */}
            {(lastUpdate || lastLocation) && (
                <div
                    className="text-[10px] text-gray-400 truncate"
                    style={{ maxWidth: `${maxWidth}px` }}
                >
                    {lastUpdate}{lastUpdate && lastLocation ? ' · ' : ''}{lastLocation}
                </div>
            )}
        </>
    );
}
