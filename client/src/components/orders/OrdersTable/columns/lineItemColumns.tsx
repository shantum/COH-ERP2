/**
 * Line Item Columns - TanStack Table column definitions
 * Columns: productName, qty, unitPrice, cost, margin, fabricColour, fabricBalance
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    ProductNameCell,
    QtyStockCell,
    UnitPriceCell,
    CostCell,
    MarginCell,
    FabricColourCell,
    FabricBalanceCell,
} from '../cells';

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
        {
            id: 'qty',
            header: getHeaderName('qty'),
            size: DEFAULT_COLUMN_WIDTHS.qty,
            cell: ({ row }) => <QtyStockCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.qty || 0) - (b.original.qty || 0),
        },
        {
            id: 'unitPrice',
            header: getHeaderName('unitPrice'),
            size: DEFAULT_COLUMN_WIDTHS.unitPrice,
            cell: ({ row }) => <UnitPriceCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.unitPrice || 0) - (b.original.unitPrice || 0),
        },
        {
            id: 'cost',
            header: getHeaderName('cost'),
            size: DEFAULT_COLUMN_WIDTHS.cost,
            cell: ({ row }) => <CostCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.bomCost || 0) - (b.original.bomCost || 0),
        },
        {
            id: 'margin',
            header: getHeaderName('margin'),
            size: DEFAULT_COLUMN_WIDTHS.margin,
            cell: ({ row }) => <MarginCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.margin || 0) - (b.original.margin || 0),
        },
        {
            id: 'fabricColour',
            header: getHeaderName('fabricColour'),
            size: DEFAULT_COLUMN_WIDTHS.fabricColour,
            cell: ({ row }) => <FabricColourCell row={row.original} />,
            enableSorting: true,
        },
        {
            id: 'fabricBalance',
            header: getHeaderName('fabricBalance'),
            size: DEFAULT_COLUMN_WIDTHS.fabricBalance,
            cell: ({ row }) => <FabricBalanceCell row={row.original} />,
            enableSorting: true,
        },
    ];
}
