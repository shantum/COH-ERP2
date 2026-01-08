/**
 * Shared column visibility dropdown for AG-Grid tables
 * Allows users to show/hide columns with persistence to localStorage
 */

import { useState, useRef, useEffect } from 'react';
import { Columns, RotateCcw } from 'lucide-react';

interface ColumnVisibilityDropdownProps {
    visibleColumns: Set<string>;
    onToggleColumn: (colId: string) => void;
    onResetAll: () => void;
    columnIds: string[];
    columnHeaders: Record<string, string>;
    excludeColumns?: string[];
}

export function ColumnVisibilityDropdown({
    visibleColumns,
    onToggleColumn,
    onResetAll,
    columnIds,
    columnHeaders,
    excludeColumns = ['actions'],
}: ColumnVisibilityDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const toggleableColumns = columnIds.filter(id => !excludeColumns.includes(id));

    return (
        <div ref={dropdownRef} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50"
            >
                <Columns size={12} />
                Columns
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                    <div className="p-2 border-b">
                        <button
                            onClick={onResetAll}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                        >
                            <RotateCcw size={10} />
                            Reset All
                        </button>
                    </div>
                    <div className="p-2 space-y-1">
                        {toggleableColumns.map((colId) => (
                            <label
                                key={colId}
                                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded"
                            >
                                <input
                                    type="checkbox"
                                    checked={visibleColumns.has(colId)}
                                    onChange={() => onToggleColumn(colId)}
                                    className="w-3 h-3"
                                />
                                {columnHeaders[colId] || colId}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
