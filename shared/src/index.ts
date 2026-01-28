/**
 * @coh/shared - Shared types and schemas for COH ERP
 *
 * This package contains TypeScript types, Zod validation schemas,
 * validator functions, and database queries shared between server and client.
 */

// Re-export all types (type-only export for pure interfaces)
export type * from './types/index.js';

// Re-export all schemas
export * from './schemas/index.js';
export * from './schemas/orders.js';
export * from './schemas/payments.js';
export * from './schemas/searchParams.js';
export * from './schemas/materials.js';

// Re-export all validators
export * from './validators/index.js';

// Re-export utils (pure functions, no DB dependencies)
export * from './utils/index.js';

// Re-export services
export * from './services/index.js';
