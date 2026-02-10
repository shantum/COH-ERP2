/**
 * Payment Columns - REMOVED
 * Tags, customer notes, and customer tags columns removed in monitoring dashboard
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';

export function buildPaymentColumns(_ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    return [];
}
