/**
 * ShipByDateCell - Editable ship-by date cell
 */

import { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';
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
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (onUpdateShipByDate) setIsEditing(true);
                }}
                className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1 text-gray-300 hover:text-blue-600 hover:bg-blue-50 border border-dashed border-gray-300 hover:border-blue-300 transition-colors"
                title="Set ship by date"
            >
                <Calendar size={10} />
                <span className="text-[10px] italic">Set date</span>
            </button>
        );
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
