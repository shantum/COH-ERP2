/**
 * Kysely Factory
 *
 * Creates and manages a singleton Kysely instance for database access.
 * Shared between Express server and TanStack Start Server Functions.
 */
import { Kysely } from 'kysely';
import type { DB } from './types.js';
/**
 * Create or return the singleton Kysely instance
 *
 * @param connectionString - Optional database connection string (defaults to DATABASE_URL env var)
 * @returns Kysely instance configured for PostgreSQL
 */
export declare function createKysely(connectionString?: string): Kysely<DB>;
/**
 * Get the existing Kysely instance
 *
 * @throws Error if createKysely() hasn't been called yet
 * @returns The singleton Kysely instance
 */
export declare function getKysely(): Kysely<DB>;
/**
 * Type helper for Kysely instance
 * Use this when typing function parameters that accept a Kysely instance
 */
export type KyselyDB = Kysely<DB>;
//# sourceMappingURL=createKysely.d.ts.map