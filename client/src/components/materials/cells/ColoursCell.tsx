/**
 * ColoursCell - Shows colour swatches/thumbnails for fabrics
 */

import type { MaterialNode } from '../types';
import { STANDARD_COLOR_HEX } from '../types';

interface ColoursCellProps {
    node: MaterialNode;
}

export function ColoursCell({ node }: ColoursCellProps) {
    // Only show for fabrics that have colour children
    if (node.type !== 'fabric' || !node.children?.length) {
        return <span className="text-gray-400 text-xs">-</span>;
    }

    const colours = node.children.filter(c => c.type === 'colour');
    if (colours.length === 0) {
        return <span className="text-gray-400 text-xs">-</span>;
    }

    // Show max 6 swatches
    const visibleColours = colours.slice(0, 6);
    const remaining = colours.length - 6;

    return (
        <div className="flex items-center gap-1">
            {visibleColours.map((colour) => {
                // Try to get hex: from colourHex, standardColour lookup, or fallback
                const hex = colour.colourHex
                    || (colour.standardColour && STANDARD_COLOR_HEX[colour.standardColour])
                    || '#e5e7eb';

                return (
                    <div
                        key={colour.id}
                        className="w-5 h-5 rounded-full border border-gray-300 flex-shrink-0 shadow-sm"
                        style={{ backgroundColor: hex }}
                        title={colour.colourName || colour.name}
                    />
                );
            })}
            {remaining > 0 && (
                <span className="text-xs text-gray-500 ml-0.5">+{remaining}</span>
            )}
        </div>
    );
}
