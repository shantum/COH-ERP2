/**
 * StatusCell - Mapping status indicator
 *
 * For product rows: Shows "X/Y mapped" count
 * For variation rows: Shows checkmark if mapped, empty if not
 */

import { memo } from 'react';
import { Check } from 'lucide-react';
import type { FabricMappingRow } from '../types';

interface StatusCellProps {
    row: FabricMappingRow;
    isPending?: boolean;
}

export const StatusCell = memo(function StatusCell({ row, isPending }: StatusCellProps) {
    if (row.rowType === 'product') {
        const mappedCount = row.mappedCount || 0;
        const totalCount = row.variationCount || 0;
        const allMapped = mappedCount === totalCount && totalCount > 0;

        return (
            <div
                className={`text-xs font-medium ${
                    allMapped
                        ? 'text-green-600'
                        : mappedCount > 0
                            ? 'text-amber-600'
                            : 'text-gray-400'
                }`}
            >
                {mappedCount}/{totalCount}
            </div>
        );
    }

    // Variation row
    const isMapped = !!row.currentColourId;
    const showCheck = isMapped || isPending;

    return (
        <div className="flex items-center justify-center">
            {showCheck ? (
                <div
                    className={`p-0.5 rounded-full ${
                        isPending
                            ? 'bg-amber-100 text-amber-600'
                            : 'bg-green-100 text-green-600'
                    }`}
                >
                    <Check size={12} />
                </div>
            ) : (
                <div className="w-4 h-4" />
            )}
        </div>
    );
});
