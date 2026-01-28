/**
 * Order Info Columns - TanStack Table column definitions
 * Columns: orderInfo, customerInfo, paymentInfo, shipByDate
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    OrderInfoCell,
    ChannelCell,
    CustomerInfoCell,
    PaymentInfoCell,
    ShipByDateCell,
} from '../cells';

export function buildOrderInfoColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Order Number + Date/Time
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

        // Channel (Shopify, COH, Myntra, etc.)
        {
            id: 'channel',
            header: getHeaderName('channel'),
            size: DEFAULT_COLUMN_WIDTHS.channel,
            cell: ({ row }) => <ChannelCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => {
                const chA = a.original.channel || 'shopify';
                const chB = b.original.channel || 'shopify';
                return chA.localeCompare(chB);
            },
        },

        // Customer Name, City, Orders, LTV
        {
            id: 'customerInfo',
            header: getHeaderName('customerInfo'),
            size: DEFAULT_COLUMN_WIDTHS.customerInfo,
            cell: ({ row }) => <CustomerInfoCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: true,
            sortingFn: (a, b) => {
                const nameA = a.original.customerName || '';
                const nameB = b.original.customerName || '';
                return nameA.localeCompare(nameB);
            },
        },

        // Order Value, Payment Method, Discount Code
        {
            id: 'paymentInfo',
            header: getHeaderName('paymentInfo'),
            size: DEFAULT_COLUMN_WIDTHS.paymentInfo,
            cell: ({ row }) => <PaymentInfoCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.totalAmount || 0) - (b.original.totalAmount || 0),
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
