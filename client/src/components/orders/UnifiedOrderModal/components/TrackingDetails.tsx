/**
 * TrackingDetails - Display iThink Logistics tracking data with scan history timeline
 */

import { useState } from 'react';
import {
    Package, MapPin, Clock, ChevronDown, ChevronUp, RefreshCw,
    AlertCircle, Truck, CalendarClock
} from 'lucide-react';
import { useIThinkTracking, type IThinkTrackingData, type IThinkScanHistoryItem } from '../../../../hooks/useIThinkTracking';
import {
    getTrackingStatusClasses,
    getTrackingStatusLabel,
    TRACKING_STATUS_STYLES,
} from '../../ordersGrid/formatting/statusStyles';
import { resolveTrackingStatus } from '../../ordersGrid/formatting/trackingResolver';

interface TrackingDetailsProps {
    /** AWB number to track */
    awbNumber: string;
    /** Whether to fetch data (lazy loading) */
    enabled?: boolean;
}

/**
 * Format datetime string from iThink API
 * Example input: "2025-01-15 14:30:00" or ISO format
 */
function formatDateTime(datetime: string | undefined): string {
    if (!datetime) return '-';
    try {
        const date = new Date(datetime);
        if (isNaN(date.getTime())) return datetime; // Return original if invalid
        return date.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return datetime;
    }
}

/**
 * Format date only (no time)
 */
function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return date.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

/**
 * Get badge classes for internal tracking status
 */
function getStatusBadge(data: IThinkTrackingData): { classes: string; label: string } {
    const internalStatus = resolveTrackingStatus(data.statusCode, data.currentStatus);
    const classes = getTrackingStatusClasses(internalStatus);
    const label = getTrackingStatusLabel(internalStatus);
    return { classes, label };
}

/**
 * Loading skeleton for tracking details
 */
function TrackingDetailsSkeleton() {
    return (
        <div className="animate-pulse space-y-3 mt-3">
            <div className="flex items-center gap-2">
                <div className="h-6 w-20 bg-slate-200 rounded-full" />
                <div className="h-4 w-32 bg-slate-200 rounded" />
            </div>
            <div className="h-4 w-48 bg-slate-200 rounded" />
            <div className="h-4 w-40 bg-slate-200 rounded" />
        </div>
    );
}

/**
 * Error state for tracking fetch failure
 */
function TrackingDetailsError({ message }: { message: string }) {
    return (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            <AlertCircle size={14} className="shrink-0" />
            <span>{message}</span>
        </div>
    );
}

/**
 * Single scan history item in the timeline
 */
function ScanHistoryItem({ scan, isLast }: { scan: IThinkScanHistoryItem; isLast: boolean }) {
    return (
        <div className="relative flex gap-3 pb-3">
            {/* Timeline line */}
            {!isLast && (
                <div className="absolute left-[7px] top-5 bottom-0 w-px bg-slate-200" />
            )}

            {/* Dot */}
            <div className="relative z-10 w-4 h-4 shrink-0 flex items-center justify-center mt-0.5">
                <div className="w-2 h-2 bg-slate-400 rounded-full" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-slate-700 leading-tight">{scan.status}</p>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                        {formatDateTime(scan.datetime)}
                    </span>
                </div>
                {scan.location && (
                    <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} className="shrink-0" />
                        {scan.location}
                    </p>
                )}
                {scan.remark && (
                    <p className="text-[10px] text-slate-500 mt-0.5 italic">{scan.remark}</p>
                )}
            </div>
        </div>
    );
}

/**
 * Main tracking details component
 */
export function TrackingDetails({ awbNumber, enabled = true }: TrackingDetailsProps) {
    const [showHistory, setShowHistory] = useState(false);
    const { data, isLoading, error, refetch, isFetching } = useIThinkTracking({
        awbNumber,
        enabled,
    });

    // Loading state
    if (isLoading) {
        return <TrackingDetailsSkeleton />;
    }

    // Error state
    if (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to fetch tracking';
        return <TrackingDetailsError message={errorMsg} />;
    }

    // No data state
    if (!data) {
        return null;
    }

    const statusBadge = getStatusBadge(data);
    const hasHistory = data.scanHistory && data.scanHistory.length > 0;

    return (
        <div className="mt-3 space-y-3">
            {/* Status Row */}
            <div className="flex items-center flex-wrap gap-2">
                {/* Main status badge */}
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge.classes}`}>
                    {statusBadge.label}
                </span>

                {/* RTO indicator */}
                {data.isRto && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
                        RTO
                    </span>
                )}

                {/* OFD count badge (if > 0) */}
                {data.ofdCount > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                        OFD x{data.ofdCount}
                    </span>
                )}

                {/* Refresh button */}
                <button
                    type="button"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="ml-auto p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    title="Refresh tracking"
                >
                    <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Expected delivery */}
            {data.expectedDeliveryDate && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                    <CalendarClock size={12} className="text-slate-400" />
                    <span>Expected: <span className="font-medium">{formatDate(data.expectedDeliveryDate)}</span></span>
                </div>
            )}

            {/* Last scan details */}
            {data.lastScan && (
                <div className="bg-slate-50 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <Clock size={12} className="text-slate-400" />
                        Last Update
                    </div>
                    <p className="text-xs text-slate-600">{data.lastScan.status}</p>
                    {data.lastScan.location && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                            <MapPin size={10} className="shrink-0" />
                            {data.lastScan.location}
                        </p>
                    )}
                    <p className="text-[10px] text-slate-400">{formatDateTime(data.lastScan.datetime)}</p>
                    {data.lastScan.remark && (
                        <p className="text-[10px] text-slate-500 italic">{data.lastScan.remark}</p>
                    )}
                </div>
            )}

            {/* Scan history (expandable) */}
            {hasHistory && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowHistory(!showHistory)}
                        className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium"
                    >
                        {showHistory ? (
                            <>
                                <ChevronUp size={14} />
                                Hide scan history
                            </>
                        ) : (
                            <>
                                <ChevronDown size={14} />
                                View scan history ({data.scanHistory.length})
                            </>
                        )}
                    </button>

                    {showHistory && (
                        <div className="mt-3 pl-1 max-h-64 overflow-y-auto">
                            {data.scanHistory.map((scan, index) => (
                                <ScanHistoryItem
                                    key={`${scan.datetime}-${index}`}
                                    scan={scan}
                                    isLast={index === data.scanHistory.length - 1}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
