/**
 * Shared Database Module
 *
 * Provides Kysely database access and queries shared between
 * Express server and TanStack Start Server Functions.
 */
export { createKysely, getKysely } from './createKysely.js';
export type { KyselyDB } from './createKysely.js';
export type { DB } from './types.js';
export * from './queries/index.js';
//# sourceMappingURL=index.d.ts.map