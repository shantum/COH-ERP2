/**
 * OrderCell - Combined Order + Customer + Payment display
 * 2-line layout with left border risk signal
 *
 * Time (spans both lines) | Line 1: Order# Customer · Repeat
 *                         | Line 2: ₹Value Badge · City
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
        return { text: `${diffMins}m`, isOld };
    } else if (diffHours < 24) {
        return { text: `${diffHours}h`, isOld };
    } else if (diffDays < 7) {
        return { text: `${diffDays}d`, isOld };
    } else {
        const formatted = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        return { text: formatted, isOld: true };
    }
}

/**
 * Format LTV compactly
 */
function formatLtv(value: number): string {
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `₹${Math.round(value / 1000)}K`;
    return `₹${value}`;
}

export function OrderCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewOrder, onViewCustomer } = handlersRef.current;

    // Order info
    const date = new Date(row.orderDate);
    const { text: dateText, isOld } = formatSmartDate(date);
    const city = row.city || '';

    // Customer info
    const orderCount = row.customerOrderCount || 0;
    const ltv = row.customerLtv || 0;
    const isRepeatCustomer = orderCount > 1;

    // Payment info
    const paymentMethod = row.paymentMethod || '';
    const isCod = paymentMethod.toLowerCase().includes('cod') ||
                  paymentMethod.toLowerCase().includes('cash');
    const orderValue = row.totalAmount || 0;

    // Risk assessment
    const rtoCount = row.customerRtoCount || 0;
    const isFirstOrder = orderCount <= 1;
    const isFirstCod = isFirstOrder && isCod;
    const hasRtoHistory = rtoCount > 0;
    const isHighRisk = hasRtoHistory && rtoCount >= 2;

    // Left border color based on risk
    const getBorderColor = () => {
        if (!isCod) return 'border-l-emerald-400'; // Prepaid = green
        if (isHighRisk || (isFirstCod && hasRtoHistory)) return 'border-l-red-400'; // High risk = red
        if (isFirstCod || hasRtoHistory) return 'border-l-orange-400'; // Medium risk = orange
        return 'border-l-amber-400'; // Regular COD = amber
    };

    // Payment badge
    const getBadge = () => {
        if (!isCod) {
            return { text: 'Prepaid', className: 'text-emerald-600' };
        }
        if (isHighRisk) {
            return { text: `COD · ${rtoCount}R`, className: 'text-red-600 font-medium' };
        }
        if (isFirstCod && hasRtoHistory) {
            return { text: `COD · 1st · ${rtoCount}R`, className: 'text-red-600 font-medium' };
        }
        if (isFirstCod) {
            return { text: 'COD · 1st', className: 'text-red-600 font-medium' };
        }
        if (hasRtoHistory) {
            return { text: `COD · ${rtoCount}R`, className: 'text-amber-600 font-medium' };
        }
        return { text: 'COD', className: 'text-amber-600' };
    };

    const badge = getBadge();

    return (
        <div className={cn(
            'flex items-center py-1 pl-3 -ml-3 min-w-0',
            'border-l-[3px]',
            getBorderColor()
        )}>
            {/* Time - spans both lines */}
            <span
                className={cn(
                    'text-gray-400 shrink-0 w-10 text-right text-[13px] pr-2',
                    isOld && 'text-amber-600'
                )}
                title={date.toLocaleString('en-IN')}
            >
                {dateText}
            </span>

            {/* Separator */}
            <div className="w-px h-8 bg-gray-200 shrink-0" />

            {/* Right content - two lines */}
            <div className="flex flex-col justify-center min-w-0 flex-1 pl-2">
                {/* Line 1: Order# Customer · Repeat */}
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onViewOrder(row.orderId);
                        }}
                        className="text-gray-800 hover:text-blue-600 hover:underline font-semibold shrink-0 w-12"
                        title={`View order ${row.orderNumber}`}
                    >
                        {row.orderNumber}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onViewCustomer(row.order);
                        }}
                        className="text-gray-600 hover:text-blue-600 hover:underline truncate max-w-[100px]"
                        title={row.customerName}
                    >
                        {row.customerName}
                    </button>
                    {isRepeatCustomer && (
                        <>
                            <span className="text-gray-300">·</span>
                            <span
                                className="text-emerald-600 text-[12px] shrink-0"
                                title={`Repeat: ${orderCount} orders, LTV ${formatLtv(ltv)}`}
                            >
                                {formatLtv(ltv)} ({orderCount})
                            </span>
                        </>
                    )}
                </div>

                {/* Line 2: ₹Value Badge · City */}
                <div className="flex items-center gap-2 text-[12px] mt-0.5">
                    <span
                        className="text-gray-600 tabular-nums w-12"
                        title={`₹${orderValue.toLocaleString('en-IN')}`}
                    >
                        ₹{Math.round(orderValue).toLocaleString('en-IN')}
                    </span>
                    <span className={cn(badge.className, 'w-16')}>
                        {badge.text}
                    </span>
                    {city && (
                        <>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-400 truncate" title={city}>
                                {city}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
