/**
 * Column definitions for OrdersTable (TanStack Table)
 * Barrel export and column builder aggregator
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';

import { buildOrderInfoColumns } from './orderInfoColumns';
import { buildPaymentColumns } from './paymentColumns';
import { buildLineItemColumns } from './lineItemColumns';
import { buildFulfillmentColumns } from './fulfillmentColumns';
import { buildTrackingColumns } from './trackingColumns';

// Re-export individual builders
export { buildOrderInfoColumns } from './orderInfoColumns';
export { buildPaymentColumns } from './paymentColumns';
export { buildLineItemColumns } from './lineItemColumns';
export { buildFulfillmentColumns } from './fulfillmentColumns';
export { buildTrackingColumns } from './trackingColumns';

/**
 * Build all columns in the correct order
 */
export function buildAllColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    return [
        ...buildOrderInfoColumns(ctx),
        ...buildPaymentColumns(ctx),
        ...buildLineItemColumns(ctx),
        ...buildFulfillmentColumns(ctx),
        ...buildTrackingColumns(ctx),
    ];
}

/**
 * Get columns filtered by view type
 */
export function getColumnsForView(
    columns: ColumnDef<FlattenedOrderRow>[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _view: string
): ColumnDef<FlattenedOrderRow>[] {
    // All views use the same columns now
    return columns;
}
