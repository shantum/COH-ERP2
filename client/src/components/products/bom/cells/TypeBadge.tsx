/**
 * TypeBadge - Visual badge for BOM component types
 *
 * Displays FABRIC, TRIM, or SERVICE with type-specific colors.
 */

import { Scissors, Package, Wrench } from 'lucide-react';
import type { BomComponentType } from '../types';
import { BOM_TYPE_CONFIG } from '../types';

interface TypeBadgeProps {
    type: BomComponentType;
    showIcon?: boolean;
    size?: 'sm' | 'md';
}

const ICONS: Record<BomComponentType, React.ComponentType<{ size: number; className?: string }>> = {
    FABRIC: Scissors,
    TRIM: Package,
    SERVICE: Wrench,
};

export function TypeBadge({ type, showIcon = true, size = 'sm' }: TypeBadgeProps) {
    const config = BOM_TYPE_CONFIG[type];
    const Icon = ICONS[type];

    const sizeClasses = size === 'sm'
        ? 'px-2 py-0.5 text-[10px]'
        : 'px-2.5 py-1 text-xs';

    return (
        <span
            className={`inline-flex items-center gap-1 font-medium rounded-md ${config.bgColor} ${config.textColor} ${sizeClasses}`}
        >
            {showIcon && <Icon size={size === 'sm' ? 10 : 12} />}
            {config.label}
        </span>
    );
}
