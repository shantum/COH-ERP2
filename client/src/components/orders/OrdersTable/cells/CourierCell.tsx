/**
 * CourierCell - Dropdown select for courier selection
 */

import { useState, useRef, useEffect } from 'react';
import type { CellProps } from '../types';
import { COURIER_OPTIONS } from '../constants';

export function CourierCell({ row, handlersRef }: CellProps) {
    if (!row?.lineId) return null;

    const { onUpdateLineTracking } = handlersRef.current;
    const [isEditing, setIsEditing] = useState(false);
    const selectRef = useRef<HTMLSelectElement>(null);

    const currentCourier = row.lineCourier || '';

    // Focus select when editing starts
    useEffect(() => {
        if (isEditing && selectRef.current) {
            selectRef.current.focus();
        }
    }, [isEditing]);

    const handleChange = (newValue: string) => {
        if (newValue !== currentCourier) {
            onUpdateLineTracking(row.lineId!, { courier: newValue || undefined });
        }
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <select
                ref={selectRef}
                value={currentCourier}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={() => setIsEditing(false)}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            >
                <option value="">Select...</option>
                {COURIER_OPTIONS.map((courier) => (
                    <option key={courier} value={courier}>
                        {courier}
                    </option>
                ))}
            </select>
        );
    }

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
            }}
            className="cursor-pointer truncate text-gray-700"
            title={currentCourier || 'Click to select courier'}
        >
            {currentCourier || <span className="text-gray-300">—</span>}
        </div>
    );
}
