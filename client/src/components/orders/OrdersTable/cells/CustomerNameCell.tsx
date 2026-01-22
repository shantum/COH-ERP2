/**
 * CustomerNameCell - Displays customer name with click-to-view functionality
 */

import { memo } from 'react';
import type { CellProps } from '../types';

export const CustomerNameCell = memo(function CustomerNameCell({ row, handlersRef }: CellProps) {
    if (!row.isFirstLine) return null;

    const { onViewCustomer } = handlersRef.current;

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onViewCustomer(row.order);
            }}
            className="text-gray-700 hover:text-blue-600 hover:underline truncate max-w-[140px]"
            title={row.customerName}
        >
            {row.customerName}
        </button>
    );
});
