/**
 * VariationBomTab - Inline BOM display for Variation detail panel
 *
 * Shows the variation's fabric assignment and any BOM overrides.
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Palette, Scissors } from 'lucide-react';
import { bomApi } from '../../../services/api';
import type { ProductTreeNode } from '../types';

interface VariationBomTabProps {
    variation: ProductTreeNode;
}

export function VariationBomTab({ variation }: VariationBomTabProps) {
    // Fetch BOM data for the parent product
    const { data: bomData, isLoading, error } = useQuery({
        queryKey: ['productBom', variation.productId],
        queryFn: () => bomApi.getProductBom(variation.productId!).then(r => r.data),
        enabled: !!variation.productId,
    });

    // Find this variation's BOM data
    const variationBom = bomData?.variations?.find((v: any) => v.variationId === variation.id);

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
            {/* Fabric Assignment */}
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-100">
                <div className="flex items-center gap-2 mb-3">
                    <Scissors size={16} className="text-purple-600" />
                    <h4 className="text-sm font-medium text-gray-700">Fabric Assignment</h4>
                </div>

                <div className="space-y-3">
                    {/* Main Fabric */}
                    <div className="bg-white rounded-lg p-3 border border-purple-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="text-xs text-gray-500 uppercase">Main Fabric</span>
                                <p className="text-sm font-medium text-gray-900 mt-0.5">
                                    {variation.fabricName || 'Not assigned'}
                                </p>
                            </div>
                            {variation.colorHex && (
                                <span
                                    className="w-8 h-8 rounded-full border-2 border-white shadow"
                                    style={{ backgroundColor: variation.colorHex }}
                                    title={variation.colorName}
                                />
                            )}
                        </div>
                    </div>

                    {/* Lining Fabric (if applicable) */}
                    {variation.hasLining && (
                        <div className="bg-white rounded-lg p-3 border border-purple-200">
                            <span className="text-xs text-gray-500 uppercase">Lining Fabric</span>
                            <p className="text-sm font-medium text-gray-900 mt-0.5">
                                {variationBom?.liningFabricColourName || 'Not assigned'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* BOM Overrides */}
            {variationBom?.overrides && variationBom.overrides.length > 0 ? (
                <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        Component Overrides
                    </h4>
                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Component</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Cost</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {variationBom.overrides.map((override: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-gray-900">
                                            {override.componentName || override.componentRole}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                            {override.quantity}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                                            ₹{(override.cost || 0).toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center py-6 border border-dashed border-gray-300 rounded-lg">
                    <Palette size={32} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-500">No component overrides</p>
                    <p className="text-xs text-gray-400 mt-1">
                        This variation uses the product template defaults
                    </p>
                </div>
            )}

            {/* Cost Summary for Variation */}
            {variationBom && (
                <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        Variation Cost Summary
                    </h4>
                    <div className="space-y-2">
                        <CostRow
                            label="Fabric Cost"
                            value={variationBom.fabricCost}
                        />
                        <CostRow
                            label="Trims Cost"
                            value={variation.trimsCost}
                            inherited={variation.trimsCost === null}
                        />
                        <CostRow
                            label="Lining Cost"
                            value={variation.hasLining ? variation.liningCost : null}
                            inherited={variation.liningCost === null}
                            show={variation.hasLining}
                        />
                        <div className="pt-2 border-t">
                            <CostRow
                                label="Total COGS"
                                value={variationBom.totalCost}
                                bold
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface CostRowProps {
    label: string;
    value?: number | null;
    inherited?: boolean;
    bold?: boolean;
    show?: boolean;
}

function CostRow({ label, value, inherited, bold, show = true }: CostRowProps) {
    if (!show) return null;

    return (
        <div className={`flex justify-between text-sm ${bold ? 'font-medium' : ''}`}>
            <span className="text-gray-500">
                {label}
                {inherited && <span className="text-gray-400 ml-1 text-[10px]">↑ inherited</span>}
            </span>
            <span className={bold ? 'text-gray-900' : 'text-gray-700'}>
                {value !== null && value !== undefined
                    ? `₹${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '-'
                }
            </span>
        </div>
    );
}
