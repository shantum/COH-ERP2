/**
 * App Router
 * Root tRPC router that combines all domain routers
 *
 * Current routers:
 * - auth: Authentication and user management
 * - customers: Customer management and statistics
 * - inventory: Inventory tracking and transactions
 * - orders: Order management
 * - products: Product catalog (products, variations, SKUs)
 * - returns: Return request management
 */

import { router } from '../index.js';
import { authRouter } from './auth.js';
import { customersRouter } from './customers.js';
import { inventoryRouter } from './inventory.js';
import { ordersRouter } from './orders.js';
import { productsRouter } from './products.js';
import { returnsRouter } from './returns.js';

export const appRouter = router({
    auth: authRouter,
    customers: customersRouter,
    inventory: inventoryRouter,
    orders: ordersRouter,
    products: productsRouter,
    returns: returnsRouter,
});

/**
 * Export type definition for client-side type safety
 * Import this type in the frontend to get full type inference
 *
 * @example
 * // In client code:
 * import type { AppRouter } from '../../server/src/trpc/routers/_app';
 * const trpc = createTRPCClient<AppRouter>({ ... });
 */
export type AppRouter = typeof appRouter;
