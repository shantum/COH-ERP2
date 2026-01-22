/**
 * SkuCodeCell - Displays SKU code
 */

import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface SkuCodeCellProps {
    row: FlattenedOrderRow;
}

export const SkuCodeCell = memo(function SkuCodeCell({ row }: SkuCodeCellProps) {
    const skuCode = row.skuCode || '-';

    return (
        <span className="font-mono text-gray-700 truncate" title={skuCode}>
            {skuCode}
        </span>
    );
});
