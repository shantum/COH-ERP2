/**
 * CustomerInfoCell - Combined display of customer name, city, orders, and LTV in 2 lines
 * Line 1: Customer name (clickable)
 * Line 2: City · Orders · LTV
 */

import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

export function CustomerInfoCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewCustomer } = handlersRef.current;

    const city = row.city || '-';
    const orderCount = row.customerOrderCount || 0;
    const ltv = row.customerLtv || 0;

    // Format LTV compactly (e.g., "₹12K" or "₹1.2L")
    const formatLtv = (value: number): string => {
        if (value === 0) return '';
        if (value >= 100000) {
            return `₹${(value / 100000).toFixed(1)}L`;
        }
        if (value >= 1000) {
            return `₹${(value / 1000).toFixed(0)}K`;
        }
        return `₹${value}`;
    };

    const ltvText = formatLtv(ltv);
    const isRepeatCustomer = orderCount > 1;

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
            {/* Line 2: City · Orders · LTV */}
            <div className="flex items-center gap-1 text-[10px] mt-0.5 text-gray-500">
                <span className="truncate max-w-[60px]" title={city}>
                    {city}
                </span>
                <span className="text-gray-300">·</span>
                <span
                    className={cn(
                        'font-medium shrink-0',
                        isRepeatCustomer ? 'text-green-600' : 'text-gray-400'
                    )}
                    title={`${orderCount} order(s)`}
                >
                    {orderCount} ord
                </span>
                {ltvText && (
                    <>
                        <span className="text-gray-300">·</span>
                        <span className="font-medium text-gray-600 shrink-0" title={`LTV: ₹${ltv.toLocaleString('en-IN')}`}>
                            {ltvText}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}
