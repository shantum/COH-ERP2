/**
 * PaymentMethodCell - Displays payment method with color coding
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { cn } from '../../../../lib/utils';

interface PaymentMethodCellProps {
    row: FlattenedOrderRow;
}

export function PaymentMethodCell({ row }: PaymentMethodCellProps) {
    if (!row.isFirstLine || !row.paymentMethod) return null;

    const isCod = row.paymentMethod.toLowerCase().includes('cod') ||
                  row.paymentMethod.toLowerCase().includes('cash');

    return (
        <span
            className={cn(
                'px-1.5 py-0.5 rounded font-medium',
                isCod
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-green-100 text-green-700'
            )}
        >
            {isCod ? 'COD' : 'Prepaid'}
        </span>
    );
}
