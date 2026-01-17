/**
 * ProductSkusTab - SKU listing with inventory for a product
 */

import type { ProductTreeNode } from '../types';
import { sortBySizeOrder } from '../types';

interface ProductSkusTabProps {
    product: ProductTreeNode;
}

export function ProductSkusTab({ product }: ProductSkusTabProps) {
    // Flatten all SKUs from all variations
    const skus = product.children?.flatMap(variation =>
        (variation.children || []).map(sku => ({
            ...sku,
            variationName: variation.colorName || variation.name,
            variationColor: variation.colorHex,
        }))
    ) || [];

    // Sort by variation then by size
    const sortedSkus = [...skus].sort((a, b) => {
        if (a.variationName !== b.variationName) {
            return (a.variationName || '').localeCompare(b.variationName || '');
        }
        return sortBySizeOrder(a.size || '', b.size || '');
    });

    if (sortedSkus.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-sm text-gray-500">No SKUs found</p>
                <p className="text-xs text-gray-400 mt-1">
                    Add variations and SKUs to see them here
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{sortedSkus.length} SKUs</span>
                <span>•</span>
                <span>Total stock: {sortedSkus.reduce((sum, sku) => sum + (sku.currentBalance || 0), 0).toLocaleString()}</span>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Variation</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU Code</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">MRP</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Stock</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {sortedSkus.map((sku) => (
                            <tr key={sku.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        {sku.variationColor && (
                                            <span
                                                className="w-3 h-3 rounded-full border border-gray-300"
                                                style={{ backgroundColor: sku.variationColor }}
                                            />
                                        )}
                                        <span className="text-gray-900">{sku.variationName}</span>
                                    </div>
                                </td>
                                <td className="px-3 py-2">
                                    <span className="font-medium text-gray-700">{sku.size}</span>
                                </td>
                                <td className="px-3 py-2">
                                    <span className="text-gray-500 font-mono text-xs">{sku.skuCode}</span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <span className="tabular-nums">
                                        {sku.mrp ? `₹${sku.mrp.toLocaleString()}` : '-'}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <StockBadge stock={sku.currentBalance} target={sku.targetStockQty} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StockBadge({ stock, target }: { stock?: number; target?: number }) {
    const value = stock || 0;
    let color = 'text-gray-600';

    if (value <= 0) {
        color = 'text-red-600 font-medium';
    } else if (target && value < target * 0.5) {
        color = 'text-amber-600';
    } else if (value > 0) {
        color = 'text-green-600';
    }

    return (
        <span className={`tabular-nums ${color}`}>
            {value.toLocaleString()}
        </span>
    );
}
