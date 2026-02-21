/**
 * SkuCostsTab - SKU-level cost display (read-only, from BOM)
 */

import { Info } from 'lucide-react';

interface SkuCostsTabProps {
  bomCost: number | null;
}

export function SkuCostsTab({
  bomCost,
}: SkuCostsTabProps) {
  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">SKU-level costs</p>
          <p className="text-blue-600 mt-0.5">
            Costs are computed from the BOM (Bill of Materials).
          </p>
        </div>
      </div>

      {/* BOM Cost (read-only) */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">BOM Cost</h4>
        <div className="bg-gray-50 rounded-lg p-3 border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Fabric + Trims + Labor + Packaging (from BOM)</span>
            <span className="text-sm font-medium text-gray-900">
              {bomCost != null ? `₹${bomCost.toFixed(0)}` : 'Not set'}
            </span>
          </div>
        </div>
      </div>

      {/* Info note */}
      <div className="text-xs text-gray-500 pt-4 border-t">
        <p><strong>Note:</strong> All cost components (fabric, trims, labor, packaging) are managed through the BOM editor.</p>
      </div>
    </div>
  );
}
