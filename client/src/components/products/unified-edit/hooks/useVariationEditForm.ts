/**
 * useVariationEditForm - Form state management for Variation level
 *
 * Migrated to use TanStack Start Server Functions instead of REST API.
 */

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { updateVariation } from '@/server/functions/productsMutations';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import type { VariationFormData, VariationDetailData, ProductDetailData, CostCascade } from '../types';

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
  const updateMutation = useMutation({
    mutationFn: async (data: VariationFormData) => {
      const result = await updateVariationFn({
        data: {
          id: variation.id,
          colorName: data.colorName,
          colorHex: data.colorHex ?? undefined,
          fabricColourId: data.fabricColourId ?? undefined,
          hasLining: data.hasLining,
          trimsCost: data.trimsCost ?? undefined,
          packagingCost: data.packagingCost ?? undefined,
          liningCost: data.liningCost ?? undefined,
          laborMinutes: data.laborMinutes ?? undefined,
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

  // Cost cascade - Variation inherits from Product
  const costCascade = useMemo((): CostCascade => {
    const resolveCost = (
      variationValue: number | null,
      productValue: number | null,
      defaultValue: number
    ) => {
      if (variationValue != null) {
        return {
          effectiveValue: variationValue,
          source: 'variation' as const,
          skuValue: null,
          variationValue,
          productValue,
          defaultValue,
        };
      }
      if (productValue != null) {
        return {
          effectiveValue: productValue,
          source: 'product' as const,
          skuValue: null,
          variationValue: null,
          productValue,
          defaultValue,
        };
      }
      return {
        effectiveValue: defaultValue,
        source: 'default' as const,
        skuValue: null,
        variationValue: null,
        productValue: null,
        defaultValue,
      };
    };

    return {
      trimsCost: resolveCost(variation.trimsCost, product.trimsCost, 0),
      liningCost: resolveCost(variation.liningCost, product.liningCost, 0),
      packagingCost: resolveCost(variation.packagingCost, product.packagingCost, 50),
      laborMinutes: resolveCost(variation.laborMinutes, product.baseProductionTimeMins, 60),
      fabricConsumption: {
        effectiveValue: product.defaultFabricConsumption ?? 1.5,
        source: product.defaultFabricConsumption != null ? 'product' : 'default',
        skuValue: null,
        variationValue: null,
        productValue: product.defaultFabricConsumption,
        defaultValue: 1.5,
      },
    };
  }, [variation, product]);

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return {
    form,
    variation,
    product,
    costCascade,
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
    fabricColourId: variation.fabricColourId ?? null,
    hasLining: variation.hasLining ?? false,
    trimsCost: variation.trimsCost ?? null,
    liningCost: variation.liningCost ?? null,
    packagingCost: variation.packagingCost ?? null,
    laborMinutes: variation.laborMinutes ?? null,
    isActive: variation.isActive ?? true,
  };
}
