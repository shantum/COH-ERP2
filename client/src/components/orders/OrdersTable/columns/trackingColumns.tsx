/**
 * Tracking Columns - TanStack Table column definitions
 * Columns: shopifyTracking, trackingInfo (AWB + courier combined), trackingStatus
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    TrackingInfoCell,
    TrackingStatusCell,
    ShopifyTrackingCell,
} from '../cells';

export function buildTrackingColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Shopify Tracking (combined: status + AWB + courier from Shopify)
        {
            id: 'shopifyTracking',
            header: getHeaderName('shopifyTracking'),
            size: DEFAULT_COLUMN_WIDTHS.shopifyTracking,
            cell: ({ row }) => <ShopifyTrackingCell row={row.original} />,
            enableSorting: true,
        },

        // ERP Tracking Info (AWB + Courier combined, editable)
        {
            id: 'trackingInfo',
            header: getHeaderName('trackingInfo'),
            size: DEFAULT_COLUMN_WIDTHS.trackingInfo,
            cell: ({ row }) => <TrackingInfoCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
        },

        // Tracking Status (from iThink)
        {
            id: 'trackingStatus',
            header: getHeaderName('trackingStatus'),
            size: DEFAULT_COLUMN_WIDTHS.trackingStatus,
            cell: ({ row }) => <TrackingStatusCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
