/**
 * OutOfStockCell - Toggle for marking fabric colours as out of stock
 *
 * Shows:
 * - A small toggle button for colour rows
 * - Red "OOS" badge when active
 * - Only renders for type === 'colour'
 */

import { memo } from 'react';
import type { MaterialNode } from '../types';

interface OutOfStockCellProps {
    node: MaterialNode;
    onToggle: (id: string, isOutOfStock: boolean) => void;
}

export const OutOfStockCell = memo(function OutOfStockCell({ node, onToggle }: OutOfStockCellProps) {
    // Only show for colours
    if (node.type !== 'colour') {
        return null;
    }

    const isOutOfStock = node.isOutOfStock ?? false;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle(node.id, !isOutOfStock);
    };

    if (isOutOfStock) {
        return (
            <button
                type="button"
                onClick={handleClick}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                title="Click to mark as in stock"
            >
                OOS
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
            title="Click to mark as out of stock"
        >
            In Stock
        </button>
    );
});
