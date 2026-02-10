/**
 * Misc Columns - TanStack Table column definitions
 * Columns: notes (read-only)
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import { NotesCell } from '../cells';

export function buildFulfillmentColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    return [
        {
            id: 'notes',
            header: getHeaderName('notes'),
            size: DEFAULT_COLUMN_WIDTHS.notes,
            cell: ({ row }) => <NotesCell row={row.original} />,
            enableSorting: false,
        },
    ];
}
