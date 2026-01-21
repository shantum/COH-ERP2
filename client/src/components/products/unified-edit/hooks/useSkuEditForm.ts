/**
 * useSkuEditForm - Form state management for SKU level
 *
 * Migrated to use TanStack Start Server Functions instead of REST API.
 */

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { updateSku } from '@/server/functions/productsMutations';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import type { SkuFormData, SkuDetailData, VariationDetailData, ProductDetailData, CostCascade } from '../types';

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
          trimsCost: data.trimsCost ?? undefined,
          packagingCost: data.packagingCost ?? undefined,
          liningCost: data.liningCost ?? undefined,
          laborMinutes: data.laborMinutes ?? undefined,
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

  // Cost cascade - SKU inherits from Variation → Product → Default
  const costCascade = useMemo((): CostCascade => {
    const resolveCost = (
      skuValue: number | null,
      variationValue: number | null,
      productValue: number | null,
      defaultValue: number
    ) => {
      if (skuValue != null) {
        return {
          effectiveValue: skuValue,
          source: 'sku' as const,
          skuValue,
          variationValue,
          productValue,
          defaultValue,
        };
      }
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
      trimsCost: resolveCost(
        sku.trimsCost,
        variation.trimsCost,
        product.trimsCost,
        0
      ),
      liningCost: resolveCost(
        sku.liningCost,
        variation.liningCost,
        product.liningCost,
        0
      ),
      packagingCost: resolveCost(
        sku.packagingCost,
        variation.packagingCost,
        product.packagingCost,
        50
      ),
      laborMinutes: resolveCost(
        sku.laborMinutes,
        variation.laborMinutes,
        product.baseProductionTimeMins,
        60
      ),
      fabricConsumption: resolveCost(
        sku.fabricConsumption,
        null, // Variation doesn't have fabricConsumption
        product.defaultFabricConsumption,
        1.5
      ),
    };
  }, [sku, variation, product]);

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return {
    form,
    sku,
    variation,
    product,
    costCascade,
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
    trimsCost: sku.trimsCost ?? null,
    liningCost: sku.liningCost ?? null,
    packagingCost: sku.packagingCost ?? null,
    laborMinutes: sku.laborMinutes ?? null,
    isActive: sku.isActive ?? true,
  };
}
