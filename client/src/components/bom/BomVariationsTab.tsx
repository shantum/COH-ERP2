/**
 * BOM Variations Tab
 *
 * Shows variation-level component assignments.
 * - Fabric colours are assigned here (color-specific)
 * - Override indicators show inherited vs custom values
 * - Quantity overrides available
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUp } from 'lucide-react';
import ComponentSelector from './ComponentSelector';

interface VariationData {
    id: string;
    colorName: string;
    colorHex?: string;
    bomLines: VariationBomLine[];
}

interface VariationBomLine {
    id?: string;
    roleId: string;
    roleName: string;
    roleCode: string;
    componentType: string;
    fabricColourId?: string;
    fabricColourName?: string;
    fabricColourHex?: string;
    trimItemId?: string;
    trimItemName?: string;
    serviceItemId?: string;
    serviceItemName?: string;
    quantity?: number;
    quantityUnit?: string;
    wastagePercent?: number;
    isInherited: boolean;
    resolvedCost?: number;
}

interface ComponentRole {
    id: string;
    code: string;
    name: string;
    typeCode: string;
    isRequired: boolean;
    allowMultiple: boolean;
    defaultQuantity?: number;
    defaultUnit?: string;
    sortOrder: number;
}

interface TemplateLineData {
    roleId: string;
    roleName: string;
    defaultQuantity: number;
    quantityUnit: string;
    trimItemId?: string;
    trimItemName?: string;
    serviceItemId?: string;
    serviceItemName?: string;
}

interface BomVariationsTabProps {
    variations: VariationData[];
    template: TemplateLineData[];
    componentRoles: ComponentRole[];
    availableComponents: {
        fabricColours: Array<{
            id: string;
            colourName: string;
            colourHex?: string;
            fabricName: string;
            costPerUnit?: number;
        }>;
        trims: Array<{ id: string; code: string; name: string; costPerUnit: number }>;
        services: Array<{ id: string; code: string; name: string; costPerJob: number }>;
    };
    onUpdate: (updates: any) => void;
}

export default function BomVariationsTab({
    variations,
    template,
    componentRoles,
    availableComponents,
    onUpdate,
}: BomVariationsTabProps) {
    const [selectedVariation, setSelectedVariation] = useState<string>('all');
    const [expandedVariations, setExpandedVariations] = useState<Set<string>>(
        new Set(variations.slice(0, 3).map(v => v.id))
    );

    // Get fabric roles only
    const fabricRoles = componentRoles.filter(r => r.typeCode === 'FABRIC');

    // Toggle variation expansion
    const toggleVariation = (id: string) => {
        const next = new Set(expandedVariations);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setExpandedVariations(next);
    };

    // Get template line for a role
    const getTemplateLine = (roleId: string) =>
        template.find(t => t.roleId === roleId);

    // Update a variation's BOM line
    const handleLineUpdate = (variationId: string, roleId: string, updates: Partial<VariationBomLine>) => {
        const updatedVariations = variations.map(v => {
            if (v.id !== variationId) return v;

            const lineIndex = v.bomLines.findIndex(l => l.roleId === roleId);
            if (lineIndex >= 0) {
                const updatedLines = [...v.bomLines];
                updatedLines[lineIndex] = { ...updatedLines[lineIndex], ...updates, isInherited: false };
                return { ...v, bomLines: updatedLines };
            } else {
                const role = componentRoles.find(r => r.id === roleId);
                return {
                    ...v,
                    bomLines: [
                        ...v.bomLines,
                        {
                            roleId,
                            roleName: role?.name || '',
                            roleCode: role?.code || '',
                            componentType: role?.typeCode || 'FABRIC',
                            isInherited: false,
                            ...updates,
                        },
                    ],
                };
            }
        });

        onUpdate({ variations: updatedVariations });
    };

    // Get the display variations
    const displayVariations = selectedVariation === 'all'
        ? variations
        : variations.filter(v => v.id === selectedVariation);

    return (
        <div className="space-y-4">
            {/* Variation Selector */}
            <div className="flex items-center gap-3">
                <label className="text-sm text-gray-500">Show:</label>
                <select
                    value={selectedVariation}
                    onChange={(e) => setSelectedVariation(e.target.value)}
                    className="text-sm border rounded-lg px-3 py-1.5"
                >
                    <option value="all">All Variations ({variations.length})</option>
                    {variations.map(v => (
                        <option key={v.id} value={v.id}>{v.colorName}</option>
                    ))}
                </select>
            </div>

            {/* Variations List */}
            <div className="space-y-3">
                {displayVariations.map(variation => {
                    const isExpanded = expandedVariations.has(variation.id);

                    return (
                        <div key={variation.id} className="border rounded-lg overflow-hidden">
                            {/* Variation Header */}
                            <button
                                onClick={() => toggleVariation(variation.id)}
                                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100"
                            >
                                <div className="flex items-center gap-3">
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    <div
                                        className="w-5 h-5 rounded-full border"
                                        style={{ backgroundColor: variation.colorHex || '#ccc' }}
                                    />
                                    <span className="font-medium text-sm">{variation.colorName}</span>
                                </div>
                                <span className="text-xs text-gray-500">
                                    {variation.bomLines.filter(l => !l.isInherited).length} overrides
                                </span>
                            </button>

                            {/* Variation Content */}
                            {isExpanded && (
                                <div className="p-3 space-y-3">
                                    {/* Fabric Roles */}
                                    <div className="space-y-2">
                                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Fabric Assignments
                                        </p>
                                        {fabricRoles.map(role => {
                                            const line = variation.bomLines.find(l => l.roleId === role.id);
                                            const templateLine = getTemplateLine(role.id);

                                            return (
                                                <div
                                                    key={role.id}
                                                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                                >
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium text-sm">{role.name}</p>
                                                            {role.isRequired && (
                                                                <span className="text-xs text-red-500">*</span>
                                                            )}
                                                        </div>

                                                        {/* Fabric Colour Selector */}
                                                        <div className="mt-2">
                                                            <ComponentSelector
                                                                type="fabric"
                                                                value={line?.fabricColourId || null}
                                                                items={availableComponents.fabricColours}
                                                                onChange={(id, item) => {
                                                                    handleLineUpdate(variation.id, role.id, {
                                                                        fabricColourId: id || undefined,
                                                                        fabricColourName: item?.colourName,
                                                                        fabricColourHex: item?.colourHex,
                                                                    });
                                                                }}
                                                                placeholder="Select fabric colour..."
                                                            />
                                                        </div>

                                                        {/* Quantity */}
                                                        {line?.fabricColourId && (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <label className="text-xs text-gray-500">Qty:</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.1"
                                                                    className="w-20 text-sm border rounded px-2 py-1"
                                                                    value={line.quantity ?? templateLine?.defaultQuantity ?? 1}
                                                                    onChange={(e) => {
                                                                        handleLineUpdate(variation.id, role.id, {
                                                                            quantity: parseFloat(e.target.value),
                                                                        });
                                                                    }}
                                                                />
                                                                <span className="text-xs text-gray-500">
                                                                    {line.quantityUnit || templateLine?.quantityUnit || 'meter'}
                                                                </span>
                                                                {line.isInherited && (
                                                                    <span className="text-xs text-gray-400 flex items-center gap-1">
                                                                        <ArrowUp size={10} /> Inherited
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Cost display */}
                                                    {line?.resolvedCost != null && (
                                                        <div className="text-right">
                                                            <p className="text-sm font-medium">
                                                                ₹{(line.resolvedCost * (line.quantity || 1)).toFixed(2)}
                                                            </p>
                                                            <p className="text-xs text-gray-500">
                                                                ₹{line.resolvedCost}/m
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Inherited Trims & Services (read-only) */}
                                    {template.filter(t => t.trimItemId || t.serviceItemId).length > 0 && (
                                        <div className="pt-3 border-t">
                                            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                                                <ArrowUp size={10} />
                                                Inherited from Template
                                            </p>
                                            <div className="space-y-1">
                                                {template.filter(t => t.trimItemId).map(t => (
                                                    <div key={t.roleId} className="flex items-center justify-between text-xs text-gray-600 p-2 bg-gray-50 rounded">
                                                        <span>{t.roleName}: {t.trimItemName}</span>
                                                        <span>×{t.defaultQuantity}</span>
                                                    </div>
                                                ))}
                                                {template.filter(t => t.serviceItemId).map(t => (
                                                    <div key={t.roleId} className="flex items-center justify-between text-xs text-gray-600 p-2 bg-gray-50 rounded">
                                                        <span>{t.roleName}: {t.serviceItemName}</span>
                                                        <span>×{t.defaultQuantity}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {variations.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                    <p>No variations found for this product</p>
                    <p className="text-sm mt-1">Add variations in the Catalog page first</p>
                </div>
            )}
        </div>
    );
}
