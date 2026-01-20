/**
 * App Router
 * Root tRPC router that combines all domain routers
 *
 * Current routers:
 * - auth: Authentication and user management
 * - customers: Customer management and statistics
 * - inventory: Inventory tracking and transactions
 * - inventoryReconciliation: Physical count reconciliation
 * - orders: Order management
 * - payments: Payment tracking
 * - production: Production batch management and capacity planning
 * - products: Product catalog (products, variations, SKUs)
 * - returns: Return request management
 */

import { router, publicProcedure } from '../index.js';
import { authRouter } from './auth.js';
import { customersRouter } from './customers.js';
import { inventoryRouter } from './inventory.js';
import { inventoryReconciliationRouter } from './inventoryReconciliation.js';
import { ordersRouter } from './orders.js';
import { paymentsRouter } from './payments.js';
import { productionRouter } from './production.js';
import { productsRouter } from './products.js';
import { returnsRouter } from './returns.js';

/**
 * Main application router
 * Combines all feature routers
 */
export const appRouter = router({
    // Health check endpoint
    healthCheck: publicProcedure.query(() => ({ status: 'ok', timestamp: new Date() })),

    // Feature routers
    auth: authRouter,
    customers: customersRouter,
    inventory: inventoryRouter,
    inventoryReconciliation: inventoryReconciliationRouter,
    orders: ordersRouter,
    payments: paymentsRouter,
    production: productionRouter,
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
