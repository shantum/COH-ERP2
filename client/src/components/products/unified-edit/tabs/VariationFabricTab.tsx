/**
 * VariationFabricTab - Fabric colour selection for variation
 */

import { type UseFormReturn } from 'react-hook-form';
import { Info } from 'lucide-react';
import type { VariationFormData, FabricColour } from '../types';
import { FabricSelector } from '../shared/FabricSelector';

interface VariationFabricTabProps {
  form: UseFormReturn<VariationFormData>;
  fabricColours: FabricColour[];
  materialId?: string | null;
  disabled?: boolean;
}

export function VariationFabricTab({
  form,
  fabricColours,
  materialId,
  disabled = false,
}: VariationFabricTabProps) {
  const { control, watch } = form;
  const selectedFabricColourId = watch('fabricColourId');
  const selectedFabricColour = fabricColours.find(fc => fc.id === selectedFabricColourId);

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p>
            Select the specific fabric colour for this variation.
            {materialId && ' Colours are filtered to match the product\'s material type.'}
          </p>
        </div>
      </div>

      {/* Fabric Colour Selector */}
      <FabricSelector
        name="fabricColourId"
        label="Fabric Colour"
        control={control}
        fabricColours={fabricColours}
        materialId={materialId}
        disabled={disabled}
        placeholder="Select a fabric colour..."
      />

      {/* Selected fabric colour details */}
      {selectedFabricColour && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Selected Fabric Colour</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Colour:</span>
              <span className="ml-2 font-medium">{selectedFabricColour.name}</span>
            </div>
            <div>
              <span className="text-gray-500">Material:</span>
              <span className="ml-2 font-medium">{selectedFabricColour.materialName}</span>
            </div>
            <div>
              <span className="text-gray-500">Fabric:</span>
              <span className="ml-2 font-medium">{selectedFabricColour.fabricName}</span>
            </div>
            {selectedFabricColour.costPerUnit && (
              <div>
                <span className="text-gray-500">Cost:</span>
                <span className="ml-2 font-medium">₹{selectedFabricColour.costPerUnit}/m</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No fabric colour warning */}
      {!selectedFabricColourId && (
        <p className="text-sm text-amber-600">
          No fabric colour selected. COGS calculation may be incomplete.
        </p>
      )}
    </div>
  );
}
