/**
 * Fulfillment Columns - TanStack Table column definitions
 * Columns: workflow, production, notes, cancelLine
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    AdminShipCell,
    CancelLineCell,
    PickPackCell,
    ProductionCell,
    NotesCell,
    WorkflowCell,
} from '../cells';

export function buildFulfillmentColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef, isDateLocked } = ctx;

    return [
        // Combined Workflow (A → P → K → S)
        {
            id: 'workflow',
            header: getHeaderName('workflow'),
            size: DEFAULT_COLUMN_WIDTHS.workflow,
            cell: ({ row }) => <WorkflowCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Pick & Pack
        {
            id: 'pickPack',
            header: getHeaderName('pickPack'),
            size: DEFAULT_COLUMN_WIDTHS.pickPack,
            cell: ({ row }) => <PickPackCell row={row.original} handlersRef={handlersRef} />,
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

        // Cancel Line
        {
            id: 'cancelLine',
            header: getHeaderName('cancelLine'),
            size: DEFAULT_COLUMN_WIDTHS.cancelLine,
            cell: ({ row }) => <CancelLineCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Admin Ship (force ship - admin only)
        {
            id: 'adminShip',
            header: getHeaderName('adminShip'),
            size: DEFAULT_COLUMN_WIDTHS.adminShip,
            cell: ({ row }) => <AdminShipCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },
    ];
}
