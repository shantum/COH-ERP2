/**
 * ShopifyTrackingCell - Shopify fulfillment status display
 * Shows Shopify icon to indicate data source
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface ShopifyTrackingCellProps {
    row: FlattenedOrderRow;
}

// Shopify bag icon (simplified SVG)
function ShopifyIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={cn('w-4 h-4', className)}
        >
            <path d="M15.337 3.415c-.03-.015-.06-.03-.098-.03-.03 0-.067.008-.097.023-.03.007-.69.21-1.5.463-.18-.54-.495-1.035-.915-1.395-.63-.54-1.41-.75-2.235-.69-.165-.24-.39-.435-.675-.54-.51-.21-1.125-.15-1.65.15-.525.3-.885.81-1.005 1.41-.195.06-.39.12-.57.18-.24.09-.42.27-.48.51-.06.24.015.495.195.66.12.12.27.195.435.21.03.42.12.84.27 1.23l-1.245 3.825c-.03.09-.03.18 0 .27l.765 2.34c.075.24.285.39.525.39h.045l8.205-.87c.24-.03.435-.21.48-.45l1.02-5.22c.03-.12.015-.24-.03-.36-.105-.24-.39-.465-.675-.585zm-4.485 9.39l-6.015.64-.585-1.785 1.02-3.15c.24.39.54.72.885.99.345.27.735.48 1.155.615l-.345 1.065c-.03.09-.015.195.03.285.045.09.12.15.21.18.03.015.06.015.09.015.15 0 .285-.09.345-.24l.36-1.095c.39.06.795.06 1.185 0l.36 1.095c.06.15.195.24.345.24.03 0 .06 0 .09-.015.09-.03.165-.09.21-.18.045-.09.06-.195.03-.285l-.345-1.065c.42-.135.81-.345 1.155-.615.345-.27.645-.6.885-.99l1.02 3.15-.585 1.785z"/>
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
    unfulfilled: { label: 'Unfulfilled', labelClass: 'text-amber-600' },
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

    const state = getFulfillmentState(status, awb);
    const config = stateConfig[state];

    // Unfulfilled - minimal display
    if (state === 'unfulfilled') {
        return (
            <div className="flex items-center gap-1.5">
                <ShopifyIcon className="text-[#96bf48]" />
                <span className={cn('text-[11px]', config.labelClass)}>
                    {config.label}
                </span>
            </div>
        );
    }

    // Has tracking info
    return (
        <div className="flex items-center gap-1.5">
            <ShopifyIcon className="text-[#96bf48] shrink-0" />
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
