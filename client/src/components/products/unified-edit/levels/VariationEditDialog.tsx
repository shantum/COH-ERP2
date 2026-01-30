/**
 * VariationEditDialog - Variation-level editing dialog
 */

import { useState } from 'react';
import { Palette, AlertCircle, X } from 'lucide-react';
import { useVariationEditForm } from '../hooks/useVariationEditForm';
import { VariationInfoTab } from '../tabs/VariationInfoTab';
import { VariationSkusTab } from '../tabs/VariationSkusTab';
import { VariationFabricTab } from '../tabs/VariationFabricTab';
import { VariationCostsTab } from '../tabs/VariationCostsTab';
import { EditDialogFooter, UnsavedIndicator } from '../shared/EditDialogFooter';
import { ColorSwatch } from '../shared/FabricSelector';
import type { VariationTabId, EditLevel, VariationDetailData, ProductDetailData, FabricColour } from '../types';

interface VariationEditDialogProps {
  variation: VariationDetailData;
  product: ProductDetailData;
  fabricColours: FabricColour[];
  isActive: boolean;
  onNavigate: (level: EditLevel, id: string, name: string) => void;
  onBack: () => void;
  onClose: () => void;
  onSuccess?: () => void;
}

const TABS: { id: VariationTabId; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'skus', label: 'SKUs' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'costs', label: 'Costs' },
];

export function VariationEditDialog({
  variation,
  product,
  fabricColours,
  isActive,
  onNavigate,
  onBack,
  onClose,
  onSuccess,
}: VariationEditDialogProps) {
  const [activeTab, setActiveTab] = useState<VariationTabId>('info');
  const [error, setError] = useState<string | null>(null);

  const {
    form,
    costCascade,
    isSaving,
    isDirty,
    isValid,
    handleSubmit,
  } = useVariationEditForm({
    variation,
    product,
    onSuccess: () => {
      setError(null);
      onSuccess?.();
    },
    onError: (err) => {
      setError(err.message || 'Failed to save changes');
    },
  });

  const handleSkuNavigate = (skuId: string, skuName: string) => {
    onNavigate('sku', skuId, skuName);
  };

  if (!isActive) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
            <Palette size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <ColorSwatch color={variation.colorHex} size="md" />
              <h2 className="text-lg font-semibold text-gray-900">{variation.colorName}</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{product.name}</span>
              <UnsavedIndicator show={isDirty} />
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <X size={20} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mt-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.id === 'skus' && variation.skus?.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                {variation.skus.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto py-4">
        {activeTab === 'info' && (
          <VariationInfoTab form={form} disabled={isSaving} />
        )}
        {activeTab === 'skus' && (
          <VariationSkusTab
            skus={variation.skus || []}
            onNavigate={handleSkuNavigate}
          />
        )}
        {activeTab === 'fabric' && (
          <VariationFabricTab
            fabricColours={fabricColours}
            currentFabricColourId={variation.fabricColourId}
            currentFabricColourName={variation.fabricColourName}
            currentMaterialName={variation.materialName}
          />
        )}
        {activeTab === 'costs' && (
          <VariationCostsTab
            form={form}
            costCascade={costCascade}
            disabled={isSaving}
          />
        )}
      </div>

      {/* Footer */}
      <EditDialogFooter
        onSave={handleSubmit}
        onCancel={onClose}
        onBack={onBack}
        canGoBack={true}
        isSaving={isSaving}
        isDirty={isDirty}
        isValid={isValid}
      />
    </div>
  );
}
