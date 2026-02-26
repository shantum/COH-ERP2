/**
 * Tracking Columns - TanStack Table column definitions
 * Columns: fulfillment (channel status + courier + AWB + tracking)
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import { FulfillmentCell } from '../cells';

export function buildTrackingColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    return [
        {
            id: 'fulfillment',
            header: getHeaderName('fulfillment'),
            size: DEFAULT_COLUMN_WIDTHS.fulfillment,
            cell: ({ row }) => <FulfillmentCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
