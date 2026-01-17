/**
 * VariationFabricTab - Fabric selection for variation
 */

import { type UseFormReturn } from 'react-hook-form';
import { Info } from 'lucide-react';
import type { VariationFormData, Fabric } from '../types';
import { FabricSelector } from '../shared/FabricSelector';

interface VariationFabricTabProps {
  form: UseFormReturn<VariationFormData>;
  fabrics: Fabric[];
  fabricTypeId?: string | null;
  disabled?: boolean;
}

export function VariationFabricTab({
  form,
  fabrics,
  fabricTypeId,
  disabled = false,
}: VariationFabricTabProps) {
  const { control, watch } = form;
  const selectedFabricId = watch('fabricId');
  const selectedFabric = fabrics.find(f => f.id === selectedFabricId);

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p>
            Select the specific fabric color for this variation.
            {fabricTypeId && ' Fabrics are filtered to match the product\'s fabric type.'}
          </p>
        </div>
      </div>

      {/* Fabric Selector */}
      <FabricSelector
        name="fabricId"
        label="Fabric"
        control={control}
        fabrics={fabrics}
        fabricTypeId={fabricTypeId}
        disabled={disabled}
        placeholder="Select a fabric color..."
      />

      {/* Selected fabric details */}
      {selectedFabric && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Selected Fabric</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Name:</span>
              <span className="ml-2 font-medium">{selectedFabric.name}</span>
            </div>
            {selectedFabric.colorName && (
              <div>
                <span className="text-gray-500">Color:</span>
                <span className="ml-2 font-medium">{selectedFabric.colorName}</span>
              </div>
            )}
            {selectedFabric.costPerUnit && (
              <div>
                <span className="text-gray-500">Cost:</span>
                <span className="ml-2 font-medium">{selectedFabric.costPerUnit}/m</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No fabric warning */}
      {!selectedFabricId && (
        <p className="text-sm text-amber-600">
          No fabric selected. COGS calculation may be incomplete.
        </p>
      )}
    </div>
  );
}
