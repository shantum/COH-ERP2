/**
 * PaymentInfoCell - Order value + payment status pill badge (Shopify-style)
 * Line 1: Order value + discount icon
 * Line 2: Payment pill badge (Paid = green, COD = amber)
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Tag } from 'lucide-react';

interface PaymentInfoCellProps {
    row: FlattenedOrderRow;
}

export const PaymentInfoCell = memo(function PaymentInfoCell({ row }: PaymentInfoCellProps) {
    if (!row.isFirstLine) return null;

    const paymentMethod = row.paymentMethod || '';
    const isCod = paymentMethod.toLowerCase().includes('cod') ||
                  paymentMethod.toLowerCase().includes('cash');

    const orderValue = row.totalAmount || 0;
    const discountCode = row.discountCodes;

    return (
        <div className="flex flex-col justify-center leading-tight py-0.5 min-w-0 gap-1">
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
            {/* Line 2: Payment status pill badge */}
            <span
                className={
                    isCod
                        ? 'inline-flex items-center w-fit px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700'
                        : 'inline-flex items-center w-fit px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700'
                }
            >
                {isCod ? 'COD' : 'Paid'}
            </span>
        </div>
    );
});
