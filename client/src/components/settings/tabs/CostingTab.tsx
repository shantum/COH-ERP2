/**
 * CostingTab component
 * Manages global costing settings with elegant design
 *
 * Uses Server Functions for data fetching and mutations.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCostConfig, updateCostConfig } from '../../../server/functions/admin';
import { Package, DollarSign, Clock, Save, RefreshCw, Info, Sparkles, Percent } from 'lucide-react';

export function CostingTab() {
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState({
        laborRatePerMin: 2.5,
        defaultPackagingCost: 50,
        gstThreshold: 2500,
        gstRateAbove: 18,
        gstRateBelow: 5,
    });
    const [hasChanges, setHasChanges] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const { data: config, isLoading } = useQuery({
        queryKey: ['costConfig'],
        queryFn: async () => {
            const result = await getCostConfig();
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to fetch cost config');
            }
            return result.data;
        },
    });

    useEffect(() => {
        if (config) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form state from fetched config
            setFormData({
                laborRatePerMin: config.laborRatePerMin,
                defaultPackagingCost: config.defaultPackagingCost,
                gstThreshold: config.gstThreshold,
                gstRateAbove: config.gstRateAbove,
                gstRateBelow: config.gstRateBelow,
            });
        }
    }, [config]);

    const updateMutation = useMutation({
        mutationFn: async (data: {
            laborRatePerMin?: number;
            defaultPackagingCost?: number;
            gstThreshold?: number;
            gstRateAbove?: number;
            gstRateBelow?: number;
        }) => {
            const result = await updateCostConfig({ data });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update cost config');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['costConfig'] });
            queryClient.invalidateQueries({ queryKey: ['catalogSkuInventory'] });
            setHasChanges(false);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        },
    });

    const handleChange = (field: keyof typeof formData, value: string) => {
        const numValue = parseFloat(value) || 0;
        setFormData(prev => ({ ...prev, [field]: numValue }));
        setHasChanges(true);
    };

    const handleSave = () => {
        updateMutation.mutate(formData);
    };

    const handleReset = () => {
        if (config) {
            setFormData({
                laborRatePerMin: config.laborRatePerMin,
                defaultPackagingCost: config.defaultPackagingCost,
                gstThreshold: config.gstThreshold,
                gstRateAbove: config.gstRateAbove,
                gstRateBelow: config.gstRateBelow,
            });
            setHasChanges(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-4xl">
            {/* Header with gradient accent */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-6 text-white">
                <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                <div className="relative">
                    <div className="flex items-center gap-3 mb-2">
                        <Sparkles size={24} className="text-purple-200" />
                        <h2 className="text-2xl font-bold tracking-tight">Costing Configuration</h2>
                    </div>
                    <p className="text-purple-100 text-sm max-w-xl">
                        Set global defaults for product costing. These values cascade to all products, variations, and SKUs
                        unless overridden at a lower level.
                    </p>
                </div>
            </div>

            {/* Info callout */}
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <Info size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-800">
                    <p className="font-medium">Cost Cascade Logic</p>
                    <p className="mt-1 text-amber-700">
                        SKU → Variation → Product → Global Default. If a value is not set at a lower level,
                        it inherits from the level above. Edit individual products in the Catalog to override.
                    </p>
                </div>
            </div>

            {/* Settings Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Packaging Cost Card */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                            <Package size={24} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Default Packaging Cost</h3>
                            <p className="text-xs text-gray-500">Applied to all products without override</p>
                        </div>
                    </div>

                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                        <input
                            type="number"
                            value={formData.defaultPackagingCost}
                            onChange={(e) => handleChange('defaultPackagingCost', e.target.value)}
                            className="w-full pl-10 pr-4 py-3 text-2xl font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                            min="0"
                            step="1"
                        />
                    </div>

                    <p className="mt-3 text-xs text-gray-500">
                        Current: ₹{config?.defaultPackagingCost?.toFixed(0) || 50} per unit
                    </p>
                </div>

                {/* Labor Rate Card */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center">
                            <Clock size={24} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">Labor Rate per Minute</h3>
                            <p className="text-xs text-gray-500">Used for COGS calculations</p>
                        </div>
                    </div>

                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₹</span>
                        <input
                            type="number"
                            value={formData.laborRatePerMin}
                            onChange={(e) => handleChange('laborRatePerMin', e.target.value)}
                            className="w-full pl-10 pr-4 py-3 text-2xl font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            min="0"
                            step="0.5"
                        />
                    </div>

                    <p className="mt-3 text-xs text-gray-500">
                        Current: ₹{config?.laborRatePerMin?.toFixed(2) || '2.50'} per minute
                    </p>
                </div>
            </div>

            {/* GST Configuration Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Percent size={20} className="text-indigo-500" />
                    GST Configuration (Catalog Pricing)
                </h3>
                <p className="text-sm text-gray-500 -mt-2">
                    Configure GST rates for catalog price calculations. Order-level GST will be calculated separately based on actual order prices.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* GST Threshold Card */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center">
                                <DollarSign size={20} className="text-white" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-900 text-sm">Price Threshold</h4>
                                <p className="text-xs text-gray-500">Cutoff for GST rate</p>
                            </div>
                        </div>

                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-sm">₹</span>
                            <input
                                type="number"
                                value={formData.gstThreshold}
                                onChange={(e) => handleChange('gstThreshold', e.target.value)}
                                className="w-full pl-8 pr-4 py-2.5 text-xl font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                                min="0"
                                step="100"
                            />
                        </div>

                        <p className="mt-2 text-xs text-gray-500">
                            Current: ₹{config?.gstThreshold?.toFixed(0) || 2500}
                        </p>
                    </div>

                    {/* GST Rate Above Card */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center">
                                <Percent size={20} className="text-white" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-900 text-sm">GST Rate (≥ Threshold)</h4>
                                <p className="text-xs text-gray-500">For products ≥ ₹{formData.gstThreshold}</p>
                            </div>
                        </div>

                        <div className="relative">
                            <input
                                type="number"
                                value={formData.gstRateAbove}
                                onChange={(e) => handleChange('gstRateAbove', e.target.value)}
                                className="w-full pl-4 pr-10 py-2.5 text-xl font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                                min="0"
                                max="100"
                                step="1"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">%</span>
                        </div>

                        <p className="mt-2 text-xs text-gray-500">
                            Current: {config?.gstRateAbove || 18}%
                        </p>
                    </div>

                    {/* GST Rate Below Card */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                                <Percent size={20} className="text-white" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-900 text-sm">GST Rate (&lt; Threshold)</h4>
                                <p className="text-xs text-gray-500">For products &lt; ₹{formData.gstThreshold}</p>
                            </div>
                        </div>

                        <div className="relative">
                            <input
                                type="number"
                                value={formData.gstRateBelow}
                                onChange={(e) => handleChange('gstRateBelow', e.target.value)}
                                className="w-full pl-4 pr-10 py-2.5 text-xl font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                                min="0"
                                max="100"
                                step="1"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">%</span>
                        </div>

                        <p className="mt-2 text-xs text-gray-500">
                            Current: {config?.gstRateBelow || 5}%
                        </p>
                    </div>
                </div>
            </div>

            {/* Total Cost Formula */}
            <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <DollarSign size={18} className="text-gray-500" />
                    Total Cost Formula
                </h4>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg font-medium">Fabric Cost</span>
                    <span className="text-gray-400">+</span>
                    <span className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg font-medium">Trims Cost</span>
                    <span className="text-gray-400">+</span>
                    <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg font-medium">Packaging Cost</span>
                    <span className="text-gray-400">=</span>
                    <span className="px-3 py-1.5 bg-gray-900 text-white rounded-lg font-medium">Total Cost</span>
                </div>
                <p className="mt-3 text-xs text-gray-500">
                    Fabric Cost = Consumption (m) × Fabric Rate (₹/m)
                </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2">
                    {saveSuccess && (
                        <span className="text-sm text-emerald-600 font-medium animate-in fade-in">
                            Settings saved successfully!
                        </span>
                    )}
                    {config?.lastUpdated && !saveSuccess && (
                        <span className="text-xs text-gray-400">
                            Last updated: {new Date(config.lastUpdated).toLocaleDateString()}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {hasChanges && (
                        <button
                            onClick={handleReset}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                        >
                            Reset
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={!hasChanges || updateMutation.isPending}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                            hasChanges
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        {updateMutation.isPending ? (
                            <RefreshCw size={16} className="animate-spin" />
                        ) : (
                            <Save size={16} />
                        )}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
