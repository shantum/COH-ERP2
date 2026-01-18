/**
 * PackCell - Fulfillment action cell for packing items
 */

import { Check } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { CheckboxSpinner } from './CheckboxSpinner';

export function PackCell({ row, handlersRef }: CellProps) {
    if (!row || row.lineStatus === 'cancelled') return null;

    const { allocatingLines, onPack, onUnpack } = handlersRef.current;

    const isToggling = allocatingLines.has(row.lineId || '');
    const canPack = row.lineStatus === 'picked';
    // Include shipped in packed state (it must have been packed)
    const isPacked = ['packed', 'shipped'].includes(row.lineStatus || '');

    if (isPacked) {
        const isShipped = row.lineStatus === 'shipped';
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isShipped && row.lineId) onUnpack(row.lineId);
                }}
                disabled={isToggling || isShipped}
                className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all',
                    isToggling
                        ? 'bg-blue-100 border-blue-300'
                        : isShipped
                        ? 'bg-blue-200 border-blue-200 text-blue-600 cursor-not-allowed'
                        : 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600 shadow-sm'
                )}
                title={isToggling ? 'Updating...' : isShipped ? 'Already shipped' : 'Click to unpack'}
            >
                {isToggling ? <CheckboxSpinner color="blue" /> : <Check size={12} strokeWidth={3} />}
            </button>
        );
    }

    // Only show if can pack - hide otherwise to reduce clutter
    if (!canPack) {
        return null;
    }

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (row.lineId) onPack(row.lineId);
            }}
            disabled={isToggling}
            className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto cursor-pointer shadow-sm transition-all',
                isToggling
                    ? 'bg-blue-100 border-blue-300'
                    : 'border-blue-400 bg-white hover:bg-blue-100 hover:border-blue-500'
            )}
            title={isToggling ? 'Packing...' : 'Click to pack'}
        >
            {isToggling ? <CheckboxSpinner color="blue" /> : null}
        </button>
    );
}
