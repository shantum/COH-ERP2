/**
 * ProductCostsTab - Cost breakdown from BOM system for Product detail panel
 *
 * Shows:
 * - Per-SKU BOM cost breakdown from product tree data
 * - Summary stats (average cost, average margin)
 */

import { useMemo } from 'react';
import { DollarSign, Info, TrendingUp } from 'lucide-react';
import type { ProductTreeNode } from '../types';

interface ProductCostsTabProps {
    product: ProductTreeNode;
}

export function ProductCostsTab({ product }: ProductCostsTabProps) {
    // Collect SKU data from product tree (already available via props)
    const skuData = useMemo(() => {
        const skus: Array<{
            skuCode: string;
            colorName: string;
            size: string;
            mrp: number;
            bomCost: number;
            totalCost: number;
            marginPct: number;
        }> = [];

        for (const variation of product.children ?? []) {
            for (const sku of variation.children ?? []) {
                const bomCost = sku.bomCost ?? 0;
                const totalCost = bomCost;
                const mrp = sku.mrp ?? 0;
                const marginPct = mrp > 0 ? ((mrp - totalCost) / mrp) * 100 : 0;

                skus.push({
                    skuCode: sku.skuCode ?? '',
                    colorName: variation.colorName ?? '',
                    size: sku.size ?? '',
                    mrp,
                    bomCost,
                    totalCost: Math.round(totalCost * 100) / 100,
                    marginPct,
                });
            }
        }
        return skus;
    }, [product]);

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
            {/* Cost Formula Explanation */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start gap-2">
                    <Info size={16} className="text-gray-500 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-medium text-gray-700">Cost Formula</h4>
                        <p className="text-xs text-gray-500 mt-1">
                            Total Cost = BOM Cost (fabric + trims + services)
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
