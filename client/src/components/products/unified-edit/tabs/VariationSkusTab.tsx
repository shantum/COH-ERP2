/**
 * VariationSkusTab - List of SKUs with navigation
 */

import { ChevronRight, Package } from 'lucide-react';
import type { SkuDetailData } from '../types';
import { sortBySizeOrder } from '@coh/shared/config/product';

interface VariationSkusTabProps {
  skus: SkuDetailData[];
  onNavigate: (skuId: string, skuName: string) => void;
}

export function VariationSkusTab({ skus, onNavigate }: VariationSkusTabProps) {
  // Sort SKUs by size order
  const sortedSkus = [...skus].sort((a, b) => sortBySizeOrder(a.size, b.size));

  if (sortedSkus.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Package size={32} className="mx-auto mb-2 text-gray-300" />
        <p>No SKUs yet.</p>
        <p className="text-sm mt-1">SKUs are created when products are synced from Shopify.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500 mb-4">
        Click a SKU to edit its details.
      </p>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Size</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">SKU Code</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">MRP</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">BOM Cost</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Stock</th>
              <th className="text-center px-4 py-2 font-medium text-gray-600">Status</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedSkus.map((sku) => (
              <tr
                key={sku.id}
                onClick={() => onNavigate(sku.id, `${sku.size} (${sku.skuCode})`)}
                className="hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <span className="inline-flex items-center justify-center min-w-[32px] px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">
                    {sku.size}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-600">{sku.skuCode}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  {sku.mrp != null ? (
                    <span className="font-medium">{sku.mrp}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {sku.bomCost != null ? (
                    <span>{sku.bomCost.toFixed(2)}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={sku.currentBalance > 0 ? 'text-green-600' : 'text-gray-400'}>
                    {sku.currentBalance ?? 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {sku.isActive ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ChevronRight size={16} className="text-gray-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
