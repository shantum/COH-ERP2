/**
 * OrderInfoCell - Combined display of order number, date, and age in 2 lines
 * Line 1: Order number (clickable)
 * Line 2: Date · Age
 */

import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

/**
 * Format age as relative time (minutes, hours, or days)
 */
function formatAge(date: Date): { text: string; urgency: 'low' | 'medium' | 'high' } {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Determine urgency based on days
    const urgency: 'low' | 'medium' | 'high' =
        diffDays > 5 ? 'high' :
        diffDays >= 3 ? 'medium' : 'low';

    // Format text based on time range
    if (diffMins < 60) {
        return { text: `${diffMins}m ago`, urgency };
    } else if (diffHours < 24) {
        return { text: `${diffHours}h ago`, urgency };
    } else {
        return { text: `${diffDays}d ago`, urgency };
    }
}

export function OrderInfoCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewOrder } = handlersRef.current;

    // Format date
    const date = new Date(row.orderDate);
    const formattedDate = date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
    });

    // Calculate age with relative formatting
    const { text: ageText, urgency } = formatAge(date);

    // Age color based on urgency
    const ageColor = urgency === 'high'
        ? 'text-red-600'
        : urgency === 'medium'
            ? 'text-amber-600'
            : 'text-gray-500';

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5">
            {/* Line 1: Order number */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewOrder(row.orderId);
                }}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left"
                title={`View order ${row.orderNumber}`}
            >
                {row.orderNumber}
            </button>
            {/* Line 2: Date · Age */}
            <div className="flex items-center gap-1 text-[10px] mt-0.5">
                <span className="text-gray-500" title={date.toLocaleString('en-IN')}>
                    {formattedDate}
                </span>
                <span className="text-gray-300">·</span>
                <span className={cn('font-semibold', ageColor)}>
                    {ageText}
                </span>
            </div>
        </div>
    );
}
