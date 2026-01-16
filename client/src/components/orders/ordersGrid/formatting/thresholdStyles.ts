/**
 * Threshold-based styling for numeric values
 * Maps value ranges to colors (e.g., order age, days in transit)
 */

import { GRID_COLORS } from './colorPalette';
import type { ThresholdConfig } from './types';

/**
 * Order age thresholds (days since order placed)
 * - Normal: < 3 days
 * - Warning: 3-5 days
 * - Urgent: > 5 days
 */
export const ORDER_AGE_THRESHOLDS: ThresholdConfig[] = [
    { max: 2, style: GRID_COLORS.neutral, fontWeight: 'normal' },
    { max: 5, style: GRID_COLORS.warning, fontWeight: 'medium' },
    { max: Infinity, style: GRID_COLORS.danger, fontWeight: 'semibold' },
];

/**
 * Days in transit thresholds (for shipped orders)
 * - Normal: < 7 days
 * - Slow: 7-9 days
 * - Very slow: 10+ days
 */
export const DAYS_IN_TRANSIT_THRESHOLDS: ThresholdConfig[] = [
    { max: 6, style: GRID_COLORS.neutral, fontWeight: 'normal' },
    { max: 9, style: GRID_COLORS.warning, fontWeight: 'medium' },
    { max: Infinity, style: GRID_COLORS.danger, fontWeight: 'bold' },
];

/**
 * Delivery time thresholds (days from shipped to delivered)
 * - Fast: <= 5 days
 * - Normal: 5-7 days
 * - Slow: > 7 days
 */
export const DELIVERY_DAYS_THRESHOLDS: ThresholdConfig[] = [
    { max: 5, style: GRID_COLORS.success, fontWeight: 'normal' },
    { max: 7, style: GRID_COLORS.warning, fontWeight: 'medium' },
    { max: Infinity, style: GRID_COLORS.danger, fontWeight: 'medium' },
];

/**
 * Days since delivery thresholds (for COD remittance)
 * - Recent: <= 7 days
 * - Moderate: 7-14 days
 * - Old: > 14 days
 */
export const DAYS_SINCE_DELIVERY_THRESHOLDS: ThresholdConfig[] = [
    { max: 7, style: GRID_COLORS.successSoft, fontWeight: 'normal' },
    { max: 14, style: GRID_COLORS.warningSoft, fontWeight: 'normal' },
    { max: Infinity, style: GRID_COLORS.danger, fontWeight: 'medium' },
];

/**
 * Days in RTO thresholds
 * - Normal: < 7 days
 * - Delayed: 7-14 days
 * - Very delayed: > 14 days
 */
export const DAYS_IN_RTO_THRESHOLDS: ThresholdConfig[] = [
    { max: 6, style: GRID_COLORS.neutral, fontWeight: 'normal' },
    { max: 14, style: GRID_COLORS.warning, fontWeight: 'medium' },
    { max: Infinity, style: GRID_COLORS.danger, fontWeight: 'semibold' },
];

/**
 * All threshold configurations by key
 */
export const THRESHOLD_CONFIGS = {
    orderAge: ORDER_AGE_THRESHOLDS,
    daysInTransit: DAYS_IN_TRANSIT_THRESHOLDS,
    deliveryDays: DELIVERY_DAYS_THRESHOLDS,
    daysSinceDelivery: DAYS_SINCE_DELIVERY_THRESHOLDS,
    daysInRto: DAYS_IN_RTO_THRESHOLDS,
} as const;

export type ThresholdConfigKey = keyof typeof THRESHOLD_CONFIGS;

/**
 * Get threshold style for a numeric value
 */
export function getThresholdStyle(
    value: number | null | undefined,
    configKey: ThresholdConfigKey
): ThresholdConfig | undefined {
    if (value == null) return undefined;
    const config = THRESHOLD_CONFIGS[configKey];
    return config.find(t => value <= t.max);
}

/**
 * Get Tailwind classes for a threshold value
 */
export function getThresholdClasses(
    value: number | null | undefined,
    configKey: ThresholdConfigKey
): string {
    const config = getThresholdStyle(value, configKey);
    if (!config) return '';

    const { bg, text } = config.style.tailwind;
    const fontWeight = config.fontWeight ? `font-${config.fontWeight}` : '';

    return `${bg} ${text} ${fontWeight}`.trim();
}

/**
 * Get just the text color class for a threshold value
 * Useful when you don't want background styling
 */
export function getThresholdTextClass(
    value: number | null | undefined,
    configKey: ThresholdConfigKey
): string {
    const config = getThresholdStyle(value, configKey);
    if (!config) return 'text-gray-600';

    const fontWeight = config.fontWeight ? `font-${config.fontWeight}` : '';
    return `${config.style.tailwind.text} ${fontWeight}`.trim();
}
