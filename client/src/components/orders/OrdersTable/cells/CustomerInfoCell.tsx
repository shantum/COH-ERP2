/**
 * CustomerInfoCell - Customer name, city, orders, LTV
 * Line 1: Customer name (clickable) + LTV (order count)
 * Line 2: City
 */

import { memo } from 'react';
import type { CellProps } from '../types';

/**
 * Format LTV compactly
 */
function formatLtv(value: number): string {
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `₹${Math.round(value / 1000)}K`;
    return `₹${value}`;
}

export const CustomerInfoCell = memo(function CustomerInfoCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewCustomer } = handlersRef.current;

    const city = row.city || '';
    const orderCount = row.customerOrderCount || 0;
    const ltv = row.customerLtv || 0;
    const isRepeatCustomer = orderCount > 1;

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Customer name */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewCustomer(row.order);
                }}
                className="text-gray-700 hover:text-blue-600 hover:underline truncate text-left"
                title={row.customerName}
            >
                {row.customerName}
            </button>
            {/* Line 2: City + LTV pill or New pill */}
            <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                {city && (
                    <span className="text-gray-400 truncate max-w-[80px]" title={city}>
                        {city}
                    </span>
                )}
                {isRepeatCustomer ? (
                    <span
                        className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] shrink-0"
                        title={`${orderCount} orders, LTV ${formatLtv(ltv)}`}
                    >
                        {formatLtv(ltv)} ({orderCount})
                    </span>
                ) : (
                    <span
                        className="px-1.5 py-0.5 bg-blue-50 text-blue-500 rounded-full text-[10px] shrink-0"
                        title="First-time customer"
                    >
                        New
                    </span>
                )}
            </div>
        </div>
    );
});
