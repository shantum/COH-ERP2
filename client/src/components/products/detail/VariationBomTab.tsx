/**
 * VariationBomTab - Unified BOM display for Variation detail panel
 *
 * Shows all BOM components (fabrics, trims, services) in a single table.
 * At variation level, fabrics show the assigned colour with swatch.
 * Trims and services are inherited from the product template.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import { getProductBom, type ProductBomResult, type VariationBomData } from '../../../server/functions/bomMutations';
import {
    BomLinesTable,
    BomCostSummary,
    type UnifiedBomLine,
    type BomCostBreakdown,
    type BomComponentType,
} from '../bom';
import type { ProductTreeNode } from '../types';

interface VariationBomTabProps {
    variation: ProductTreeNode;
}

export function VariationBomTab({ variation }: VariationBomTabProps) {
    // Server Functions
    const getProductBomFn = useServerFn(getProductBom);

    // Fetch BOM data for the parent product
    const {
        data: bomData,
        isLoading,
        error,
    } = useQuery<ProductBomResult | null>({
        queryKey: ['productBom', variation.productId],
        queryFn: async () => {
            if (!variation.productId) return null;
            const result = await getProductBomFn({ data: { productId: variation.productId } });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load BOM');
            }
            return result.data;
        },
        enabled: !!variation.productId,
    });

    // Transform API data to unified lines for this variation
    const { lines, costs } = useMemo(() => {
        if (!bomData?.templates) {
            return {
                lines: [] as UnifiedBomLine[],
                costs: { fabricCost: 0, trimCost: 0, serviceCost: 0, total: 0 },
            };
        }

        // Find this variation's BOM data
        const variationBom = bomData.variations?.find(
            (v) => v.id === variation.id
        );
        const variationLines = variationBom?.bomLines || [];

        // Create a map of variation-level overrides
        const variationLinesByRole = new Map<string, VariationBomData['bomLines'][number]>();
        for (const line of variationLines) {
            variationLinesByRole.set(line.roleId, line);
        }

        const unifiedLines: UnifiedBomLine[] = [];
        let fabricCost = 0;
        let trimCost = 0;
        let serviceCost = 0;

        // Transform templates, applying variation-level overrides
        for (const template of bomData.templates) {
            const typeCode = template.typeCode as BomComponentType;
            const variationLine = variationLinesByRole.get(template.roleId);

            // Determine component name and cost based on type
            let componentName: string | null = null;
            let componentId: string | null = null;
            let costPerUnit: number | null = null;
            let colourHex: string | null = null;
            let isInherited = false;

            if (typeCode === 'FABRIC') {
                // At variation level, show the assigned fabric colour
                if (variationLine?.fabricColour) {
                    componentName = variationLine.fabricColour.name;
                    componentId = variationLine.fabricColourId;
                    colourHex = variationLine.fabricColour.colourHex;
                    costPerUnit = variationLine.fabricColour.costPerUnit ?? variationLine.fabricColour.fabric?.costPerUnit ?? null;
                } else {
                    componentName = null; // Not assigned yet
                }
            } else if (typeCode === 'TRIM') {
                // Check for variation override first
                if (variationLine?.trimItem) {
                    componentName = variationLine.trimItem.name;
                    componentId = variationLine.trimItemId;
                    costPerUnit = variationLine.trimItem.costPerUnit;
                } else if (template.trimItem) {
                    // Inherit from template
                    componentName = template.trimItem.name;
                    componentId = template.trimItemId;
                    costPerUnit = template.trimItem.costPerUnit;
                    isInherited = true;
                }
            } else if (typeCode === 'SERVICE') {
                // Check for variation override first
                if (variationLine?.serviceItem) {
                    componentName = variationLine.serviceItem.name;
                    componentId = variationLine.serviceItemId;
                    costPerUnit = variationLine.serviceItem.costPerJob;
                } else if (template.serviceItem) {
                    // Inherit from template
                    componentName = template.serviceItem.name;
                    componentId = template.serviceItemId;
                    costPerUnit = template.serviceItem.costPerJob;
                    isInherited = true;
                }
            }

            // Get quantity (variation can override template)
            const qty = variationLine?.quantity ?? template.defaultQuantity ?? 0;
            const total = (costPerUnit ?? 0) * qty;

            // Accumulate costs
            if (typeCode === 'FABRIC') fabricCost += total;
            else if (typeCode === 'TRIM') trimCost += total;
            else if (typeCode === 'SERVICE') serviceCost += total;

            unifiedLines.push({
                id: variationLine?.id || template.id,
                type: typeCode,
                roleCode: template.roleCode,
                roleName: template.roleName,
                roleId: template.roleId,
                componentName,
                componentId,
                colourHex,
                quantity: qty,
                quantityUnit: template.quantityUnit || 'unit',
                costPerUnit,
                totalCost: total,
                source: variationLine ? 'variation' : 'template',
                isInherited,
                _raw: {
                    templateId: template.id,
                    variationLineId: variationLine?.id,
                    trimItem: variationLine?.trimItem || template.trimItem,
                    serviceItem: variationLine?.serviceItem || template.serviceItem,
                    fabricColour: variationLine?.fabricColour,
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
        };
    }, [bomData, variation.id]);

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
                context="variation"
                emptyMessage="No BOM template defined for this product"
            />

            {/* Inheritance Note */}
            {lines.some((l) => l.isInherited) && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                    <span className="text-gray-400">↑</span>
                    Lines marked with ↑ are inherited from the product template
                </p>
            )}
        </div>
    );
}
