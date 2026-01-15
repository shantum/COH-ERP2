/**
 * EditableHeader Component
 *
 * AG-Grid custom header component that allows double-click to edit the header name.
 * Used for customizable column headers in grids.
 */

import { useState } from 'react';

interface EditableHeaderProps {
    displayName: string;
    column: { colId: string };
    setCustomHeader: (colId: string, value: string) => void;
}

export function EditableHeader({ displayName, column, setCustomHeader }: EditableHeaderProps) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(displayName);

    const handleDoubleClick = () => setEditing(true);

    const handleBlur = () => {
        setEditing(false);
        if (value !== displayName) {
            setCustomHeader(column.colId, value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            setEditing(false);
            setCustomHeader(column.colId, value);
        } else if (e.key === 'Escape') {
            setEditing(false);
            setValue(displayName);
        }
    };

    if (editing) {
        return (
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full px-1 py-0 text-xs border rounded bg-white"
                style={{ minWidth: '30px' }}
            />
        );
    }

    return (
        <div
            onDoubleClick={handleDoubleClick}
            className="cursor-pointer truncate"
            title={`${displayName} (double-click to edit)`}
        >
            {displayName}
        </div>
    );
}
