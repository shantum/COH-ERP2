/**
 * NotesCell - Inline editable notes for order lines
 */

import { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import type { CellProps } from '../types';

export function NotesCell({ row, handlersRef }: CellProps) {
    if (!row?.lineId) return null;

    const { onUpdateLineNotes } = handlersRef.current;
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(row.lineNotes || '');
    const inputRef = useRef<HTMLInputElement>(null);

    // Update local value when row changes
    useEffect(() => {
        setValue(row.lineNotes || '');
    }, [row.lineNotes]);

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleSave = () => {
        if (value !== row.lineNotes) {
            onUpdateLineNotes(row.lineId!, value);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setValue(row.lineNotes || '');
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
                className="w-full px-1 py-0 border border-blue-300 rounded focus:outline-none bg-white text-xs"
                placeholder="Note..."
            />
        );
    }

    const notes = row.lineNotes || '';

    if (!notes) {
        return (
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                }}
                className="flex items-center gap-1 cursor-pointer text-gray-300 hover:text-gray-400 transition-colors group"
                title="Click to add note"
            >
                <Pencil size={12} className="opacity-50 group-hover:opacity-100" />
                <span className="text-[10px] italic">Add note</span>
            </div>
        );
    }

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
            }}
            className="flex items-center gap-1 cursor-pointer group"
            title={`${notes} (click to edit)`}
        >
            <span className="truncate text-amber-700 bg-amber-50 px-1 rounded text-xs">
                {notes}
            </span>
            <Pencil size={10} className="text-gray-300 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
        </div>
    );
}
