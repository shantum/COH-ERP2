/**
 * Centralized formatting system for Orders AG-Grid
 *
 * This module provides a single source of truth for all conditional formatting
 * including colors, status styles, threshold-based styling, and reusable builders.
 *
 * Usage:
 * ```typescript
 * import {
 *   // Colors
 *   GRID_COLORS,
 *
 *   // Status helpers
 *   getLineStatusClasses,
 *   getTrackingStatusClasses,
 *   TRACKING_STATUS_STYLES,
 *
 *   // Threshold helpers
 *   getThresholdClasses,
 *   getThresholdTextClass,
 *
 *   // Cell class builders
 *   statusCellClass,
 *   thresholdCellClass,
 *   conditionalCellClass,
 *
 *   // Row styling
 *   getRowStyle,
 *   getRowClass,
 *   gridRowStyles,
 * } from './formatting';
 * ```
 */

// Types
export type {
    TailwindStyle,
    CSSStyle,
    GridColorStyle,
    ThresholdConfig,
    CellClassFn,
    RowClassFn,
    RowStyleFn,
    StatusLegendItem,
} from './types';

// Color palette
export {
    GRID_COLORS,
    URGENCY_COLORS,
    ROW_EFFECT_COLORS,
} from './colorPalette';

// Status styles
export {
    LINE_STATUS_STYLES,
    PENDING_SUBSTATUS_STYLES,
    TRACKING_STATUS_STYLES,
    FINAL_STATUS_STYLES,
    STOCK_STATUS_STYLES,
    TIER_STYLES,
    PAYMENT_STYLES,
    STATUS_LEGEND_ITEMS,
    getLineStatusClasses,
    getTrackingStatusClasses,
    getFinalStatusClasses,
    getTrackingStatusLabel,
} from './statusStyles';

// Threshold styles
export {
    ORDER_AGE_THRESHOLDS,
    DAYS_IN_TRANSIT_THRESHOLDS,
    DELIVERY_DAYS_THRESHOLDS,
    DAYS_SINCE_DELIVERY_THRESHOLDS,
    DAYS_IN_RTO_THRESHOLDS,
    THRESHOLD_CONFIGS,
    getThresholdStyle,
    getThresholdClasses,
    getThresholdTextClass,
} from './thresholdStyles';
export type { ThresholdConfigKey } from './thresholdStyles';

// Cell class builders
export {
    statusCellClass,
    thresholdCellClass,
    thresholdTextCellClass,
    conditionalCellClass,
    hasValueCellClass,
    editableCellClass,
    composeCellClass,
    withBaseClasses,
} from './cellClassBuilders';

// Row styling
export {
    getRowStyle,
    getRowClass,
    gridRowStyles,
    ROW_STYLES,
} from './rowStyleBuilders';
