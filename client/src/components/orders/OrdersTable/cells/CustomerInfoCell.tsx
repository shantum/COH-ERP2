/**
 * CustomerInfoCell - Combined display of customer name and key info
 * Line 1: Customer name (clickable)
 * Line 2: City + repeat customer indicator (if applicable)
 */

import type { CellProps } from '../types';

export function CustomerInfoCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewCustomer } = handlersRef.current;

    const city = row.city || '';
    const orderCount = row.customerOrderCount || 0;
    const ltv = row.customerLtv || 0;

    // Only highlight repeat customers (2+ orders)
    const isRepeatCustomer = orderCount > 1;

    // Format LTV compactly
    const formatLtv = (value: number): string => {
        if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
        if (value >= 1000) return `₹${Math.round(value / 1000)}K`;
        return `₹${value}`;
    };

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Customer name */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewCustomer(row.order);
                }}
                className="text-gray-800 hover:text-blue-600 hover:underline font-medium truncate text-left"
                title={row.customerName}
            >
                {row.customerName}
            </button>
            {/* Line 2: City + repeat indicator */}
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
                {city && (
                    <span className="text-gray-400 truncate max-w-[70px]" title={city}>
                        {city}
                    </span>
                )}
                {isRepeatCustomer && (
                    <span
                        className="text-emerald-600 font-medium shrink-0"
                        title={`Repeat customer: ${orderCount} orders, LTV ${formatLtv(ltv)}`}
                    >
                        {orderCount}× · {formatLtv(ltv)}
                    </span>
                )}
            </div>
        </div>
    );
}
