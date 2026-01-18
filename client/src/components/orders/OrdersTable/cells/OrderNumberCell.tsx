/**
 * OrderNumberCell - Displays order number with click-to-view functionality
 */

import type { CellProps } from '../types';

export function OrderNumberCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewOrder } = handlersRef.current;

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onViewOrder(row.orderId);
            }}
            className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
            title={`View order ${row.orderNumber}`}
        >
            {row.orderNumber}
        </button>
    );
}
