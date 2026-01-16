/**
 * Generic status badge component for various status displays
 */

import { CheckCircle, AlertCircle } from 'lucide-react';
import { STOCK_STATUS_STYLES } from '../../orders/ordersGrid/formatting';

interface StatusBadgeProps {
    status: string;
    showIcon?: boolean;
}

export function StatusBadge({ status, showIcon = false }: StatusBadgeProps) {
    const config = STOCK_STATUS_STYLES[status] || {
        bg: 'bg-gray-100',
        text: 'text-gray-700',
        label: status,
    };

    const isPositive = status === 'OK' || status === 'ok';
    const Icon = isPositive ? CheckCircle : AlertCircle;

    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
            {showIcon && <Icon size={10} />}
            {config.label}
        </span>
    );
}

/**
 * Simple OK/Low status badge for inventory
 */
export function InventoryStatusBadge({ status }: { status: string }) {
    if (status === 'ok') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                <CheckCircle size={10} />
                OK
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
            <AlertCircle size={10} />
            Low
        </span>
    );
}

/**
 * Fabric stock status badge
 */
export function FabricStatusBadge({ status }: { status: string }) {
    if (status === 'OK') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                OK
            </span>
        );
    }
    if (status === 'ORDER SOON') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                Soon
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
            Order Now
        </span>
    );
}
