/**
 * Server Functions Feature Flags
 *
 * Controls migration from tRPC to TanStack Start Server Functions.
 * Enable flags one at a time to safely migrate endpoints.
 *
 * Usage in hooks:
 *   import { USE_SERVER_FUNCTIONS } from '@/config/serverFunctionFlags';
 *
 *   if (USE_SERVER_FUNCTIONS.ordersList) {
 *     // Use Server Function
 *     return getOrders({ data: params });
 *   } else {
 *     // Use tRPC
 *     return trpc.orders.list.useQuery(params);
 *   }
 */

// SPA MODE: All Server Functions disabled - use tRPC instead
// Server Functions require TanStack Start SSR runtime which isn't available in SPA builds
export const USE_SERVER_FUNCTIONS = {
    /**
     * orders.list - Main orders listing endpoint
     * Status: DISABLED for SPA - uses tRPC
     */
    ordersList: false,

    /**
     * orders.get - Single order detail
     * Status: DISABLED - uses tRPC
     */
    ordersGet: false,

    /**
     * orders.* mutations - All order mutations
     * Status: DISABLED - uses tRPC
     */
    ordersMutations: false,

    /**
     * Simple line mutations (markLineDelivered, markLineRto, receiveLineRto, cancelLine)
     * Status: DISABLED - uses tRPC
     */
    lineDeliveryMutations: false,
    lineRtoMutations: false,
    lineCancelMutations: false,

    /**
     * inventory.getBalances - Inventory balance lookup
     * Status: DISABLED - uses tRPC
     */
    inventoryGetBalances: false,

    /**
     * inventory.list - Inventory listing page
     * Status: DISABLED for SPA - uses tRPC
     */
    inventoryList: false,

    /**
     * customers.list - Customer listing
     * Status: DISABLED for SPA - uses tRPC
     */
    customersList: false,

    /**
     * products.list - Product tree listing
     * Status: DISABLED for SPA - uses tRPC
     */
    productsList: false,
} as const;

/**
 * Type for feature flag keys
 */
export type ServerFunctionFlag = keyof typeof USE_SERVER_FUNCTIONS;

/**
 * Check if a Server Function is enabled
 * @param flag - The feature flag to check
 * @returns true if the Server Function should be used
 */
export function isServerFunctionEnabled(flag: ServerFunctionFlag): boolean {
    return USE_SERVER_FUNCTIONS[flag];
}
