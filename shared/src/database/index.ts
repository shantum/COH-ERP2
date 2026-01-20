/**
 * Shared Database Module
 *
 * Provides Kysely database access and queries shared between
 * Express server and TanStack Start Server Functions.
 */

// Kysely factory and instance management
export { createKysely, getKysely } from './createKysely.js';
export type { KyselyDB } from './createKysely.js';

// Database types - exported under DB namespace to avoid conflicts with domain types
// Access via: import type { DB } from '@coh/shared/database'
export type { DB } from './types.js';

// Queries
export * from './queries/index.js';
