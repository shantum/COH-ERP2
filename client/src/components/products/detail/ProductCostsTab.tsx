/**
 * ProductCostsTab - Cost breakdown and cascade display for Product detail panel
 *
 * Shows:
 * - Product-level cost settings
 * - Cost cascade explanation
 * - Per-SKU cost breakdown summary
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Info, AlertCircle, Loader2, ArrowDown, TrendingUp } from 'lucide-react';
import { productsApi } from '../../../services/api';
import type { ProductTreeNode } from '../types';

interface ProductCostsTabProps {
    product: ProductTreeNode;
}

export function ProductCostsTab({ product }: ProductCostsTabProps) {
    // Fetch cost config (global defaults)
    const { data: costConfig } = useQuery({
        queryKey: ['costConfig'],
        queryFn: () => productsApi.getCostConfig().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch COGS data for this product's SKUs
    const { data: cogsData, isLoading, error } = useQuery({
        queryKey: ['productCogs', product.id],
        queryFn: async () => {
            // Fetch all COGS and filter for this product
            const response = await productsApi.getCogs();
            return response.data.filter((item: any) =>
                product.children?.some(v =>
                    v.children?.some(s => s.id === item.skuId)
                )
            );
        },
        enabled: !!product.id,
    });

    // Calculate summary stats
    const summary = useMemo(() => {
        if (!cogsData || cogsData.length === 0) {
            return { avgCogs: 0, avgMargin: 0, minMargin: 0, maxMargin: 0 };
        }

        const cogs = cogsData.map((c: any) => c.totalCogs);
        const margins = cogsData.map((c: any) => c.marginPct);

        return {
            avgCogs: cogs.reduce((a: number, b: number) => a + b, 0) / cogs.length,
            avgMargin: margins.reduce((a: number, b: number) => a + b, 0) / margins.length,
            minMargin: Math.min(...margins),
            maxMargin: Math.max(...margins),
        };
    }, [cogsData]);

    return (
        <div className="space-y-6">
            {/* Cost Settings Card */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                <div className="flex items-center gap-2 mb-4">
                    <DollarSign size={18} className="text-green-600" />
                    <h4 className="text-sm font-medium text-gray-700">Product Cost Settings</h4>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <CostSettingCard
                        label="Trims Cost"
                        productValue={product.trimsCost}
                        defaultLabel="Not set (uses variation/SKU)"
                    />
                    <CostSettingCard
                        label="Lining Cost"
                        productValue={product.liningCost}
                        defaultLabel="Not set"
                        showIf={product.hasLining}
                    />
                    <CostSettingCard
                        label="Packaging Cost"
                        productValue={product.packagingCost}
                        defaultValue={costConfig?.defaultPackagingCost}
                        defaultLabel={`Default: ₹${costConfig?.defaultPackagingCost || 50}`}
                    />
                    <CostSettingCard
                        label="Labor Minutes"
                        productValue={product.laborMinutes}
                        unit="min"
                        defaultValue={60}
                        defaultLabel="Default: 60 min"
                    />
                </div>

                {/* Labor Rate Info */}
                <div className="mt-4 pt-4 border-t border-green-200">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Labor Rate (Global)</span>
                        <span className="font-medium text-gray-900">
                            ₹{costConfig?.laborRatePerMin || 2.5}/min
                        </span>
                    </div>
                </div>
            </div>

            {/* Cost Cascade Explanation */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start gap-2 mb-3">
                    <Info size={16} className="text-gray-500 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-gray-700">Cost Cascade</h4>
                        <p className="text-xs text-gray-500 mt-1">
                            Costs flow from SKU → Variation → Product → Global Defaults
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between text-xs bg-white rounded-lg p-3">
                    <CascadeLevel label="SKU" color="teal" />
                    <ArrowDown size={12} className="text-gray-400" />
                    <CascadeLevel label="Variation" color="purple" />
                    <ArrowDown size={12} className="text-gray-400" />
                    <CascadeLevel label="Product" color="blue" />
                    <ArrowDown size={12} className="text-gray-400" />
                    <CascadeLevel label="Default" color="gray" />
                </div>
            </div>

            {/* Summary Stats */}
            {isLoading && (
                <div className="flex items-center justify-center h-32">
                    <Loader2 size={24} className="animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-500">Calculating costs...</span>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg">
                    <AlertCircle size={20} />
                    <span>Failed to load cost data</span>
                </div>
            )}

            {cogsData && cogsData.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        Cost Summary ({cogsData.length} SKUs)
                    </h4>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <StatCard
                            label="Average COGS"
                            value={`₹${summary.avgCogs.toFixed(2)}`}
                            icon={DollarSign}
                        />
                        <StatCard
                            label="Average Margin"
                            value={`${summary.avgMargin.toFixed(1)}%`}
                            icon={TrendingUp}
                            color={summary.avgMargin >= 30 ? 'green' : summary.avgMargin >= 20 ? 'yellow' : 'red'}
                        />
                    </div>

                    {/* SKU Cost Table */}
                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">SKU</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">MRP</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">COGS</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Margin</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {cogsData.slice(0, 10).map((sku: any) => (
                                    <tr key={sku.skuId} className="hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                            <div>
                                                <span className="text-gray-900">{sku.colorName} - {sku.size}</span>
                                                <span className="text-xs text-gray-400 ml-2">{sku.skuCode}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            ₹{sku.mrp.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            ₹{sku.totalCogs.toFixed(2)}
                                        </td>
                                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                                            sku.marginPct >= 30 ? 'text-green-600' :
                                            sku.marginPct >= 20 ? 'text-amber-600' : 'text-red-600'
                                        }`}>
                                            {sku.marginPct.toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {cogsData.length > 10 && (
                            <div className="px-3 py-2 text-center text-xs text-gray-500 border-t bg-gray-50">
                                Showing 10 of {cogsData.length} SKUs
                            </div>
                        )}
                    </div>
                </div>
            )}

            {cogsData && cogsData.length === 0 && (
                <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
                    <DollarSign size={40} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">No cost data available</p>
                    <p className="text-xs text-gray-400 mt-1">
                        Add SKUs and BOM to see cost calculations
                    </p>
                </div>
            )}
        </div>
    );
}

interface CostSettingCardProps {
    label: string;
    productValue?: number | null;
    defaultValue?: number;
    defaultLabel: string;
    unit?: string;
    showIf?: boolean;
}

function CostSettingCard({ label, productValue, defaultValue, defaultLabel, unit = '₹', showIf = true }: CostSettingCardProps) {
    if (!showIf) return null;

    const hasValue = productValue !== null && productValue !== undefined;
    const displayValue = hasValue ? productValue : defaultValue;

    return (
        <div className="bg-white rounded-lg p-3 border border-green-100">
            <span className="text-xs text-gray-500">{label}</span>
            <div className="mt-1">
                {hasValue ? (
                    <span className="text-sm font-medium text-gray-900">
                        {unit === '₹' ? '₹' : ''}{displayValue}{unit !== '₹' ? ` ${unit}` : ''}
                    </span>
                ) : (
                    <span className="text-sm text-gray-400">{defaultLabel}</span>
                )}
            </div>
        </div>
    );
}

function CascadeLevel({ label, color }: { label: string; color: string }) {
    const colors: Record<string, string> = {
        teal: 'bg-teal-100 text-teal-700 border-teal-200',
        purple: 'bg-purple-100 text-purple-700 border-purple-200',
        blue: 'bg-blue-100 text-blue-700 border-blue-200',
        gray: 'bg-gray-100 text-gray-700 border-gray-200',
    };

    return (
        <span className={`px-2 py-1 rounded border text-xs font-medium ${colors[color]}`}>
            {label}
        </span>
    );
}

interface StatCardProps {
    label: string;
    value: string;
    icon: typeof DollarSign;
    color?: 'green' | 'yellow' | 'red';
}

function StatCard({ label, value, icon: Icon, color }: StatCardProps) {
    const colors = {
        green: 'text-green-600',
        yellow: 'text-amber-600',
        red: 'text-red-600',
    };

    return (
        <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">{label}</span>
                <Icon size={16} className="text-gray-400" />
            </div>
            <span className={`text-xl font-bold ${color ? colors[color] : 'text-gray-900'}`}>
                {value}
            </span>
        </div>
    );
}
