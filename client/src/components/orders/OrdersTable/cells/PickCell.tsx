/**
 * PickCell - Fulfillment action cell for picking items
 */

import { Check } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { CheckboxSpinner } from './CheckboxSpinner';

export function PickCell({ row, handlersRef }: CellProps) {
    if (!row || row.lineStatus === 'cancelled') return null;

    const { allocatingLines, onPick, onUnpick } = handlersRef.current;

    const isToggling = allocatingLines.has(row.lineId || '');
    const canPick = row.lineStatus === 'allocated';
    // Include shipped in picked state (it must have been picked)
    const isPicked = ['picked', 'packed', 'shipped'].includes(row.lineStatus || '');

    if (isPicked) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (row.lineStatus === 'picked' && row.lineId) onUnpick(row.lineId);
                }}
                disabled={isToggling || row.lineStatus !== 'picked'}
                className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all',
                    isToggling
                        ? 'bg-teal-100 border-teal-300'
                        : row.lineStatus === 'picked'
                        ? 'bg-teal-500 border-teal-500 text-white hover:bg-teal-600 shadow-sm'
                        : 'bg-teal-200 border-teal-200 text-teal-600'
                )}
                title={
                    isToggling
                        ? 'Updating...'
                        : row.lineStatus === 'picked'
                        ? 'Click to unpick'
                        : row.lineStatus === 'shipped'
                        ? 'Shipped'
                        : 'Packed'
                }
            >
                {isToggling ? <CheckboxSpinner color="teal" /> : <Check size={12} strokeWidth={3} />}
            </button>
        );
    }

    // Only show if can pick - hide otherwise to reduce clutter
    if (!canPick) {
        return null;
    }

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (row.lineId) onPick(row.lineId);
            }}
            disabled={isToggling}
            className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto cursor-pointer shadow-sm transition-all',
                isToggling
                    ? 'bg-teal-100 border-teal-300'
                    : 'border-teal-400 bg-white hover:bg-teal-100 hover:border-teal-500'
            )}
            title={isToggling ? 'Picking...' : 'Click to pick'}
        >
            {isToggling ? <CheckboxSpinner color="teal" /> : null}
        </button>
    );
}
