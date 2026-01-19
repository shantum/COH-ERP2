/**
 * OrderInfoCell - Order number + date/time display
 * Layout: Date & relative time (left) | Order number (right, bold)
 */

import { memo } from 'react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

/**
 * Format date and relative time for two-line display
 */
function formatDateTime(date: Date): { dateStr: string; relativeStr: string; isOld: boolean } {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const isOld = diffDays >= 3;

    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    // Relative time
    let relativeStr: string;
    if (diffMins < 60) {
        relativeStr = `${diffMins}m ago`;
    } else if (diffHours < 24) {
        relativeStr = `${diffHours}h ago`;
    } else {
        relativeStr = `${diffDays}d ago`;
    }

    return { dateStr, relativeStr, isOld };
}

export const OrderInfoCell = memo(function OrderInfoCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewOrder } = handlersRef.current;

    const date = new Date(row.orderDate);
    const { dateStr, relativeStr, isOld } = formatDateTime(date);

    return (
        <div className="flex items-center gap-2 py-1">
            {/* Date/Time - two lines */}
            <div
                className={cn(
                    'shrink-0 w-12 flex flex-col text-right',
                    isOld ? 'text-amber-600' : 'text-gray-400'
                )}
                title={date.toLocaleString('en-IN')}
            >
                <span className="text-[11px] leading-tight">{dateStr}</span>
                <span className="text-[10px] leading-tight">{relativeStr}</span>
            </div>

            {/* Order number */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewOrder(row.orderId);
                }}
                className="text-gray-800 hover:text-blue-600 hover:underline font-bold text-base"
                title={`View order ${row.orderNumber}`}
            >
                {row.orderNumber}
            </button>
        </div>
    );
}, (prev, next) => (
    prev.row.isFirstLine === next.row.isFirstLine &&
    prev.row.orderId === next.row.orderId &&
    prev.row.orderNumber === next.row.orderNumber &&
    prev.row.orderDate === next.row.orderDate
));
