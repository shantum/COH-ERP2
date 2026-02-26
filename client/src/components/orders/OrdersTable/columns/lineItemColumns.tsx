/**
 * Line Item Columns - TanStack Table column definitions
 * Columns: productName
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import { ProductNameCell } from '../cells';

export function buildLineItemColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    return [
        {
            id: 'productName',
            header: getHeaderName('productName'),
            size: DEFAULT_COLUMN_WIDTHS.productName,
            cell: ({ row }) => <ProductNameCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
