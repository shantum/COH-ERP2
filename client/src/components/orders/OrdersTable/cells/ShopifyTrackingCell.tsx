/**
 * ShopifyTrackingCell - Shopify fulfillment status display
 * Shows Shopify icon to indicate data source
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface ShopifyTrackingCellProps {
    row: FlattenedOrderRow;
}

// Official Shopify bag icon
function ShopifyIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 109.5 124.5"
            className={cn('w-4 h-4', className)}
        >
            <path
                fill="#95BF47"
                d="M95.9,23.9c-0.1-0.6-0.6-1-1.1-1c-0.5,0-9.3-0.2-9.3-0.2s-7.4-7.2-8.1-7.9c-0.7-0.7-2.2-0.5-2.7-0.3
                c0,0-1.4,0.4-3.7,1.1c-0.4-1.3-1-2.8-1.8-4.4c-2.6-5-6.5-7.7-11.1-7.7c0,0,0,0,0,0c-0.3,0-0.6,0-1,0.1c-0.1-0.2-0.3-0.3-0.4-0.5
                c-2-2.2-4.6-3.2-7.7-3.1c-6,0.2-12,4.5-16.8,12.2c-3.4,5.4-6,12.2-6.8,17.5c-6.9,2.1-11.7,3.6-11.8,3.7c-3.5,1.1-3.6,1.2-4,4.5
                c-0.3,2.5-9.5,73-9.5,73l76.4,13.2l33.1-8.2C109.5,115.8,96,24.5,95.9,23.9z M67.2,16.8c-1.8,0.5-3.8,1.2-5.9,1.8
                c0-3-0.4-7.3-1.8-10.9C64,8.6,66.2,13.7,67.2,16.8z M57.2,19.9c-4,1.2-8.4,2.6-12.8,3.9c1.2-4.7,3.6-9.4,6.4-12.5
                c1.1-1.1,2.6-2.4,4.3-3.2C56.9,11.6,57.3,16.5,57.2,19.9z M49.1,4c1.4,0,2.6,0.3,3.6,0.9C51.1,5.8,49.5,7,48,8.6
                c-3.8,4.1-6.7,10.5-7.9,16.6c-3.6,1.1-7.2,2.2-10.5,3.2C31.7,18.8,39.8,4.3,49.1,4z"
            />
            <path
                fill="#5E8E3E"
                d="M94.8,22.9c-0.5,0-9.3-0.2-9.3-0.2s-7.4-7.2-8.1-7.9c-0.3-0.3-0.6-0.4-1-0.5l0,109.7l33.1-8.2
                c0,0-13.5-91.3-13.6-92C95.8,23.3,95.3,22.9,94.8,22.9z"
            />
            <path
                fill="#FFFFFF"
                d="M58,39.9l-3.8,14.4c0,0-4.3-2-9.4-1.6c-7.5,0.5-7.5,5.2-7.5,6.4c0.4,6.4,17.3,7.8,18.3,22.9
                c0.7,11.9-6.3,20-16.4,20.6c-12.2,0.8-18.9-6.4-18.9-6.4l2.6-11c0,0,6.7,5.1,12.1,4.7c3.5-0.2,4.8-3.1,4.7-5.1
                c-0.5-8.4-14.3-7.9-15.2-21.7c-0.7-11.6,6.9-23.4,23.7-24.4C54.7,38.2,58,39.9,58,39.9z"
            />
        </svg>
    );
}

type FulfillmentState = 'unfulfilled' | 'fulfilled' | 'in_transit' | 'delivered' | 'partial';

function getFulfillmentState(status: string | null | undefined, awb: string | null): FulfillmentState {
    if (!status || status === '-' || status === 'unfulfilled') {
        return awb ? 'in_transit' : 'unfulfilled';
    }
    const s = status.toLowerCase();
    if (s.includes('deliver')) return 'delivered';
    if (s.includes('transit') || s.includes('ship')) return 'in_transit';
    if (s.includes('partial')) return 'partial';
    if (s.includes('fulfil')) return 'fulfilled';
    return 'fulfilled';
}

const stateConfig: Record<FulfillmentState, { label: string; labelClass: string }> = {
    unfulfilled: { label: 'Unfulfilled', labelClass: 'text-slate-400' },
    fulfilled: { label: 'Fulfilled', labelClass: 'text-emerald-600' },
    in_transit: { label: 'In Transit', labelClass: 'text-blue-600' },
    delivered: { label: 'Delivered', labelClass: 'text-emerald-600' },
    partial: { label: 'Partial', labelClass: 'text-orange-600' },
};

export function ShopifyTrackingCell({ row }: ShopifyTrackingCellProps) {
    if (!row.isFirstLine) return null;

    const awb = row.shopifyAwb;
    const courier = row.shopifyCourier;
    const status = row.shopifyStatus;

    const state = getFulfillmentState(status, awb ?? null);
    const config = stateConfig[state];

    // Unfulfilled - minimal display, greyed out
    if (state === 'unfulfilled') {
        return (
            <div className="flex items-center gap-1.5 opacity-40">
                <ShopifyIcon />
                <span className="text-[11px] text-slate-500">
                    {config.label}
                </span>
            </div>
        );
    }

    // Has tracking info
    return (
        <div className="flex items-center gap-1.5">
            <ShopifyIcon className="shrink-0" />
            <div className="flex flex-col min-w-0">
                {awb && (
                    <span
                        className="font-mono text-[11px] text-gray-700 truncate"
                        title={awb}
                    >
                        {awb}
                    </span>
                )}
                <span className="text-[10px] text-gray-500 truncate">
                    {courier && <span>{courier} · </span>}
                    <span className={config.labelClass}>{config.label}</span>
                </span>
            </div>
        </div>
    );
}
