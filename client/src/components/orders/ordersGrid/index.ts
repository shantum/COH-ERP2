/**
 * OrdersGrid module exports
 *
 * This module contains extracted components and utilities from OrdersGrid.tsx
 * to improve maintainability and reduce file size.
 */

// Constants (non-styling)
export { ALL_COLUMN_IDS, COURIER_OPTIONS } from './constants';

// Formatting (styles, colors, status configs)
export {
    TIER_STYLES,
    STATUS_LEGEND_ITEMS,
    GRID_COLORS,
    TRACKING_STATUS_STYLES,
    PAYMENT_STYLES,
    getRowStyle,
    getRowClass,
    gridRowStyles,
} from './formatting';

// Types
export type { OrdersGridProps, CustomizeLineData, EditCustomizationData, ColumnBuilderContext } from './types';

// Cell Renderers
export { ProductionDatePopover } from './cellRenderers';

// Helpers
export { StatusLegend } from './helpers';
