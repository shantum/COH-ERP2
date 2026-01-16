/**
 * Order workflow mutations
 * Handles allocate/unallocate/pick/pack line status transitions
 */

import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../services/trpc';
import { inventoryQueryKeys } from '../../constants/queryKeys';
import { useOrderInvalidation } from './orderMutationUtils';
import type { MutationOptions } from './orderMutationUtils';

export function useOrderWorkflowMutations() {
    const queryClient = useQueryClient();
    const { invalidateOpenOrders } = useOrderInvalidation();

    const allocate = trpc.orders.allocate.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err) => {
            const errorMsg = err.message || '';
            if (errorMsg.includes('Insufficient stock')) {
                alert(errorMsg);
            } else if (!errorMsg.includes('pending') && !errorMsg.includes('allocated')) {
                alert(errorMsg || 'Failed to allocate');
            }
        }
    });

    // Line status mutations - all use unified setLineStatus tRPC procedure
    const setLineStatusMutation = trpc.orders.setLineStatus.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.balance });
        },
        onError: (err) => {
            const msg = err.message || 'Failed to update line status';
            if (!msg.includes('Cannot transition')) {
                alert(msg);
            }
        }
    });

    // Wrapper mutations that use setLineStatus with specific statuses
    const unallocate = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'pending' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'pending' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const pickLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'picked' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'picked' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const unpickLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'allocated' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'allocated' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const packLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'packed' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'packed' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    const unpackLine = {
        mutate: (lineId: string, opts?: MutationOptions) => setLineStatusMutation.mutate(
            { lineId, status: 'picked' },
            opts
        ),
        mutateAsync: (lineId: string) => setLineStatusMutation.mutateAsync({ lineId, status: 'picked' }),
        isPending: setLineStatusMutation.isPending,
        isError: setLineStatusMutation.isError,
        error: setLineStatusMutation.error,
    };

    return {
        allocate,
        unallocate,
        pickLine,
        unpickLine,
        packLine,
        unpackLine,
    };
}
