/**
 * PaymentInfoCell - Order value, payment method, discount indicator
 * Line 1: Order value + discount icon (if applicable)
 * Line 2: COD/Prepaid
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';
import { Tag } from 'lucide-react';

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

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0">
            {/* Line 1: Order value + discount icon */}
            <div className="flex items-center gap-1.5">
                <span
                    className="text-gray-700 tabular-nums font-medium"
                    title={`₹${orderValue.toLocaleString('en-IN')}`}
                >
                    ₹{Math.round(orderValue).toLocaleString('en-IN')}
                </span>
                {discountCode && (
                    <span title={discountCode}>
                        <Tag className="w-3.5 h-3.5 text-purple-500" />
                    </span>
                )}
            </div>
            {/* Line 2: Payment method */}
            <span
                className={cn(
                    'text-[11px]',
                    isCod ? 'text-amber-600' : 'text-emerald-600'
                )}
            >
                {isCod ? 'COD' : 'Prepaid'}
            </span>
        </div>
    );
}
