/**
 * ProductBomTab - Unified BOM display for Product detail panel
 *
 * Shows all BOM components (fabrics, trims, services) in a single table
 * with type-specific badges and visual differentiation.
 *
 * At product level, fabrics show "Per variation" since specific colours
 * are assigned at the variation level.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle } from 'lucide-react';
import { bomApi } from '../../../services/api';
import {
    BomLinesTable,
    BomCostSummary,
    AddBomLineModal,
    SizeConsumptionModal,
    type UnifiedBomLine,
    type BomCostBreakdown,
    type BomComponentType,
} from '../bom';
import type { ProductTreeNode } from '../types';

interface ProductBomTabProps {
    product: ProductTreeNode;
    onOpenFullEditor?: () => void;
}

export function ProductBomTab({ product }: ProductBomTabProps) {
    const queryClient = useQueryClient();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [consumptionModalLine, setConsumptionModalLine] = useState<UnifiedBomLine | null>(null);

    // Fetch BOM data
    const {
        data: bomData,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['productBom', product.id],
        queryFn: () => bomApi.getProductBom(product.id).then((r) => r.data),
        enabled: !!product.id,
    });

    // Transform API data to unified lines
    const { lines, costs, existingRoleIds } = useMemo(() => {
        if (!bomData?.templates) {
            return {
                lines: [] as UnifiedBomLine[],
                costs: { fabricCost: 0, trimCost: 0, serviceCost: 0, total: 0 },
                existingRoleIds: [] as string[],
            };
        }

        const unifiedLines: UnifiedBomLine[] = [];
        let fabricCost = 0;
        let trimCost = 0;
        let serviceCost = 0;
        const roleIds: string[] = [];

        // Transform templates into unified lines
        for (const template of bomData.templates) {
            const typeCode = template.typeCode as BomComponentType;
            roleIds.push(template.roleId);

            // Determine component name and cost based on type
            let componentName: string | null = null;
            let componentId: string | null = null;
            let costPerUnit: number | null = null;
            let colourHex: string | null = null;

            if (typeCode === 'FABRIC') {
                // At product level, fabric is "Per variation"
                componentName = 'Per variation';
                costPerUnit = null; // Cost determined at variation level
            } else if (typeCode === 'TRIM' && template.trimItem) {
                componentName = template.trimItem.name;
                componentId = template.trimItemId;
                costPerUnit = template.trimItem.costPerUnit;
            } else if (typeCode === 'SERVICE' && template.serviceItem) {
                componentName = template.serviceItem.name;
                componentId = template.serviceItemId;
                costPerUnit = template.serviceItem.costPerJob;
            }

            const qty = template.defaultQuantity ?? 0;
            const total = (costPerUnit ?? 0) * qty;

            // Accumulate costs
            if (typeCode === 'FABRIC') fabricCost += total;
            else if (typeCode === 'TRIM') trimCost += total;
            else if (typeCode === 'SERVICE') serviceCost += total;

            unifiedLines.push({
                id: template.id,
                type: typeCode,
                roleCode: template.roleCode,
                roleName: template.roleName,
                roleId: template.roleId,
                componentName,
                componentId,
                colourHex,
                quantity: template.defaultQuantity,
                quantityUnit: template.quantityUnit || 'unit',
                costPerUnit,
                totalCost: total,
                source: 'template',
                _raw: {
                    templateId: template.id,
                    trimItem: template.trimItem,
                    serviceItem: template.serviceItem,
                },
            });
        }

        // Sort: FABRIC first, then TRIM, then SERVICE
        const typeOrder: Record<BomComponentType, number> = { FABRIC: 0, TRIM: 1, SERVICE: 2 };
        unifiedLines.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

        return {
            lines: unifiedLines,
            costs: {
                fabricCost,
                trimCost,
                serviceCost,
                total: fabricCost + trimCost + serviceCost,
            } as BomCostBreakdown,
            existingRoleIds: roleIds,
        };
    }, [bomData]);

    // Add BOM line mutation
    const addLineMutation = useMutation({
        mutationFn: async (data: {
            roleId: string;
            componentType: BomComponentType;
            componentId?: string;
            quantity?: number;
        }) => {
            // Build the template line data
            const lineData: any = {
                roleId: data.roleId,
                defaultQuantity: data.quantity ?? null,
                quantityUnit: data.componentType === 'FABRIC' ? 'meter' : 'unit',
            };

            // Set component ID based on type
            if (data.componentType === 'TRIM' && data.componentId) {
                lineData.trimItemId = data.componentId;
            } else if (data.componentType === 'SERVICE' && data.componentId) {
                lineData.serviceItemId = data.componentId;
            }
            // For FABRIC, componentId is not set at product level

            return bomApi.updateTemplate(product.id, {
                lines: [...(bomData?.templates || []), lineData],
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productBom', product.id] });
        },
    });

    // Delete BOM line mutation
    const deleteLineMutation = useMutation({
        mutationFn: async (line: UnifiedBomLine) => {
            // Filter out the line to delete and update
            const remainingLines = (bomData?.templates || [])
                .filter((t: any) => t.id !== line.id)
                .map((t: any) => ({
                    id: t.id,
                    roleId: t.roleId,
                    defaultQuantity: t.defaultQuantity,
                    quantityUnit: t.quantityUnit,
                    trimItemId: t.trimItemId,
                    serviceItemId: t.serviceItemId,
                }));

            return bomApi.updateTemplate(product.id, { lines: remainingLines });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productBom', product.id] });
        },
    });

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

    return (
        <div className="space-y-6">
            {/* Cost Summary */}
            <BomCostSummary costs={costs} />

            {/* Unified BOM Lines Table */}
            <BomLinesTable
                lines={lines}
                context="product"
                onAddLine={() => setIsAddModalOpen(true)}
                onDeleteLine={(line) => deleteLineMutation.mutate(line)}
                onRowClick={(line) => setConsumptionModalLine(line)}
                emptyMessage="No BOM configured for this product"
            />

            {/* Variations Summary */}
            {bomData?.variations && bomData.variations.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        Variation Fabric Assignments
                    </h4>
                    <div className="space-y-2">
                        {bomData.variations.slice(0, 5).map((v: any) => {
                            // Find main fabric assignment
                            const mainFabric = v.bomLines?.find(
                                (l: any) => l.roleCode === 'main' && l.typeCode === 'FABRIC'
                            );
                            return (
                                <div
                                    key={v.id}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-700">{v.colorName}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {mainFabric?.fabricColour?.colourHex && (
                                            <span
                                                className="w-3 h-3 rounded-full border border-gray-300"
                                                style={{
                                                    backgroundColor: mainFabric.fabricColour.colourHex,
                                                }}
                                            />
                                        )}
                                        <span className="text-gray-500 text-xs">
                                            {mainFabric?.fabricColour?.name || 'No fabric assigned'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                        {bomData.variations.length > 5 && (
                            <p className="text-xs text-gray-400 mt-2">
                                + {bomData.variations.length - 5} more variations
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Add Line Modal */}
            <AddBomLineModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onAdd={(data) => addLineMutation.mutateAsync(data)}
                existingRoles={existingRoleIds}
                context="product"
                productId={product.id}
            />

            {/* Size Consumption Modal */}
            {consumptionModalLine && (
                <SizeConsumptionModal
                    isOpen={!!consumptionModalLine}
                    onClose={() => setConsumptionModalLine(null)}
                    productId={product.id}
                    productName={product.name}
                    roleId={consumptionModalLine.roleId}
                    roleName={consumptionModalLine.roleName}
                    roleType={consumptionModalLine.type}
                />
            )}
        </div>
    );
}
