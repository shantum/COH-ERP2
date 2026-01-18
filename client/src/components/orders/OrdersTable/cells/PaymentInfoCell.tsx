/**
 * PaymentInfoCell - Combined display of payment method, order value, discount, and RTO risk
 * Line 1: Payment badge + Order value
 * Line 2: Discount code + RTO warning (if applicable)
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';
import { AlertTriangle } from 'lucide-react';

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

    // RTO risk level
    const isHighRisk = rtoCount >= 3;

    const hasSecondLine = discountCode || rtoCount > 0;

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Order value + Payment badge */}
            <div className="flex items-center gap-1.5">
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
            </div>
            {/* Line 2: Only show if discount or RTO warning exists */}
            {hasSecondLine && (
                <div className="flex items-center gap-1 mt-0.5 text-[10px]">
                    {discountCode && (
                        <span
                            className="text-gray-500 truncate max-w-[90px]"
                            title={discountCode}
                        >
                            {discountCode}
                        </span>
                    )}
                    {rtoCount > 0 && (
                        <span
                            className={cn(
                                'flex items-center gap-0.5 shrink-0',
                                isHighRisk ? 'text-red-600' : 'text-amber-500'
                            )}
                            title={`Customer has ${rtoCount} RTO(s)`}
                        >
                            <AlertTriangle size={9} />
                            <span className="font-semibold">{rtoCount} RTO</span>
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
