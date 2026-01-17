/**
 * FabricSelectCell - Fabric dropdown selector
 *
 * Second level of cascading dropdown (Material → Fabric → Colour).
 * Filtered by selected material. Changes reset Colour selection.
 */

import { Plus } from 'lucide-react';
import type { FabricOption, CascadingSelection } from '../types';

interface FabricSelectCellProps {
    selection: CascadingSelection;
    fabrics: FabricOption[];
    currentFabricId: string | null;
    currentFabricName: string | null;
    onChange: (fabricId: string | null) => void;
    onAddNew?: () => void;
    disabled?: boolean;
}

export function FabricSelectCell({
    selection,
    fabrics,
    currentFabricId,
    currentFabricName,
    onChange,
    onAddNew,
    disabled,
}: FabricSelectCellProps) {
    // Use selection state if set, otherwise use current value
    const selectedId = selection.fabricId ?? currentFabricId;
    const selectedMaterialId = selection.materialId;

    // Filter fabrics by selected material
    const filteredFabrics = selectedMaterialId
        ? fabrics.filter((f) => f.materialId === selectedMaterialId)
        : fabrics;

    // Disabled if no material selected
    const isDisabled = disabled || !selectedMaterialId;

    return (
        <div className="flex items-center gap-1">
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
                    {isDisabled ? 'Select material first...' : 'Select fabric...'}
                </option>
                {filteredFabrics.map((fabric) => (
                    <option key={fabric.id} value={fabric.id}>
                        {fabric.name} ({fabric.colourCount})
                    </option>
                ))}
            </select>

            {onAddNew && !isDisabled && (
                <button
                    onClick={onAddNew}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Add new fabric"
                >
                    <Plus size={14} />
                </button>
            )}
        </div>
    );
}
