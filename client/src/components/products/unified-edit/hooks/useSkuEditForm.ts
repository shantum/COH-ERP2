/**
 * useSkuEditForm - Form state management for SKU level
 *
 * Migrated to use TanStack Start Server Functions instead of REST API.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { updateSku } from '@/server/functions/productsMutations';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import type { SkuFormData, SkuDetailData, VariationDetailData, ProductDetailData } from '../types';

interface UseSkuEditFormOptions {
  sku: SkuDetailData;
  variation: VariationDetailData;
  product: ProductDetailData;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useSkuEditForm({
  sku,
  variation,
  product,
  onSuccess,
  onError,
}: UseSkuEditFormOptions) {
  const queryClient = useQueryClient();

  // Server Function
  const updateSkuFn = useServerFn(updateSku);

  // Form setup
  const form = useForm<SkuFormData>({
    defaultValues: getDefaultValues(sku),
  });

  const { reset, formState: { isDirty, isValid, errors } } = form;

  // Reset form when SKU data changes
  useEffect(() => {
    if (sku) {
      reset(getDefaultValues(sku));
    }
  }, [sku, reset]);

  // Update mutation using Server Function
  const updateMutation = useMutation({
    mutationFn: async (data: SkuFormData) => {
      const result = await updateSkuFn({
        data: {
          id: sku.id,
          fabricConsumption: data.fabricConsumption ?? undefined,
          mrp: data.mrp ?? undefined,
          targetStockQty: data.targetStockQty ?? undefined,
          isActive: data.isActive,
        },
      });

      if (!result.success) {
        throw new Error(result.error?.message ?? 'Failed to update SKU');
      }

      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
      onSuccess?.();
    },
    onError: (err: Error) => {
      onError?.(err);
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return {
    form,
    sku,
    variation,
    product,
    isLoading: false,
    isSaving: updateMutation.isPending,
    isDirty,
    isValid,
    errors,
    handleSubmit,
    reset: () => reset(getDefaultValues(sku)),
  };
}

function getDefaultValues(sku: SkuDetailData): SkuFormData {
  return {
    size: sku.size ?? '',
    fabricConsumption: sku.fabricConsumption ?? null,
    mrp: sku.mrp ?? null,
    targetStockQty: sku.targetStockQty ?? null,
    isActive: sku.isActive ?? true,
  };
}
