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

    const { isCancellingLine, isUncancellingLine, onCancelLine, onUncancelLine } = handlersRef.current;

    const isCancelled = row.lineStatus === 'cancelled';
    const isToggling = isCancellingLine || isUncancellingLine;

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
}, (prev, next) => (
    prev.row.lineId === next.row.lineId &&
    prev.row.lineStatus === next.row.lineStatus &&
    prev.handlersRef.current.isCancellingLine === next.handlersRef.current.isCancellingLine &&
    prev.handlersRef.current.isUncancellingLine === next.handlersRef.current.isUncancellingLine
));
