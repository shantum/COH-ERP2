/**
 * CompositionCell - Display fabric composition (e.g., "100% Cotton", "60/40 Cotton Poly")
 * Only shown for fabric rows
 */

import type { MaterialNode } from '../types';

interface CompositionCellProps {
    node: MaterialNode;
}

export function CompositionCell({ node }: CompositionCellProps) {
    if (node.type !== 'fabric' || !node.composition) {
        return null;
    }

    return (
        <span className="text-xs text-gray-700 truncate" title={node.composition}>
            {node.composition}
        </span>
    );
}
