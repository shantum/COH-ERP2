/**
 * ProductVariationsTab - List of variations with navigation
 */

import { ChevronRight } from 'lucide-react';
import type { VariationDetailData } from '../types';
import { ColorSwatch } from '../shared/FabricSelector';

interface ProductVariationsTabProps {
  variations: VariationDetailData[];
  onNavigate: (variationId: string, variationName: string) => void;
}

export function ProductVariationsTab({ variations, onNavigate }: ProductVariationsTabProps) {
  if (variations.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No variations yet.</p>
        <p className="text-sm mt-1">Variations are created when products are synced from Shopify.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500 mb-4">
        Click a variation to edit its details.
      </p>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Color</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Fabric</th>
              <th className="text-center px-4 py-2 font-medium text-gray-600">Lining</th>
              <th className="text-center px-4 py-2 font-medium text-gray-600">SKUs</th>
              <th className="text-center px-4 py-2 font-medium text-gray-600">Status</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {variations.map((variation) => (
              <tr
                key={variation.id}
                onClick={() => onNavigate(variation.id, variation.colorName)}
                className="hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ColorSwatch color={variation.colorHex} size="md" />
                    <span className="font-medium">{variation.colorName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {variation.fabricName || <span className="text-gray-400">-</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  {variation.hasLining ? (
                    <span className="text-green-600">Yes</span>
                  ) : (
                    <span className="text-gray-400">No</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center min-w-[24px] px-2 py-0.5 bg-gray-100 rounded-full text-xs font-medium">
                    {variation.skus?.length || 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {variation.isActive ? (
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
