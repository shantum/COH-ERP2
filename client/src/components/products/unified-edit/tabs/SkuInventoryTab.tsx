/**
 * SkuInventoryTab - SKU inventory display (read-only)
 */

import { Package, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SkuDetailData } from '../types';

interface SkuInventoryTabProps {
  sku: SkuDetailData;
}

export function SkuInventoryTab({ sku }: SkuInventoryTabProps) {
  const currentBalance = sku.currentBalance ?? 0;
  const targetStock = sku.targetStockQty ?? 0;
  const stockDiff = targetStock > 0 ? currentBalance - targetStock : 0;
  const stockStatus =
    targetStock === 0 ? 'neutral' :
    currentBalance >= targetStock ? 'good' :
    currentBalance >= targetStock * 0.5 ? 'warning' :
    'low';

  const statusColors = {
    good: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    low: 'bg-red-100 text-red-700',
    neutral: 'bg-gray-100 text-gray-600',
  };

  const statusLabels = {
    good: 'In Stock',
    warning: 'Low Stock',
    low: 'Critical',
    neutral: 'No Target',
  };

  return (
    <div className="space-y-6">
      {/* Current inventory card */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-gray-700">Current Inventory</h4>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[stockStatus]}`}>
            {statusLabels[stockStatus]}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">
              {currentBalance}
            </div>
            <div className="text-xs text-gray-500 mt-1">Current Stock</div>
          </div>

          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">
              {targetStock || '-'}
            </div>
            <div className="text-xs text-gray-500 mt-1">Target Stock</div>
          </div>

          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className={`text-2xl font-bold ${
              stockDiff > 0 ? 'text-green-600' :
              stockDiff < 0 ? 'text-red-600' :
              'text-gray-600'
            }`}>
              <span className="flex items-center justify-center gap-1">
                {stockDiff > 0 ? <TrendingUp size={16} /> :
                 stockDiff < 0 ? <TrendingDown size={16} /> :
                 <Minus size={16} />}
                {Math.abs(stockDiff)}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-1">vs Target</div>
          </div>
        </div>
      </div>

      {/* SKU details */}
      <div className="border rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">SKU Details</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500">SKU Code:</span>
            <span className="ml-2 font-mono text-xs">{sku.skuCode}</span>
          </div>
          <div>
            <span className="text-gray-500">Size:</span>
            <span className="ml-2 font-medium">{sku.size}</span>
          </div>
          {sku.mrp && (
            <div>
              <span className="text-gray-500">MRP:</span>
              <span className="ml-2 font-medium">{sku.mrp}</span>
            </div>
          )}
        </div>
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2 p-3 bg-gray-50 border rounded-lg text-sm text-gray-600">
        <Package size={16} className="mt-0.5 flex-shrink-0 text-gray-400" />
        <div>
          <p>
            Inventory is managed through the Inventory module.
            This view shows current stock levels for reference.
          </p>
        </div>
      </div>
    </div>
  );
}
