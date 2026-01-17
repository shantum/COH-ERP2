/**
 * ConnectedProductsCell - Shows products using this fabric/colour
 */

import { Package } from 'lucide-react';
import type { MaterialNode } from '../types';

interface ConnectedProductsCellProps {
    node: MaterialNode;
}

export function ConnectedProductsCell({ node }: ConnectedProductsCellProps) {
    // Only show for fabrics and colours
    if (node.type === 'material') {
        return null;
    }

    const productCount = node.productCount || 0;
    const products = node.connectedProducts || [];

    if (productCount === 0) {
        return <span className="text-gray-400 text-xs">-</span>;
    }

    // Show count with tooltip showing product names
    const tooltipText = products.length > 0
        ? products.map(p => p.styleCode ? `${p.name} (${p.styleCode})` : p.name).join(', ')
        : `${productCount} product${productCount === 1 ? '' : 's'}`;

    return (
        <div
            className="flex items-center gap-1.5 text-xs cursor-default"
            title={tooltipText}
        >
            <Package size={12} className="text-gray-400" />
            <span className="text-gray-600 font-medium">{productCount}</span>
            {products.length > 0 && products.length <= 2 && (
                <span className="text-gray-500 truncate max-w-[80px]">
                    {products.map(p => p.name).join(', ')}
                </span>
            )}
        </div>
    );
}
