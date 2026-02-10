/**
 * OrdersTable module - TanStack Table implementation for orders
 */

// Main component
export { OrdersTable, default } from './OrdersTable';

// Types
export type {
    OrderViewType,
    OrdersTableProps,
    OrdersTableContext,
    DynamicColumnHandlers,
    CellProps,
} from './types';

// Hooks
export { useOrdersTableState } from './useOrdersTableState';

// Constants
export {
    ALL_COLUMN_IDS,
    DEFAULT_VISIBLE_COLUMNS,
    DEFAULT_HEADERS,
    DEFAULT_COLUMN_WIDTHS,
    COURIER_OPTIONS,
    ROW_HEIGHT,
    TABLE_ID,
} from './constants';

// Styling utilities
export { getRowClassName, TRACKING_STATUS_STYLES, PAYMENT_STYLES } from './rowStyling';

// Cells (for custom column builders)
export * from './cells';

// Columns
export { buildAllColumns, getColumnsForView } from './columns';
