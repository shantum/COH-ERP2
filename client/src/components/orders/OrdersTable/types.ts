/**
 * Type definitions for OrdersTable component (monitoring dashboard)
 */

import type { MutableRefObject } from 'react';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import type { Order } from '../../../types';

/**
 * View type for order views
 */
export type OrderViewType = 'all' | 'in_transit' | 'delivered' | 'rto' | 'cancelled';

/**
 * Dynamic values accessed via ref for stable column context.
 */
export interface DynamicColumnHandlers {
    onViewOrder: (orderNumber: string) => void;
    onViewCustomer: (order: Order) => void;
}

/**
 * Context passed to cell components.
 */
export interface OrdersTableContext {
    getHeaderName: (colId: string) => string;
    setCustomHeader: (colId: string, value: string) => void;
    currentView?: OrderViewType;
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
}

/**
 * Common cell component props
 */
export interface CellProps {
    row: FlattenedOrderRow;
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
}

/**
 * Props for OrdersTable component
 */
export interface OrdersTableProps {
    rows: FlattenedOrderRow[];
    currentView?: OrderViewType;
    onViewOrder: (orderNumber: string) => void;
    onViewCustomer: (order: Order) => void;
}
