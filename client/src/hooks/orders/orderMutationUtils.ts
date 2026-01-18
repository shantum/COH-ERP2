/**
 * Shared utilities for order mutations
 * Contains invalidation helpers and common types used across mutation hooks
 */

import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { orderTabInvalidationMap } from '../../constants/queryKeys';
import { trpc } from '../../services/trpc';

// Page size for orders pagination (must match useUnifiedOrdersData)
export const PAGE_SIZE = 250;

// Map view names to tRPC query input
export const viewToTrpcInput: Record<string, { view: string; limit?: number }> = {
    open: { view: 'open', limit: PAGE_SIZE },
    shipped: { view: 'shipped', limit: PAGE_SIZE },
    rto: { view: 'rto', limit: PAGE_SIZE },
    cod_pending: { view: 'cod_pending', limit: PAGE_SIZE },
    cancelled: { view: 'cancelled', limit: PAGE_SIZE },
    archived: { view: 'archived', limit: PAGE_SIZE },
};

// Type for mutation options (onSettled, onSuccess, onError callbacks)
export type MutationOptions = {
    onSettled?: () => void;
    onSuccess?: () => void;
    onError?: (err: unknown) => void;
};

// Type for tRPC utils
type TRPCUtils = ReturnType<typeof trpc.useUtils>;

// Interface for invalidation context
export interface InvalidationContext {
    queryClient: QueryClient;
    trpcUtils: TRPCUtils;
}

// Factory for creating invalidation functions
export function createInvalidationHelpers(ctx: InvalidationContext) {
    const { queryClient, trpcUtils } = ctx;

    const invalidateTab = (tab: keyof typeof orderTabInvalidationMap) => {
        // Invalidate old Axios query keys (for any remaining Axios queries)
        const keysToInvalidate = orderTabInvalidationMap[tab];
        if (keysToInvalidate) {
            keysToInvalidate.forEach(key => {
                queryClient.invalidateQueries({ queryKey: [key] });
            });
        }

        // Invalidate tRPC query cache
        const trpcInput = viewToTrpcInput[tab];
        if (trpcInput) {
            trpcUtils.orders.list.invalidate(trpcInput);
        }
    };

    return {
        invalidateTab,
        invalidateOpenOrders: () => invalidateTab('open'),
        invalidateShippedOrders: () => invalidateTab('shipped'),
        invalidateRtoOrders: () => invalidateTab('rto'),
        invalidateCodPendingOrders: () => invalidateTab('cod_pending'),
        invalidateCancelledOrders: () => invalidateTab('cancelled'),
        invalidateAll: () => {
            Object.keys(orderTabInvalidationMap).forEach(tab => {
                invalidateTab(tab as keyof typeof orderTabInvalidationMap);
            });
        },
    };
}

// Custom hook to get invalidation helpers
export function useOrderInvalidation() {
    const queryClient = useQueryClient();
    const trpcUtils = trpc.useUtils();

    return useMemo(
        () => createInvalidationHelpers({ queryClient, trpcUtils }),
        [queryClient, trpcUtils]
    );
}
