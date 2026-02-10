// @ts-nocheck
/**
 * AdminShipCell - Admin-only force ship button
 * Allows admins to bypass normal workflow and ship a line directly
 */

import { useState, memo } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

export const AdminShipCell = memo(function AdminShipCell({ row, handlersRef }: CellProps) {
    const { isAdmin, onForceShipLine, allocatingLines } = handlersRef.current;
    const [isPrompting, setIsPrompting] = useState(false);

    const lineId = row.lineId;
    const status = row.lineStatus;

    // Early exit for non-actionable states (stable conditions that won't change)
    if (!lineId) return null;
    if (status === 'shipped' || status === 'cancelled') return null;

    // Check admin status - explicitly require true to prevent flicker
    // during hydration when isAdmin might briefly be undefined
    if (isAdmin !== true || !onForceShipLine) return null;

    const isLoading = allocatingLines?.has(lineId) || false;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isLoading || isPrompting) return;

        setIsPrompting(true);

        // Check for existing AWB
        const existingAwb = row.lineAwbNumber || row.shopifyAwb;

        if (existingAwb) {
            // Has AWB - confirm and ship
            const confirmed = confirm(
                `Force ship this line with AWB: ${existingAwb}?\n\nThis will bypass normal workflow checks.`
            );
            if (confirmed) {
                onForceShipLine(lineId, {
                    awbNumber: existingAwb,
                    courier: row.lineCourier || row.shopifyCourier || 'Unknown',
                });
            }
        } else {
            // No AWB - prompt for it
            const awb = prompt('AWB Number (required for force ship):');
            if (awb?.trim()) {
                const courier = prompt('Courier (optional):') || 'Manual';
                onForceShipLine(lineId, { awbNumber: awb.trim(), courier });
            }
        }

        setIsPrompting(false);
    };

    return (
        <button
            onClick={handleClick}
            disabled={isLoading}
            className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                isLoading
                    ? 'bg-amber-100 text-amber-400 cursor-wait'
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300'
            )}
            title="Admin: Force ship (bypass workflow)"
        >
            {isLoading ? (
                <Loader2 size={10} className="animate-spin" />
            ) : (
                <Zap size={10} />
            )}
            <span>Force</span>
        </button>
    );
});
