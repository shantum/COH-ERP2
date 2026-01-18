/**
 * ShopifyTrackingCell - Combined display for Shopify status, AWB and courier
 * Line 1: AWB number (monospace)
 * Line 2: Courier · Status
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface ShopifyTrackingCellProps {
    row: FlattenedOrderRow;
}

export function ShopifyTrackingCell({ row }: ShopifyTrackingCellProps) {
    if (!row.isFirstLine) return null;

    const awb = row.shopifyAwb;
    const courier = row.shopifyCourier;
    const status = row.shopifyStatus;

    // If no tracking info, show "Unfulfilled" status
    if (!awb && !courier && (!status || status === '-' || status === 'unfulfilled')) {
        return (
            <span className="text-gray-400 text-[11px]">
                Unfulfilled
            </span>
        );
    }

    // Build line 2 parts
    const line2Parts: string[] = [];
    if (courier) line2Parts.push(courier);
    if (status && status !== '-') line2Parts.push(status);

    return (
        <div className="flex flex-col leading-tight">
            {/* Line 1: AWB */}
            <span className="font-mono text-[11px] text-gray-700 truncate" title={awb || undefined}>
                {awb || '-'}
            </span>
            {/* Line 2: Courier · Status */}
            <span className="text-[10px] text-gray-500 truncate">
                {line2Parts.length > 0 ? line2Parts.join(' · ') : '-'}
            </span>
        </div>
    );
}
