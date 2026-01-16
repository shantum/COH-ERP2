/**
 * Centralized color palette for orders grid formatting
 * Single source of truth for all colors used in row/cell styling
 *
 * Each color has both Tailwind classes (for cells/badges) and
 * CSS hex values (for AG-Grid's getRowStyle which needs CSSProperties)
 */

import type { GridColorStyle } from './types';

/**
 * Core semantic colors used throughout the grid
 * Named by meaning, not by color (e.g., 'success' not 'green')
 */
export const GRID_COLORS = {
    // Status colors
    success: {
        tailwind: { bg: 'bg-green-100', text: 'text-green-700' },
        css: { background: '#dcfce7', border: '#10b981' },
    },
    successStrong: {
        tailwind: { bg: 'bg-green-200', text: 'text-green-800' },
        css: { background: '#bbf7d0', border: '#10b981' },
    },
    successSoft: {
        tailwind: { bg: 'bg-green-50', text: 'text-green-600' },
        css: { background: '#f0fdf4', border: '#86efac' },
    },

    warning: {
        tailwind: { bg: 'bg-amber-100', text: 'text-amber-700' },
        css: { background: '#fef3c7', border: '#f59e0b' },
    },
    warningSoft: {
        tailwind: { bg: 'bg-amber-50', text: 'text-amber-600' },
        css: { background: '#fffbeb', border: '#fcd34d' },
    },

    danger: {
        tailwind: { bg: 'bg-red-100', text: 'text-red-700' },
        css: { background: '#fee2e2', border: '#ef4444' },
    },
    dangerStrong: {
        tailwind: { bg: 'bg-red-200', text: 'text-red-800' },
        css: { background: '#fecaca', border: '#dc2626' },
    },

    info: {
        tailwind: { bg: 'bg-blue-100', text: 'text-blue-700' },
        css: { background: '#dbeafe', border: '#3b82f6' },
    },

    neutral: {
        tailwind: { bg: 'bg-gray-100', text: 'text-gray-700' },
        css: { background: '#f3f4f6', border: '#9ca3af' },
    },
    neutralSoft: {
        tailwind: { bg: 'bg-gray-50', text: 'text-gray-500' },
        css: { background: '#f9fafb', border: '#d1d5db' },
    },

    // Workflow-specific colors
    purple: {
        tailwind: { bg: 'bg-purple-100', text: 'text-purple-700' },
        css: { background: '#f3e8ff', border: '#a855f7' },
    },

    teal: {
        tailwind: { bg: 'bg-teal-100', text: 'text-teal-700' },
        css: { background: '#ccfbf1', border: '#14b8a6' },
    },

    orange: {
        tailwind: { bg: 'bg-orange-100', text: 'text-orange-700' },
        css: { background: '#ffedd5', border: '#f97316' },
    },
    orangeSoft: {
        tailwind: { bg: 'bg-orange-50', text: 'text-orange-600' },
        css: { background: '#fff7ed', border: '#f97316' },
    },

    indigo: {
        tailwind: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
        css: { background: '#e0e7ff', border: '#6366f1' },
    },

    sky: {
        tailwind: { bg: 'bg-sky-100', text: 'text-sky-700' },
        css: { background: '#e0f2fe', border: '#0ea5e9' },
    },

    slate: {
        tailwind: { bg: 'bg-slate-100', text: 'text-slate-700' },
        css: { background: '#f1f5f9', border: '#64748b' },
    },
    slateStrong: {
        tailwind: { bg: 'bg-slate-200', text: 'text-slate-700' },
        css: { background: '#e2e8f0', border: '#475569' },
    },
} as const satisfies Record<string, GridColorStyle>;

/**
 * Urgency border colors (used for row left borders)
 */
export const URGENCY_COLORS = {
    urgent: '#ef4444',   // Red - orders > 5 days old
    warning: '#f59e0b',  // Amber - orders 3-5 days old
    normal: 'transparent',
} as const;

/**
 * Special row styling (cancelled, shipped strikethrough effects)
 */
export const ROW_EFFECT_COLORS = {
    cancelled: {
        background: '#f3f4f6',
        text: '#9ca3af',
        cssText: '#991b1b',
    },
    shipped: {
        background: '#dcfce7',
        cssText: '#166534',
    },
} as const;
