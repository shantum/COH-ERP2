/**
 * OrderInfoCell - Order number + date/time display
 * Layout: Date & relative time (left) | Order number (right, bold)
 */

import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { formatDateTime } from '../utils/dateFormatters';

export function OrderInfoCell({ row, handlersRef }: CellProps) {
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
}
