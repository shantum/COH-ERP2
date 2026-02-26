/**
 * OrderInfoCell - Order number + date/time display
 * Layout: Date & relative time (left) | Order number (right, bold link)
 */

import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { formatDateTime } from '../utils/dateFormatters';

export const OrderInfoCell = memo(function OrderInfoCell({ row }: CellProps) {
    if (!row.isFirstLine) return null;

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

            {/* Order number - Link to detail page (ctrl+click opens new tab) */}
            <Link
                to="/orders/$orderId"
                params={{ orderId: row.orderNumber }}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                    'hover:text-blue-600 hover:underline font-bold truncate max-w-[80px]',
                    row.orderNumber.length > 8 ? 'text-xs text-gray-700' : 'text-base text-gray-800'
                )}
                title={row.orderNumber}
            >
                {row.orderNumber}
            </Link>
        </div>
    );
});
