/**
 * Payment Columns - TanStack Table column definitions
 * Columns: tags, customerNotes, customerTags
 * Note: paymentInfo column is now in orderInfoColumns.tsx
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import { TagsCell, CustomerNotesCell, CustomerTagsCell } from '../cells';

export function buildPaymentColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName } = ctx;

    return [
        // Tags
        {
            id: 'tags',
            header: getHeaderName('tags'),
            size: DEFAULT_COLUMN_WIDTHS.tags,
            cell: ({ row }) => <TagsCell row={row.original} />,
        },

        // Customer Notes
        {
            id: 'customerNotes',
            header: getHeaderName('customerNotes'),
            size: DEFAULT_COLUMN_WIDTHS.customerNotes,
            cell: ({ row }) => <CustomerNotesCell row={row.original} />,
        },

        // Customer Tags
        {
            id: 'customerTags',
            header: getHeaderName('customerTags'),
            size: DEFAULT_COLUMN_WIDTHS.customerTags,
            cell: ({ row }) => <CustomerTagsCell row={row.original} />,
        },
    ];
}
