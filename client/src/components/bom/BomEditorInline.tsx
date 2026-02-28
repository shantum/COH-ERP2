/**
 * BOM Editor Inline
 *
 * Inline version of BomEditorPanel for use in the /fabrics?tab=bom layout.
 * No overlay/backdrop — renders directly in the content area.
 * Accepts productId prop and fetches product name + BOM data.
 *
 * Three-tab structure:
 * - Template: Product-level defaults (trims, services)
 * - Variations: Color-specific fabric assignments + overrides
 * - SKUs: Size-specific quantity overrides
 */

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, AlertCircle, Loader2 } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import {
    getProductBom,
    getComponentRoles,
    getAvailableComponents,
    updateProductBom,
    type ProductBomResult,
    type ComponentRoleResult,
    type AvailableComponentsResult,
} from '../../server/functions/bomMutations';
import { useProductsTree } from '../products/hooks/useProductsTree';
import BomTemplateTab from './BomTemplateTab';
import BomVariationsTab from './BomVariationsTab';
import BomSkuTab from './BomSkuTab';
import CostSummary from './CostSummary';

interface BomEditorInlineProps {
    productId: string;
}

type TabType = 'template' | 'variations' | 'skus';

export default function BomEditorInline({ productId }: BomEditorInlineProps) {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<TabType>('template');
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Reset state when product changes
    useEffect(() => {
        setActiveTab('template');
        setHasUnsavedChanges(false);
    }, [productId]);

    // Server Functions
    const getProductBomFn = useServerFn(getProductBom);
    const getComponentRolesFn = useServerFn(getComponentRoles);
    const getAvailableComponentsFn = useServerFn(getAvailableComponents);
    const updateProductBomFn = useServerFn(updateProductBom);

    // Fetch BOM data for product
    const { data: bomData, isLoading, error } = useQuery<ProductBomResult | null>({
        queryKey: ['productBom', productId],
        queryFn: async () => {
            const result = await getProductBomFn({ data: { productId } });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load BOM');
            }
            return result.data;
        },
        enabled: !!productId,
    });

    // Fetch component roles (from config)
    const { data: componentRoles } = useQuery<ComponentRoleResult[]>({
        queryKey: ['componentRoles'],
        queryFn: async () => {
            const result = await getComponentRolesFn({ data: undefined });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load component roles');
            }
            return result.data;
        },
        staleTime: 60 * 60 * 1000,
    });

    // Fetch available components for selection
    const { data: availableComponents } = useQuery<AvailableComponentsResult | null>({
        queryKey: ['availableComponents'],
        queryFn: async () => {
            const result = await getAvailableComponentsFn({ data: undefined });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load available components');
            }
            return result.data;
        },
        staleTime: 5 * 60 * 1000,
    });

    // Save BOM mutation
    const saveBom = useMutation({
        mutationFn: async (updates: { template?: { roleId: string; componentType: 'FABRIC' | 'TRIM' | 'SERVICE'; componentId?: string | null; resolvedQuantity?: number | null }[] }) => {
            const result = await updateProductBomFn({ data: { productId, ...updates } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to save BOM');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productBom', productId] });
            setHasUnsavedChanges(false);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to save BOM');
        },
    });

    // Calculate costs
    const costSummary = useMemo(() => {
        if (!bomData) return { fabricCost: 0, trimCost: 0, serviceCost: 0, totalCogs: 0 };

        let fabricCost = 0;
        let trimCost = 0;
        let serviceCost = 0;

        bomData.templates?.forEach((line) => {
            const qty = line.defaultQuantity || 0;

            if (line.typeCode === 'FABRIC') {
                const variationCosts: number[] = [];
                for (const v of bomData.variations || []) {
                    const vLine = v.bomLines.find(bl => bl.roleId === line.roleId);
                    if (vLine?.fabricColour) {
                        const rate = vLine.fabricColour.costPerUnit ?? vLine.fabricColour.fabric?.costPerUnit ?? 0;
                        if (rate > 0) variationCosts.push(rate);
                    }
                }
                const avgRate = variationCosts.length > 0
                    ? variationCosts.reduce((a, b) => a + b, 0) / variationCosts.length
                    : 0;
                fabricCost += avgRate * qty;
            } else if (line.typeCode === 'TRIM' && line.trimItem) {
                trimCost += (line.trimItem.costPerUnit || 0) * qty;
            } else if (line.typeCode === 'SERVICE' && line.serviceItem) {
                serviceCost += (line.serviceItem.costPerJob || 0) * qty;
            }
        });

        return {
            fabricCost,
            trimCost,
            serviceCost,
            totalCogs: fabricCost + trimCost + serviceCost,
        };
    }, [bomData]);

    // Handle save
    const handleSave = () => {
        const template = bomData?.templates?.map((t) => ({
            roleId: t.roleId,
            componentType: t.typeCode as 'FABRIC' | 'TRIM' | 'SERVICE',
            componentId: t.trimItemId || t.serviceItemId || null,
            resolvedQuantity: t.defaultQuantity,
        }));
        saveBom.mutate({ template });
    };

    // Get product name from cached tree (already loaded by BomProductList)
    const { data: products } = useProductsTree();
    const productName = products?.find(p => p.id === productId)?.name || 'Loading...';

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b bg-white px-5 py-3">
                <div>
                    <h2 className="text-base font-semibold text-slate-900">BOM Editor</h2>
                    <p className="text-sm text-slate-500">{productName}</p>
                </div>
                <div className="flex items-center gap-3">
                    {hasUnsavedChanges && (
                        <span className="text-xs text-amber-600">Unsaved changes</span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={!hasUnsavedChanges || saveBom.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                        {saveBom.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Save size={14} />
                        )}
                        Save
                    </button>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex border-b bg-white px-5">
                {(['template', 'variations', 'skus'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                            activeTab === tab
                                ? 'border-primary-500 text-primary-600'
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {tab === 'skus' ? 'SKUs' : tab}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {isLoading && (
                    <div className="flex items-center justify-center h-48">
                        <Loader2 size={24} className="animate-spin text-slate-400" />
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg">
                        <AlertCircle size={20} />
                        <span>Failed to load BOM data</span>
                    </div>
                )}

                {!isLoading && !error && bomData && (
                    <>
                        {activeTab === 'template' && (
                            <BomTemplateTab
                                template={(bomData.templates || []).map(t => ({
                                    id: t.id,
                                    roleId: t.roleId,
                                    roleName: t.roleName,
                                    roleCode: t.roleCode,
                                    componentType: t.typeCode,
                                    trimItemId: t.trimItemId || undefined,
                                    trimItemName: t.trimItem?.name,
                                    serviceItemId: t.serviceItemId || undefined,
                                    serviceItemName: t.serviceItem?.name,
                                    defaultQuantity: t.defaultQuantity ?? 0,
                                    quantityUnit: t.quantityUnit || 'unit',
                                    wastagePercent: t.wastagePercent ?? 0,
                                }))}
                                componentRoles={(componentRoles || []).map(r => ({
                                    id: r.id,
                                    code: r.code,
                                    name: r.name,
                                    typeCode: r.type.code,
                                    isRequired: r.isRequired,
                                    allowMultiple: r.allowMultiple,
                                    sortOrder: r.sortOrder,
                                }))}
                                availableComponents={availableComponents || { trims: [], services: [] }}
                                onUpdate={() => setHasUnsavedChanges(true)}
                            />
                        )}

                        {activeTab === 'variations' && (
                            <BomVariationsTab
                                variations={(bomData.variations || []).map(v => ({
                                    id: v.id,
                                    colorName: v.colorName,
                                    bomLines: v.bomLines.map(line => {
                                        const template = bomData.templates?.find(t => t.roleId === line.roleId);
                                        return {
                                            id: line.id,
                                            roleId: line.roleId,
                                            roleName: template?.roleName || '',
                                            roleCode: line.roleCode,
                                            componentType: line.typeCode,
                                            fabricColourId: line.fabricColourId || undefined,
                                            fabricColourName: line.fabricColour?.name,
                                            fabricColourHex: line.fabricColour?.colourHex || undefined,
                                            trimItemId: line.trimItemId || undefined,
                                            trimItemName: line.trimItem?.name,
                                            serviceItemId: line.serviceItemId || undefined,
                                            serviceItemName: line.serviceItem?.name,
                                            quantity: line.quantity ?? undefined,
                                            isInherited: false,
                                        };
                                    }),
                                }))}
                                template={(bomData.templates || []).map(t => ({
                                    roleId: t.roleId,
                                    roleName: t.roleName,
                                    defaultQuantity: t.defaultQuantity ?? 0,
                                    quantityUnit: t.quantityUnit || 'unit',
                                    trimItemId: t.trimItemId || undefined,
                                    trimItemName: t.trimItem?.name,
                                    serviceItemId: t.serviceItemId || undefined,
                                    serviceItemName: t.serviceItem?.name,
                                }))}
                                componentRoles={(componentRoles || []).map(r => ({
                                    id: r.id,
                                    code: r.code,
                                    name: r.name,
                                    typeCode: r.type.code,
                                    isRequired: r.isRequired,
                                    allowMultiple: r.allowMultiple,
                                    sortOrder: r.sortOrder,
                                }))}
                                availableComponents={availableComponents as typeof availableComponents & { fabricColours: never[] } || { fabricColours: [], trims: [], services: [] }}
                                onUpdate={() => setHasUnsavedChanges(true)}
                            />
                        )}

                        {activeTab === 'skus' && (
                            <BomSkuTab
                                skus={(bomData.skus || []).map(sku => {
                                    const variation = bomData.variations?.find(v => v.id === sku.variationId);
                                    const resolvedLines = (componentRoles || [])
                                        .filter(r => r.type.code === 'FABRIC')
                                        .map(role => {
                                            const skuLine = sku.bomLines.find(bl => bl.roleId === role.id);
                                            const varLine = variation?.bomLines.find(bl => bl.roleId === role.id);
                                            const templateLine = bomData.templates?.find(t => t.roleId === role.id);
                                            const resolvedQty = skuLine?.quantity ?? varLine?.quantity ?? templateLine?.defaultQuantity ?? 0;
                                            return {
                                                id: skuLine?.id,
                                                roleId: role.id,
                                                roleName: role.name,
                                                roleCode: role.code,
                                                componentType: role.type.code,
                                                quantity: skuLine?.quantity ?? undefined,
                                                overrideCost: skuLine?.overrideCost ?? undefined,
                                                notes: skuLine?.notes ?? undefined,
                                                isInherited: !skuLine?.quantity,
                                                resolvedQuantity: resolvedQty,
                                                resolvedCost: 0,
                                            };
                                        });
                                    return {
                                        id: sku.id,
                                        skuCode: sku.skuCode,
                                        size: sku.size,
                                        variationId: sku.variationId,
                                        colorName: sku.colorName,
                                        colorHex: sku.colorHex ?? undefined,
                                        bomLines: resolvedLines,
                                    };
                                })}
                                variations={(bomData.variations || []).map(v => ({
                                    id: v.id,
                                    colorName: v.colorName,
                                    bomLines: v.bomLines.map(line => ({
                                        roleId: line.roleId,
                                        quantity: line.quantity ?? undefined,
                                    })),
                                }))}
                                template={(bomData.templates || []).map(t => ({
                                    id: t.id,
                                    roleId: t.roleId,
                                    roleName: t.roleName,
                                    roleCode: t.roleCode,
                                    componentType: t.typeCode,
                                    defaultQuantity: t.defaultQuantity ?? 0,
                                    quantityUnit: t.quantityUnit || 'unit',
                                    wastagePercent: t.wastagePercent ?? 0,
                                }))}
                                componentRoles={(componentRoles || []).map(r => ({
                                    id: r.id,
                                    code: r.code,
                                    name: r.name,
                                    typeCode: r.type.code,
                                    isRequired: r.isRequired,
                                    allowMultiple: r.allowMultiple,
                                    sortOrder: r.sortOrder,
                                }))}
                                onUpdate={() => setHasUnsavedChanges(true)}
                            />
                        )}
                    </>
                )}
            </div>

            {/* Cost Summary Footer */}
            <CostSummary
                fabricCost={costSummary.fabricCost}
                trimCost={costSummary.trimCost}
                serviceCost={costSummary.serviceCost}
                totalCogs={costSummary.totalCogs}
            />
        </div>
    );
}
