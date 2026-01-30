/**
 * VariationFabricTab - Read-only fabric information (set via BOM Editor)
 *
 * Fabric assignment is now managed through the BOM Editor.
 * This tab shows the current fabric from BOM and directs users
 * to the BOM Editor for changes.
 */

import { Info } from 'lucide-react';
import type { FabricColour } from '../types';

interface VariationFabricTabProps {
  fabricColours: FabricColour[];
  currentFabricColourId?: string | null;
  currentFabricColourName?: string | null;
  currentMaterialName?: string | null;
}

export function VariationFabricTab({
  fabricColours,
  currentFabricColourId,
  currentFabricColourName,
  currentMaterialName,
}: VariationFabricTabProps) {
  const selectedFabricColour = currentFabricColourId
    ? fabricColours.find(fc => fc.id === currentFabricColourId)
    : null;

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Fabric is set via BOM Editor</p>
          <p className="mt-1 text-blue-600">
            To change the fabric for this variation, use the{' '}
            <span className="font-medium">BOM Editor</span> tab on the Products page
            or the <span className="font-medium">Fabric Mapping</span> tab for bulk assignment.
          </p>
        </div>
      </div>

      {/* Current fabric info */}
      {selectedFabricColour ? (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Current Fabric Assignment</h4>
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
      ) : currentFabricColourName ? (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Current Fabric Assignment</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Colour:</span>
              <span className="ml-2 font-medium">{currentFabricColourName}</span>
            </div>
            {currentMaterialName && (
              <div>
                <span className="text-gray-500">Material:</span>
                <span className="ml-2 font-medium">{currentMaterialName}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-amber-200 rounded-lg p-4 bg-amber-50">
          <p className="text-sm text-amber-700 font-medium">No fabric assigned</p>
          <p className="text-sm text-amber-600 mt-1">
            Use the BOM Editor or Fabric Mapping tab to assign a fabric colour.
          </p>
        </div>
      )}
    </div>
  );
}
