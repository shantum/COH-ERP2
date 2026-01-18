/**
 * Tracking Columns - TanStack Table column definitions
 * Columns: shopifyTracking (combined: status + AWB + courier), awb, courier, trackingStatus
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    AwbCell,
    CourierCell,
    TrackingStatusCell,
    ShopifyTrackingCell,
} from '../cells';

export function buildTrackingColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Shopify Tracking (combined: status + AWB + courier)
        {
            id: 'shopifyTracking',
            header: getHeaderName('shopifyTracking'),
            size: DEFAULT_COLUMN_WIDTHS.shopifyTracking,
            cell: ({ row }) => <ShopifyTrackingCell row={row.original} />,
            enableSorting: true,
        },

        // AWB (editable)
        {
            id: 'awb',
            header: getHeaderName('awb'),
            size: DEFAULT_COLUMN_WIDTHS.awb,
            cell: ({ row }) => <AwbCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
        },

        // Courier (editable dropdown)
        {
            id: 'courier',
            header: getHeaderName('courier'),
            size: DEFAULT_COLUMN_WIDTHS.courier,
            cell: ({ row }) => <CourierCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
        },

        // Tracking Status
        {
            id: 'trackingStatus',
            header: getHeaderName('trackingStatus'),
            size: DEFAULT_COLUMN_WIDTHS.trackingStatus,
            cell: ({ row }) => <TrackingStatusCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
