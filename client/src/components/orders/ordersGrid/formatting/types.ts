/**
 * Type definitions for centralized grid formatting system
 */

import type { CellClassParams, RowClassParams, RowStyle } from 'ag-grid-community';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

/**
 * Style configuration for Tailwind-based styling (cells, badges)
 */
export interface TailwindStyle {
    bg: string;      // Tailwind background class (e.g., 'bg-green-100')
    text: string;    // Tailwind text class (e.g., 'text-green-700')
    border?: string; // Optional Tailwind border class
}

/**
 * Style configuration for CSS-based styling (rows)
 * Uses hex colors for AG-Grid's getRowStyle which needs CSSProperties
 */
export interface CSSStyle {
    background: string;  // Hex color (e.g., '#f0fdf4')
    border: string;      // Hex color for left border (e.g., '#86efac')
    text?: string;       // Optional hex text color
}

/**
 * Combined style with both Tailwind and CSS representations
 */
export interface GridColorStyle {
    tailwind: TailwindStyle;
    css: CSSStyle;
}

/**
 * Threshold configuration for numeric-based styling
 */
export interface ThresholdConfig {
    max: number;
    style: GridColorStyle;
    fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
}

/**
 * Cell class function signature
 */
export type CellClassFn = (params: CellClassParams<FlattenedOrderRow>) => string;

/**
 * Row class function signature
 */
export type RowClassFn = (params: RowClassParams<FlattenedOrderRow>) => string;

/**
 * Row style function signature
 */
export type RowStyleFn = (params: RowClassParams<FlattenedOrderRow>) => RowStyle | undefined;

/**
 * Legend item for status indicators
 */
export interface StatusLegendItem {
    color: string;   // Background hex color
    border: string;  // Border hex color
    label: string;   // Display label
    desc: string;    // Description
}
