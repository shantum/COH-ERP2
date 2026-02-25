/**
 * AwbTrackingCell — Reusable AWB + courier + live tracking status cell
 *
 * Shows:
 * 1. AWB number (monospace, click-to-copy)
 * 2. Courier name (from live tracking API — returns real carrier e.g. BlueDart, Delhivery)
 * 3. Live tracking status (grouped) + last scan location/time
 *
 * Two modes:
 * - With `tracking` prop: renders pre-fetched data (no API call — use with useBatchTracking)
 * - Without: fetches individually via useIThinkTracking (for modals/detail views)
 *
 * Usage:
 *   <AwbTrackingCell awbNumber="28449571923692" courier="Delhivery" tracking={trackingMap?.["28449571923692"]} />
 */

import { useCallback, useRef } from 'react';
import { useIThinkTracking } from '../hooks/useIThinkTracking';
import type { IThinkTrackingData } from '../hooks/useIThinkTracking';
import { formatLastUpdate } from './orders/OrdersTable/utils/dateFormatters';
import { cn } from '../lib/utils';

interface AwbTrackingCellProps {
    /** AWB / waybill number */
    awbNumber: string | null | undefined;
    /** Courier name from DB (fallback if API returns "iThink") */
    courier?: string | null;
    /** Pre-fetched tracking data (from useBatchTracking). If provided, no individual API call is made. */
    tracking?: IThinkTrackingData | null;
    /** Max width for truncation (default: 160px) */
    maxWidth?: number;
}

interface StatusGroup { label: string; color: string; dot: string }

const DEFAULT_GROUP: StatusGroup = { label: 'Unknown', color: 'text-gray-500', dot: 'bg-gray-400' };

/**
 * Resolve raw iThink status text + code to a display group.
 */
function resolveStatusGroup(currentStatus: string, statusCode: string): StatusGroup {
    const text = (currentStatus || '').toLowerCase();
    const code = (statusCode || '').toUpperCase();

    if (text.includes('cancel') || code === 'CA')
        return { label: 'Cancelled', color: 'text-red-600', dot: 'bg-red-500' };
    if ((text.includes('rto') && text.includes('deliver')) || code === 'RTD' || code === 'RTOD')
        return { label: 'RTO Delivered', color: 'text-purple-600', dot: 'bg-purple-500' };
    if (text.includes('rto') || text.includes('return to origin') || ['RTO', 'RTI', 'RTP'].includes(code))
        return { label: 'RTO', color: 'text-orange-600', dot: 'bg-orange-500' };
    if ((text.includes('deliver') && !text.includes('undeliver') && !text.includes('out for')) || code === 'DL')
        return { label: 'Delivered', color: 'text-green-600', dot: 'bg-green-500' };
    if (text.includes('undeliver') || text.includes('not deliver') || text.includes('ndr') || code === 'NDR')
        return { label: 'Undelivered', color: 'text-amber-600', dot: 'bg-amber-500' };
    if (text.includes('out for delivery') || code === 'OFD')
        return { label: 'Out for Delivery', color: 'text-blue-600', dot: 'bg-blue-500' };
    if (text.includes('reached') || text.includes('destination') || code === 'RAD')
        return { label: 'At Destination', color: 'text-blue-600', dot: 'bg-blue-500' };
    if (text.includes('transit') || code === 'IT' || code === 'OT')
        return { label: 'In Transit', color: 'text-blue-600', dot: 'bg-blue-500' };
    if ((text.includes('pick') && !text.includes('not pick')) || code === 'PP')
        return { label: 'Picked Up', color: 'text-blue-600', dot: 'bg-blue-500' };
    if (text.includes('not pick') || text.includes('pickup fail') || code === 'NP')
        return { label: 'Pickup Failed', color: 'text-amber-600', dot: 'bg-amber-500' };
    if (text.includes('manifest') || code === 'M')
        return { label: 'Awaiting Pickup', color: 'text-gray-600', dot: 'bg-gray-400' };
    if (text.includes('reverse deliver') || code === 'REVD')
        return { label: 'Delivered', color: 'text-green-600', dot: 'bg-green-500' };
    if (text.includes('reverse') || code === 'REVI' || code === 'REVP')
        return { label: 'In Transit', color: 'text-blue-600', dot: 'bg-blue-500' };

    return DEFAULT_GROUP;
}

export function AwbTrackingCell({ awbNumber, courier, tracking: prefetched, maxWidth = 160 }: AwbTrackingCellProps) {
    const elRef = useRef<HTMLDivElement>(null);

    const handleCopy = useCallback(() => {
        if (!awbNumber || !elRef.current) return;
        navigator.clipboard.writeText(awbNumber).then(() => {
            const el = elRef.current;
            if (!el) return;
            const original = el.textContent;
            el.textContent = 'Copied!';
            el.classList.add('text-green-600');
            el.classList.remove('text-gray-700');
            setTimeout(() => {
                if (el) {
                    el.textContent = original;
                    el.classList.remove('text-green-600');
                    el.classList.add('text-gray-700');
                }
            }, 1000);
        }).catch(() => {});
    }, [awbNumber]);

    if (!awbNumber) {
        return <span className="text-gray-400 text-xs">-</span>;
    }

    const dbCourier = courier && courier.toLowerCase() !== 'ithink' ? courier : null;

    return (
        <div className="space-y-0.5">
            {/* AWB number — click to copy */}
            <div
                ref={elRef}
                className="font-mono text-xs text-gray-700 cursor-pointer hover:text-blue-600 transition-colors"
                onClick={handleCopy}
                title={`Click to copy ${awbNumber}`}
            >
                {awbNumber}
            </div>

            {/* Tracking status */}
            {prefetched !== undefined ? (
                <TrackingDisplay tracking={prefetched} dbCourier={dbCourier} maxWidth={maxWidth} />
            ) : (
                <FetchAndDisplay awbNumber={awbNumber} dbCourier={dbCourier} maxWidth={maxWidth} />
            )}
        </div>
    );
}

/** Renders tracking data that was already fetched (batch mode) */
function TrackingDisplay({ tracking, dbCourier, maxWidth }: { tracking: IThinkTrackingData | null; dbCourier: string | null; maxWidth: number }) {
    if (!tracking?.currentStatus) {
        if (dbCourier) return <div className="text-[11px] text-gray-500 font-medium">{dbCourier}</div>;
        return null;
    }
    return <TrackingInfo tracking={tracking} dbCourier={dbCourier} maxWidth={maxWidth} />;
}

/** Fetches individual AWB tracking then renders (standalone mode) */
function FetchAndDisplay({ awbNumber, dbCourier, maxWidth }: { awbNumber: string; dbCourier: string | null; maxWidth: number }) {
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
        if (dbCourier) return <div className="text-[11px] text-gray-500 font-medium">{dbCourier}</div>;
        return null;
    }

    return <TrackingInfo tracking={tracking} dbCourier={dbCourier} maxWidth={maxWidth} />;
}

/** Shared tracking display: courier + status badge + last scan */
function TrackingInfo({ tracking, dbCourier, maxWidth }: { tracking: IThinkTrackingData; dbCourier: string | null; maxWidth: number }) {
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
            {courierName && (
                <div className="text-[11px] text-gray-500 font-medium">{courierName}</div>
            )}
            <div className="flex items-center gap-1.5">
                <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', group.dot)} />
                <span className={cn('text-[11px] font-medium', group.color)}>
                    {group.label}
                </span>
            </div>
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
