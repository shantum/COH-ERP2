/**
 * Order Info Columns - TanStack Table column definitions
 * Columns: orderCustomer (combined order + customer), shipByDate
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    OrderCustomerCell,
    ShipByDateCell,
} from '../cells';

export function buildOrderInfoColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Order + Customer combined
        {
            id: 'orderCustomer',
            header: getHeaderName('orderCustomer'),
            size: DEFAULT_COLUMN_WIDTHS.orderCustomer,
            cell: ({ row }) => <OrderCustomerCell row={row.original} handlersRef={handlersRef} />,
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
