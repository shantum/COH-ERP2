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
        <div className="flex items-center gap-2.5">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                className="p-0.5 rounded hover:bg-gray-200 transition-colors"
            >
                {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-400" />
                ) : (
                    <ChevronRight size={16} className="text-gray-400" />
                )}
            </button>

            {row.productImageUrl ? (
                <img
                    src={row.productImageUrl}
                    alt=""
                    className="w-8 h-8 rounded object-cover flex-shrink-0 border border-gray-100"
                />
            ) : (
                <div className="w-8 h-8 rounded bg-gray-100 flex-shrink-0 border border-gray-200" />
            )}

            <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-800 text-sm truncate">
                    {row.productName}
                </div>
                <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                    {row.styleCode && (
                        <span className="font-mono">{row.styleCode}</span>
                    )}
                    {row.styleCode && row.gender && <span>·</span>}
                    {row.gender && <span>{row.gender}</span>}
                    <span className="text-gray-300">·</span>
                    <span>{row.variationCount} variants</span>
                </div>
            </div>
        </div>
    );
});
