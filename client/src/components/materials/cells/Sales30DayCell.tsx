/**
 * Sales30DayCell - Display 30-day sales value
 *
 * Shows:
 * - For fabric rows: Aggregated sales value of all colours (e.g., "₹1,23,456")
 * - For colour rows: Individual sales value
 * - Gray text with "-" if no sales
 */

import React from 'react';
import type { MaterialNode } from '../types';

interface Sales30DayCellProps {
    node: MaterialNode;
}

/**
 * Format currency for display in Indian format (lakhs/crores)
 */
function formatCurrency(value: number): string {
    if (value === 0) return '-';
    return '₹' + value.toLocaleString('en-IN', {
        maximumFractionDigits: 0,
    });
}

export const Sales30DayCell = React.memo(function Sales30DayCell({ node }: Sales30DayCellProps) {
    // Only show for fabric and colour rows
    if (node.type === 'material') {
        return null;
    }

    const value = node.sales30DayValue ?? 0;
    const isFabric = node.type === 'fabric';

    if (value === 0) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    // Style based on type
    const style = isFabric
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-emerald-50/50 text-emerald-600';

    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
            {formatCurrency(value)}
        </span>
    );
});
