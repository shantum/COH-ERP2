/**
 * MaterialBadgeCell - Display material name as a badge
 */

import { memo } from 'react';
import type { FabricColourFlatRow } from '../hooks/useMaterialsTree';

interface MaterialBadgeCellProps {
    row: FabricColourFlatRow;
}

export const MaterialBadgeCell = memo(function MaterialBadgeCell({ row }: MaterialBadgeCellProps) {
    if (!row.materialName) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 truncate max-w-full">
            {row.materialName}
        </span>
    );
});
