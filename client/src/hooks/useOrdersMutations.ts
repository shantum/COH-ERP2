/**
 * useOrdersMutations hook
 * Centralizes all mutations for the Orders page
 *
 * Migration status:
 * - Most mutations use Axios (complex optimistic updates)
 * - createOrder, allocate, shipLines use tRPC (migrated in Phase 12.2)
 * - Cache invalidation updated to support both Axios and tRPC queries
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi, productionApi } from '../services/api';
import { orderQueryKeys, inventoryQueryKeys, orderTabInvalidationMap } from '../constants/queryKeys';
import { trpc } from '../services/trpc';

interface UseOrdersMutationsOptions {
    onShipSuccess?: () => void;
    onCreateSuccess?: () => void;
    onDeleteSuccess?: () => void;
    onEditSuccess?: () => void;
    onNotesSuccess?: () => void;
    onProcessMarkedShippedSuccess?: () => void;
}

// Context types for optimistic update mutations
type LineUpdateContext = { skipped: true } | { skipped?: false; previousOrders: unknown };
type InventoryUpdateContext = { skipped: true } | { skipped?: false; previousOrders: unknown; previousInventory: unknown; skuIds?: string[] };

export function useOrdersMutations(options: UseOrdersMutationsOptions = {}) {
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();

    // Debounced invalidation for rapid-fire operations (allocate/unallocate/pick/pack)
    // Waits for 800ms of inactivity before syncing with server
    // IMPORTANT: Only use for error recovery, NOT for success cases (optimistic updates are correct)
    const debounceTimerRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Clear pending debounced invalidation - call this when starting a new mutation
    // to prevent race conditions where old invalidation overwrites new optimistic updates
    const clearPendingInvalidation = () => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
    };

    // Map view names to tRPC query input
    const viewToTrpcInput: Record<string, { view: string; limit?: number }> = {
        open: { view: 'open', limit: 500 },
        shipped: { view: 'shipped' },
        rto: { view: 'rto' },
        cod_pending: { view: 'cod_pending' },
        cancelled: { view: 'cancelled' },
        archived: { view: 'archived' },
    };

    // Consolidated invalidation function - invalidates both Axios and tRPC query caches
    // Uses orderTabInvalidationMap for Axios and trpcUtils for tRPC
    const invalidateTab = (tab: keyof typeof orderTabInvalidationMap, debounce = false) => {
        const invalidate = () => {
            // Invalidate old Axios query keys (for any remaining Axios queries)
            const keysToInvalidate = orderTabInvalidationMap[tab];
            if (keysToInvalidate) {
                keysToInvalidate.forEach(key => {
                    queryClient.invalidateQueries({ queryKey: [key] });
                });
            }

            // Invalidate tRPC query cache
            // This ensures tRPC queries refetch after mutations
            const trpcInput = viewToTrpcInput[tab];
            if (trpcInput) {
                trpcUtils.orders.list.invalidate(trpcInput);
            }
        };

        if (debounce) {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = setTimeout(() => {
                invalidate();
                debounceTimerRef.current = null;
            }, 800);
        } else {
            invalidate();
        }
    };

    // Convenience wrappers for backward compatibility and clarity
    const invalidateOpenOrders = () => invalidateTab('open');
    const invalidateShippedOrders = () => invalidateTab('shipped');
    const invalidateRtoOrders = () => invalidateTab('rto');
    const invalidateCodPendingOrders = () => invalidateTab('cod_pending');
    const invalidateCancelledOrders = () => invalidateTab('cancelled');
    const debouncedInvalidateOpenOrders = () => invalidateTab('open', true);

    // Keep invalidateAll for operations that truly affect multiple tabs (creation, deletion)
    const invalidateAll = () => {
        Object.keys(orderTabInvalidationMap).forEach(tab => {
            invalidateTab(tab as keyof typeof orderTabInvalidationMap);
        });
    };

    // Ship order mutation - moves from open to shipped
    const ship = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.ship(id, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err: any) => {
            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                // Show validation details (e.g., AWB must be 8-20 characters)
                const messages = errorData.details.map((d: any) => d.message).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else {
                alert(errorData?.error || 'Failed to ship order');
            }
        }
    });

    // Ship specific lines mutation - supports partial shipments
    const shipLines = trpc.orders.ship.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err) => {
            const errorMsg = err.message || '';
            // Check for common error patterns
            if (errorMsg.includes('not packed')) {
                alert(`Cannot ship: Some lines are not packed yet`);
            } else if (errorMsg.includes('validation')) {
                alert(`Validation failed: ${errorMsg}`);
            } else {
                alert(errorMsg || 'Failed to ship lines');
            }
        }
    });

    // Helper for optimistic line status updates (pick/pack operations)
    // Returns previous data for rollback on error
    // Now uses tRPC cache management since orders are fetched via tRPC
    const optimisticLineUpdate = async (lineId: string, newStatus: string) => {
        // Cancel any outgoing refetches to avoid overwriting optimistic update
        await trpcUtils.orders.list.cancel({ view: 'open', limit: 500 });

        // Snapshot the previous value from tRPC cache
        const previousOrders = trpcUtils.orders.list.getData({ view: 'open', limit: 500 });

        // Optimistically update the line status in tRPC cache
        // IMPORTANT: Only create new objects for the modified order/line to preserve AG-Grid selection state
        trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, (old) => {
            if (!old) return old;

            // Find which order contains this line
            const orderIndex = old.orders.findIndex((order: any) =>
                order.orderLines?.some((line: any) => line.id === lineId)
            );

            if (orderIndex === -1) return old;

            // Only update that specific order
            const newOrders = [...old.orders];
            const order = newOrders[orderIndex];
            if (!order.orderLines) return old;
            const newOrderLines = order.orderLines.map((line: any) =>
                line.id === lineId ? { ...line, lineStatus: newStatus } : line
            );
            newOrders[orderIndex] = { ...order, orderLines: newOrderLines };

            return { ...old, orders: newOrders };
        });

        return { previousOrders };
    };

    // Helper to get current line status from tRPC cache
    const getLineStatus = (lineId: string): string | null => {
        // Use tRPC cache (orders.list with view=open)
        const data = trpcUtils.orders.list.getData({ view: 'open', limit: 500 });
        const orders = data?.orders;
        if (!orders) return null;
        for (const order of orders) {
            const line = (order as any).orderLines?.find((l: any) => l.id === lineId);
            if (line) return line.lineStatus;
        }
        return null;
    };

    // Helper for optimistic inventory balance updates (allocate/unallocate)
    // delta: +1 for allocate (increase reserved), -1 for unallocate (decrease reserved)
    // Uses tRPC cache management for inventory - updates getBalances cache (filtered by skuIds)
    const optimisticInventoryUpdate = async (lineId: string, newStatus: string, delta: number) => {
        // Cancel tRPC queries
        await trpcUtils.orders.list.cancel({ view: 'open', limit: 500 });

        // Get current data from tRPC cache
        const previousOrdersData = trpcUtils.orders.list.getData({ view: 'open', limit: 500 });

        // Find the line to get skuId and qty
        let skuId: string | null = null;
        let qty = 0;
        const orders = previousOrdersData?.orders;
        if (orders) {
            for (const order of orders) {
                const line = (order as any).orderLines?.find((l: any) => l.id === lineId);
                if (line) {
                    skuId = line.skuId;
                    qty = line.qty || 1;
                    break;
                }
            }
        }

        // Extract all SKU IDs from open orders to match the cache key used by useOrdersData
        const openOrderSkuIds: string[] = [];
        if (orders) {
            const skuSet = new Set<string>();
            orders.forEach((order: any) => {
                order.orderLines?.forEach((line: any) => {
                    if (line.skuId) skuSet.add(line.skuId);
                });
            });
            openOrderSkuIds.push(...Array.from(skuSet));
        }

        // Get previous inventory data for rollback (using the exact skuIds from open orders)
        const previousInventoryData = openOrderSkuIds.length > 0
            ? trpcUtils.inventory.getBalances.getData({ skuIds: openOrderSkuIds })
            : null;

        // Update line status in tRPC openOrders cache
        // IMPORTANT: Only create new objects for the modified order/line to preserve AG-Grid selection state
        trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, (old) => {
            if (!old) return old;

            // Find which order contains this line
            const orderIndex = old.orders.findIndex((order: any) =>
                order.orderLines?.some((line: any) => line.id === lineId)
            );

            if (orderIndex === -1) return old;

            // Only update that specific order
            const newOrders = [...old.orders];
            const order = newOrders[orderIndex];
            if (!order.orderLines) return old;
            const newOrderLines = order.orderLines.map((line: any) =>
                line.id === lineId ? { ...line, lineStatus: newStatus } : line
            );
            newOrders[orderIndex] = { ...order, orderLines: newOrderLines };

            return { ...old, orders: newOrders };
        });

        // Update inventory balance for the affected SKU in tRPC cache (getBalances with skuIds)
        if (skuId && openOrderSkuIds.length > 0) {
            trpcUtils.inventory.getBalances.setData({ skuIds: openOrderSkuIds }, (old) => {
                if (!old) return old;
                // getBalances returns an array directly with fields: totalReserved, availableBalance
                return old.map((item: any) => {
                    if (item.skuId === skuId) {
                        const reservedChange = qty * delta;
                        return {
                            ...item,
                            totalReserved: (item.totalReserved || 0) + reservedChange,
                            availableBalance: (item.availableBalance || 0) - reservedChange,
                        };
                    }
                    return item;
                });
            });
        }

        return {
            previousOrders: previousOrdersData,
            previousInventory: previousInventoryData,
            skuIds: openOrderSkuIds, // Store for rollback
        };
    };

    // Allocate/unallocate line mutations - only affects open orders (with optimistic updates)
    // These also optimistically update inventory balance for instant stock column feedback
    // NO onSettled invalidation - optimistic updates are correct, only rollback on error
    const allocate = trpc.orders.allocate.useMutation({
        onMutate: async (input): Promise<InventoryUpdateContext> => {
            // Clear any pending invalidation from previous operations to prevent race conditions
            clearPendingInvalidation();

            const lineId = input.lineIds[0]; // Single line allocation
            const status = getLineStatus(lineId);
            // Skip if already allocated or has wrong status
            if (status !== 'pending') return { skipped: true };
            return optimisticInventoryUpdate(lineId, 'allocated', 1);
        },
        onError: (err, _vars, context) => {
            // ALWAYS rollback first, before any early returns
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            if (context && 'previousInventory' in context && context.previousInventory && context.skuIds?.length) {
                trpcUtils.inventory.getBalances.setData({ skuIds: context.skuIds }, context.previousInventory as any);
            }

            // Then handle specific error types
            if (context?.skipped) return;

            const errorMsg = err.message || '';
            // Only invalidate on state-mismatch errors to sync with server
            if (errorMsg.includes('pending') || errorMsg.includes('allocated')) {
                debouncedInvalidateOpenOrders();
            }
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    const unallocate = useMutation<unknown, any, string, InventoryUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unallocateLine(lineId),
        onMutate: async (lineId): Promise<InventoryUpdateContext> => {
            // Clear any pending invalidation from previous operations to prevent race conditions
            clearPendingInvalidation();

            const status = getLineStatus(lineId);
            // Skip if not allocated
            if (status !== 'allocated') return { skipped: true };
            return optimisticInventoryUpdate(lineId, 'pending', -1);
        },
        onError: (err: any, _lineId, context) => {
            // ALWAYS rollback first using tRPC cache, before any early returns
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            if (context && 'previousInventory' in context && context.previousInventory && context.skuIds?.length) {
                trpcUtils.inventory.getBalances.setData({ skuIds: context.skuIds }, context.previousInventory as any);
            }

            // Then handle specific error types
            if (context?.skipped) return;

            const errorMsg = err.response?.data?.error || '';
            // Only invalidate on state-mismatch errors to sync with server
            if (errorMsg.includes('pending') || errorMsg.includes('allocated')) {
                debouncedInvalidateOpenOrders();
            }
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    // Pick/unpick line mutations - only affects open orders (with optimistic updates)
    // NO onSettled invalidation - optimistic updates are correct, only rollback on error
    const pickLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.pickLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            clearPendingInvalidation();
            const status = getLineStatus(lineId);
            if (status !== 'allocated') return { skipped: true };
            return optimisticLineUpdate(lineId, 'picked');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // On state-mismatch errors, invalidate to sync with server
            if (errorMsg.includes('allocated') || errorMsg.includes('picked')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            alert(errorMsg || 'Failed to pick line');
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    const unpickLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unpickLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            clearPendingInvalidation();
            const status = getLineStatus(lineId);
            if (status !== 'picked') return { skipped: true };
            return optimisticLineUpdate(lineId, 'allocated');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // On state-mismatch errors, invalidate to sync with server
            if (errorMsg.includes('allocated') || errorMsg.includes('picked')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            alert(errorMsg || 'Failed to unpick line');
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    // Pack/unpack line mutations - only affects open orders (with optimistic updates)
    const packLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.packLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            clearPendingInvalidation();
            const status = getLineStatus(lineId);
            if (status !== 'picked') return { skipped: true };
            return optimisticLineUpdate(lineId, 'packed');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // On state-mismatch errors, invalidate to sync with server
            if (errorMsg.includes('picked') || errorMsg.includes('packed')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            alert(errorMsg || 'Failed to pack line');
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    const unpackLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unpackLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            clearPendingInvalidation();
            const status = getLineStatus(lineId);
            if (status !== 'packed') return { skipped: true };
            return optimisticLineUpdate(lineId, 'picked');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            // On state-mismatch errors, invalidate to sync with server
            if (errorMsg.includes('picked') || errorMsg.includes('packed')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            alert(errorMsg || 'Failed to unpack line');
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    // Mark shipped (visual only - no inventory release)
    const markShippedLine = useMutation<unknown, any, { lineId: string; data?: { awbNumber?: string; courier?: string } }, LineUpdateContext>({
        mutationFn: ({ lineId, data }) => ordersApi.markShippedLine(lineId, data),
        onMutate: async ({ lineId }): Promise<LineUpdateContext> => {
            clearPendingInvalidation();
            const status = getLineStatus(lineId);
            if (status !== 'packed') return { skipped: true };
            return optimisticLineUpdate(lineId, 'marked_shipped');
        },
        onError: (err: any, _vars, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            if (errorMsg.includes('packed') || errorMsg.includes('marked_shipped')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            alert(errorMsg || 'Failed to mark line as shipped');
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    const unmarkShippedLine = useMutation<unknown, any, string, LineUpdateContext>({
        mutationFn: (lineId: string) => ordersApi.unmarkShippedLine(lineId),
        onMutate: async (lineId): Promise<LineUpdateContext> => {
            clearPendingInvalidation();
            const status = getLineStatus(lineId);
            if (status !== 'marked_shipped') return { skipped: true };
            return optimisticLineUpdate(lineId, 'packed');
        },
        onError: (err: any, _lineId, context) => {
            if (context?.skipped) return;
            const errorMsg = err.response?.data?.error || '';
            if (errorMsg.includes('packed') || errorMsg.includes('marked_shipped')) {
                debouncedInvalidateOpenOrders();
                return;
            }
            if (context && 'previousOrders' in context && context.previousOrders) {
                trpcUtils.orders.list.setData({ view: 'open', limit: 500 }, context.previousOrders as any);
            }
            alert(errorMsg || 'Failed to unmark shipped line');
        },
        // NO onSettled - optimistic update is authoritative on success
    });

    // Update line tracking (AWB/courier) with optimistic update
    const updateLineTracking = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }) =>
            ordersApi.updateLineTracking(lineId, data),
        onMutate: async ({ lineId, data }) => {
            await queryClient.cancelQueries({ queryKey: orderQueryKeys.open });
            const previousOrders = queryClient.getQueryData(orderQueryKeys.open);

            // Optimistically update tracking info in cache
            queryClient.setQueryData(orderQueryKeys.open, (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.id === lineId
                            ? { ...line, ...data }
                            : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _vars, context) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            // Log error silently - frontend validation should prevent most cases
            console.error('Tracking update failed:', err.response?.data?.error || err.message);
        },
        // No invalidation needed - optimistic update is sufficient
    });

    // Process all marked shipped lines (batch clear)
    const processMarkedShipped = useMutation({
        mutationFn: (data?: { comment?: string }) => ordersApi.processMarkedShipped(data),
        onSuccess: (response: any) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            const { processed, orders } = response.data;
            alert(`Processed ${processed} lines across ${orders?.length || 0} orders`);
            options.onProcessMarkedShippedSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to process marked shipped lines')
    });

    // Migrate Shopify fulfilled orders (onboarding - no inventory)
    const migrateShopifyFulfilled = useMutation({
        mutationFn: () => ordersApi.migrateShopifyFulfilled(),
        onSuccess: (response: any) => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            const { skipped, message } = response.data;
            alert(message + (skipped > 0 ? ` (${skipped} already shipped)` : ''));
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to migrate fulfilled orders')
    });

    // Production batch mutations - only affects open orders (with optimistic updates)
    const createBatch = useMutation({
        mutationFn: (data: any) => productionApi.createBatch(data),
        onMutate: async (data) => {
            // Cancel outgoing refetches to avoid overwriting optimistic update
            await queryClient.cancelQueries({ queryKey: orderQueryKeys.open });

            // Snapshot previous value for rollback
            const previousOrders = queryClient.getQueryData(orderQueryKeys.open);

            // Create a temporary batch object for optimistic update
            const tempBatch = {
                id: `temp-${Date.now()}`,
                skuId: data.skuId,
                qtyPlanned: data.qtyPlanned,
                batchDate: data.batchDate,
                notes: data.notes,
                status: 'planned',
            };

            // Optimistically add the batch to the order line
            queryClient.setQueryData(orderQueryKeys.open, (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.id === data.sourceOrderLineId
                            ? { ...line, productionBatch: tempBatch, productionBatchId: tempBatch.id }
                            : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _data, context) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to add to production');
        },
        onSettled: () => {
            invalidateOpenOrders();
            // Invalidate fabric and inventory since batch affects both
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    const updateBatch = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            // Skip API call for temporary IDs (from optimistic creates that haven't finished)
            if (id.startsWith('temp-')) {
                return { data: { success: true } } as any;
            }
            return productionApi.updateBatch(id, data);
        },
        onMutate: async ({ id, data }) => {
            // Cancel outgoing refetches to avoid overwriting optimistic update
            await queryClient.cancelQueries({ queryKey: orderQueryKeys.open });

            // Snapshot previous value for rollback
            const previousOrders = queryClient.getQueryData(orderQueryKeys.open);

            // Optimistically update the batch in nested orderLines
            queryClient.setQueryData(orderQueryKeys.open, (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.productionBatch?.id === id
                            ? { ...line, productionBatch: { ...line.productionBatch, ...data } }
                            : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _vars, context: { previousOrders?: any } | undefined) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to update batch');
        },
        onSettled: () => {
            invalidateOpenOrders();
            // Invalidate fabric and inventory since batch affects both
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    const deleteBatch = useMutation({
        mutationFn: async (id: string) => {
            // Skip API call for temporary IDs (from optimistic creates that haven't finished)
            if (id.startsWith('temp-')) {
                return { data: { success: true } } as any;
            }
            return productionApi.deleteBatch(id);
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: orderQueryKeys.open });
            const previousOrders = queryClient.getQueryData(orderQueryKeys.open);

            // Optimistically remove the batch from orderLines
            queryClient.setQueryData(orderQueryKeys.open, (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.productionBatch?.id === id
                            ? { ...line, productionBatch: null, productionBatchId: null }
                            : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _id, context: { previousOrders?: any } | undefined) => {
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to delete batch');
        },
        onSettled: () => {
            invalidateOpenOrders();
            // Invalidate fabric and inventory since batch affects both
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.fabric });
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        }
    });

    // Order CRUD mutations - these affect multiple tabs
    // createOrder uses tRPC for type-safe input validation
    const createOrder = trpc.orders.create.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            options.onCreateSuccess?.();
        },
        onError: (err) => {
            // tRPC errors have a different shape
            const message = err.message || 'Failed to create order';
            alert(message);
        }
    });

    const deleteOrder = useMutation({
        mutationFn: (id: string) => ordersApi.delete(id),
        onSuccess: () => {
            invalidateAll(); // Deletion can happen from any tab
            options.onDeleteSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete order')
    });

    const updateOrder = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.update(id, data),
        onSuccess: () => {
            invalidateOpenOrders(); // Editing only on open orders
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update order')
    });

    const updateOrderNotes = useMutation({
        mutationFn: ({ id, notes }: { id: string; notes: string }) =>
            ordersApi.update(id, { internalNotes: notes }),
        onSuccess: () => {
            invalidateOpenOrders(); // Notes editing only on open orders
            options.onNotesSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update notes')
    });

    // Update line notes - affects open orders (with optimistic updates for instant feedback)
    const updateLineNotes = useMutation({
        mutationFn: ({ lineId, notes }: { lineId: string; notes: string }) =>
            ordersApi.updateLine(lineId, { notes }),
        onMutate: async ({ lineId, notes }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: orderQueryKeys.open });
            const previousOrders = queryClient.getQueryData(orderQueryKeys.open);

            // Optimistically update line notes in cache (openOrders is stored as array)
            queryClient.setQueryData(orderQueryKeys.open, (old: any[] | undefined) => {
                if (!old) return old;
                return old.map(order => ({
                    ...order,
                    orderLines: order.orderLines?.map((line: any) =>
                        line.id === lineId ? { ...line, notes } : line
                    )
                }));
            });

            return { previousOrders };
        },
        onError: (err: any, _vars, context) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(['openOrders'], context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to update line notes');
        },
        onSuccess: () => options.onNotesSuccess?.(),
        // No need to invalidate - optimistic update is sufficient, server confirmed
    });

    // Update ship by date - affects open orders (with optimistic updates)
    const updateShipByDate = useMutation({
        mutationFn: ({ orderId, date }: { orderId: string; date: string | null }) =>
            ordersApi.update(orderId, { shipByDate: date }),
        onMutate: async ({ orderId, date }) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: orderQueryKeys.open });
            const previousOrders = queryClient.getQueryData(orderQueryKeys.open);

            // Optimistically update the shipByDate in cache
            queryClient.setQueryData(orderQueryKeys.open, (old: any[] | undefined) => {
                if (!old) return old;
                return old.map((order: any) =>
                    order.id === orderId ? { ...order, shipByDate: date } : order
                );
            });

            return { previousOrders };
        },
        onError: (err: any, _vars, context) => {
            // Rollback on error
            if (context?.previousOrders) {
                queryClient.setQueryData(orderQueryKeys.open, context.previousOrders);
            }
            alert(err.response?.data?.error || 'Failed to update ship by date');
        },
        // No need to invalidate - optimistic update is sufficient, server confirmed
    });

    // Shipping status mutations - moves between shipped and open
    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unship order')
    });

    // Delivery tracking mutations - affects shipped tab and potentially COD pending
    const markDelivered = useMutation({
        mutationFn: (id: string) => ordersApi.markDelivered(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateCodPendingOrders(); // May affect COD pending if it's a COD order
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to mark as delivered')
    });

    const markRto = useMutation({
        mutationFn: (id: string) => ordersApi.markRto(id),
        onSuccess: () => {
            invalidateShippedOrders();
            invalidateRtoOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to mark as RTO')
    });

    const receiveRto = useMutation({
        mutationFn: (id: string) => ordersApi.receiveRto(id),
        onSuccess: () => {
            invalidateRtoOrders();
            invalidateOpenOrders();
            // Invalidate inventory balance since RTO creates inward
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to receive RTO')
    });

    // Order status mutations
    const cancelOrder = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
            ordersApi.cancel(id, reason),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel order')
    });

    const uncancelOrder = useMutation({
        mutationFn: (id: string) => ordersApi.uncancel(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateCancelledOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore order')
    });


    // Order line mutations - only affects open orders
    const cancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.cancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to cancel line')
    });

    const uncancelLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.uncancelLine(lineId),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to restore line')
    });

    // Close/reopen lines - controls visibility (moves between open and shipped views)
    const closeLines = useMutation({
        mutationFn: (lineIds: string[]) => ordersApi.closeLines(lineIds),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to close lines')
    });

    const reopenLines = useMutation({
        mutationFn: (lineIds: string[]) => ordersApi.reopenLines(lineIds),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to reopen lines')
    });

    const closeOrder = useMutation({
        mutationFn: (orderId: string) => ordersApi.closeOrder(orderId),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to close order')
    });

    const reopenOrder = useMutation({
        mutationFn: (orderId: string) => ordersApi.reopenOrder(orderId),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to reopen order')
    });

    const updateLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: any }) =>
            ordersApi.updateLine(lineId, data),
        onSuccess: () => invalidateOpenOrders(),
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update line')
    });

    const addLine = useMutation({
        mutationFn: ({ orderId, data }: { orderId: string; data: any }) =>
            ordersApi.addLine(orderId, data),
        onSuccess: () => {
            invalidateOpenOrders();
            options.onEditSuccess?.();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to add line')
    });

    // Customization mutations - only affects open orders
    const customizeLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { type: string; value: string; notes?: string } }) =>
            ordersApi.customizeLine(lineId, data),
        onSuccess: () => {
            invalidateOpenOrders();
        },
        onError: (err: any) => {
            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                // Show validation details
                const messages = errorData.details.map((d: any) => `${d.path}: ${d.message}`).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else if (errorData?.code === 'LINE_NOT_PENDING') {
                alert('Cannot customize: Line is already allocated/picked/packed. Unallocate first.');
            } else if (errorData?.code === 'ALREADY_CUSTOMIZED') {
                alert('This line is already customized.');
            } else {
                alert(errorData?.error || 'Failed to customize line');
            }
        }
    });

    const removeCustomization = useMutation({
        mutationFn: ({ lineId, force = false }: { lineId: string; force?: boolean }) =>
            ordersApi.removeCustomization(lineId, { force }),
        onSuccess: (response: any) => {
            invalidateOpenOrders();
            if (response.data?.forcedCleanup) {
                alert(`Customization removed.\nCleared ${response.data.deletedTransactions} inventory transactions and ${response.data.deletedBatches} production batches.`);
            }
        },
        onError: (err: any, variables) => {
            const errorCode = err.response?.data?.code;
            const errorMsg = err.response?.data?.error;

            // If blocked by inventory/production, offer force option
            if (errorCode === 'CANNOT_UNDO_HAS_INVENTORY' || errorCode === 'CANNOT_UNDO_HAS_PRODUCTION') {
                const confirmMsg = errorCode === 'CANNOT_UNDO_HAS_INVENTORY'
                    ? 'Inventory transactions exist for this custom SKU.\n\nForce remove? This will delete all inventory records for this custom item.'
                    : 'Production batches exist for this custom SKU.\n\nForce remove? This will delete all production records for this custom item.';

                if (window.confirm(confirmMsg)) {
                    // Retry with force=true
                    removeCustomization.mutate({ lineId: variables.lineId, force: true });
                }
            } else {
                alert(errorMsg || 'Failed to remove customization');
            }
        }
    });

    return {
        // Ship
        ship,
        shipLines,
        unship,

        // Delivery tracking
        markDelivered,
        markRto,
        receiveRto,

        // Allocate/Pick/Pack
        allocate,
        unallocate,
        pickLine,
        unpickLine,
        packLine,
        unpackLine,

        // Mark shipped (spreadsheet workflow)
        markShippedLine,
        unmarkShippedLine,
        updateLineTracking,
        processMarkedShipped,

        // Migration (onboarding)
        migrateShopifyFulfilled,

        // Production
        createBatch,
        updateBatch,
        deleteBatch,

        // Order CRUD
        createOrder,
        deleteOrder,
        updateOrder,
        updateOrderNotes,

        // Order status
        cancelOrder,
        uncancelOrder,

        // Order lines
        cancelLine,
        uncancelLine,
        updateLine,
        updateLineNotes,
        updateShipByDate,
        addLine,

        // Close/reopen (visibility control)
        closeLines,
        reopenLines,
        closeOrder,
        reopenOrder,

        // Customization
        customizeLine,
        removeCustomization,

        // Helper
        invalidateAll,
    };
}

export default useOrdersMutations;
