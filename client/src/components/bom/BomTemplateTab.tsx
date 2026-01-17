/**
 * BOM Template Tab
 *
 * Shows product-level component defaults.
 * - Fabric roles show "Set at variation level" placeholder
 * - Trims and Services can be assigned here (same across all colors)
 * - Default quantities are editable
 * - "Apply to All Variations" button for bulk updates
 */

import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import ComponentRow from './ComponentRow';
import ComponentSelector from './ComponentSelector';

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
    id?: string;
    roleId: string;
    roleName: string;
    roleCode: string;
    componentType: string;
    trimItemId?: string;
    trimItemName?: string;
    serviceItemId?: string;
    serviceItemName?: string;
    defaultQuantity: number;
    quantityUnit: string;
    wastagePercent: number;
    notes?: string;
    resolvedCost?: number;
    resolvedQuantity?: number;
}

interface BomTemplateTabProps {
    template: TemplateLineData[];
    componentRoles: ComponentRole[];
    availableComponents: {
        trims: Array<{ id: string; code: string; name: string; category: string; costPerUnit: number; unit: string }>;
        services: Array<{ id: string; code: string; name: string; category: string; costPerJob: number }>;
    };
    onUpdate: (updates: any) => void;
}

export default function BomTemplateTab({
    template,
    componentRoles,
    availableComponents,
    onUpdate,
}: BomTemplateTabProps) {
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        FABRIC: true,
        TRIM: true,
        SERVICE: true,
    });

    // Group roles by type
    const rolesByType: Record<string, ComponentRole[]> = {};
    componentRoles.forEach(role => {
        if (!rolesByType[role.typeCode]) rolesByType[role.typeCode] = [];
        rolesByType[role.typeCode].push(role);
    });

    // Find template line for a role
    const getTemplateLine = (roleId: string) =>
        template.find(t => t.roleId === roleId);

    // Toggle section
    const toggleSection = (typeCode: string) => {
        setExpandedSections(prev => ({
            ...prev,
            [typeCode]: !prev[typeCode],
        }));
    };

    // Update a template line
    const handleLineUpdate = (roleId: string, updates: Partial<TemplateLineData>) => {
        const updatedTemplate = template.map(line =>
            line.roleId === roleId ? { ...line, ...updates } : line
        );
        onUpdate({ template: updatedTemplate });
    };

    // Add a new line for a role
    const handleAddLine = (role: ComponentRole) => {
        const newLine: TemplateLineData = {
            roleId: role.id,
            roleName: role.name,
            roleCode: role.code,
            componentType: role.typeCode,
            defaultQuantity: role.defaultQuantity || 1,
            quantityUnit: role.defaultUnit || 'unit',
            wastagePercent: 0,
        };
        onUpdate({ template: [...template, newLine] });
    };

    // Remove a line
    const handleRemoveLine = (roleId: string) => {
        onUpdate({ template: template.filter(t => t.roleId !== roleId) });
    };

    // Render section
    const renderSection = (typeCode: string, label: string) => {
        const roles = rolesByType[typeCode] || [];
        const isExpanded = expandedSections[typeCode];

        return (
            <div key={typeCode} className="border rounded-lg overflow-hidden">
                {/* Section Header */}
                <button
                    onClick={() => toggleSection(typeCode)}
                    className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100"
                >
                    <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className="font-medium text-sm">{label}</span>
                        <span className="text-xs text-gray-500">
                            ({roles.filter(r => getTemplateLine(r.id)).length}/{roles.length} configured)
                        </span>
                    </div>
                </button>

                {/* Section Content */}
                {isExpanded && (
                    <div className="p-3 space-y-3">
                        {typeCode === 'FABRIC' && (
                            <div className="flex items-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg text-sm">
                                <Info size={16} />
                                <span>Fabric colours are assigned at variation level (color-specific)</span>
                            </div>
                        )}

                        {roles.map(role => {
                            const line = getTemplateLine(role.id);

                            if (typeCode === 'FABRIC') {
                                // Fabric roles - show read-only with link to variations tab
                                return (
                                    <div
                                        key={role.id}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                    >
                                        <div>
                                            <p className="font-medium text-sm">{role.name}</p>
                                            <p className="text-xs text-gray-500">
                                                {role.isRequired ? 'Required' : 'Optional'}
                                            </p>
                                        </div>
                                        <span className="text-xs text-gray-400">
                                            Set in Variations tab
                                        </span>
                                    </div>
                                );
                            }

                            // Trims and Services - editable
                            return (
                                <ComponentRow
                                    key={role.id}
                                    role={role}
                                    line={line || null}
                                    availableItems={
                                        typeCode === 'TRIM'
                                            ? availableComponents.trims
                                            : availableComponents.services
                                    }
                                    onUpdate={(updates) => handleLineUpdate(role.id, updates)}
                                    onAdd={() => handleAddLine(role)}
                                    onRemove={() => handleRemoveLine(role.id)}
                                />
                            );
                        })}

                        {/* Add custom role (for multi-allowed roles) */}
                        {roles.some(r => r.allowMultiple) && (
                            <button className="w-full flex items-center justify-center gap-2 p-2 text-sm text-gray-500 border border-dashed rounded-lg hover:bg-gray-50">
                                <Plus size={14} />
                                <span>Add another {label.slice(0, -1).toLowerCase()}</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-medium">Product Template</h3>
                    <p className="text-xs text-gray-500">
                        Default components inherited by all variations and SKUs
                    </p>
                </div>
                <button className="text-xs text-primary-600 hover:text-primary-700">
                    Apply to All Variations
                </button>
            </div>

            {renderSection('FABRIC', 'Fabrics')}
            {renderSection('TRIM', 'Trims')}
            {renderSection('SERVICE', 'Services')}
        </div>
    );
}
