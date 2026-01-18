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

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Order value + Payment badge */}
            <div className="flex items-center gap-1.5">
                <span className="font-medium text-gray-800">
                    {formatValue(orderValue)}
                </span>
                <span
                    className={cn(
                        'px-1.5 py-0 rounded text-[10px] font-semibold shrink-0',
                        isCod
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-green-100 text-green-700'
                    )}
                >
                    {isCod ? 'COD' : 'Prepaid'}
                </span>
            </div>
            {/* Line 2: Discount + RTO warning */}
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                {discountCode ? (
                    <span
                        className="text-purple-600 font-medium truncate max-w-[80px]"
                        title={discountCode}
                    >
                        {discountCode}
                    </span>
                ) : (
                    <span className="text-gray-300">No discount</span>
                )}
                {rtoCount > 0 && (
                    <>
                        <span className="text-gray-300">·</span>
                        <span
                            className={cn(
                                'flex items-center gap-0.5 shrink-0',
                                isHighRisk ? 'text-red-600' : 'text-amber-600'
                            )}
                            title={`⚠️ Customer has ${rtoCount} RTO(s) in history`}
                        >
                            <AlertTriangle size={10} />
                            <span className="font-semibold">{rtoCount}</span>
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}
