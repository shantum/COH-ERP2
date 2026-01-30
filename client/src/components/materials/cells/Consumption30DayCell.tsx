/**
 * Consumption30DayCell - Display 30-day fabric consumption
 *
 * Shows:
 * - For fabric rows: Aggregated consumption of all colours (e.g., "245 mtr")
 * - For colour rows: Individual consumption value
 * - Uses the fabric's unit field (m or kg)
 * - Gray text with "-" if no consumption
 */

import React from 'react';
import type { MaterialNode } from '../types';

interface Consumption30DayCellProps {
    node: MaterialNode;
}

/**
 * Format unit for display
 * 'm' -> 'mtr', 'kg' -> 'kg'
 */
function formatUnit(unit?: string): string {
    if (!unit) return '';
    if (unit === 'm') return 'mtr';
    return unit;
}

/**
 * Format consumption value
 */
function formatConsumption(value: number): string {
    if (value === 0) return '-';
    return value.toLocaleString('en-IN', {
        maximumFractionDigits: 1,
    });
}

export const Consumption30DayCell = React.memo(function Consumption30DayCell({ node }: Consumption30DayCellProps) {
    // Only show for fabric and colour rows
    if (node.type === 'material') {
        return null;
    }

    const value = node.consumption30Day ?? 0;
    const unit = node.unit;
    const unitDisplay = formatUnit(unit);
    const isFabric = node.type === 'fabric';

    if (value === 0) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    // Style based on type
    const style = isFabric
        ? 'bg-blue-50 text-blue-700'
        : 'bg-blue-50/50 text-blue-600';

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${style}`}>
            <span>{formatConsumption(value)}</span>
            {unitDisplay && <span className="text-gray-500">{unitDisplay}</span>}
        </span>
    );
});
