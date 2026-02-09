/**
 * NameCell - Product/Variation/SKU name with indentation and color swatch
 */

import type { Row } from '@tanstack/react-table';
import type { ProductTreeNode } from '../types';

interface NameCellProps {
    row: Row<ProductTreeNode>;
}

export function NameCell({ row }: NameCellProps) {
    const node = row.original;
    const depth = row.depth;

    // Indentation based on depth
    const paddingLeft = depth * 20;

    // Color swatch for variations
    const colorHex = node.type === 'variation' ? node.colorHex : undefined;

    // Display name based on type
    let displayName = node.name;
    let subText = '';

    switch (node.type) {
        case 'product':
            subText = node.styleCode || '';
            break;
        case 'variation':
            displayName = node.colorName || node.name;
            // fabricColourName may not exist on ProductTreeNode, use optional chaining
            subText = node.fabricColourName || '';
            break;
        case 'sku':
            displayName = node.size || node.name;
            subText = node.skuCode || '';
            break;
    }

    return (
        <div
            className="flex items-center gap-2 min-w-0"
            style={{ paddingLeft: `${paddingLeft}px` }}
        >
            {/* Color swatch for variations */}
            {colorHex && (
                <span
                    className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: colorHex }}
                    title={node.colorName}
                />
            )}

            {/* Name and subtext */}
            <div className="min-w-0">
                <div className={`truncate ${
                    node.type === 'product' ? 'font-medium text-gray-900' :
                    node.type === 'variation' ? 'text-gray-800' :
                    'text-gray-700'
                }`}>
                    {displayName}
                </div>
                {subText && (
                    <div className="text-[10px] text-gray-400 truncate">
                        {subText}
                    </div>
                )}
            </div>
        </div>
    );
}
