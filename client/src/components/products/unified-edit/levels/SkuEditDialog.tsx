/**
 * SkuEditDialog - SKU-level editing dialog
 */

import { useState } from 'react';
import { Box, AlertCircle, X } from 'lucide-react';
import { useSkuEditForm } from '../hooks/useSkuEditForm';
import { SkuInfoTab } from '../tabs/SkuInfoTab';
import { SkuCostsTab } from '../tabs/SkuCostsTab';
import { SkuInventoryTab } from '../tabs/SkuInventoryTab';
import { EditDialogFooter, UnsavedIndicator } from '../shared/EditDialogFooter';
import { ColorSwatch } from '../shared/FabricSelector';
import type { SkuTabId, SkuDetailData, VariationDetailData, ProductDetailData } from '../types';

interface SkuEditDialogProps {
  sku: SkuDetailData;
  variation: VariationDetailData;
  product: ProductDetailData;
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
  onSuccess?: () => void;
}

const TABS: { id: SkuTabId; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'costs', label: 'Costs' },
  { id: 'inventory', label: 'Inventory' },
];

export function SkuEditDialog({
  sku,
  variation,
  product,
  isActive,
  onBack,
  onClose,
  onSuccess,
}: SkuEditDialogProps) {
  const [activeTab, setActiveTab] = useState<SkuTabId>('info');
  const [error, setError] = useState<string | null>(null);

  const {
    form,
    costCascade,
    isSaving,
    isDirty,
    isValid,
    handleSubmit,
  } = useSkuEditForm({
    sku,
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

  if (!isActive) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 text-teal-600 rounded-lg">
            <Box size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center px-2 py-0.5 bg-gray-100 rounded text-sm font-medium">
                {sku.size}
              </span>
              <span className="font-mono text-sm text-gray-500">{sku.skuCode}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{product.name}</span>
              <span>/</span>
              <span className="flex items-center gap-1">
                <ColorSwatch color={variation.colorHex} size="sm" />
                {variation.colorName}
              </span>
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
                ? 'border-teal-500 text-teal-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto py-4">
        {activeTab === 'info' && (
          <SkuInfoTab form={form} sku={sku} disabled={isSaving} />
        )}
        {activeTab === 'costs' && (
          <SkuCostsTab
            form={form}
            costCascade={costCascade}
            variation={variation}
            disabled={isSaving}
          />
        )}
        {activeTab === 'inventory' && (
          <SkuInventoryTab sku={sku} />
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
