/**
 * ProductHeaderCell - Product header row display
 *
 * Shows product name, image, style code, and variation count.
 * Used for visual grouping in the flat table.
 */

import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FabricMappingRow } from '../types';

interface ProductHeaderCellProps {
    row: FabricMappingRow;
    isExpanded: boolean;
    onToggle: () => void;
}

export const ProductHeaderCell = memo(function ProductHeaderCell({ row, isExpanded, onToggle }: ProductHeaderCellProps) {
    return (
        <div className="flex items-center gap-2">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                className="p-0.5 rounded hover:bg-gray-200"
            >
                {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-500" />
                ) : (
                    <ChevronRight size={16} className="text-gray-500" />
                )}
            </button>

            {row.productImageUrl ? (
                <img
                    src={row.productImageUrl}
                    alt=""
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
            ) : (
                <div className="w-8 h-8 rounded bg-gray-200 flex-shrink-0" />
            )}

            <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">
                    {row.productName}
                </div>
                <div className="text-[10px] text-gray-500 flex items-center gap-2">
                    {row.styleCode && <span>{row.styleCode}</span>}
                    {row.category && <span>{row.category}</span>}
                    <span>({row.variationCount} variations)</span>
                </div>
            </div>
        </div>
    );
});
