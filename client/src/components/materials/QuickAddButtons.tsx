/**
 * QuickAddButtons - Toolbar buttons for quick creation
 *
 * Provides floating action buttons:
 * - + Material: Opens modal with type='material', mode='add'
 * - + Fabric: Opens modal with material selector, then fabric form
 * - + Colour: Opens modal with fabric selector, then colour form
 */

import { useState } from 'react';
import { Plus, Box, Layers, Palette, ChevronDown } from 'lucide-react';

interface QuickAddButtonsProps {
    onAddMaterial: () => void;
    onAddFabric: (materialId: string) => void;
    onAddColour: (fabricId: string) => void;
    materials?: Array<{ id: string; name: string }>;
    fabrics?: Array<{ id: string; name: string; materialName?: string }>;
}

export function QuickAddButtons({
    onAddMaterial,
    onAddFabric,
    onAddColour,
    materials = [],
    fabrics = [],
}: QuickAddButtonsProps) {
    const [showFabricPicker, setShowFabricPicker] = useState(false);
    const [showColourPicker, setShowColourPicker] = useState(false);

    return (
        <div className="flex items-center gap-2">
            {/* Add Material - Direct action */}
            <button
                type="button"
                onClick={onAddMaterial}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
            >
                <Box size={14} />
                <Plus size={12} />
                Material
            </button>

            {/* Add Fabric - With material selector */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => {
                        if (materials.length === 0) {
                            alert('No materials found. Please add a material first.');
                            return;
                        }
                        setShowFabricPicker(!showFabricPicker);
                        setShowColourPicker(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors"
                >
                    <Layers size={14} />
                    <Plus size={12} />
                    Fabric
                    <ChevronDown size={12} className={`transition-transform ${showFabricPicker ? 'rotate-180' : ''}`} />
                </button>

                {showFabricPicker && (
                    <MaterialPickerDropdown
                        materials={materials}
                        onSelect={(materialId) => {
                            onAddFabric(materialId);
                            setShowFabricPicker(false);
                        }}
                        onClose={() => setShowFabricPicker(false)}
                    />
                )}
            </div>

            {/* Add Colour - With fabric selector */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => {
                        if (fabrics.length === 0) {
                            alert('No fabrics found. Please add a fabric first.');
                            return;
                        }
                        setShowColourPicker(!showColourPicker);
                        setShowFabricPicker(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200 transition-colors"
                >
                    <Palette size={14} />
                    <Plus size={12} />
                    Colour
                    <ChevronDown size={12} className={`transition-transform ${showColourPicker ? 'rotate-180' : ''}`} />
                </button>

                {showColourPicker && (
                    <FabricPickerDropdown
                        fabrics={fabrics}
                        onSelect={(fabricId) => {
                            onAddColour(fabricId);
                            setShowColourPicker(false);
                        }}
                        onClose={() => setShowColourPicker(false)}
                    />
                )}
            </div>
        </div>
    );
}

// Material picker dropdown for fabric creation
function MaterialPickerDropdown({
    materials,
    onSelect,
    onClose,
}: {
    materials: Array<{ id: string; name: string }>;
    onSelect: (id: string) => void;
    onClose: () => void;
}) {
    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40"
                onClick={onClose}
            />

            {/* Dropdown */}
            <div className="absolute left-0 z-50 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 max-h-64 overflow-y-auto">
                <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                    Select Material
                </div>
                {materials.map((material) => (
                    <button
                        key={material.id}
                        type="button"
                        onClick={() => onSelect(material.id)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700"
                    >
                        {material.name}
                    </button>
                ))}
            </div>
        </>
    );
}

// Fabric picker dropdown for colour creation
function FabricPickerDropdown({
    fabrics,
    onSelect,
    onClose,
}: {
    fabrics: Array<{ id: string; name: string; materialName?: string }>;
    onSelect: (id: string) => void;
    onClose: () => void;
}) {
    // Group fabrics by material for better organization
    const groupedFabrics = fabrics.reduce((acc, fabric) => {
        const materialName = fabric.materialName || 'Other';
        if (!acc[materialName]) {
            acc[materialName] = [];
        }
        acc[materialName].push(fabric);
        return acc;
    }, {} as Record<string, typeof fabrics>);

    const materialNames = Object.keys(groupedFabrics).sort();

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40"
                onClick={onClose}
            />

            {/* Dropdown */}
            <div className="absolute left-0 z-50 mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-1 max-h-80 overflow-y-auto">
                <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                    Select Fabric
                </div>
                {materialNames.map((materialName) => (
                    <div key={materialName}>
                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 bg-gray-50">
                            {materialName}
                        </div>
                        {groupedFabrics[materialName].map((fabric) => (
                            <button
                                key={fabric.id}
                                type="button"
                                onClick={() => onSelect(fabric.id)}
                                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-teal-700 pl-6"
                            >
                                {fabric.name}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </>
    );
}
