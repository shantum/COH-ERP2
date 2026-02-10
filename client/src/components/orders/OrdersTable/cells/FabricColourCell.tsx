/**
 * FabricColourCell - Display fabric colour name
 */
import { memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';

interface FabricColourCellProps {
    row: FlattenedOrderRow;
}

export const FabricColourCell = memo(function FabricColourCell({ row }: FabricColourCellProps) {
    const name = row.fabricColourName;
    if (!name) return <span className="text-gray-400">-</span>;

    return (
        <span className="text-gray-700 truncate" title={name}>
            {name}
        </span>
    );
});
