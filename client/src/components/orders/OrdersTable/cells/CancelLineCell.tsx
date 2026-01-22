/**
 * CancelLineCell - Cell for cancelling/uncancelling order lines
 * Light checkbox style - thin border, subtle colors
 */

import { memo } from 'react';
import { X } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { CheckboxSpinner } from './CheckboxSpinner';

export const CancelLineCell = memo(function CancelLineCell({ row, handlersRef }: CellProps) {
    if (!row || !row.lineId) return null;

    const { allocatingLines, onCancelLine, onUncancelLine } = handlersRef.current;

    const isCancelled = row.lineStatus === 'cancelled';
    // Check if THIS specific line is being processed (not a global flag)
    const isToggling = allocatingLines?.has(row.lineId) || false;

    // Cancelled - checked with X
    if (isCancelled) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onUncancelLine(row.lineId!);
                }}
                disabled={isToggling}
                className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center mx-auto transition-colors',
                    isToggling
                        ? 'bg-red-50 border-red-200'
                        : 'bg-red-100 border-red-300 text-red-500 hover:bg-red-200 hover:border-red-400'
                )}
                title={isToggling ? 'Restoring...' : 'Click to restore line'}
            >
                {isToggling ? <CheckboxSpinner color="red" /> : <X size={10} strokeWidth={2.5} />}
            </button>
        );
    }

    // Not cancelled - empty checkbox
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onCancelLine(row.lineId!);
            }}
            disabled={isToggling}
            className={cn(
                'w-4 h-4 rounded border flex items-center justify-center mx-auto transition-colors',
                isToggling
                    ? 'bg-red-50 border-red-200'
                    : 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50'
            )}
            title={isToggling ? 'Cancelling...' : 'Click to cancel line'}
        >
            {isToggling ? <CheckboxSpinner color="red" /> : null}
        </button>
    );
});
