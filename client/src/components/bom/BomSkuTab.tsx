/**
 * BOM SKU Tab
 *
 * Shows SKU-level (size-specific) overrides.
 * This is the least commonly used tab - most products don't need SKU-level overrides.
 * Common use case: XL size uses 2.6m instead of 2.2m fabric.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, Info } from 'lucide-react';

interface SkuData {
    id: string;
    skuCode: string;
    size: string;
    variationId: string;
    colorName: string;
    colorHex?: string;
    bomLines: SkuBomLine[];
}

interface SkuBomLine {
    id?: string;
    roleId: string;
    roleName: string;
    roleCode: string;
    componentType: string;
    quantity?: number;
    quantityUnit?: string;
    overrideCost?: number;
    notes?: string;
    isInherited: boolean;
    resolvedQuantity: number;
    resolvedCost: number;
}

interface VariationData {
    id: string;
    colorName: string;
    colorHex?: string;
    bomLines: Array<{
        roleId: string;
        quantity?: number;
    }>;
}

interface TemplateLineData {
    roleId: string;
    roleName: string;
    defaultQuantity: number;
}

interface ComponentRole {
    id: string;
    code: string;
    name: string;
    typeCode: string;
}

interface BomSkuTabProps {
    skus: SkuData[];
    variations: VariationData[];
    template: TemplateLineData[];
    componentRoles: ComponentRole[];
    onUpdate: (updates: { skus: SkuData[] }) => void;
}

export default function BomSkuTab({
    skus,
    variations,
    template,
    componentRoles,
    onUpdate,
}: BomSkuTabProps) {
    const [selectedVariation, setSelectedVariation] = useState<string>('all');
    const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());

    // Group SKUs by variation
    const skusByVariation = skus.reduce((acc, sku) => {
        if (!acc[sku.variationId]) acc[sku.variationId] = [];
        acc[sku.variationId].push(sku);
        return acc;
    }, {} as Record<string, SkuData[]>);

    // Toggle SKU expansion
    const toggleSku = (id: string) => {
        const next = new Set(expandedSkus);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setExpandedSkus(next);
    };

    // Update a SKU's BOM line
    const handleLineUpdate = (skuId: string, roleId: string, updates: Partial<SkuBomLine>) => {
        const updatedSkus = skus.map(sku => {
            if (sku.id !== skuId) return sku;

            const lineIndex = sku.bomLines.findIndex(l => l.roleId === roleId);
            if (lineIndex >= 0) {
                const updatedLines = [...sku.bomLines];
                updatedLines[lineIndex] = { ...updatedLines[lineIndex], ...updates, isInherited: false };
                return { ...sku, bomLines: updatedLines };
            } else {
                const role = componentRoles.find(r => r.id === roleId);
                return {
                    ...sku,
                    bomLines: [
                        ...sku.bomLines,
                        {
                            roleId,
                            roleName: role?.name || '',
                            roleCode: role?.code || '',
                            componentType: role?.typeCode || 'FABRIC',
                            isInherited: false,
                            resolvedQuantity: 0,
                            resolvedCost: 0,
                            ...updates,
                        },
                    ],
                };
            }
        });

        onUpdate({ skus: updatedSkus });
    };

    // Clear override
    const handleClearOverride = (skuId: string, roleId: string) => {
        const updatedSkus = skus.map(sku => {
            if (sku.id !== skuId) return sku;
            return {
                ...sku,
                bomLines: sku.bomLines.filter(l => l.roleId !== roleId),
            };
        });

        onUpdate({ skus: updatedSkus });
    };

    // Get fabric roles for display
    const fabricRoles = componentRoles.filter(r => r.typeCode === 'FABRIC');

    // Filter variations if selected
    const displayVariations = selectedVariation === 'all'
        ? variations
        : variations.filter(v => v.id === selectedVariation);

    // Count total overrides
    const totalOverrides = skus.reduce((sum, sku) =>
        sum + sku.bomLines.filter(l => !l.isInherited).length, 0);

    return (
        <div className="space-y-4">
            {/* Info Banner */}
            <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg text-sm">
                <Info size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium">Size-specific overrides</p>
                    <p className="text-xs mt-1">
                        Use this tab only when a specific size needs different quantities.
                        For example, XL garments may require more fabric than S sizes.
                    </p>
                </div>
            </div>

            {/* Variation Selector */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-500">Show:</label>
                    <select
                        value={selectedVariation}
                        onChange={(e) => setSelectedVariation(e.target.value)}
                        className="text-sm border rounded-lg px-3 py-1.5"
                    >
                        <option value="all">All Colors ({variations.length})</option>
                        {variations.map(v => (
                            <option key={v.id} value={v.id}>{v.colorName}</option>
                        ))}
                    </select>
                </div>
                <span className="text-xs text-gray-500">
                    {totalOverrides} override{totalOverrides !== 1 ? 's' : ''} total
                </span>
            </div>

            {/* Grouped by Variation */}
            {displayVariations.map(variation => {
                const variationSkus = skusByVariation[variation.id] || [];
                if (variationSkus.length === 0) return null;

                return (
                    <div key={variation.id} className="border rounded-lg overflow-hidden">
                        {/* Variation Header */}
                        <div className="flex items-center gap-2 p-3 bg-gray-100">
                            <div
                                className="w-4 h-4 rounded-full border"
                                style={{ backgroundColor: variation.colorHex || '#ccc' }}
                            />
                            <span className="font-medium text-sm">{variation.colorName}</span>
                            <span className="text-xs text-gray-500">
                                ({variationSkus.length} sizes)
                            </span>
                        </div>

                        {/* SKUs */}
                        <div className="divide-y">
                            {variationSkus.map(sku => {
                                const isExpanded = expandedSkus.has(sku.id);
                                const hasOverrides = sku.bomLines.some(l => !l.isInherited);

                                return (
                                    <div key={sku.id}>
                                        {/* SKU Header */}
                                        <button
                                            onClick={() => toggleSku(sku.id)}
                                            className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
                                        >
                                            <div className="flex items-center gap-2">
                                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <span className="font-mono text-sm">{sku.size}</span>
                                                <span className="text-xs text-gray-400">{sku.skuCode}</span>
                                            </div>
                                            {hasOverrides ? (
                                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                                                    Has overrides
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                                    <ArrowUp size={10} /> Inherits all
                                                </span>
                                            )}
                                        </button>

                                        {/* SKU Content */}
                                        {isExpanded && (
                                            <div className="p-3 bg-gray-50 space-y-2">
                                                {fabricRoles.map(role => {
                                                    const line = sku.bomLines.find(l => l.roleId === role.id);
                                                    const variationLine = variation.bomLines.find(l => l.roleId === role.id);
                                                    const templateLine = template.find(t => t.roleId === role.id);
                                                    const inheritedQty = variationLine?.quantity ?? templateLine?.defaultQuantity ?? 1;

                                                    return (
                                                        <div
                                                            key={role.id}
                                                            className="flex items-center justify-between p-2 bg-white rounded border"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-sm text-gray-600">{role.name}:</span>
                                                                <input
                                                                    type="number"
                                                                    step="0.1"
                                                                    className={`w-20 text-sm border rounded px-2 py-1 ${line?.quantity != null ? 'border-amber-300 bg-amber-50' : ''}`}
                                                                    value={line?.quantity ?? inheritedQty}
                                                                    onChange={(e) => {
                                                                        handleLineUpdate(sku.id, role.id, {
                                                                            quantity: parseFloat(e.target.value),
                                                                        });
                                                                    }}
                                                                />
                                                                <span className="text-xs text-gray-500">meters</span>
                                                            </div>
                                                            {line?.quantity != null ? (
                                                                <button
                                                                    onClick={() => handleClearOverride(sku.id, role.id)}
                                                                    className="text-xs text-gray-400 hover:text-red-500"
                                                                >
                                                                    Clear
                                                                </button>
                                                            ) : (
                                                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                                                    <ArrowUp size={10} /> {inheritedQty}m inherited
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {skus.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                    <p>No SKUs found for this product</p>
                    <p className="text-sm mt-1">Add variations and sizes in the Catalog page first</p>
                </div>
            )}
        </div>
    );
}
