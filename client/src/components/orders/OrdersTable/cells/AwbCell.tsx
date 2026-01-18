/**
 * AwbCell - Inline editable AWB number cell
 */

import { useState, useRef, useEffect } from 'react';
import type { CellProps } from '../types';

export function AwbCell({ row, handlersRef }: CellProps) {
    if (!row?.lineId) return null;

    const { onUpdateLineTracking } = handlersRef.current;
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(row.lineAwbNumber || '');
    const inputRef = useRef<HTMLInputElement>(null);

    const currentAwb = row.lineAwbNumber || '';

    // Update local value when row changes
    useEffect(() => {
        setValue(row.lineAwbNumber || '');
    }, [row.lineAwbNumber]);

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleSave = () => {
        if (value !== currentAwb) {
            onUpdateLineTracking(row.lineId!, { awbNumber: value || undefined });
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setValue(currentAwb);
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="w-full text-xs px-1 py-0.5 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                placeholder="Enter AWB..."
            />
        );
    }

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
            }}
            className="cursor-pointer truncate text-gray-700"
            title={currentAwb || 'Click to enter AWB'}
        >
            {currentAwb || <span className="text-gray-300">—</span>}
        </div>
    );
}
