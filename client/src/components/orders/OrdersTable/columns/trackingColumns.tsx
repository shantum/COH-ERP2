/**
 * Tracking Columns - TanStack Table column definitions
 * Columns: trackingInfo (read-only), trackingStatus
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    TrackingInfoCell,
    TrackingStatusCell,
} from '../cells';

export function buildTrackingColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    return [
        {
            id: 'trackingInfo',
            header: getHeaderName('trackingInfo'),
            size: DEFAULT_COLUMN_WIDTHS.trackingInfo,
            cell: ({ row }) => <TrackingInfoCell row={row.original} />,
            enableSorting: true,
        },
        {
            id: 'trackingStatus',
            header: getHeaderName('trackingStatus'),
            size: DEFAULT_COLUMN_WIDTHS.trackingStatus,
            cell: ({ row }) => <TrackingStatusCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
