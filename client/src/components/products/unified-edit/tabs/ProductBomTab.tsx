/**
 * ProductBomTab - BOM template placeholder
 *
 * Note: Full BOM editing is handled in the separate BOM Editor.
 * This tab provides a summary view and link to the editor.
 */

import { ExternalLink, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProductBomTabProps {
  productId: string;
  productName: string;
  onOpenBomEditor?: () => void;
}

export function ProductBomTab({ productId, productName, onOpenBomEditor }: ProductBomTabProps) {
  return (
    <div className="space-y-4">
      {/* Info */}
      <div className="flex items-start gap-3 p-4 bg-gray-50 border rounded-lg">
        <Package size={20} className="text-gray-400 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-medium text-gray-900">Bill of Materials</h4>
          <p className="text-sm text-gray-600 mt-1">
            The BOM defines the materials, trims, and services required to produce this product.
            Edit the BOM using the dedicated BOM Editor for full control.
          </p>
        </div>
      </div>

      {/* Quick summary placeholder */}
      <div className="border rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">BOM Summary</h4>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-semibold text-gray-900">-</div>
            <div className="text-xs text-gray-500 mt-1">Fabrics</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-semibold text-gray-900">-</div>
            <div className="text-xs text-gray-500 mt-1">Trims</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-semibold text-gray-900">-</div>
            <div className="text-xs text-gray-500 mt-1">Services</div>
          </div>
        </div>
      </div>

      {/* Open BOM Editor button */}
      {onOpenBomEditor && (
        <Button
          variant="outline"
          onClick={onOpenBomEditor}
          className="w-full gap-2"
        >
          <ExternalLink size={16} />
          Open BOM Editor
        </Button>
      )}

      {/* Note */}
      <p className="text-xs text-gray-500 text-center">
        BOM templates are set at the product level and can be customized per variation.
      </p>
    </div>
  );
}
