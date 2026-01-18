/**
 * AllocateCell - Fulfillment action cell for allocating inventory
 */

import { Check } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { CheckboxSpinner } from './CheckboxSpinner';

export function AllocateCell({ row, handlersRef }: CellProps) {
    if (!row || row.lineStatus === 'cancelled') return null;

    const { allocatingLines, onAllocate, onUnallocate } = handlersRef.current;

    const hasStock = row.skuStock >= row.qty;
    const isAllocated =
        row.lineStatus === 'allocated' ||
        row.lineStatus === 'picked' ||
        row.lineStatus === 'packed';
    const isPending = row.lineStatus === 'pending';

    // Allow allocation for any pending line with stock (including customized)
    const canAllocate = isPending && hasStock;
    const isToggling = allocatingLines.has(row.lineId || '');

    if (isAllocated) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (row.lineStatus === 'allocated' && row.lineId) onUnallocate(row.lineId);
                }}
                disabled={isToggling || row.lineStatus !== 'allocated'}
                className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all',
                    isToggling
                        ? 'bg-purple-100 border-purple-300'
                        : row.lineStatus === 'allocated'
                        ? 'bg-purple-500 border-purple-500 text-white hover:bg-purple-600 shadow-sm'
                        : 'bg-purple-200 border-purple-200 text-purple-600'
                )}
                title={isToggling ? 'Updating...' : row.lineStatus === 'allocated' ? 'Click to unallocate' : `Status: ${row.lineStatus}`}
            >
                {isToggling ? <CheckboxSpinner color="purple" /> : <Check size={12} strokeWidth={3} />}
            </button>
        );
    }

    // Only show checkbox if can allocate - hide otherwise to reduce clutter
    if (!canAllocate) {
        return null;
    }

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (row.lineId) onAllocate(row.lineId);
            }}
            disabled={isToggling}
            className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto cursor-pointer shadow-sm transition-all',
                isToggling
                    ? 'bg-purple-100 border-purple-300'
                    : 'border-purple-400 bg-white hover:bg-purple-100 hover:border-purple-500'
            )}
            title={isToggling ? 'Allocating...' : 'Click to allocate'}
        >
            {isToggling ? <CheckboxSpinner color="purple" /> : null}
        </button>
    );
}
