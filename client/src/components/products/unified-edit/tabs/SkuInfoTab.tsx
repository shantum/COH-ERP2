/**
 * SkuInfoTab - Basic SKU information editing
 */

import { Controller, type UseFormReturn } from 'react-hook-form';
import type { SkuFormData, SkuDetailData } from '../types';
import { SIZE_ORDER } from '../../types';

interface SkuInfoTabProps {
  form: UseFormReturn<SkuFormData>;
  sku: SkuDetailData;
  disabled?: boolean;
}

export function SkuInfoTab({ form, sku, disabled = false }: SkuInfoTabProps) {
  const { control, formState: { errors } } = form;

  return (
    <div className="space-y-4">
      {/* SKU Code (read-only) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          SKU Code
        </label>
        <input
          type="text"
          value={sku.skuCode}
          disabled
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 font-mono"
        />
        <p className="mt-1 text-xs text-gray-500">SKU codes are auto-generated and cannot be changed.</p>
      </div>

      {/* Size */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Size <span className="text-red-500">*</span>
        </label>
        <Controller
          name="size"
          control={control}
          rules={{ required: 'Size is required' }}
          render={({ field }) => (
            <select
              {...field}
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            >
              <option value="">Select size...</option>
              {SIZE_ORDER.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          )}
        />
        {errors.size && (
          <p className="mt-1 text-xs text-red-600">{errors.size.message}</p>
        )}
      </div>

      {/* MRP */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          MRP (Maximum Retail Price)
        </label>
        <Controller
          name="mrp"
          control={control}
          render={({ field }) => (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></span>
              <input
                type="number"
                step="1"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
                disabled={disabled}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                placeholder="e.g., 1299"
              />
            </div>
          )}
        />
      </div>

      {/* Target Stock Qty */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Target Stock Quantity
        </label>
        <Controller
          name="targetStockQty"
          control={control}
          render={({ field }) => (
            <input
              type="number"
              step="1"
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? null : parseInt(e.target.value))}
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g., 50"
            />
          )}
        />
        <p className="mt-1 text-xs text-gray-500">Used for replenishment planning.</p>
      </div>

      {/* Active Status */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <input
              type="checkbox"
              checked={field.value}
              onChange={field.onChange}
              disabled={disabled}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
          )}
        />
        <label className="text-sm text-gray-700">Active</label>
      </div>
    </div>
  );
}
