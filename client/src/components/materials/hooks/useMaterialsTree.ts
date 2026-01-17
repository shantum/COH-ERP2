/**
 * useMaterialsTree - TanStack Query hook for materials tree data
 *
 * Handles:
 * - Fetching full tree data (non-lazy mode)
 * - Lazy-loading children on expand
 * - Merging loaded children into tree structure
 * - Optimistic updates for mutations
 */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useState, useMemo } from 'react';
import { materialsApi } from '../../../services/api';
import type { MaterialNode, MaterialNodeType, MaterialTreeResponse, MaterialChildrenResponse } from '../types';

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
            const response = await materialsApi.getTree({ lazyLoad });
            return response.data as MaterialTreeResponse;
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
            const response = await materialsApi.getTreeChildren(parentId, parentType as 'material' | 'fabric');
            const data = response.data as MaterialChildrenResponse;

            // Store loaded children
            setLoadedChildren(prev => new Map(prev).set(parentId, data.items));

            return data.items;
        } catch (err) {
            console.error(`Failed to load children for ${parentType} ${parentId}:`, err);
            throw err;
        }
    }, [loadedChildren]);

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
 */
export function useMaterialsTreeMutations() {
    const queryClient = useQueryClient();

    const updateColour = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
            materialsApi.updateColour(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const updateFabric = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
            materialsApi.updateFabric(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const updateMaterial = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
            materialsApi.updateMaterial(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const deleteMaterial = useMutation({
        mutationFn: (id: string) => materialsApi.deleteMaterial(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const deleteFabric = useMutation({
        mutationFn: (id: string) => materialsApi.deleteFabric(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: materialsTreeKeys.all });
        },
    });

    const deleteColour = useMutation({
        mutationFn: (id: string) => materialsApi.deleteColour(id),
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
