/**
 * Shared Zod schemas for COH ERP
 *
 * This file contains common validation schemas that are shared between server and client.
 * Order-specific schemas are in ./orders.ts
 */

// Re-export common schemas (base schemas without circular dependencies)
export * from './common.js';

// Re-export domain schemas
export * from './orders.js';
export * from './production.js';
export * from './returns.js';
export * from './reconciliation.js';
export * from './customers.js';
export * from './inventory.js';
export * from './products.js';
export * from './fabricReceipt.js';
export * from './fabricInvoice.js';
export * from './returnPrime.js';
