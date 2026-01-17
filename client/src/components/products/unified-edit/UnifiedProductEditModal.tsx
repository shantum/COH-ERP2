/**
 * UnifiedProductEditModal - Main orchestrator for Product/Variation/SKU editing
 *
 * Uses dialog-stack to enable drill-down navigation:
 * Product → Variation → SKU
 *
 * Features:
 * - Stack-based navigation with visual depth indication
 * - Back button to return to previous level
 * - Unsaved changes warning
 * - Cost cascade visualization
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  DialogStack,
  DialogStackOverlay,
  DialogStackBody,
  DialogStackContent,
  useDialogStack,
} from '@/components/ui/dialog-stack';
import { productsApi, catalogApi } from '@/services/api';
import { ProductEditDialog } from './levels/ProductEditDialog';
import { VariationEditDialog } from './levels/VariationEditDialog';
import { SkuEditDialog } from './levels/SkuEditDialog';
import type {
  UnifiedProductEditModalProps,
  EditLevel,
  ProductDetailData,
  CatalogFilters,
} from './types';

interface StackEntry {
  level: EditLevel;
  id: string;
  name: string;
}

// Sync component to update DialogStack's activeIndex when our stack changes
function DialogStackIndexSync({ stackLength }: { stackLength: number }) {
  const { setActiveIndex } = useDialogStack();

  useEffect(() => {
    // Active index is 0-based, so stack length of 1 means index 0, etc.
    setActiveIndex(Math.max(0, stackLength - 1));
  }, [stackLength, setActiveIndex]);

  return null;
}

export function UnifiedProductEditModal({
  isOpen,
  onClose,
  initialLevel = 'product',
  productId,
  variationId,
  skuId,
  onSuccess,
}: UnifiedProductEditModalProps) {
  // Navigation stack
  const [stack, setStack] = useState<StackEntry[]>(() => {
    // Initialize stack based on initial level
    const entries: StackEntry[] = [];
    if (productId) {
      entries.push({ level: 'product', id: productId, name: '' });
    }
    if (variationId && initialLevel !== 'product') {
      entries.push({ level: 'variation', id: variationId, name: '' });
    }
    if (skuId && initialLevel === 'sku') {
      entries.push({ level: 'sku', id: skuId, name: '' });
    }
    return entries;
  });

  // Fetch product data
  const {
    data: product,
    isLoading: isLoadingProduct,
  } = useQuery<ProductDetailData>({
    queryKey: ['product', productId],
    queryFn: async () => {
      const response = await productsApi.getById(productId!);
      return response.data;
    },
    enabled: isOpen && !!productId,
  });

  // Fetch catalog filters
  const {
    data: filters,
    isLoading: isLoadingFilters,
  } = useQuery<CatalogFilters>({
    queryKey: ['catalogFilters'],
    queryFn: async () => {
      const response = await catalogApi.getFilters();
      return response.data;
    },
    enabled: isOpen,
  });

  // Find current variation and SKU from product data
  const currentVariation = useMemo(() => {
    const variationEntry = stack.find(s => s.level === 'variation');
    if (!variationEntry || !product) return null;
    return product.variations?.find(v => v.id === variationEntry.id) ?? null;
  }, [stack, product]);

  const currentSku = useMemo(() => {
    const skuEntry = stack.find(s => s.level === 'sku');
    if (!skuEntry || !currentVariation) return null;
    return currentVariation.skus?.find(s => s.id === skuEntry.id) ?? null;
  }, [stack, currentVariation]);

  // Navigation handlers
  const pushLevel = useCallback((level: EditLevel, id: string, name: string) => {
    setStack(prev => [...prev, { level, id, name }]);
  }, []);

  const popLevel = useCallback(() => {
    setStack(prev => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const handleNavigate = useCallback((level: EditLevel, id: string, name: string) => {
    pushLevel(level, id, name);
  }, [pushLevel]);

  const handleBack = useCallback(() => {
    popLevel();
  }, [popLevel]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset stack after close animation
    setTimeout(() => {
      setStack(productId ? [{ level: 'product', id: productId, name: '' }] : []);
    }, 300);
  }, [onClose, productId]);

  const handleSuccess = useCallback(() => {
    onSuccess?.();
  }, [onSuccess]);

  // Current active level
  const activeLevel = stack[stack.length - 1]?.level ?? 'product';
  const activeIndex = stack.length - 1;

  // Loading state
  const isLoading = isLoadingProduct || isLoadingFilters;

  if (!isOpen) return null;

  return (
    <DialogStack
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      clickable
    >
      <DialogStackOverlay />
      {/* Sync the DialogStack's activeIndex with our navigation stack */}
      <DialogStackIndexSync stackLength={stack.length} />
      <DialogStackBody>
        {/* Product Level */}
        <DialogStackContent index={0}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : product ? (
            <ProductEditDialog
              productId={product.id}
              isActive={activeIndex === 0}
              onNavigate={handleNavigate}
              onClose={handleClose}
              onSuccess={handleSuccess}
            />
          ) : (
            <div className="text-center py-12 text-gray-500">
              Product not found
            </div>
          )}
        </DialogStackContent>

        {/* Variation Level */}
        {stack.length > 1 && currentVariation && (
          <DialogStackContent index={1}>
            <VariationEditDialog
              variation={currentVariation}
              product={product!}
              fabrics={filters?.fabrics ?? []}
              isActive={activeIndex === 1}
              onNavigate={handleNavigate}
              onBack={handleBack}
              onClose={handleClose}
              onSuccess={handleSuccess}
            />
          </DialogStackContent>
        )}

        {/* SKU Level */}
        {stack.length > 2 && currentSku && currentVariation && (
          <DialogStackContent index={2}>
            <SkuEditDialog
              sku={currentSku}
              variation={currentVariation}
              product={product!}
              isActive={activeIndex === 2}
              onBack={handleBack}
              onClose={handleClose}
              onSuccess={handleSuccess}
            />
          </DialogStackContent>
        )}
      </DialogStackBody>
    </DialogStack>
  );
}
