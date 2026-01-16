/**
 * Composable cell class builders for AG-Grid
 * These functions return cellClass callbacks that can be used in column definitions
 */

import type { CellClassParams } from 'ag-grid-community';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { CellClassFn } from './types';
import {
    getLineStatusClasses,
    getTrackingStatusClasses,
    getFinalStatusClasses,
} from './statusStyles';
import {
    getThresholdClasses,
    getThresholdTextClass,
    type ThresholdConfigKey,
} from './thresholdStyles';

/**
 * Create a cellClass callback for status-based styling
 * @param statusField - The field containing the status value
 * @param styleType - Type of status styling to apply
 */
export function statusCellClass(
    statusField: keyof FlattenedOrderRow,
    styleType: 'line' | 'tracking' | 'final' = 'line'
): CellClassFn {
    const getClasses = {
        line: getLineStatusClasses,
        tracking: getTrackingStatusClasses,
        final: getFinalStatusClasses,
    }[styleType];

    return (params: CellClassParams<FlattenedOrderRow>) => {
        const status = params.data?.[statusField];
        if (!status || typeof status !== 'string') return '';
        return getClasses(status);
    };
}

/**
 * Create a cellClass callback for threshold-based styling (with background)
 * @param valueField - The field containing the numeric value
 * @param configKey - The threshold configuration to use
 */
export function thresholdCellClass(
    valueField: keyof FlattenedOrderRow,
    configKey: ThresholdConfigKey
): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        const value = params.data?.[valueField];
        if (value == null || typeof value !== 'number') return '';
        return getThresholdClasses(value, configKey);
    };
}

/**
 * Create a cellClass callback for threshold-based text color only (no background)
 * @param valueField - The field containing the numeric value
 * @param configKey - The threshold configuration to use
 */
export function thresholdTextCellClass(
    valueField: keyof FlattenedOrderRow,
    configKey: ThresholdConfigKey
): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        const value = params.data?.[valueField];
        if (value == null || typeof value !== 'number') return '';
        return getThresholdTextClass(value, configKey);
    };
}

/**
 * Create a cellClass callback based on a condition
 * @param condition - Function that returns true if classes should apply
 * @param trueClasses - Classes to apply when condition is true
 * @param falseClasses - Classes to apply when condition is false (optional)
 */
export function conditionalCellClass(
    condition: (data: FlattenedOrderRow | undefined) => boolean,
    trueClasses: string,
    falseClasses = ''
): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        return condition(params.data) ? trueClasses : falseClasses;
    };
}

/**
 * Create a cellClass callback that checks if a field has a value
 * @param field - The field to check
 * @param hasValueClasses - Classes when field has value
 * @param emptyClasses - Classes when field is empty
 */
export function hasValueCellClass(
    field: keyof FlattenedOrderRow,
    hasValueClasses: string,
    emptyClasses = 'text-gray-400'
): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        const value = params.data?.[field];
        const hasValue = value != null && value !== '';
        return hasValue ? hasValueClasses : emptyClasses;
    };
}

/**
 * Create a cellClass callback for editable state styling
 * @param statusField - Field containing the status
 * @param editableStatuses - Array of statuses where cell is editable
 */
export function editableCellClass(
    statusField: keyof FlattenedOrderRow,
    editableStatuses: string[],
    baseClasses = 'text-xs'
): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        const status = params.data?.[statusField];
        const isEditable = typeof status === 'string' && editableStatuses.includes(status);
        return isEditable ? `${baseClasses} cursor-text` : baseClasses;
    };
}

/**
 * Compose multiple cellClass functions into one
 * Classes are joined with spaces
 */
export function composeCellClass(...fns: CellClassFn[]): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        return fns
            .map(fn => fn(params))
            .filter(Boolean)
            .join(' ');
    };
}

/**
 * Add base classes to any cellClass function
 */
export function withBaseClasses(baseClasses: string, fn?: CellClassFn): CellClassFn {
    return (params: CellClassParams<FlattenedOrderRow>) => {
        const dynamicClasses = fn?.(params) || '';
        return `${baseClasses} ${dynamicClasses}`.trim();
    };
}
