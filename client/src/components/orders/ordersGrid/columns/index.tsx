/**
 * Column builders for OrdersGrid
 *
 * This module exports functions to build column definitions for AG-Grid.
 * Columns are organized by responsibility:
 * - Order Info: orderDate, orderAge, shipByDate, orderNumber, customerName, city, orderValue
 * - Payment: discountCode, paymentMethod, rtoHistory, customerNotes, customerOrderCount, customerLtv
 * - Line Items: skuCode, productName, customize, qty, skuStock, fabricBalance
 * - Fulfillment Actions: allocate, production, notes, pick, pack, ship, cancelLine
 * - Tracking: shopifyStatus, shopifyAwb, shopifyCourier, awb, courier, trackingStatus
 * - Post-Ship: shippedAt, deliveredAt, deliveryDays, daysInTransit, rtoInitiatedAt, etc.
 */

import type { ColDef } from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';

// Import column builders
import { buildOrderInfoColumns } from './orderInfoColumns';
import { buildPaymentColumns } from './paymentColumns';
import { buildLineItemColumns } from './lineItemColumns';
import { buildFulfillmentColumns } from './fulfillmentColumns';
import { buildTrackingColumns } from './trackingColumns';
import { buildPostShipColumns } from './postShipColumns';

export type { ColumnBuilderContext } from '../types';

/**
 * Build all column definitions from context
 * Returns columns in display order
 *
 * @param ctx - Context containing handlers and state for column rendering
 * @returns Array of AG-Grid column definitions
 */
export function buildAllColumns(ctx: ColumnBuilderContext): ColDef[] {
    return [
        ...buildOrderInfoColumns(ctx),
        ...buildPaymentColumns(ctx),
        ...buildLineItemColumns(ctx),
        ...buildFulfillmentColumns(ctx),
        ...buildTrackingColumns(ctx),
        ...buildPostShipColumns(ctx),
    ];
}

// Re-export individual builders for testing/customization
export { buildOrderInfoColumns };
export { buildPaymentColumns };
export { buildLineItemColumns };
export { buildFulfillmentColumns };
export { buildTrackingColumns };
export { buildPostShipColumns };
