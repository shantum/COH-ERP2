/**
 * VariationCell - Variation row name display
 *
 * Shows indented variation name with color swatch.
 */

import { memo } from 'react';
import type { FabricMappingRow } from '../types';

interface VariationCellProps {
    row: FabricMappingRow;
}

export const VariationCell = memo(function VariationCell({ row }: VariationCellProps) {
    return (
        <div className="flex items-center gap-2 pl-8">
            <span className="text-gray-400 text-sm">-</span>

            {row.colorHex && (
                <div
                    className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                    style={{ backgroundColor: row.colorHex }}
                    title={row.variationName}
                />
            )}

            <span className="text-gray-700 text-sm truncate">
                {row.variationName}
            </span>
        </div>
    );
});
