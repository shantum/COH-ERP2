/**
 * useMaterialsTree - TanStack Query hook for materials tree data
 *
 * Handles:
 * - Fetching full tree data (non-lazy mode)
 * - Lazy-loading children on expand
 * - Merging loaded children into tree structure
 * - Optimistic updates for mutations
 *
 * NOTE: Uses Server Functions instead of Axios API calls.
 */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useState, useMemo } from 'react';
import { useServerFn } from '@tanstack/react-start';
import {
    getMaterialsTree,
    getMaterialsTreeChildren,
} from '../../../server/functions/materials';
import {
    updateMaterial as updateMaterialFn,
    deleteMaterial as deleteMaterialFn,
    updateFabric as updateFabricFn,
    deleteFabric as deleteFabricFn,
    updateColour as updateColourFn,
    deleteColour as deleteColourFn,
} from '../../../server/functions/materialsMutations';
import type { MaterialNode, MaterialNodeType, MaterialTreeResponse } from '../types';

// Query keys for cache management
export const materialsTreeKeys = {
    all: ['materialsTree'] as const,
    tree: () => [...materialsTreeKeys.all, 'tree'] as const,
    children: (parentId: string, parentType: MaterialNodeType) =>
        [...materialsTreeKeys.all, 'children', parentId, parentType] as const,
};

interface UseMaterialsTreeOptions {
    /** Use lazy loading (fetch children on expand) */
    lazyLoad?: boolean;
    /** Enable the query */
    enabled?: boolean;
}

interface UseMaterialsTreeReturn {
    /** Tree data (top-level nodes) */
    data: MaterialNode[];
    /** Summary statistics */
    summary: MaterialTreeResponse['summary'] | null;
    /** Loading state */
    isLoading: boolean;
    /** Fetching state (background refresh) */
    isFetching: boolean;
    /** Error state */
    error: Error | null;
    /** Refetch the tree */
    refetch: () => void;
    /** Load children for a node (lazy loading) */
    loadChildren: (parentId: string, parentType: MaterialNodeType) => Promise<MaterialNode[]>;
    /** Expanded node IDs */
    expandedIds: Set<string>;
    /** Toggle node expansion */
    toggleExpanded: (nodeId: string) => void;
    /** Expand a specific node */
    expand: (nodeId: string) => void;
    /** Collapse a specific node */
    collapse: (nodeId: string) => void;
    /** Expand all nodes */
    expandAll: () => void;
    /** Collapse all nodes */
    collapseAll: () => void;
    /** Check if a node is expanded */
    isExpanded: (nodeId: string) => boolean;
    /** Update a node in the tree (for optimistic updates) */
    updateNode: (nodeId: string, updates: Partial<MaterialNode>) => void;
    /** Add child to a parent node */
    addChild: (parentId: string, child: MaterialNode) => void;
    /** Remove a node from the tree */
    removeNode: (nodeId: string) => void;
}

/**
 * Helper to find and update a node in a nested tree
 */
function updateNodeInTree(
    nodes: MaterialNode[],
    nodeId: string,
    updater: (node: MaterialNode) => MaterialNode
): MaterialNode[] {
    return nodes.map(node => {
        if (node.id === nodeId) {
            return updater(node);
        }
        if (node.children && node.children.length > 0) {
            return {
                ...node,
                children: updateNodeInTree(node.children, nodeId, updater),
            };
        }
        return node;
    });
}

/**
 * Helper to remove a node from a nested tree
 */
function removeNodeFromTree(nodes: MaterialNode[], nodeId: string): MaterialNode[] {
    return nodes
        .filter(node => node.id !== nodeId)
        .map(node => ({
            ...node,
            children: node.children ? removeNodeFromTree(node.children, nodeId) : undefined,
        }));
}

/**
 * Helper to collect all node IDs from a tree
 */
function collectAllNodeIds(nodes: MaterialNode[]): string[] {
    const ids: string[] = [];
    const traverse = (items: MaterialNode[]) => {
        for (const node of items) {
            ids.push(node.id);
            if (node.children) {
                traverse(node.children);
            }
        }
    };
    traverse(nodes);
    return ids;
}

export function useMaterialsTree(options: UseMaterialsTreeOptions = {}): UseMaterialsTreeReturn {
    const { lazyLoad = false, enabled = true } = options;
    const queryClient = useQueryClient();

    // Server Functions
    const getTreeFn = useServerFn(getMaterialsTree);
    const getChildrenFn = useServerFn(getMaterialsTreeChildren);

    // Track expanded node IDs
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Local state for lazy-loaded children (merged into tree)
    const [loadedChildren, setLoadedChildren] = useState<Map<string, MaterialNode[]>>(new Map());

    // Fetch the tree data
    const {
        data: treeResponse,
        isLoading,
        isFetching,
        error,
        refetch,
    } = useQuery({
        queryKey: materialsTreeKeys.tree(),
        queryFn: async () => {
            const response = await getTreeFn({ data: { lazyLoad } });
            // Transform Server Function response to expected MaterialTreeResponse format
            if ('success' in response && response.success && 'items' in response) {
                const summary = 'summary' in response ? response.summary : null;
                return {
                    items: response.items as MaterialNode[],
                    summary: {
                        total: (summary?.totalMaterials ?? 0) + (summary?.totalFabrics ?? 0) + (summary?.totalColours ?? 0),
                        materials: summary?.totalMaterials ?? 0,
                        fabrics: summary?.totalFabrics ?? 0,
                        colours: summary?.totalColours ?? 0,
                        orderNow: 0,
                        orderSoon: 0,
                        ok: 0,
                    },
                } satisfies MaterialTreeResponse;
            }
            // Return empty on error
            return {
                items: [],
                summary: { total: 0, materials: 0, fabrics: 0, colours: 0, orderNow: 0, orderSoon: 0, ok: 0 },
            } satisfies MaterialTreeResponse;
        },
        enabled,
        staleTime: 2 * 60 * 1000, // 2 minutes
    });

    // Load children for a parent node (lazy loading)
    const loadChildren = useCallback(async (
        parentId: string,
        parentType: MaterialNodeType
    ): Promise<MaterialNode[]> => {
        // Check if already loaded
        if (loadedChildren.has(parentId)) {
            return loadedChildren.get(parentId) || [];
        }

        try {
            const response = await getChildrenFn({
                data: { parentId, parentType: parentType as 'material' | 'fabric' }
            });

            // Extract items from Server Function response
            if ('success' in response && response.success && 'items' in response) {
                const items = response.items as MaterialNode[];
                // Store loaded children
                setLoadedChildren(prev => new Map(prev).set(parentId, items));
                return items;
            }

            return [];
        } catch (err) {
            console.error(`Failed to load children for ${parentType} ${parentId}:`, err);
            throw err;
        }
    }, [loadedChildren, getChildrenFn]);

    // Build the final tree data with lazy-loaded children merged in
    // IMPORTANT: Must be memoized to prevent infinite re-renders
    const data: MaterialNode[] = useMemo(() => {
        function addLoadedChildren(node: MaterialNode): MaterialNode {
            // If this node has lazy-loaded children, use them
            if (lazyLoad && loadedChildren.has(node.id)) {
                return {
                    ...node,
                    children: loadedChildren.get(node.id)?.map(addLoadedChildren),
                };
            }
            // Otherwise, recursively process existing children
            if (node.children) {
                return {
                    ...node,
                    children: node.children.map(addLoadedChildren),
                };
            }
            return node;
        }
        return (treeResponse?.items || []).map(addLoadedChildren);
    }, [treeResponse?.items, lazyLoad, loadedChildren]);

    // Expansion management
    const toggleExpanded = useCallback((nodeId: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(nodeId)) {
                next.delete(nodeId);
            } else {
                next.add(nodeId);
            }
            return next;
        });
    }, []);

    const expand = useCallback((nodeId: string) => {
        setExpandedIds(prev => new Set(prev).add(nodeId));
    }, []);

    const collapse = useCallback((nodeId: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
        });
    }, []);

    const expandAll = useCallback(() => {
        if (data.length > 0) {
            setExpandedIds(new Set(collectAllNodeIds(data)));
        }
    }, [data]);

    const collapseAll = useCallback(() => {
        setExpandedIds(new Set());
    }, []);

    const isExpanded = useCallback((nodeId: string) => {
        return expandedIds.has(nodeId);
    }, [expandedIds]);

    // Update a node in the cache (optimistic updates)
    const updateNode = useCallback((nodeId: string, updates: Partial<MaterialNode>) => {
        queryClient.setQueryData<MaterialTreeResponse>(
            materialsTreeKeys.tree(),
            (oldData) => {
                if (!oldData) return oldData;
                return {
                    ...oldData,
                    items: updateNodeInTree(oldData.items, nodeId, (node) => ({
                        ...node,
                        ...updates,
                    })),
                };
            }
        );
    }, [queryClient]);

    // Add a child to a parent node
    const addChild = useCallback((parentId: string, child: MaterialNode) => {
        queryClient.setQueryData<MaterialTreeResponse>(
            materialsTreeKeys.tree(),
            (oldData) => {
                if (!oldData) return oldData;
                return {
                    ...oldData,
                    items: updateNodeInTree(oldData.items, parentId, (node) => ({
                        ...node,
                        children: [...(node.children || []), child],
                        // Update counts
                        fabricCount: child.type === 'fabric'
                            ? (node.fabricCount || 0) + 1
                            : node.fabricCount,
                        colourCount: child.type === 'colour'
                            ? (node.colourCount || 0) + 1
                            : node.colourCount,
                    })),
                };
            }
        );
    }, [queryClient]);

    // Remove a node from the tree
    const removeNode = useCallback((nodeId: string) => {
        queryClient.setQueryData<MaterialTreeResponse>(
            materialsTreeKeys.tree(),
            (oldData) => {
                if (!oldData) return oldData;
                return {
                    ...oldData,
                    items: removeNodeFromTree(oldData.items, nodeId),
                };
            }
        );
    }, [queryClient]);

    return {
        data,
        summary: treeResponse?.summary || null,
        isLoading,
        isFetching,
        error: error as Error | null,
        refetch,
        loadChildren,
        expandedIds,
        toggleExpanded,
        expand,
        collapse,
        expandAll,
        collapseAll,
        isExpanded,
        updateNode,
        addChild,
        removeNode,
    };
}

/**
 * Hook for mutations with optimistic updates
 * Uses Server Functions instead of Axios API calls
 */
export function useMaterialsTreeMutations() {
    const queryClient = useQueryClient();

    // Server Functions
    const updateMaterialServerFn = useServerFn(updateMaterialFn);
    const deleteMaterialServerFn = useServerFn(deleteMaterialFn);
    const updateFabricServerFn = useServerFn(updateFabricFn);
    const deleteFabricServerFn = useServerFn(deleteFabricFn);
    const updateColourServerFn = useServerFn(updateColourFn);
    const deleteColourServerFn = useServerFn(deleteColourFn);

    // Helper to extract error message from Server Function response
    const getErrorMessage = (result: { success: boolean; error?: { message?: string } }, defaultMsg: string) => {
        if ('error' in result && result.error?.message) {
            return result.error.message;
        }
        return defaultMsg;
    };

    const updateColour = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const result = await updateColourServerFn({ data: { id, ...data } });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to update colour'));
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const updateFabric = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const result = await updateFabricServerFn({ data: { id, ...data } });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to update fabric'));
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const updateMaterial = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
            const result = await updateMaterialServerFn({ data: { id, ...data } });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to update material'));
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const deleteMaterial = useMutation({
        mutationFn: async (id: string) => {
            const result = await deleteMaterialServerFn({ data: { id } });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to delete material'));
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const deleteFabric = useMutation({
        mutationFn: async (id: string) => {
            const result = await deleteFabricServerFn({ data: { id } });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to delete fabric'));
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const deleteColour = useMutation({
        mutationFn: async (id: string) => {
            const result = await deleteColourServerFn({ data: { id } });
            if (!result.success) {
                throw new Error(getErrorMessage(result, 'Failed to delete colour'));
            }
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    return {
        updateColour,
        updateFabric,
        updateMaterial,
        deleteMaterial,
        deleteFabric,
        deleteColour,
    };
}
