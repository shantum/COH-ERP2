/**
 * FulfillmentCell - Rich shipment status cell
 * Compact card showing channel status, courier + AWB, and live tracking
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { TRACKING_STATUS_STYLES } from '../styleConfig';
import { cn } from '../../../../lib/utils';
import { Truck, Package, CircleCheck, CircleX, RotateCcw } from 'lucide-react';

// ── Status config ──────────────────────────────────────────────────────────

interface StatusConfig {
    bg: string;
    text: string;
    border: string;
    icon: 'package' | 'truck' | 'check' | 'x' | 'rto';
    label: string;
}

const STATUS: Record<string, StatusConfig> = {
    pending:       { bg: 'bg-gray-50',    text: 'text-gray-500',   border: 'border-gray-200',  icon: 'package', label: 'Unfulfilled' },
    allocated:     { bg: 'bg-sky-50',     text: 'text-sky-600',    border: 'border-sky-200',   icon: 'package', label: 'Allocated' },
    in_progress:   { bg: 'bg-amber-50',   text: 'text-amber-600',  border: 'border-amber-200', icon: 'package', label: 'In Progress' },
    ready_to_ship: { bg: 'bg-indigo-50',  text: 'text-indigo-600', border: 'border-indigo-200',icon: 'package', label: 'Ready to Ship' },
    shipped:       { bg: 'bg-blue-50',    text: 'text-blue-600',   border: 'border-blue-200',  icon: 'truck',   label: 'Shipped' },
    delivered:     { bg: 'bg-emerald-50', text: 'text-emerald-600',border: 'border-emerald-200',icon: 'check',  label: 'Delivered' },
    cancelled:     { bg: 'bg-red-50',     text: 'text-red-500',    border: 'border-red-200',   icon: 'x',       label: 'Cancelled' },
    fulfilled:     { bg: 'bg-emerald-50', text: 'text-emerald-600',border: 'border-emerald-200',icon: 'check',  label: 'Fulfilled' },
    partial:       { bg: 'bg-amber-50',   text: 'text-amber-600',  border: 'border-amber-200', icon: 'package', label: 'Partial' },
};

const ICON_MAP = {
    package: Package,
    truck: Truck,
    check: CircleCheck,
    x: CircleX,
    rto: RotateCcw,
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatChannel(channel: string | null): string {
    if (!channel) return 'Shopify';
    const map: Record<string, string> = {
        shopify_online: 'Shopify', shopify: 'Shopify',
        myntra: 'Myntra', ajio: 'Ajio',
        amazon: 'Amazon', flipkart: 'Flipkart', website: 'Website',
    };
    return map[channel.toLowerCase()] || channel;
}

function resolveStatus(row: FlattenedOrderRow): StatusConfig {
    const ls = row.lineStatus;
    if (ls === 'shipped' || ls === 'delivered' || ls === 'cancelled') {
        return STATUS[ls] || STATUS.pending;
    }
    const shopify = row.shopifyStatus;
    if (shopify && shopify !== '-') {
        const key = shopify.toLowerCase().replace(/\s+/g, '_');
        if (STATUS[key]) return STATUS[key];
    }
    const stage = row.fulfillmentStage || 'pending';
    return STATUS[stage] || STATUS.pending;
}

// ── Component ──────────────────────────────────────────────────────────────

export const FulfillmentCell = memo(function FulfillmentCell({ row }: { row: FlattenedOrderRow }) {
    const channel = formatChannel(row.channel);
    const status = resolveStatus(row);
    const Icon = ICON_MAP[status.icon];

    const courier = row.lineCourier || row.shopifyCourier || null;
    const awb = row.lineAwbNumber || row.shopifyAwb || null;
    const hasShipment = courier || awb;

    const trackingStatus = row.lineTrackingStatus;
    const trackingStyle = trackingStatus ? TRACKING_STATUS_STYLES[trackingStatus] : null;

    return (
        <div
            className={cn(
                'flex items-start gap-1.5 px-2 py-1 rounded-md border',
                status.bg, status.border,
            )}
        >
            {/* Icon */}
            <Icon size={13} className={cn('shrink-0 mt-0.5', status.text)} strokeWidth={2} />

            {/* Content */}
            <div className="flex flex-col min-w-0 gap-px">
                {/* Channel · Status */}
                <div className="flex items-center gap-1">
                    <span className={cn('text-[10px] font-semibold', status.text)}>
                        {status.label}
                    </span>
                    <span className="text-[9px] text-gray-400">
                        {channel}
                    </span>
                </div>

                {/* Courier · AWB */}
                {hasShipment && (
                    <div className="flex items-center gap-1 text-[10px] text-gray-500">
                        {courier && <span className="font-medium">{courier}</span>}
                        {awb && (
                            <span className="font-mono text-gray-400 truncate max-w-[80px]" title={awb}>
                                {awb}
                            </span>
                        )}
                    </div>
                )}

                {/* Live tracking badge */}
                {trackingStyle && (
                    <span
                        className={cn(
                            'inline-flex items-center w-fit px-1 py-px rounded text-[9px] font-medium mt-px',
                            trackingStyle.bg, trackingStyle.text,
                        )}
                    >
                        {trackingStyle.label}
                    </span>
                )}
            </div>
        </div>
    );
});
