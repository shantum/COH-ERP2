/**
 * ShipByDateCell - Editable ship-by date cell
 */

import { useState, useRef, useEffect } from 'react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

export function ShipByDateCell({ row, handlersRef }: ShipByDateCellProps) {
    if (!row.isFirstLine) return null;

    const { onUpdateShipByDate } = handlersRef.current;
    const [isEditing, setIsEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const currentDate = row.shipByDate;

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    const handleChange = (newValue: string) => {
        if (onUpdateShipByDate) {
            onUpdateShipByDate(row.orderId, newValue || null);
        }
        setIsEditing(false);
    };

    // Check if past due
    const isPastDue = currentDate && new Date(currentDate) < new Date();

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="date"
                defaultValue={currentDate?.split('T')[0] || ''}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={() => setIsEditing(false)}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            />
        );
    }

    if (!currentDate) {
        return null; // Don't show anything when no ship-by date
    }

    const formatted = new Date(currentDate).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
    });

    return (
        <span
            onClick={(e) => {
                e.stopPropagation();
                if (onUpdateShipByDate) setIsEditing(true);
            }}
            className={cn(
                'cursor-pointer',
                isPastDue ? 'text-red-600 font-medium' : 'text-gray-700'
            )}
            title={currentDate}
        >
            {formatted}
        </span>
    );
}

interface ShipByDateCellProps extends CellProps {}
