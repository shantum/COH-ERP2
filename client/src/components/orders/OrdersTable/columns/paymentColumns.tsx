/**
 * Payment Columns - REMOVED
 * Tags, customer notes, and customer tags columns removed in monitoring dashboard
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildPaymentColumns(_ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    return [];
}
