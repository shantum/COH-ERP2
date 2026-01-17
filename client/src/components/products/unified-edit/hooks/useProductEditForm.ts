/**
 * useProductEditForm - Form state management for Product level
 */

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, catalogApi } from '@/services/api';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import type { ProductFormData, ProductDetailData, CatalogFilters, CostCascade } from '../types';

interface UseProductEditFormOptions {
  productId: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useProductEditForm({ productId, onSuccess, onError }: UseProductEditFormOptions) {
  const queryClient = useQueryClient();

  // Fetch product data
  const {
    data: product,
    isLoading: isLoadingProduct,
    error: productError,
  } = useQuery<ProductDetailData>({
    queryKey: ['product', productId],
    queryFn: async () => {
      const response = await productsApi.getById(productId);
      return response.data;
    },
    enabled: !!productId,
  });

  // Fetch catalog filters for dropdowns
  const {
    data: filters,
    isLoading: isLoadingFilters,
  } = useQuery<CatalogFilters>({
    queryKey: ['catalogFilters'],
    queryFn: async () => {
      const response = await catalogApi.getFilters();
      return response.data;
    },
  });

  // Form setup
  const form = useForm<ProductFormData>({
    defaultValues: getDefaultValues(product),
  });

  const { reset, formState: { isDirty, isValid, errors } } = form;

  // Reset form when product data loads
  useEffect(() => {
    if (product) {
      reset(getDefaultValues(product));
    }
  }, [product, reset]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: ProductFormData) => {
      const response = await productsApi.update(productId, {
        name: data.name,
        styleCode: data.styleCode,
        category: data.category,
        productType: data.productType,
        gender: data.gender,
        fabricTypeId: data.fabricTypeId,
        baseProductionTimeMins: data.baseProductionTimeMins,
        defaultFabricConsumption: data.defaultFabricConsumption,
        trimsCost: data.trimsCost,
        liningCost: data.liningCost,
        packagingCost: data.packagingCost,
        isActive: data.isActive,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
      onSuccess?.();
    },
    onError: (err: Error) => {
      onError?.(err);
    },
  });

  // Cost cascade (Product is top level, so it just shows defaults)
  const costCascade = useMemo((): CostCascade => ({
    trimsCost: {
      effectiveValue: product?.trimsCost ?? 0,
      source: product?.trimsCost != null ? 'product' : 'default',
      skuValue: null,
      variationValue: null,
      productValue: product?.trimsCost ?? null,
      defaultValue: 0,
    },
    liningCost: {
      effectiveValue: product?.liningCost ?? 0,
      source: product?.liningCost != null ? 'product' : 'default',
      skuValue: null,
      variationValue: null,
      productValue: product?.liningCost ?? null,
      defaultValue: 0,
    },
    packagingCost: {
      effectiveValue: product?.packagingCost ?? 50,
      source: product?.packagingCost != null ? 'product' : 'default',
      skuValue: null,
      variationValue: null,
      productValue: product?.packagingCost ?? null,
      defaultValue: 50,
    },
    laborMinutes: {
      effectiveValue: product?.baseProductionTimeMins ?? 60,
      source: 'product',
      skuValue: null,
      variationValue: null,
      productValue: product?.baseProductionTimeMins ?? null,
      defaultValue: 60,
    },
    fabricConsumption: {
      effectiveValue: product?.defaultFabricConsumption ?? 1.5,
      source: product?.defaultFabricConsumption != null ? 'product' : 'default',
      skuValue: null,
      variationValue: null,
      productValue: product?.defaultFabricConsumption ?? null,
      defaultValue: 1.5,
    },
  }), [product]);

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return {
    form,
    product,
    filters,
    costCascade,
    isLoading: isLoadingProduct || isLoadingFilters,
    isSaving: updateMutation.isPending,
    isDirty,
    isValid,
    errors,
    error: productError,
    handleSubmit,
    reset: () => reset(getDefaultValues(product)),
  };
}

function getDefaultValues(product?: ProductDetailData | null): ProductFormData {
  return {
    name: product?.name ?? '',
    styleCode: product?.styleCode ?? null,
    category: product?.category ?? '',
    productType: product?.productType ?? '',
    gender: product?.gender ?? 'Women',
    fabricTypeId: product?.fabricTypeId ?? null,
    baseProductionTimeMins: product?.baseProductionTimeMins ?? 60,
    defaultFabricConsumption: product?.defaultFabricConsumption ?? null,
    trimsCost: product?.trimsCost ?? null,
    liningCost: product?.liningCost ?? null,
    packagingCost: product?.packagingCost ?? null,
    isActive: product?.isActive ?? true,
  };
}
