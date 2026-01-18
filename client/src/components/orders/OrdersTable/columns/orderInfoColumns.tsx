/**
 * Order Info Columns - TanStack Table column definitions
 * Columns: order (combined order + customer + payment), shipByDate
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    OrderCell,
    ShipByDateCell,
} from '../cells';

export function buildOrderInfoColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Combined Order + Customer + Payment
        {
            id: 'order',
            header: getHeaderName('order'),
            size: DEFAULT_COLUMN_WIDTHS.order,
            cell: ({ row }) => <OrderCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
            sortingFn: (a, b) => {
                const dateA = new Date(a.original.orderDate).getTime();
                const dateB = new Date(b.original.orderDate).getTime();
                return dateA - dateB;
            },
        },

        // Ship By Date
        {
            id: 'shipByDate',
            header: getHeaderName('shipByDate'),
            size: DEFAULT_COLUMN_WIDTHS.shipByDate,
            cell: ({ row }) => <ShipByDateCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
        },
    ];
}
