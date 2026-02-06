/**
 * ColourNameCell - Display colour name with swatch
 *
 * Simplified version of NameCell for flat table (no indentation needed)
 */

import { memo } from 'react';
import type { FabricColourFlatRow } from '../hooks/useMaterialsTree';

interface ColourNameCellProps {
    row: FabricColourFlatRow;
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

export const ColourNameCell = memo(function ColourNameCell({ row }: ColourNameCellProps) {
    return (
        <div className="flex items-center gap-2">
            <ColourSwatch hex={row.colourHex} />
            <span className="truncate font-medium">{row.colourName}</span>
        </div>
    );
});
