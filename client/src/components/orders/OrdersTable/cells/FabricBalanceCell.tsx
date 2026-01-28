/**
 * FabricBalanceCell - Display fabric balance for order line
 * Shows green when positive, gray dash when zero/negative
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface FabricBalanceCellProps {
    row: FlattenedOrderRow;
}

export const FabricBalanceCell = memo(function FabricBalanceCell({ row }: FabricBalanceCellProps) {
    const balance = row.fabricBalance || 0;

    return (
        <span className={balance > 0 ? 'text-green-600' : 'text-gray-400'}>
            {balance > 0 ? balance.toFixed(1) : '-'}
        </span>
    );
});
