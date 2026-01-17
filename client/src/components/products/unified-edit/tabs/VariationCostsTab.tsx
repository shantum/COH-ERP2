/**
 * VariationCostsTab - Variation-level costs with inheritance
 */

import { type UseFormReturn } from 'react-hook-form';
import { Info } from 'lucide-react';
import type { VariationFormData, CostCascade } from '../types';
import { CostInheritanceField } from '../shared/CostInheritanceField';

interface VariationCostsTabProps {
  form: UseFormReturn<VariationFormData>;
  costCascade: CostCascade;
  disabled?: boolean;
}

export function VariationCostsTab({
  form,
  costCascade,
  disabled = false,
}: VariationCostsTabProps) {
  const { control, watch } = form;
  const hasLining = watch('hasLining');

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Variation-level costs</p>
          <p className="text-blue-600 mt-0.5">
            Leave empty to inherit from product. Set a value to override.
          </p>
        </div>
      </div>

      {/* Cost fields */}
      <div className="space-y-4">
        <CostInheritanceField
          name="laborMinutes"
          label="Labor Time (mins)"
          control={control}
          cascade={costCascade.laborMinutes}
          step="1"
          level="variation"
          disabled={disabled}
        />

        <CostInheritanceField
          name="trimsCost"
          label="Trims Cost"
          control={control}
          cascade={costCascade.trimsCost}
          unit=""
          level="variation"
          disabled={disabled}
        />

        <CostInheritanceField
          name="packagingCost"
          label="Packaging Cost"
          control={control}
          cascade={costCascade.packagingCost}
          unit=""
          level="variation"
          disabled={disabled}
        />

        {/* Lining cost - only show if hasLining is true */}
        {hasLining && (
          <CostInheritanceField
            name="liningCost"
            label="Lining Cost"
            control={control}
            cascade={costCascade.liningCost}
            unit=""
            level="variation"
            disabled={disabled}
          />
        )}
      </div>

      {/* Cascade explanation */}
      <div className="text-xs text-gray-500 pt-4 border-t">
        <p><strong>Inheritance:</strong></p>
        <ul className="list-disc list-inside mt-1 space-y-0.5">
          <li>Empty values inherit from product defaults</li>
          <li>Set a value to override for this variation</li>
          <li>SKUs can further override these values</li>
        </ul>
      </div>
    </div>
  );
}
