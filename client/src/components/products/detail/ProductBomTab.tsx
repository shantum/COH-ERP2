/**
 * ProductBomTab - Inline BOM display and editing for Product detail panel
 *
 * Shows the product's bill of materials:
 * - Template lines (trims, services)
 * - Cost summary
 * - Option to open full BOM editor
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Trash2, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { bomApi } from '../../../services/api';
import type { ProductTreeNode } from '../types';

interface ProductBomTabProps {
    product: ProductTreeNode;
    onOpenFullEditor?: () => void;
}

interface BomLine {
    id?: string;
    componentType: 'FABRIC' | 'TRIM' | 'SERVICE';
    componentRole: string;
    componentId?: string | null;
    componentName?: string;
    quantity: number;
    resolvedQuantity?: number;
    cost?: number;
    resolvedCost?: number;
    unit?: string;
}

export function ProductBomTab({ product, onOpenFullEditor }: ProductBomTabProps) {
    const queryClient = useQueryClient();

    // Fetch BOM data
    const { data: bomData, isLoading, error } = useQuery({
        queryKey: ['productBom', product.id],
        queryFn: () => bomApi.getProductBom(product.id).then(r => r.data),
        enabled: !!product.id,
    });

    // Fetch component roles
    const { data: componentRoles } = useQuery({
        queryKey: ['componentRoles'],
        queryFn: () => bomApi.getComponentRoles().then(r => r.data),
        staleTime: 60 * 60 * 1000,
    });

    // Calculate cost summary
    const costSummary = useMemo(() => {
        if (!bomData?.template) return { fabricCost: 0, trimCost: 0, serviceCost: 0, total: 0 };

        let fabricCost = 0;
        let trimCost = 0;
        let serviceCost = 0;

        bomData.template.forEach((line: BomLine) => {
            const cost = line.resolvedCost || line.cost || 0;
            const qty = line.resolvedQuantity || line.quantity || 0;
            const lineTotal = cost * qty;

            if (line.componentType === 'FABRIC') fabricCost += lineTotal;
            else if (line.componentType === 'TRIM') trimCost += lineTotal;
            else if (line.componentType === 'SERVICE') serviceCost += lineTotal;
        });

        return {
            fabricCost,
            trimCost,
            serviceCost,
            total: fabricCost + trimCost + serviceCost,
        };
    }, [bomData]);

    // Group template lines by type
    const templateByType = useMemo(() => {
        if (!bomData?.template) return { trims: [], services: [] };

        return {
            trims: bomData.template.filter((l: BomLine) => l.componentType === 'TRIM'),
            services: bomData.template.filter((l: BomLine) => l.componentType === 'SERVICE'),
        };
    }, [bomData]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-48">
                <Loader2 size={24} className="animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading BOM...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg">
                <AlertCircle size={20} />
                <span>Failed to load BOM data</span>
            </div>
        );
    }

    const hasNoBom = !bomData?.template || bomData.template.length === 0;

    return (
        <div className="space-y-6">
            {/* Cost Summary Card */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-100">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700">Cost Summary</h4>
                    <span className="text-lg font-bold text-gray-900">
                        ₹{costSummary.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                        <span className="text-gray-500">Fabric</span>
                        <p className="font-medium">₹{costSummary.fabricCost.toFixed(2)}</p>
                    </div>
                    <div>
                        <span className="text-gray-500">Trims</span>
                        <p className="font-medium">₹{costSummary.trimCost.toFixed(2)}</p>
                    </div>
                    <div>
                        <span className="text-gray-500">Services</span>
                        <p className="font-medium">₹{costSummary.serviceCost.toFixed(2)}</p>
                    </div>
                </div>
            </div>

            {/* Empty State */}
            {hasNoBom && (
                <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
                    <Package size={40} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-sm text-gray-500">No BOM configured for this product</p>
                    <p className="text-xs text-gray-400 mt-1">
                        Add trims and services to calculate COGS
                    </p>
                    {onOpenFullEditor && (
                        <button
                            onClick={onOpenFullEditor}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100"
                        >
                            <Plus size={16} />
                            Configure BOM
                        </button>
                    )}
                </div>
            )}

            {/* Trims Section */}
            {templateByType.trims.length > 0 && (
                <BomSection
                    title="Trims"
                    lines={templateByType.trims}
                    componentRoles={componentRoles}
                />
            )}

            {/* Services Section */}
            {templateByType.services.length > 0 && (
                <BomSection
                    title="Services"
                    lines={templateByType.services}
                    componentRoles={componentRoles}
                />
            )}

            {/* Variations Overview */}
            {bomData?.variations && bomData.variations.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        Variation Assignments
                    </h4>
                    <div className="space-y-2">
                        {bomData.variations.slice(0, 5).map((v: any) => (
                            <div key={v.variationId} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    {v.colorHex && (
                                        <span
                                            className="w-3 h-3 rounded-full border border-gray-300"
                                            style={{ backgroundColor: v.colorHex }}
                                        />
                                    )}
                                    <span className="text-gray-700">{v.colorName}</span>
                                </div>
                                <span className="text-gray-500 text-xs">
                                    {v.fabricColourName || 'No fabric assigned'}
                                </span>
                            </div>
                        ))}
                        {bomData.variations.length > 5 && (
                            <p className="text-xs text-gray-400 mt-2">
                                + {bomData.variations.length - 5} more variations
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Open Full Editor Button */}
            {onOpenFullEditor && !hasNoBom && (
                <div className="pt-4 border-t">
                    <button
                        onClick={onOpenFullEditor}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                        <ExternalLink size={16} />
                        Open Full BOM Editor
                    </button>
                </div>
            )}
        </div>
    );
}

interface BomSectionProps {
    title: string;
    lines: BomLine[];
    componentRoles?: any[];
}

function BomSection({ title, lines, componentRoles }: BomSectionProps) {
    // Get role label from componentRoles
    const getRoleLabel = (roleCode: string) => {
        if (!componentRoles) return roleCode;
        const role = componentRoles.find((r: any) => r.code === roleCode);
        return role?.name || roleCode;
    };

    return (
        <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                {title} ({lines.length})
            </h4>
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Role</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Component</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Cost</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {lines.map((line, idx) => {
                            const qty = line.resolvedQuantity || line.quantity || 0;
                            const cost = line.resolvedCost || line.cost || 0;
                            const total = qty * cost;

                            return (
                                <tr key={line.id || idx} className="hover:bg-gray-50">
                                    <td className="px-3 py-2">
                                        <span className="text-gray-700">
                                            {getRoleLabel(line.componentRole)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className="text-gray-900">
                                            {line.componentName || 'Not assigned'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                        {qty} {line.unit || ''}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                        ₹{cost.toFixed(2)}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                                        ₹{total.toFixed(2)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
