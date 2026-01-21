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

// SSR MODE: Server Functions enabled for queries (migrations in progress)
// Mutations remain on tRPC until query migration is stable
export const USE_SERVER_FUNCTIONS = {
    /**
     * customers.list - Customer listing
     * Status: ENABLED - Simple query, low risk
     */
    customersList: true,

    /**
     * products.list - Product tree listing
     * Status: ENABLED - Tree structure query
     */
    productsList: true,

    /**
     * inventory.getBalances - Inventory balance lookup
     * Status: ENABLED - Computed values query
     */
    inventoryGetBalances: true,

    /**
     * inventory.list - Inventory listing page
     * Status: ENABLED - Larger dataset query
     */
    inventoryList: true,

    /**
     * orders.list - Main orders listing endpoint
     * Status: ENABLED - Complex query with views/filters
     */
    ordersList: true,

    /**
     * orders.get - Single order detail
     * Status: ENABLED - Single order lookup
     */
    ordersGet: true,

    /**
     * orders.* mutations - All order mutations
     * Status: DISABLED - Keep on tRPC until queries are stable
     */
    ordersMutations: false,

    /**
     * Simple line mutations (markLineDelivered, markLineRto, receiveLineRto, cancelLine)
     * Status: DISABLED - Keep on tRPC until queries are stable
     */
    lineDeliveryMutations: false,
    lineRtoMutations: false,
    lineCancelMutations: false,
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
