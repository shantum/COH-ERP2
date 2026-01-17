/**
 * ExpanderCell - Expand/collapse control for tree rows
 */

import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import type { Row } from '@tanstack/react-table';
import type { ProductTreeNode } from '../types';

interface ExpanderCellProps {
    row: Row<ProductTreeNode>;
    isLoading?: boolean;
}

export function ExpanderCell({ row, isLoading }: ExpanderCellProps) {
    const canExpand = row.getCanExpand();
    const isExpanded = row.getIsExpanded();

    if (!canExpand) {
        return <span className="w-5 inline-block" />;
    }

    if (isLoading) {
        return <Loader2 size={14} className="animate-spin text-gray-400" />;
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                row.toggleExpanded();
            }}
            className="p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
        >
            {isExpanded ? (
                <ChevronDown size={14} />
            ) : (
                <ChevronRight size={14} />
            )}
        </button>
    );
}
