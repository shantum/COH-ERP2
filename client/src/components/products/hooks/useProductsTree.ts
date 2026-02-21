/**
 * useProductsTree Hook
 *
 * Fetches and manages the hierarchical products tree data.
 * Uses TanStack Query for caching and state management.
 *
 * Migrated to use Server Functions instead of Axios API calls.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getProductsTree, getProductById } from '../../../server/functions/products';
import {
    createProduct as createProductFn,
    updateProduct as updateProductFn,
    createVariation as createVariationFn,
    updateVariation as updateVariationFn,
    createSku as createSkuFn,
    updateSku as updateSkuFn,
} from '../../../server/functions/productsMutations';
import type { ProductsTreeResponse } from '../../../server/functions/products';
import type { ProductTreeResponse, ProductTreeNode } from '../types';

// ============================================
// Infer mutation data types from Zod schemas
// via the server functions' inputValidator shapes.
// We re-declare the accepted shapes here (excluding 'id')
// because the Zod schemas themselves are not exported.
// ============================================

/** Fields accepted by updateProduct (minus 'id' which is passed separately) */
type UpdateProductData = {
    name?: string;
    styleCode?: string | null;
    category?: string;
    productType?: string;
    gender?: string;
    baseProductionTimeMins?: number;
    defaultFabricConsumption?: number | null;
    imageUrl?: string | null;
    isActive?: boolean;
};

/** Fields accepted by updateVariation (minus 'id') */
type UpdateVariationData = {
    colorName?: string;
    standardColor?: string | null;
    colorHex?: string | null;
    imageUrl?: string | null;
    hasLining?: boolean;
    isActive?: boolean;
};

/** Fields accepted by updateSku (minus 'id') */
type UpdateSkuData = {
    fabricConsumption?: number;
    mrp?: number;
    targetStockQty?: number;
    targetStockMethod?: string;
    isActive?: boolean;
};

/** Fields accepted by createProduct */
type CreateProductData = {
    name: string;
    category: string;
    productType: string;
    styleCode?: string | null;
    gender?: string;
    baseProductionTimeMins?: number;
    defaultFabricConsumption?: number | null;
    imageUrl?: string | null;
};

/** Fields accepted by createVariation (minus 'productId' which is passed separately) */
type CreateVariationData = {
    colorName: string;
    standardColor?: string | null;
    colorHex?: string | null;
    imageUrl?: string | null;
    hasLining?: boolean;
};

/** Fields accepted by createSku (minus 'variationId' which is passed separately) */
type CreateSkuData = {
    size: string;
    skuCode: string;
    fabricConsumption?: number;
    mrp: number;
    targetStockQty?: number;
    targetStockMethod?: string;
};

// Query key factory
export const productsTreeKeys = {
    all: ['productsTree'] as const,
    tree: () => [...productsTreeKeys.all, 'tree'] as const,
    detail: (id: string) => [...productsTreeKeys.all, 'detail', id] as const,
};

// Map Server Function response to legacy ProductTreeResponse type
function mapToLegacyResponse(response: ProductsTreeResponse): ProductTreeResponse {
    return {
        items: response.items as unknown as ProductTreeNode[],
        summary: response.summary,
    };
}

/**
 * Hook to fetch the full products tree
 *
 * Supports initialData from route loaders for instant SSR hydration.
 * When initialData is provided, the hook starts with that data and
 * skips the initial fetch.
 */
export function useProductsTree(options?: {
    enabled?: boolean;
    initialData?: ProductTreeResponse | null;
}) {
    const query = useQuery<ProductTreeResponse>({
        queryKey: productsTreeKeys.tree(),
        queryFn: async () => {
            const response = await getProductsTree({ data: {} });
            return mapToLegacyResponse(response);
        },
        staleTime: 30 * 1000, // 30 seconds
        enabled: options?.enabled !== false,
        // Use initialData from route loader if available
        initialData: options?.initialData ?? undefined,
    });

    return {
        data: query.data?.items ?? [],
        summary: query.data?.summary,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: query.error,
        refetch: query.refetch,
    };
}

/**
 * Hook to fetch a single product with details
 */
export function useProductDetail(productId: string | null) {
    return useQuery({
        queryKey: productsTreeKeys.detail(productId ?? ''),
        queryFn: async () => {
            if (!productId) return null;
            const response = await getProductById({ data: { id: productId } });
            return response;
        },
        enabled: !!productId,
    });
}

/**
 * Hook for products tree mutations
 *
 * Uses Server Functions for all mutations.
 */
export function useProductsTreeMutations() {
    const queryClient = useQueryClient();

    // Server function hooks
    const updateProductServerFn = useServerFn(updateProductFn);
    const updateVariationServerFn = useServerFn(updateVariationFn);
    const updateSkuServerFn = useServerFn(updateSkuFn);
    const createProductServerFn = useServerFn(createProductFn);
    const createVariationServerFn = useServerFn(createVariationFn);
    const createSkuServerFn = useServerFn(createSkuFn);

    const updateProduct = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: UpdateProductData }) => {
            const response = await updateProductServerFn({ data: { id, ...data } });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const updateVariation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: UpdateVariationData }) => {
            const response = await updateVariationServerFn({ data: { id, ...data } });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const updateSku = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: UpdateSkuData }) => {
            const response = await updateSkuServerFn({ data: { id, ...data } });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const createProduct = useMutation({
        mutationFn: async (data: CreateProductData) => {
            const response = await createProductServerFn({ data });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const createVariation = useMutation({
        mutationFn: async ({ productId, data }: { productId: string; data: CreateVariationData }) => {
            const response = await createVariationServerFn({ data: { productId, ...data } });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const createSku = useMutation({
        mutationFn: async ({ variationId, data }: { variationId: string; data: CreateSkuData }) => {
            const response = await createSkuServerFn({ data: { variationId, ...data } });
            return response;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    return {
        updateProduct,
        updateVariation,
        updateSku,
        createProduct,
        createVariation,
        createSku,
    };
}

/**
 * Filter tree nodes by search query
 */
export function filterProductTree(nodes: ProductTreeNode[], searchQuery: string): ProductTreeNode[] {
    if (!searchQuery.trim()) return nodes;

    const query = searchQuery.toLowerCase();

    function filterNodes(nodes: ProductTreeNode[]): ProductTreeNode[] {
        const result: ProductTreeNode[] = [];

        for (const node of nodes) {
            const nameMatch = node.name.toLowerCase().includes(query);
            const styleMatch = node.styleCode?.toLowerCase().includes(query);
            const skuMatch = node.skuCode?.toLowerCase().includes(query);
            const colorMatch = node.colorName?.toLowerCase().includes(query);
            const categoryMatch = node.category?.toLowerCase().includes(query);

            // Check if this node or any children match
            const filteredChildren = node.children ? filterNodes(node.children) : undefined;
            const hasMatchingChildren = filteredChildren && filteredChildren.length > 0;

            if (nameMatch || styleMatch || skuMatch || colorMatch || categoryMatch || hasMatchingChildren) {
                result.push({
                    ...node,
                    children: filteredChildren,
                });
            }
        }

        return result;
    }

    return filterNodes(nodes);
}
