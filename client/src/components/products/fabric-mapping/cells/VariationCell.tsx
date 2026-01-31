/**
 * VariationCell - Variation row name display
 *
 * Shows product name, image, and variation color name in a flat row.
 */

import { memo } from 'react';
import { getOptimizedImageUrl } from '../../../../utils/imageOptimization';
import type { FabricMappingRow } from '../types';

interface VariationCellProps {
    row: FabricMappingRow;
}

export const VariationCell = memo(function VariationCell({ row }: VariationCellProps) {
    return (
        <div className="flex items-center gap-2.5">
            {row.imageUrl ? (
                <img
                    src={getOptimizedImageUrl(row.imageUrl, 'xs') || row.imageUrl}
                    alt=""
                    className="w-8 h-8 rounded object-cover flex-shrink-0 border border-gray-100"
                />
            ) : (
                <div className="w-8 h-8 rounded bg-gray-100 flex-shrink-0 border border-gray-200" />
            )}

            <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-800 text-sm truncate">
                    {row.parentProductName}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    {row.colorHex ? (
                        <div
                            className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: row.colorHex }}
                            title={row.variationName}
                        />
                    ) : (
                        <div className="w-3 h-3 rounded-full border border-dashed border-gray-300 flex-shrink-0" />
                    )}
                    <span className="truncate">{row.variationName}</span>
                </div>
            </div>
        </div>
    );
});
