/**
 * Fulfillment Columns - TanStack Table column definitions
 *
 * STRIPPED: Workflow (A→P→K→S), PickPack, CancelLine, AdminShip columns removed.
 * Fulfillment now managed in Google Sheets. Only production and notes remain.
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    ProductionCell,
    NotesCell,
} from '../cells';

export function buildFulfillmentColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef, isDateLocked } = ctx;

    return [
        // Production
        {
            id: 'production',
            header: getHeaderName('production'),
            size: DEFAULT_COLUMN_WIDTHS.production,
            cell: ({ row }) => (
                <ProductionCell
                    row={row.original}
                    handlersRef={handlersRef}
                    isDateLocked={isDateLocked}
                />
            ),
            enableSorting: false,
        },

        // Notes
        {
            id: 'notes',
            header: getHeaderName('notes'),
            size: DEFAULT_COLUMN_WIDTHS.notes,
            cell: ({ row }) => <NotesCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },
    ];
}
