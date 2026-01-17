/**
 * ColourSelectCell - Colour dropdown selector
 *
 * Third level of cascading dropdown (Material → Fabric → Colour).
 * Filtered by selected fabric. Selecting a colour triggers a pending change.
 */

import { Plus } from 'lucide-react';
import type { ColourOption, CascadingSelection } from '../types';

interface ColourSelectCellProps {
    selection: CascadingSelection;
    colours: ColourOption[];
    currentColourId: string | null;
    currentColourName: string | null;
    currentColourHex: string | null;
    onChange: (colourId: string | null) => void;
    onAddNew?: () => void;
    disabled?: boolean;
}

export function ColourSelectCell({
    selection,
    colours,
    currentColourId,
    currentColourName,
    currentColourHex,
    onChange,
    onAddNew,
    disabled,
}: ColourSelectCellProps) {
    // Use selection state if set, otherwise use current value
    const selectedId = selection.colourId ?? currentColourId;
    const selectedFabricId = selection.fabricId;

    // Filter colours by selected fabric
    const filteredColours = selectedFabricId
        ? colours.filter((c) => c.fabricId === selectedFabricId)
        : colours;

    // Disabled if no fabric selected
    const isDisabled = disabled || !selectedFabricId;

    // Get the selected colour for displaying the swatch
    const selectedColour = filteredColours.find((c) => c.id === selectedId);
    const displayHex = selectedColour?.colourHex || currentColourHex;

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
                onChange={(e) => onChange(e.target.value || null)}
                disabled={isDisabled}
                className="flex-1 text-sm py-1 px-2 border border-gray-200 rounded
                           focus:outline-none focus:ring-1 focus:ring-blue-500
                           disabled:bg-gray-50 disabled:text-gray-400
                           min-w-0 truncate"
            >
                <option value="">
                    {isDisabled ? 'Select fabric first...' : 'Select colour...'}
                </option>
                {filteredColours.map((colour) => (
                    <option key={colour.id} value={colour.id}>
                        {colour.name}
                    </option>
                ))}
            </select>

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
}
