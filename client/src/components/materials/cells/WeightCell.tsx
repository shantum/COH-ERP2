/**
 * WeightCell - Display fabric weight with unit (e.g., "180 gsm", "60 lea")
 * Only shown for fabric rows
 */

import type { MaterialNode } from '../types';

interface WeightCellProps {
    node: MaterialNode;
}

export function WeightCell({ node }: WeightCellProps) {
    if (node.type !== 'fabric' || node.weight == null) {
        return null;
    }

    const unit = node.weightUnit || 'gsm';

    return (
        <span className="text-xs text-gray-700">
            {node.weight} {unit}
        </span>
    );
}
