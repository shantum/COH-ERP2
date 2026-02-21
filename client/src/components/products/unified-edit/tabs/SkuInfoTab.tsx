/**
 * SkuInfoTab - Basic SKU information editing
 */

import { useState, useCallback } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { Check, Loader2 } from 'lucide-react';
import type { SkuFormData, SkuDetailData, ProductDetailData } from '../types';
import { updateStyleCode } from '../../../../server/functions/productsMutations';

interface SkuInfoTabProps {
  form: UseFormReturn<SkuFormData>;
  sku: SkuDetailData;
  product: ProductDetailData;
  disabled?: boolean;
}

export function SkuInfoTab({ form, sku, product, disabled = false }: SkuInfoTabProps) {
  const { control } = form;

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

      {/* Style Code (product-level, saved independently) */}
      <StyleCodeField productId={product.id} initialValue={product.styleCode} disabled={disabled} />

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

    </div>
  );
}

/**
 * Inline style code editor — saves directly to product via updateStyleCode
 */
function StyleCodeField({
  productId,
  initialValue,
  disabled,
}: {
  productId: string;
  initialValue: string | null;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed === (initialValue ?? '')) return;
    setSaving(true);
    const result = await updateStyleCode({ data: { id: productId, styleCode: trimmed || null } });
    setSaving(false);
    if (result.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [value, initialValue, productId]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Style Code
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          disabled={disabled || saving}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          placeholder="e.g., KR-001"
        />
        {saving && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
        {saved && (
          <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" />
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">Applies to all SKUs of this product. Saves on blur.</p>
    </div>
  );
}
