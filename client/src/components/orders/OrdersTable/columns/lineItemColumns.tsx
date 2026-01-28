/**
 * Line Item Columns - TanStack Table column definitions
 * Columns: productName, customize, qty, skuStock, fabricBalance
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    ProductNameCell,
    QtyStockCell,
    AssignStockCell,
    ReturnStatusCell,
    CustomizeCell,
    FabricBalanceCell,
} from '../cells';

export function buildLineItemColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Product Name
        {
            id: 'productName',
            header: getHeaderName('productName'),
            size: DEFAULT_COLUMN_WIDTHS.productName,
            cell: ({ row }) => <ProductNameCell row={row.original} />,
            enableSorting: true,
        },

        // Return Status
        {
            id: 'returnStatus',
            header: getHeaderName('returnStatus'),
            size: 90,
            cell: ({ row }) => <ReturnStatusCell row={row.original} />,
            enableSorting: false,
        },

        // Customize
        {
            id: 'customize',
            header: getHeaderName('customize'),
            size: DEFAULT_COLUMN_WIDTHS.customize,
            cell: ({ row }) => <CustomizeCell row={row.original} handlersRef={handlersRef} />,
        },

        // Quantity + Stock (combined)
        {
            id: 'qty',
            header: getHeaderName('qty'),
            size: DEFAULT_COLUMN_WIDTHS.qty,
            cell: ({ row }) => <QtyStockCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.qty || 0) - (b.original.qty || 0),
        },

        // Assign Stock
        {
            id: 'assignStock',
            header: getHeaderName('assignStock'),
            size: DEFAULT_COLUMN_WIDTHS.assignStock,
            cell: ({ row }) => <AssignStockCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Fabric Balance
        {
            id: 'fabricBalance',
            header: getHeaderName('fabricBalance'),
            size: DEFAULT_COLUMN_WIDTHS.fabricBalance,
            cell: ({ row }) => <FabricBalanceCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
