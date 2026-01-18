/**
 * OrderInfoCell - Combined display of order number and smart date
 * Line 1: Order number (clickable)
 * Line 2: Smart date (relative for recent, date for older)
 */

import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

/**
 * Smart date formatting - shows relative time for recent, date for older
 */
function formatSmartDate(date: Date): { text: string; urgency: 'low' | 'medium' | 'high' } {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Determine urgency based on days
    const urgency: 'low' | 'medium' | 'high' =
        diffDays > 5 ? 'high' :
        diffDays >= 3 ? 'medium' : 'low';

    // Recent: relative time | Older: date
    if (diffMins < 60) {
        return { text: `${diffMins}m ago`, urgency };
    } else if (diffHours < 24) {
        return { text: `${diffHours}h ago`, urgency };
    } else if (diffDays < 7) {
        return { text: `${diffDays}d ago`, urgency };
    } else {
        // Older than a week: show date
        const formatted = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        return { text: formatted, urgency };
    }
}

export function OrderInfoCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewOrder } = handlersRef.current;

    const date = new Date(row.orderDate);
    const { text: dateText, urgency } = formatSmartDate(date);

    // Color based on urgency (only for older orders)
    const dateColor = urgency === 'high'
        ? 'text-red-600 font-medium'
        : urgency === 'medium'
            ? 'text-amber-600'
            : 'text-gray-400';

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
            {/* Line 2: Smart date */}
            <span
                className={cn('text-[10px] mt-0.5', dateColor)}
                title={date.toLocaleString('en-IN')}
            >
                {dateText}
            </span>
        </div>
    );
}
