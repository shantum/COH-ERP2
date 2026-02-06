/**
 * FabricNameCell - Display fabric name for flat colour table
 */

import { memo } from 'react';
import type { FabricColourFlatRow } from '../hooks/useMaterialsTree';

interface FabricNameCellProps {
    row: FabricColourFlatRow;
}

export const FabricNameCell = memo(function FabricNameCell({ row }: FabricNameCellProps) {
    return (
        <span className="text-sm text-gray-700 truncate">
            {row.fabricName}
        </span>
    );
});
