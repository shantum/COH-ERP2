/**
 * ProductCostsTab - Product-level cost defaults
 */

import { Controller, type UseFormReturn } from 'react-hook-form';
import { Info } from 'lucide-react';
import type { ProductFormData } from '../types';
import { SimpleCostField } from '../shared/CostInheritanceField';

interface ProductCostsTabProps {
  form: UseFormReturn<ProductFormData>;
  disabled?: boolean;
}

export function ProductCostsTab({ form, disabled = false }: ProductCostsTabProps) {
  const { control } = form;

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Product-level defaults</p>
          <p className="text-blue-600 mt-0.5">
            Values set here are inherited by variations and SKUs unless overridden.
          </p>
        </div>
      </div>

      {/* Production settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">Production Settings</h4>

        <div className="grid grid-cols-2 gap-4">
          <SimpleCostField
            name="baseProductionTimeMins"
            label="Base Production Time (mins)"
            control={control}
            defaultValue={60}
            step="1"
            placeholder="60"
            disabled={disabled}
          />

          <SimpleCostField
            name="defaultFabricConsumption"
            label="Default Fabric Consumption (m)"
            control={control}
            defaultValue={1.5}
            step="0.1"
            placeholder="1.5"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Cost defaults */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">Cost Defaults</h4>

        <div className="grid grid-cols-2 gap-4">
          <SimpleCostField
            name="trimsCost"
            label="Trims Cost"
            control={control}
            defaultValue={0}
            unit=""
            step="0.01"
            disabled={disabled}
          />

          <SimpleCostField
            name="packagingCost"
            label="Packaging Cost"
            control={control}
            defaultValue={50}
            unit=""
            step="0.01"
            disabled={disabled}
          />
        </div>

        <SimpleCostField
          name="liningCost"
          label="Lining Cost"
          control={control}
          defaultValue={0}
          unit=""
          step="0.01"
          disabled={disabled}
        />
      </div>

      {/* Cascade explanation */}
      <div className="text-xs text-gray-500 pt-2 border-t">
        <p><strong>Cost cascade:</strong> SKU → Variation → Product → System default</p>
        <p className="mt-1">
          If a SKU doesn't have a value, it uses the variation's value. If the variation doesn't have one, it uses this product's value.
        </p>
      </div>
    </div>
  );
}
