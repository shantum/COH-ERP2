/**
 * ProductCostsTab - Cost breakdown from BOM system for Product detail panel
 *
 * Shows:
 * - Product-level cost settings (packagingCost, laborMinutes)
 * - Per-SKU BOM cost breakdown from product tree data
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Info, TrendingUp } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import {
    getCostConfig,
    type CostConfigResult,
} from '../../../server/functions/bomMutations';
import type { ProductTreeNode } from '../types';

interface ProductCostsTabProps {
    product: ProductTreeNode;
}

export function ProductCostsTab({ product }: ProductCostsTabProps) {
    const getCostConfigFn = useServerFn(getCostConfig);

    const { data: costConfig } = useQuery<CostConfigResult | null>({
        queryKey: ['costConfig'],
        queryFn: async () => {
            const result = await getCostConfigFn({ data: undefined });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to load cost config');
            }
            return result.data;
        },
        staleTime: 5 * 60 * 1000,
    });

    // Collect SKU data from product tree (already available via props)
    const skuData = useMemo(() => {
        const skus: Array<{
            skuCode: string;
            colorName: string;
            size: string;
            mrp: number;
            bomCost: number;
            laborCost: number;
            packagingCost: number;
            totalCost: number;
            marginPct: number;
        }> = [];

        const laborRate = costConfig?.laborRatePerMin ?? 2.5;
        const defaultPackaging = costConfig?.defaultPackagingCost ?? 50;

        for (const variation of product.children ?? []) {
            for (const sku of variation.children ?? []) {
                const bomCost = sku.bomCost ?? 0;
                const laborMinutes = sku.laborMinutes ?? variation.laborMinutes ?? product.laborMinutes ?? 60;
                const laborCost = (laborMinutes ?? 0) * laborRate;
                const packagingCost = sku.packagingCost ?? variation.packagingCost ?? product.packagingCost ?? defaultPackaging;
                const totalCost = bomCost + laborCost + (packagingCost ?? 0);
                const mrp = sku.mrp ?? 0;
                const marginPct = mrp > 0 ? ((mrp - totalCost) / mrp) * 100 : 0;

                skus.push({
                    skuCode: sku.skuCode ?? '',
                    colorName: variation.colorName ?? '',
                    size: sku.size ?? '',
                    mrp,
                    bomCost,
                    laborCost: Math.round(laborCost * 100) / 100,
                    packagingCost: packagingCost ?? 0,
                    totalCost: Math.round(totalCost * 100) / 100,
                    marginPct,
                });
            }
        }
        return skus;
    }, [product, costConfig]);

    // Calculate summary stats
    const summary = useMemo(() => {
        if (skuData.length === 0) {
            return { avgCost: 0, avgMargin: 0 };
        }
        const costs = skuData.map(s => s.totalCost);
        const margins = skuData.map(s => s.marginPct);
        return {
            avgCost: costs.reduce((a, b) => a + b, 0) / costs.length,
            avgMargin: margins.reduce((a, b) => a + b, 0) / margins.length,
        };
    }, [skuData]);

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

            {/* Cost Formula Explanation */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start gap-2">
                    <Info size={16} className="text-gray-500 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-gray-700">Cost Formula</h4>
                        <p className="text-xs text-gray-500 mt-1">
                            Total Cost = BOM Cost (fabric + trims + services) + Labor + Packaging
                        </p>
                    </div>
                </div>
            </div>

            {/* Summary Stats */}
            {skuData.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        Cost Summary ({skuData.length} SKUs)
                    </h4>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <StatCard
                            label="Average Cost"
                            value={`₹${summary.avgCost.toFixed(0)}`}
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
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">BOM</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Margin</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {skuData.slice(0, 10).map((sku) => (
                                    <tr key={sku.skuCode} className="hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                            <div>
                                                <span className="text-gray-900">{sku.colorName} - {sku.size}</span>
                                                <span className="text-xs text-gray-400 ml-2">{sku.skuCode}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            ₹{sku.mrp.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-blue-600">
                                            ₹{sku.bomCost.toFixed(0)}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            ₹{sku.totalCost.toFixed(0)}
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
                        {skuData.length > 10 && (
                            <div className="px-3 py-2 text-center text-xs text-gray-500 border-t bg-gray-50">
                                Showing 10 of {skuData.length} SKUs
                            </div>
                        )}
                    </div>
                </div>
            )}

            {skuData.length === 0 && (
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
}

function CostSettingCard({ label, productValue, defaultValue, defaultLabel, unit = '₹' }: CostSettingCardProps) {
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
