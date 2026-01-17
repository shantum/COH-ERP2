/**
 * StockCell - Display inventory balance (colours only)
 *
 * Shows:
 * - Current balance with color coding based on status
 * - order_now: Red background
 * - order_soon: Yellow background
 * - ok: Green background
 */

import type { MaterialNode } from '../types';

interface StockCellProps {
    node: MaterialNode;
}

export function StockCell({ node }: StockCellProps) {
    // Only show for colours with balance data
    if (node.type !== 'colour') {
        return null;
    }

    const balance = node.currentBalance ?? 0;
    const status = node.stockStatus;

    // Status-based styling
    const getStatusStyle = () => {
        switch (status) {
            case 'order_now':
                return 'bg-red-100 text-red-700';
            case 'order_soon':
                return 'bg-yellow-100 text-yellow-700';
            case 'ok':
                return 'bg-green-100 text-green-700';
            default:
                return 'bg-gray-100 text-gray-700';
        }
    };

    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusStyle()}`}>
            {balance.toLocaleString()}
        </span>
    );
}
