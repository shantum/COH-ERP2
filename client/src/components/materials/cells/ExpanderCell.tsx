/**
 * ExpanderCell - Expand/collapse button for tree rows
 */

import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import type { Row } from '@tanstack/react-table';
import type { MaterialNode } from '../types';

interface ExpanderCellProps {
    row: Row<MaterialNode>;
    isLoading?: boolean;
}

export function ExpanderCell({ row, isLoading }: ExpanderCellProps) {
    const canExpand = row.getCanExpand();
    const isExpanded = row.getIsExpanded();

    if (!canExpand) {
        // No expander, just spacing for alignment
        return <span className="w-5 inline-block" />;
    }

    if (isLoading) {
        return (
            <span className="w-5 inline-flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                row.toggleExpanded();
            }}
            className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
            {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
            ) : (
                <ChevronRight className="w-4 h-4" />
            )}
        </button>
    );
}
