/**
 * OrderCustomerCell - Combined Order + Customer display
 * Line 1: Order number · Customer name
 * Line 2: Time ago · City · LTV (count) for repeat customers
 */

import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

/**
 * Smart date formatting - relative for recent, date for older
 */
function formatSmartDate(date: Date): { text: string; isOld: boolean } {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const isOld = diffDays >= 3;

    if (diffMins < 60) {
        return { text: `${diffMins}m ago`, isOld };
    } else if (diffHours < 24) {
        return { text: `${diffHours}h ago`, isOld };
    } else if (diffDays < 7) {
        return { text: `${diffDays}d ago`, isOld };
    } else {
        const formatted = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        return { text: formatted, isOld: true };
    }
}

export function OrderCustomerCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewOrder, onViewCustomer } = handlersRef.current;

    const date = new Date(row.orderDate);
    const { text: dateText, isOld } = formatSmartDate(date);

    const city = row.city || '';
    const orderCount = row.customerOrderCount || 0;
    const ltv = row.customerLtv || 0;
    const isRepeatCustomer = orderCount > 1;

    // Format LTV compactly
    const formatLtv = (value: number): string => {
        if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
        if (value >= 1000) return `₹${Math.round(value / 1000)}K`;
        return `₹${value}`;
    };

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Order number · Customer name */}
            <div className="flex items-center gap-1.5 min-w-0">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onViewOrder(row.orderId);
                    }}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-semibold shrink-0"
                    title={`View order ${row.orderNumber}`}
                >
                    {row.orderNumber}
                </button>
                <span className="text-gray-300">·</span>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onViewCustomer(row.order);
                    }}
                    className="text-gray-700 hover:text-blue-600 hover:underline truncate"
                    title={row.customerName}
                >
                    {row.customerName}
                </button>
            </div>
            {/* Line 2: Time · City · Repeat indicator */}
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5 min-w-0">
                <span
                    className={cn(
                        isOld ? 'text-amber-600' : 'text-gray-400'
                    )}
                    title={date.toLocaleString('en-IN')}
                >
                    {dateText}
                </span>
                {city && (
                    <>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-400 truncate max-w-[60px]" title={city}>
                            {city}
                        </span>
                    </>
                )}
                {isRepeatCustomer && (
                    <>
                        <span className="text-gray-300">·</span>
                        <span
                            className="text-emerald-600 shrink-0"
                            title={`Repeat: ${orderCount} orders, LTV ${formatLtv(ltv)}`}
                        >
                            {formatLtv(ltv)} ({orderCount})
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}
