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
        <div className="flex items-center gap-2 pl-6">
            {row.colorHex ? (
                <div
                    className="w-3.5 h-3.5 rounded-full border border-gray-200 flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: row.colorHex }}
                    title={row.variationName}
                />
            ) : (
                <div className="w-3.5 h-3.5 rounded-full border border-dashed border-gray-300 flex-shrink-0" />
            )}

            <span className="text-gray-600 text-sm truncate">
                {row.variationName}
            </span>
        </div>
    );
});
