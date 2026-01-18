/**
 * Order Info Columns - TanStack Table column definitions
 * Columns: orderInfo (combined), shipByDate, customerInfo (combined)
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    OrderInfoCell,
    CustomerInfoCell,
    ShipByDateCell,
} from '../cells';

export function buildOrderInfoColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Order Info (combined: order number, date, age)
        {
            id: 'orderInfo',
            header: getHeaderName('orderInfo'),
            size: DEFAULT_COLUMN_WIDTHS.orderInfo,
            cell: ({ row }) => <OrderInfoCell row={row.original} handlersRef={handlersRef} />,
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

        // Customer Info (combined: customer name, city, order count, LTV)
        {
            id: 'customerInfo',
            header: getHeaderName('customerInfo'),
            size: DEFAULT_COLUMN_WIDTHS.customerInfo,
            cell: ({ row }) => <CustomerInfoCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
            sortingFn: (a, b) => a.original.customerName.localeCompare(b.original.customerName),
        },
    ];
}
