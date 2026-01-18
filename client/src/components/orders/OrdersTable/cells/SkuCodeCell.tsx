/**
 * SkuCodeCell - Displays SKU code
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface SkuCodeCellProps {
    row: FlattenedOrderRow;
}

export function SkuCodeCell({ row }: SkuCodeCellProps) {
    const skuCode = row.skuCode || '-';

    return (
        <span className="font-mono text-gray-700 truncate" title={skuCode}>
            {skuCode}
        </span>
    );
}
