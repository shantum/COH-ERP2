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
import { buildPostShipColumns } from './postShipColumns';

// Re-export individual builders
export { buildOrderInfoColumns } from './orderInfoColumns';
export { buildPaymentColumns } from './paymentColumns';
export { buildLineItemColumns } from './lineItemColumns';
export { buildFulfillmentColumns } from './fulfillmentColumns';
export { buildTrackingColumns } from './trackingColumns';
export { buildPostShipColumns } from './postShipColumns';

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
        ...buildPostShipColumns(ctx),
    ];
}

/**
 * Get columns filtered by view type
 * Different views may show different column subsets
 */
export function getColumnsForView(
    columns: ColumnDef<FlattenedOrderRow>[],
    view: 'open' | 'shipped' | 'rto' | 'cod_pending' | 'archived' | 'cancelled'
): ColumnDef<FlattenedOrderRow>[] {
    // Post-ship column IDs
    const postShipColumnIds = [
        'shippedAt', 'deliveredAt', 'deliveryDays', 'daysInTransit',
        'rtoInitiatedAt', 'daysInRto', 'daysSinceDelivery', 'codRemittedAt',
        'archivedAt', 'finalStatus',
    ];

    // Open view: hide post-ship columns
    if (view === 'open') {
        return columns.filter(col => !postShipColumnIds.includes((col as any).id));
    }

    // Shipped/RTO/COD pending views: show all columns
    return columns;
}
