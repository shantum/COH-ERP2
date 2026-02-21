/**
 * useProductEditForm - Form state management for Product level
 *
 * Migrated to use TanStack Start Server Functions instead of REST API.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getProductById } from '@/server/functions/products';
import { updateProduct } from '@/server/functions/productsMutations';
import { productsTreeKeys } from '../../hooks/useProductsTree';
import type { ProductFormData, ProductDetailData } from '../types';

interface UseProductEditFormOptions {
  productId: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useProductEditForm({ productId, onSuccess, onError }: UseProductEditFormOptions) {
  const queryClient = useQueryClient();

  // Server Functions
  const getProductByIdFn = useServerFn(getProductById);
  const updateProductFn = useServerFn(updateProduct);

  // Fetch product data using Server Function
  const {
    data: product,
    isLoading: isLoadingProduct,
    error: productError,
  } = useQuery<ProductDetailData>({
    queryKey: ['product', productId],
    queryFn: async () => {
      const result = await getProductByIdFn({ data: { id: productId } });
      return result as ProductDetailData;
    },
    enabled: !!productId,
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

  // Update mutation using Server Function
  // Note: fabricTypeId removed - fabric is now managed via BOM
  const updateMutation = useMutation({
    mutationFn: async (data: ProductFormData) => {
      const result = await updateProductFn({
        data: {
          id: productId,
          name: data.name,
          styleCode: data.styleCode,
          category: data.category,
          productType: data.productType,
          gender: data.gender,
          baseProductionTimeMins: data.baseProductionTimeMins,
          defaultFabricConsumption: data.defaultFabricConsumption,
          isActive: data.isActive,
        },
      });

      if (!result.success) {
        throw new Error(result.error?.message ?? 'Failed to update product');
      }

      return result.data;
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

  // Cost cascade removed — costs are now fully managed via BOM

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return {
    form,
    product,
    isLoading: isLoadingProduct,
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
    baseProductionTimeMins: product?.baseProductionTimeMins ?? 60,
    defaultFabricConsumption: product?.defaultFabricConsumption ?? null,
    isActive: product?.isActive ?? true,
  };
}
