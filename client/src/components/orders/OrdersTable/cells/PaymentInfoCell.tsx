/**
 * PaymentInfoCell - Combined display of payment method, order value, discount, and risk indicators
 * Line 1: Order value + Payment badge + Risk indicators
 * Line 2: Discount code (if applicable)
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';
import { AlertTriangle, UserX, User } from 'lucide-react';

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
    const isFirstOrder = orderCount <= 1; // This is their first order
    const isFirstCod = isFirstOrder && isCod; // First order AND COD = high risk
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
            {/* Line 1: Order value + Payment badge + Risk indicators */}
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

                {/* Risk indicators */}
                {isFirstCod && (
                    <span
                        className="flex items-center text-orange-600 shrink-0"
                        title="⚠️ First order + COD - Higher RTO risk"
                    >
                        <User size={11} strokeWidth={2.5} />
                    </span>
                )}
                {hasRtoHistory && (
                    <span
                        className={cn(
                            'flex items-center shrink-0',
                            isHighRtoRisk ? 'text-red-600' : 'text-amber-600'
                        )}
                        title={`⚠️ Customer has ${rtoCount} past RTO${rtoCount > 1 ? 's' : ''}`}
                    >
                        <UserX size={11} strokeWidth={2.5} />
                    </span>
                )}
            </div>
            {/* Line 2: Discount code only */}
            {discountCode && (
                <div className="flex items-center gap-1 mt-0.5 text-[10px]">
                    <span
                        className="text-gray-500 truncate max-w-[90px]"
                        title={discountCode}
                    >
                        {discountCode}
                    </span>
                </div>
            )}
        </div>
    );
}
