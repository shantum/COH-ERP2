/**
 * Shared Database Module
 *
 * Provides Kysely database access and queries shared between
 * Express server and TanStack Start Server Functions.
 */
// Kysely factory and instance management
export { createKysely, getKysely } from './createKysely.js';
// Queries
export * from './queries/index.js';
//# sourceMappingURL=index.js.map