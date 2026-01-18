/**
 * CancelLineCell - Cell for cancelling/uncancelling order lines
 */

import { X } from 'lucide-react';
import type { CellProps } from '../types';

export function CancelLineCell({ row, handlersRef }: CellProps) {
    if (!row || !row.lineId) return null;

    const { allocatingLines, onCancelLine, onUncancelLine } = handlersRef.current;

    const isCancelled = row.lineStatus === 'cancelled';
    const isToggling = allocatingLines.has(row.lineId);

    // Cancelled - show red X (can restore)
    if (isCancelled) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onUncancelLine(row.lineId!);
                }}
                disabled={isToggling}
                className="w-5 h-5 rounded border-2 bg-red-500 border-red-500 text-white flex items-center justify-center mx-auto hover:bg-red-600 hover:border-red-600 shadow-sm disabled:opacity-50"
                title="Click to restore line"
            >
                {isToggling ? <span className="animate-spin text-xs">·</span> : <X size={12} strokeWidth={3} />}
            </button>
        );
    }

    // Not cancelled - show empty checkbox (can cancel)
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onCancelLine(row.lineId!);
            }}
            disabled={isToggling}
            className="w-5 h-5 rounded border-2 border-red-300 bg-white hover:bg-red-50 hover:border-red-400 flex items-center justify-center mx-auto cursor-pointer shadow-sm disabled:opacity-50"
            title="Click to cancel line"
        >
            {isToggling ? <span className="animate-spin text-xs">·</span> : null}
        </button>
    );
}
