/**
 * TypeBadgeCell - Badge showing node type (Product/Variation/SKU)
 */

import type { ProductNodeType } from '../types';

interface TypeBadgeCellProps {
    type: ProductNodeType;
}

const TYPE_STYLES: Record<ProductNodeType, { bg: string; text: string; label: string }> = {
    product: {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        label: 'Product',
    },
    variation: {
        bg: 'bg-purple-50',
        text: 'text-purple-700',
        label: 'Variation',
    },
    sku: {
        bg: 'bg-teal-50',
        text: 'text-teal-700',
        label: 'SKU',
    },
};

export function TypeBadgeCell({ type }: TypeBadgeCellProps) {
    const style = TYPE_STYLES[type];

    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg} ${style.text}`}>
            {style.label}
        </span>
    );
}
