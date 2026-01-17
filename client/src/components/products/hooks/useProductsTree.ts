/**
 * useProductsTree Hook
 *
 * Fetches and manages the hierarchical products tree data.
 * Uses TanStack Query for caching and state management.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../../services/api';
import type { ProductTreeResponse, ProductTreeNode } from '../types';

// Query key factory
export const productsTreeKeys = {
    all: ['productsTree'] as const,
    tree: () => [...productsTreeKeys.all, 'tree'] as const,
    detail: (id: string) => [...productsTreeKeys.all, 'detail', id] as const,
};

/**
 * Hook to fetch the full products tree
 */
export function useProductsTree(options?: { enabled?: boolean }) {
    const query = useQuery<ProductTreeResponse>({
        queryKey: productsTreeKeys.tree(),
        queryFn: async () => {
            const response = await productsApi.getTree();
            return response.data;
        },
        staleTime: 30 * 1000, // 30 seconds
        enabled: options?.enabled !== false,
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
            const response = await productsApi.getById(productId);
            return response.data;
        },
        enabled: !!productId,
    });
}

/**
 * Hook for products tree mutations
 */
export function useProductsTreeMutations() {
    const queryClient = useQueryClient();

    const updateProduct = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            const response = await productsApi.update(id, data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const updateVariation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            const response = await productsApi.updateVariation(id, data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const updateSku = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            const response = await productsApi.updateSku(id, data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const createProduct = useMutation({
        mutationFn: async (data: any) => {
            const response = await productsApi.create(data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const createVariation = useMutation({
        mutationFn: async ({ productId, data }: { productId: string; data: any }) => {
            const response = await productsApi.createVariation(productId, data);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: productsTreeKeys.tree() });
        },
    });

    const createSku = useMutation({
        mutationFn: async ({ variationId, data }: { variationId: string; data: any }) => {
            const response = await productsApi.createSku(variationId, data);
            return response.data;
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
