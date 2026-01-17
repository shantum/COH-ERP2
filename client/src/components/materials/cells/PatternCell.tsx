/**
 * PatternCell - Display fabric pattern (e.g., "French Terry", "Plain Weave")
 * Only shown for fabric rows
 */

import type { MaterialNode } from '../types';

interface PatternCellProps {
    node: MaterialNode;
}

export function PatternCell({ node }: PatternCellProps) {
    if (node.type !== 'fabric' || !node.pattern) {
        return null;
    }

    return (
        <span className="text-xs text-gray-700 truncate">
            {node.pattern}
        </span>
    );
}
