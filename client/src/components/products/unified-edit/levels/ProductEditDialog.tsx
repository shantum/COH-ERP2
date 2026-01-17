/**
 * ProductEditDialog - Product-level editing dialog
 */

import { useState } from 'react';
import { Package, Loader2, AlertCircle, X } from 'lucide-react';
import { useProductEditForm } from '../hooks/useProductEditForm';
import { ProductInfoTab } from '../tabs/ProductInfoTab';
import { ProductVariationsTab } from '../tabs/ProductVariationsTab';
import { ProductCostsTab } from '../tabs/ProductCostsTab';
import { ProductBomTab } from '../tabs/ProductBomTab';
import { EditDialogFooter, UnsavedIndicator } from '../shared/EditDialogFooter';
import type { ProductTabId, EditLevel } from '../types';

interface ProductEditDialogProps {
  productId: string;
  isActive: boolean;
  onNavigate: (level: EditLevel, id: string, name: string) => void;
  onClose: () => void;
  onSuccess?: () => void;
}

const TABS: { id: ProductTabId; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'variations', label: 'Variations' },
  { id: 'costs', label: 'Costs' },
  { id: 'bom', label: 'BOM' },
];

export function ProductEditDialog({
  productId,
  isActive,
  onNavigate,
  onClose,
  onSuccess,
}: ProductEditDialogProps) {
  const [activeTab, setActiveTab] = useState<ProductTabId>('info');
  const [error, setError] = useState<string | null>(null);

  const {
    form,
    product,
    filters,
    isLoading,
    isSaving,
    isDirty,
    isValid,
    handleSubmit,
  } = useProductEditForm({
    productId,
    onSuccess: () => {
      setError(null);
      onSuccess?.();
    },
    onError: (err) => {
      setError(err.message || 'Failed to save changes');
    },
  });

  const handleVariationNavigate = (variationId: string, variationName: string) => {
    onNavigate('variation', variationId, variationName);
  };

  if (!isActive) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        Product not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <Package size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{product.name}</h2>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {product.styleCode && <span>{product.styleCode}</span>}
              {product.category && (
                <>
                  <span>·</span>
                  <span>{product.category}</span>
                </>
              )}
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
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.id === 'variations' && product.variations?.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                {product.variations.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto py-4">
        {activeTab === 'info' && (
          <ProductInfoTab form={form} filters={filters} disabled={isSaving} />
        )}
        {activeTab === 'variations' && (
          <ProductVariationsTab
            variations={product.variations || []}
            onNavigate={handleVariationNavigate}
          />
        )}
        {activeTab === 'costs' && (
          <ProductCostsTab form={form} disabled={isSaving} />
        )}
        {activeTab === 'bom' && (
          <ProductBomTab
            productId={productId}
            productName={product.name}
          />
        )}
      </div>

      {/* Footer */}
      <EditDialogFooter
        onSave={handleSubmit}
        onCancel={onClose}
        canGoBack={false}
        isSaving={isSaving}
        isDirty={isDirty}
        isValid={isValid}
      />
    </div>
  );
}
