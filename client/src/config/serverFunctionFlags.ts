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

export const USE_SERVER_FUNCTIONS = {
    /**
     * orders.list - Main orders listing endpoint
     * Status: DISABLED - Server Functions require TanStack Start SSR mode
     * Set to true only when running with `npm run dev` (SSR mode)
     */
    ordersList: false,

    /**
     * orders.get - Single order detail
     * Status: PENDING - Keep on tRPC
     */
    ordersGet: false,

    /**
     * orders.* mutations - All order mutations
     * Status: PENDING - Keep on tRPC (complex with optimistic updates)
     */
    ordersMutations: false,

    /**
     * inventory.getBalances - Inventory balance lookup
     * Status: PENDING - Simple read, good candidate
     */
    inventoryGetBalances: false,

    /**
     * customers.list - Customer listing
     * Status: PENDING - Simple read, good candidate
     */
    customersList: false,

    /**
     * products.list - Product tree listing
     * Status: PENDING - Tree structure, medium complexity
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
