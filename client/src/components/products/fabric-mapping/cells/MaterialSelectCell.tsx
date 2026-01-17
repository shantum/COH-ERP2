/**
 * MaterialSelectCell - Material dropdown selector
 *
 * First level of cascading dropdown (Material → Fabric → Colour).
 * Changes here reset Fabric and Colour selections.
 */

import { Plus } from 'lucide-react';
import type { MaterialOption, CascadingSelection } from '../types';

interface MaterialSelectCellProps {
    selection: CascadingSelection;
    materials: MaterialOption[];
    currentMaterialId: string | null;
    currentMaterialName: string | null;
    onChange: (materialId: string | null) => void;
    onAddNew?: () => void;
    disabled?: boolean;
}

export function MaterialSelectCell({
    selection,
    materials,
    currentMaterialId,
    currentMaterialName: _currentMaterialName,
    onChange,
    onAddNew,
    disabled,
}: MaterialSelectCellProps) {
    // Use selection state if set, otherwise use current value
    const selectedId = selection.materialId ?? currentMaterialId;

    return (
        <div className="flex items-center gap-1">
            <select
                value={selectedId || ''}
                onChange={(e) => onChange(e.target.value || null)}
                disabled={disabled}
                className="flex-1 text-sm py-1 px-2 border border-gray-200 rounded
                           focus:outline-none focus:ring-1 focus:ring-blue-500
                           disabled:bg-gray-50 disabled:text-gray-400
                           min-w-0 truncate"
            >
                <option value="">Select material...</option>
                {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                        {material.name} ({material.fabricCount})
                    </option>
                ))}
            </select>

            {onAddNew && !disabled && (
                <button
                    onClick={onAddNew}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Add new material"
                >
                    <Plus size={14} />
                </button>
            )}
        </div>
    );
}
