/**
 * StockCell - Stock level display with status indicator
 */

import type { ProductTreeNode } from '../types';

interface StockCellProps {
    node: ProductTreeNode;
}

export function StockCell({ node }: StockCellProps) {
    // Show aggregate stock for products/variations, actual balance for SKUs
    const stock = node.type === 'sku' ? node.currentBalance : node.totalStock;

    if (stock === undefined || stock === null) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    // Determine status color
    let statusColor = 'text-gray-600';
    if (node.type === 'sku' && node.targetStockQty !== undefined) {
        if (stock <= 0) {
            statusColor = 'text-red-600 font-medium';
        } else if (stock < node.targetStockQty * 0.5) {
            statusColor = 'text-amber-600';
        } else {
            statusColor = 'text-green-600';
        }
    } else if (stock <= 0) {
        statusColor = 'text-red-600 font-medium';
    } else if (stock < 10) {
        statusColor = 'text-amber-600';
    }

    return (
        <span className={`text-xs tabular-nums ${statusColor}`}>
            {stock.toLocaleString()}
        </span>
    );
}
