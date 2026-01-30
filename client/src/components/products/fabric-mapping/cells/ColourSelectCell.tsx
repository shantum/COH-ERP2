/**
 * ColourSelectCell - Colour dropdown selector
 *
 * Third level of cascading dropdown (Material → Fabric → Colour).
 * Filtered by selected fabric. Selecting a colour triggers a pending change.
 * Includes "+ Add new colour" option in dropdown for better UX.
 * Includes "Clear" option to reset fabric assignment.
 */

import { memo, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { ColourOption, CascadingSelection } from '../types';
import { CLEAR_FABRIC_VALUE } from '../types';

const ADD_NEW_VALUE = '__add_new__';

interface ColourSelectCellProps {
    selection: CascadingSelection;
    colours: ColourOption[];
    currentColourId: string | null;
    currentColourName: string | null;
    currentColourHex: string | null;
    onChange: (colourId: string | null) => void;
    onAddNew?: () => void;
    onClear?: () => void;
    disabled?: boolean;
}

export const ColourSelectCell = memo(function ColourSelectCell({
    selection,
    colours,
    currentColourId,
    currentColourName: _currentColourName,
    currentColourHex,
    onChange,
    onAddNew,
    onClear,
    disabled,
}: ColourSelectCellProps) {
    // Use selection state if set, otherwise use current value
    const selectedId = selection.colourId ?? currentColourId;
    const selectedFabricId = selection.fabricId;

    // Filter colours by selected fabric (memoized for performance)
    const filteredColours = useMemo(
        () => selectedFabricId
            ? colours.filter((c) => c.fabricId === selectedFabricId)
            : colours,
        [colours, selectedFabricId]
    );

    // Disabled if no fabric selected
    const isDisabled = disabled || !selectedFabricId;

    // Check if there's a current assignment that can be cleared
    const hasClearableAssignment = currentColourId !== null;

    // Get the selected colour for displaying the swatch (memoized)
    const displayHex = useMemo(() => {
        const selectedColour = filteredColours.find((c) => c.id === selectedId);
        return selectedColour?.colourHex || currentColourHex;
    }, [filteredColours, selectedId, currentColourHex]);

    const handleChange = (value: string) => {
        if (value === ADD_NEW_VALUE) {
            onAddNew?.();
            return;
        }
        if (value === CLEAR_FABRIC_VALUE) {
            onClear?.();
            return;
        }
        onChange(value || null);
    };

    return (
        <div className="flex items-center gap-1">
            {displayHex && (
                <div
                    className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: displayHex }}
                />
            )}

            <select
                value={selectedId || ''}
                onChange={(e) => handleChange(e.target.value)}
                disabled={isDisabled}
                className="flex-1 text-sm py-1 px-2 border border-gray-200 rounded
                           focus:outline-none focus:ring-1 focus:ring-blue-500
                           disabled:bg-gray-50 disabled:text-gray-400
                           min-w-0 truncate"
            >
                <option value="">
                    {isDisabled ? 'Select fabric first...' : 'Select colour...'}
                </option>
                {onClear && hasClearableAssignment && (
                    <option value={CLEAR_FABRIC_VALUE} className="text-red-600 font-medium">
                        ✕ Clear assignment
                    </option>
                )}
                {onAddNew && (
                    <option value={ADD_NEW_VALUE} className="text-blue-600 font-medium">
                        + Add new colour...
                    </option>
                )}
                {filteredColours.map((colour) => (
                    <option key={colour.id} value={colour.id}>
                        {colour.name}
                    </option>
                ))}
            </select>

            {onClear && hasClearableAssignment && !isDisabled && (
                <button
                    onClick={onClear}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Clear fabric assignment"
                >
                    <X size={14} />
                </button>
            )}

            {onAddNew && !isDisabled && (
                <button
                    onClick={onAddNew}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Add new colour"
                >
                    <Plus size={14} />
                </button>
            )}
        </div>
    );
});
