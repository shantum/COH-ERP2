/**
 * PaymentInfoCell - Combined display of payment method, order value, discount, and risk indicators
 * Line 1: Order value + Payment badge + Risk pills
 * Line 2: Discount code (if applicable)
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface PaymentInfoCellProps {
    row: FlattenedOrderRow;
}

export function PaymentInfoCell({ row }: PaymentInfoCellProps) {
    if (!row.isFirstLine) return null;

    const paymentMethod = row.paymentMethod || '';
    const isCod = paymentMethod.toLowerCase().includes('cod') ||
                  paymentMethod.toLowerCase().includes('cash');

    const orderValue = row.totalAmount || 0;
    const discountCode = row.discountCodes;
    const rtoCount = row.customerRtoCount || 0;
    const orderCount = row.customerOrderCount || 0;

    // Risk indicators
    const isFirstOrder = orderCount <= 1;
    const isFirstCod = isFirstOrder && isCod;
    const hasRtoHistory = rtoCount > 0;
    const isHighRtoRisk = rtoCount >= 3;

    // Format order value compactly
    const formatValue = (value: number): string => {
        if (value === 0) return '-';
        if (value >= 100000) {
            return `₹${(value / 100000).toFixed(1)}L`;
        }
        if (value >= 1000) {
            return `₹${(value / 1000).toFixed(1)}K`;
        }
        return `₹${value}`;
    };

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Order value + Payment badge + Risk pills */}
            <div className="flex items-center gap-1">
                <span className="font-semibold text-gray-800">
                    {formatValue(orderValue)}
                </span>
                <span
                    className={cn(
                        'px-1.5 py-0 rounded text-[10px] font-medium shrink-0',
                        isCod
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                    )}
                >
                    {isCod ? 'COD' : 'Prepaid'}
                </span>

                {/* Risk pills - small text badges */}
                {isFirstCod && (
                    <span
                        className="px-1 py-0 rounded text-[9px] font-semibold bg-orange-100 text-orange-700 shrink-0"
                        title="First order + COD = Higher RTO risk"
                    >
                        1st
                    </span>
                )}
                {hasRtoHistory && (
                    <span
                        className={cn(
                            'px-1 py-0 rounded text-[9px] font-semibold shrink-0',
                            isHighRtoRisk
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                        )}
                        title={`Customer has ${rtoCount} past RTO${rtoCount > 1 ? 's' : ''}`}
                    >
                        {rtoCount}R
                    </span>
                )}
            </div>
            {/* Line 2: Discount code only */}
            {discountCode && (
                <div className="text-[10px] text-gray-500 truncate mt-0.5" title={discountCode}>
                    {discountCode}
                </div>
            )}
        </div>
    );
}
