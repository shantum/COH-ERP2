/**
 * TypeBadgeCell - Display type badge (Material/Fabric/Colour)
 */

import type { MaterialNodeType } from '../types';

interface TypeBadgeCellProps {
    type: MaterialNodeType;
}

const TYPE_STYLES: Record<MaterialNodeType, string> = {
    material: 'bg-purple-100 text-purple-700',
    fabric: 'bg-blue-100 text-blue-700',
    colour: 'bg-green-100 text-green-700',
};

const TYPE_LABELS: Record<MaterialNodeType, string> = {
    material: 'Material',
    fabric: 'Fabric',
    colour: 'Colour',
};

export function TypeBadgeCell({ type }: TypeBadgeCellProps) {
    return (
        <span className={`px-2 py-0.5 text-xs rounded-full ${TYPE_STYLES[type]}`}>
            {TYPE_LABELS[type]}
        </span>
    );
}

/**
 * Construction type badge (knit/woven) for fabrics
 */
interface ConstructionBadgeProps {
    type?: 'knit' | 'woven' | string | null;
}

export function ConstructionBadge({ type }: ConstructionBadgeProps) {
    if (!type) return <span className="text-xs text-gray-400">-</span>;

    const isKnit = type === 'knit';
    return (
        <span className={`px-2 py-0.5 text-xs rounded-full capitalize ${
            isKnit ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
        }`}>
            {type}
        </span>
    );
}
