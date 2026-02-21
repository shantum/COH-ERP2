/**
 * useVariationEditForm - Form state management for Variation level
 *
 * Migrated to use TanStack Start Server Functions instead of REST API.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { updateVariation } from '@/server/functions/productsMutations';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import type { VariationFormData, VariationDetailData, ProductDetailData } from '../types';

interface UseVariationEditFormOptions {
  variation: VariationDetailData;
  product: ProductDetailData;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useVariationEditForm({
  variation,
  product,
  onSuccess,
  onError,
}: UseVariationEditFormOptions) {
  const queryClient = useQueryClient();

  // Server Function
  const updateVariationFn = useServerFn(updateVariation);

  // Form setup
  const form = useForm<VariationFormData>({
    defaultValues: getDefaultValues(variation),
  });

  const { reset, formState: { isDirty, isValid, errors } } = form;

  // Reset form when variation data changes
  useEffect(() => {
    if (variation) {
      reset(getDefaultValues(variation));
    }
  }, [variation, reset]);

  // Update mutation using Server Function
  // Note: fabricColourId is now managed via BOM, not direct variation fields
  const updateMutation = useMutation({
    mutationFn: async (data: VariationFormData) => {
      const result = await updateVariationFn({
        data: {
          id: variation.id,
          colorName: data.colorName,
          colorHex: data.colorHex ?? undefined,
          hasLining: data.hasLining,
          isActive: data.isActive,
        },
      });

      if (!result.success) {
        throw new Error(result.error?.message ?? 'Failed to update variation');
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
    variation,
    product,
    isLoading: false,
    isSaving: updateMutation.isPending,
    isDirty,
    isValid,
    errors,
    handleSubmit,
    reset: () => reset(getDefaultValues(variation)),
  };
}

function getDefaultValues(variation: VariationDetailData): VariationFormData {
  return {
    colorName: variation.colorName ?? '',
    colorHex: variation.colorHex ?? null,
    hasLining: variation.hasLining ?? false,
    isActive: variation.isActive ?? true,
  };
}
