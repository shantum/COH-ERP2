/**
 * CancelLineCell - Cell for cancelling/uncancelling order lines
 */

import { X } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { CheckboxSpinner } from './CheckboxSpinner';

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
                className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto shadow-sm transition-all',
                    isToggling
                        ? 'bg-red-100 border-red-300'
                        : 'bg-red-500 border-red-500 text-white hover:bg-red-600 hover:border-red-600'
                )}
                title={isToggling ? 'Restoring...' : 'Click to restore line'}
            >
                {isToggling ? <CheckboxSpinner color="red" /> : <X size={12} strokeWidth={3} />}
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
            className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto cursor-pointer shadow-sm transition-all',
                isToggling
                    ? 'bg-red-100 border-red-300'
                    : 'border-red-300 bg-white hover:bg-red-50 hover:border-red-400'
            )}
            title={isToggling ? 'Cancelling...' : 'Click to cancel line'}
        >
            {isToggling ? <CheckboxSpinner color="red" /> : null}
        </button>
    );
}
