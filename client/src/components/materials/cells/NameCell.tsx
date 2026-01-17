/**
 * NameCell - Display name with colour swatch and indentation
 */

import type { Row } from '@tanstack/react-table';
import type { MaterialNode } from '../types';

interface NameCellProps {
    row: Row<MaterialNode>;
}

/**
 * Colour swatch component
 */
function ColourSwatch({ hex }: { hex?: string | null }) {
    return (
        <div
            className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
            style={{ backgroundColor: hex || '#ccc' }}
        />
    );
}

export function NameCell({ row }: NameCellProps) {
    const node = row.original;
    const depth = row.depth;
    const isColour = node.type === 'colour';

    return (
        <div
            className="flex items-center gap-2"
            style={{ paddingLeft: `${depth * 20}px` }}
        >
            {isColour && <ColourSwatch hex={node.colourHex} />}
            <span className={`truncate ${depth === 0 ? 'font-semibold' : depth === 1 ? 'font-medium' : ''}`}>
                {node.name}
            </span>
        </div>
    );
}
