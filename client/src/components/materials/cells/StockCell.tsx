/**
 * StockCell - Display inventory balance
 *
 * Shows:
 * - For fabric rows: Total stock of all colours with unit (e.g., "1,234 m")
 * - For colour rows: Individual balance with unit and color coding
 * - order_now: Red background
 * - order_soon: Yellow background
 * - ok: Green background
 */

import type { MaterialNode } from '../types';

interface StockCellProps {
    node: MaterialNode;
}

/**
 * Format unit for display
 * 'm' -> 'mtr', 'kg' -> 'kg'
 */
function formatUnit(unit?: string): string {
    if (!unit) return '';
    if (unit === 'm') return 'mtr';
    return unit;
}

export function StockCell({ node }: StockCellProps) {
    // Show for fabric rows (total stock) and colour rows (individual balance)
    if (node.type === 'material') {
        return null;
    }

    const isFabric = node.type === 'fabric';
    const balance = isFabric ? (node.totalStock ?? 0) : (node.currentBalance ?? 0);
    const status = node.stockStatus;
    const unit = node.unit;
    const unitDisplay = formatUnit(unit);

    // Status-based styling (only for colour rows)
    const getStatusStyle = () => {
        if (isFabric) {
            // Fabric rows: neutral style for total
            return 'bg-slate-100 text-slate-700';
        }
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

    // Format balance with unit
    const formattedBalance = balance.toLocaleString('en-IN', {
        maximumFractionDigits: 2,
    });

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${getStatusStyle()}`}>
            <span>{formattedBalance}</span>
            {unitDisplay && <span className="text-gray-500">{unitDisplay}</span>}
        </span>
    );
}
