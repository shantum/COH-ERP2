/**
 * SkuCostsTab - SKU-level costs with full cascade visualization
 */

import { type UseFormReturn } from 'react-hook-form';
import { Info } from 'lucide-react';
import type { SkuFormData, CostCascade } from '../types';
import { CostInheritanceField } from '../shared/CostInheritanceField';

interface SkuCostsTabProps {
  form: UseFormReturn<SkuFormData>;
  costCascade: CostCascade;
  bomCost: number | null;
  disabled?: boolean;
}

export function SkuCostsTab({
  form,
  costCascade,
  bomCost,
  disabled = false,
}: SkuCostsTabProps) {
  const { control } = form;

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">SKU-level costs</p>
          <p className="text-blue-600 mt-0.5">
            These values override variation and product defaults. Clear to inherit.
          </p>
        </div>
      </div>

      {/* BOM Cost (read-only) */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">BOM Cost</h4>
        <div className="bg-gray-50 rounded-lg p-3 border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Fabric + Trims + Services (from BOM)</span>
            <span className="text-sm font-medium text-gray-900">
              {bomCost != null ? `₹${bomCost.toFixed(0)}` : 'Not set'}
            </span>
          </div>
        </div>
      </div>

      {/* Fabric consumption */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">Fabric</h4>
        <CostInheritanceField
          name="fabricConsumption"
          label="Fabric Consumption (meters)"
          control={control}
          cascade={costCascade.fabricConsumption}
          step="0.1"
          level="sku"
          disabled={disabled}
        />
      </div>

      {/* Labor */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">Labor</h4>
        <CostInheritanceField
          name="laborMinutes"
          label="Labor Time (mins)"
          control={control}
          cascade={costCascade.laborMinutes}
          step="1"
          level="sku"
          disabled={disabled}
        />
      </div>

      {/* Packaging */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-900">Packaging</h4>
        <CostInheritanceField
          name="packagingCost"
          label="Packaging Cost"
          control={control}
          cascade={costCascade.packagingCost}
          unit=""
          level="sku"
          disabled={disabled}
        />
      </div>

      {/* Cascade visualization */}
      <div className="pt-4 border-t">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Cost Cascade</h4>
        <div className="text-xs space-y-1.5">
          <CascadeRow
            label="Packaging"
            cascade={costCascade.packagingCost}
          />
          <CascadeRow
            label="Labor"
            cascade={costCascade.laborMinutes}
            suffix=" mins"
          />
          <CascadeRow
            label="Fabric"
            cascade={costCascade.fabricConsumption}
            suffix="m"
          />
        </div>
      </div>
    </div>
  );
}

function CascadeRow({
  label,
  cascade,
  suffix = '',
}: {
  label: string;
  cascade: CostCascade[keyof CostCascade];
  suffix?: string;
}) {
  const sourceColors = {
    sku: 'bg-blue-100 text-blue-700',
    variation: 'bg-purple-100 text-purple-700',
    product: 'bg-indigo-100 text-indigo-700',
    default: 'bg-gray-100 text-gray-600',
    none: 'bg-gray-50 text-gray-400',
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-gray-500">{label}:</span>
      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${sourceColors[cascade.source]}`}>
        {cascade.effectiveValue != null ? `${cascade.effectiveValue}${suffix}` : 'none'}
      </span>
      <span className="text-gray-400">
        ({cascade.source})
      </span>
    </div>
  );
}
