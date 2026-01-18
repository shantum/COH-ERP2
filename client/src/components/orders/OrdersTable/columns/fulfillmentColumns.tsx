/**
 * Fulfillment Columns - TanStack Table column definitions
 * Columns: allocate, production, notes, pick, pack, ship, cancelLine
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    AllocateCell,
    PickCell,
    PackCell,
    ShipCell,
    CancelLineCell,
    ProductionCell,
    NotesCell,
} from '../cells';

export function buildFulfillmentColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef, isDateLocked } = ctx;

    return [
        // Allocate
        {
            id: 'allocate',
            header: getHeaderName('allocate'),
            size: DEFAULT_COLUMN_WIDTHS.allocate,
            cell: ({ row }) => <AllocateCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

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

        // Pick
        {
            id: 'pick',
            header: getHeaderName('pick'),
            size: DEFAULT_COLUMN_WIDTHS.pick,
            cell: ({ row }) => <PickCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Pack
        {
            id: 'pack',
            header: getHeaderName('pack'),
            size: DEFAULT_COLUMN_WIDTHS.pack,
            cell: ({ row }) => <PackCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Ship
        {
            id: 'ship',
            header: getHeaderName('ship'),
            size: DEFAULT_COLUMN_WIDTHS.ship,
            cell: ({ row }) => <ShipCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Cancel Line
        {
            id: 'cancelLine',
            header: getHeaderName('cancelLine'),
            size: DEFAULT_COLUMN_WIDTHS.cancelLine,
            cell: ({ row }) => <CancelLineCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },
    ];
}
