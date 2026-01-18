/**
 * OrderCell - Combined Order + Customer + Payment display
 * Signal-first design: Calm by default, problems create contrast
 *
 * Line 1: Order# · Customer name                    ₹Value
 * Line 2: Time · City · Repeat              [Payment Badge]
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
 * Format currency value compactly
 */
function formatValue(value: number): string {
    if (value === 0) return '-';
    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
    if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
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
    const isHighValue = orderValue >= 10000;

    // Risk assessment
    const rtoCount = row.customerRtoCount || 0;
    const isFirstOrder = orderCount <= 1;
    const isFirstCod = isFirstOrder && isCod;
    const hasRtoHistory = rtoCount > 0;

    // Determine risk level for badge styling
    const hasRisk = isFirstCod || hasRtoHistory;
    const isHighRisk = hasRtoHistory && rtoCount >= 2;

    // Build risk badge text
    const getRiskBadge = () => {
        if (!isCod) {
            // Prepaid - subtle green text only
            return {
                text: 'Prepaid',
                className: 'text-emerald-600 text-[10px] font-medium',
            };
        }

        // COD with potential risk
        if (isHighRisk) {
            // High risk: COD + RTO history
            return {
                text: `COD · ${rtoCount}R`,
                className: 'px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700',
            };
        } else if (isFirstCod && hasRtoHistory) {
            // First COD + RTO history
            return {
                text: `COD · 1st · ${rtoCount}R`,
                className: 'px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700',
            };
        } else if (isFirstCod) {
            // First COD only
            return {
                text: 'COD · 1st',
                className: 'px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600',
            };
        } else if (hasRtoHistory) {
            // COD + RTO history
            return {
                text: `COD · ${rtoCount}R`,
                className: 'px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700',
            };
        } else {
            // Regular COD
            return {
                text: 'COD',
                className: 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700',
            };
        }
    };

    const badge = getRiskBadge();

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Order# · Customer name                    ₹Value */}
            <div className="flex items-center gap-1.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
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
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onViewCustomer(row.order);
                        }}
                        className="text-gray-600 hover:text-blue-600 hover:underline truncate"
                        title={row.customerName}
                    >
                        {row.customerName}
                    </button>
                </div>
                <span
                    className={cn(
                        'shrink-0 tabular-nums',
                        isHighValue ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'
                    )}
                    title={`₹${orderValue.toLocaleString('en-IN')}`}
                >
                    {formatValue(orderValue)}
                </span>
            </div>

            {/* Line 2: Time · City · Repeat              [Payment Badge] */}
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5 min-w-0">
                <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span
                        className={cn(isOld ? 'text-amber-600' : 'text-gray-400')}
                        title={date.toLocaleString('en-IN')}
                    >
                        {dateText}
                    </span>
                    {city && (
                        <>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-400 truncate" title={city}>
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
                                {formatLtv(ltv)}({orderCount})
                            </span>
                        </>
                    )}
                </div>
                <span className={badge.className} title={isCod ? 'Cash on Delivery' : 'Prepaid'}>
                    {badge.text}
                </span>
            </div>
        </div>
    );
}
