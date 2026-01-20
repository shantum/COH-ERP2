/**
 * NotesCell - Inline editable notes for order lines
 * Expandable on click when text is truncated
 */

import { useState, useRef, useEffect } from 'react';
import { Pencil, FileText, ChevronDown } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';

export function NotesCell({ row, handlersRef }: CellProps) {
    if (!row?.lineId) return null;

    const { onUpdateLineNotes } = handlersRef.current;
    const [isEditing, setIsEditing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isTruncated, setIsTruncated] = useState(false);
    const [value, setValue] = useState(row.lineNotes || '');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);

    // Update local value when row changes
    useEffect(() => {
        setValue(row.lineNotes || '');
    }, [row.lineNotes]);

    // Check if text is truncated
    useEffect(() => {
        if (textRef.current && !isExpanded) {
            const el = textRef.current;
            setIsTruncated(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
        }
    }, [value, isExpanded]);

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    // Collapse when clicking outside
    useEffect(() => {
        if (!isExpanded) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-notes-cell]')) {
                setIsExpanded(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isExpanded]);

    const handleSave = () => {
        if (value !== row.lineNotes) {
            onUpdateLineNotes(row.lineId!, value);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            setValue(row.lineNotes || '');
            setIsEditing(false);
        }
    };

    const handleNoteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isTruncated && !isExpanded) {
            setIsExpanded(true);
        } else {
            setIsEditing(true);
            setIsExpanded(false);
        }
    };

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
        setIsExpanded(false);
    };

    if (isEditing) {
        return (
            <div className="relative" data-notes-cell>
                <textarea
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    className="w-full min-h-[60px] px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-xs resize-none"
                    placeholder="Add note..."
                    rows={3}
                />
                <div className="text-[9px] text-gray-400 mt-0.5">
                    Enter to save · Shift+Enter for new line · Esc to cancel
                </div>
            </div>
        );
    }

    // Use local value for instant feedback after save
    const notes = value;

    if (!notes) {
        return (
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                }}
                className="flex items-center gap-1.5 cursor-pointer text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 hover:border-yellow-200 px-1.5 py-1 rounded text-xs border border-dashed border-gray-300 transition-colors group"
                title="Click to add note"
                data-notes-cell
            >
                <FileText size={12} className="opacity-60 group-hover:opacity-100" />
                <span className="text-[10px]">Add note</span>
            </div>
        );
    }

    return (
        <div
            data-notes-cell
            className={cn(
                'relative group cursor-pointer',
                isExpanded && 'z-10'
            )}
        >
            <div
                onClick={handleNoteClick}
                className={cn(
                    'flex items-start gap-1.5 text-yellow-700 bg-yellow-50 px-1.5 py-1 rounded text-xs border border-yellow-200',
                    isExpanded
                        ? 'absolute left-0 top-0 min-w-[200px] max-w-[300px] shadow-lg border-yellow-300 bg-yellow-50/95 backdrop-blur-sm'
                        : 'max-w-full'
                )}
                title={isExpanded ? 'Click to edit' : (isTruncated ? 'Click to expand' : 'Click to edit')}
            >
                <FileText size={12} className="shrink-0 mt-0.5 text-yellow-600" />
                <span
                    ref={textRef}
                    className={cn(
                        'whitespace-pre-wrap break-words',
                        !isExpanded && 'line-clamp-2'
                    )}
                >
                    {notes}
                </span>
                {!isExpanded && isTruncated && (
                    <ChevronDown size={12} className="shrink-0 mt-0.5 text-yellow-500" />
                )}
            </div>

            {/* Edit button when expanded */}
            {isExpanded && (
                <button
                    onClick={handleEditClick}
                    className="absolute -bottom-6 left-0 text-[10px] text-yellow-700 hover:text-yellow-800 flex items-center gap-1 bg-white px-1.5 py-0.5 rounded shadow-sm border border-yellow-300"
                >
                    <Pencil size={10} />
                    Edit
                </button>
            )}

            {/* Subtle edit icon on hover when not expanded */}
            {!isExpanded && (
                <Pencil
                    size={10}
                    className="absolute -right-3 top-1/2 -translate-y-1/2 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={handleEditClick}
                />
            )}
        </div>
    );
}
