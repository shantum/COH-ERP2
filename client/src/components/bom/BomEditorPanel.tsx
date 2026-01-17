/**
 * BOM Editor Slide-out Panel
 *
 * Opens from Catalog page to edit product Bill of Materials.
 * Three-tab structure:
 * - Template: Product-level defaults (trims, services - same across all colors)
 * - Variations: Color-specific fabric assignments + overrides
 * - SKUs: Size-specific quantity overrides (rare, optional)
 *
 * Features:
 * - Real-time cost calculation in sticky footer
 * - Inheritance display (↑ indicates inherited value)
 * - Component typeahead for selecting fabric colours, trims, services
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, AlertCircle, Loader2 } from 'lucide-react';
import { bomApi } from '../../services/api';
import BomTemplateTab from './BomTemplateTab';
import BomVariationsTab from './BomVariationsTab';
import BomSkuTab from './BomSkuTab';
import CostSummary from './CostSummary';

interface BomEditorPanelProps {
    productId: string;
    productName: string;
    isOpen: boolean;
    onClose: () => void;
}

type TabType = 'template' | 'variations' | 'skus';

export default function BomEditorPanel({
    productId,
    productName,
    isOpen,
    onClose,
}: BomEditorPanelProps) {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<TabType>('template');
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Fetch BOM data for product
    const { data: bomData, isLoading, error } = useQuery({
        queryKey: ['productBom', productId],
        queryFn: () => bomApi.getProductBom(productId).then(r => r.data),
        enabled: isOpen && !!productId,
    });

    // Fetch component roles (from config)
    const { data: componentRoles } = useQuery({
        queryKey: ['componentRoles'],
        queryFn: () => bomApi.getComponentRoles().then(r => r.data),
        staleTime: 60 * 60 * 1000, // 1 hour
    });

    // Fetch available components for selection
    const { data: availableComponents } = useQuery({
        queryKey: ['availableComponents'],
        queryFn: () => bomApi.getAvailableComponents().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Save BOM mutation
    const saveBom = useMutation({
        mutationFn: (updates: any) => bomApi.updateProductBom(productId, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['productBom', productId] });
            setHasUnsavedChanges(false);
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to save BOM');
        },
    });

    // Calculate costs
    const costSummary = useMemo(() => {
        if (!bomData) return { fabricCost: 0, trimCost: 0, serviceCost: 0, totalCogs: 0 };

        let fabricCost = 0;
        let trimCost = 0;
        let serviceCost = 0;

        // Calculate from template + variations
        bomData.template?.forEach((line: any) => {
            const cost = line.resolvedCost || 0;
            const qty = line.resolvedQuantity || 0;
            const lineTotal = cost * qty;

            if (line.componentType === 'FABRIC') fabricCost += lineTotal;
            else if (line.componentType === 'TRIM') trimCost += lineTotal;
            else if (line.componentType === 'SERVICE') serviceCost += lineTotal;
        });

        return {
            fabricCost,
            trimCost,
            serviceCost,
            totalCogs: fabricCost + trimCost + serviceCost,
        };
    }, [bomData]);

    // Handle close with confirmation
    const handleClose = () => {
        if (hasUnsavedChanges) {
            if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
                return;
            }
        }
        onClose();
    };

    // Handle save
    const handleSave = () => {
        // Collect all changes and save
        saveBom.mutate(bomData);
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 z-40"
                onClick={handleClose}
            />

            {/* Panel */}
            <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">BOM Editor</h2>
                        <p className="text-sm text-gray-500">{productName}</p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 rounded-lg hover:bg-gray-200 text-gray-500"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b px-4">
                    <button
                        onClick={() => setActiveTab('template')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            activeTab === 'template'
                                ? 'border-primary-500 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Template
                    </button>
                    <button
                        onClick={() => setActiveTab('variations')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            activeTab === 'variations'
                                ? 'border-primary-500 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Variations
                    </button>
                    <button
                        onClick={() => setActiveTab('skus')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            activeTab === 'skus'
                                ? 'border-primary-500 text-primary-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        SKUs
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {isLoading && (
                        <div className="flex items-center justify-center h-48">
                            <Loader2 size={24} className="animate-spin text-gray-400" />
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
                                    template={bomData.template || []}
                                    componentRoles={componentRoles || []}
                                    availableComponents={availableComponents || { trims: [], services: [] }}
                                    onUpdate={(updates: any) => {
                                        setHasUnsavedChanges(true);
                                        // Update local state
                                    }}
                                />
                            )}

                            {activeTab === 'variations' && (
                                <BomVariationsTab
                                    variations={bomData.variations || []}
                                    template={bomData.template || []}
                                    componentRoles={componentRoles || []}
                                    availableComponents={availableComponents || { fabricColours: [], trims: [], services: [] }}
                                    onUpdate={(updates: any) => {
                                        setHasUnsavedChanges(true);
                                    }}
                                />
                            )}

                            {activeTab === 'skus' && (
                                <BomSkuTab
                                    skus={bomData.skus || []}
                                    variations={bomData.variations || []}
                                    template={bomData.template || []}
                                    componentRoles={componentRoles || []}
                                    onUpdate={(updates: any) => {
                                        setHasUnsavedChanges(true);
                                    }}
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

                {/* Action Footer */}
                <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                    <div className="text-sm text-gray-500">
                        {hasUnsavedChanges && (
                            <span className="text-amber-600">Unsaved changes</span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={handleClose}
                            className="px-4 py-2 text-sm text-gray-700 bg-white border rounded-lg hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!hasUnsavedChanges || saveBom.isPending}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                        >
                            {saveBom.isPending ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Save size={16} />
                            )}
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
