/**
 * Kysely Factory
 *
 * Creates and manages a singleton Kysely instance for database access.
 * Shared between Express server and TanStack Start Server Functions.
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './types.js';

let kyselyInstance: Kysely<DB> | null = null;

/**
 * Create or return the singleton Kysely instance
 *
 * @param connectionString - Optional database connection string (defaults to DATABASE_URL env var)
 * @returns Kysely instance configured for PostgreSQL
 */
export function createKysely(connectionString?: string): Kysely<DB> {
    if (kyselyInstance) return kyselyInstance;

    const pool = new pg.Pool({
        connectionString: connectionString || process.env.DATABASE_URL,
        max: 10,
    });

    kyselyInstance = new Kysely<DB>({
        dialect: new PostgresDialect({ pool }),
    });

    return kyselyInstance;
}

/**
 * Get the existing Kysely instance
 *
 * @throws Error if createKysely() hasn't been called yet
 * @returns The singleton Kysely instance
 */
export function getKysely(): Kysely<DB> {
    if (!kyselyInstance) {
        throw new Error('Kysely not initialized. Call createKysely() first.');
    }
    return kyselyInstance;
}

/**
 * Type helper for Kysely instance
 * Use this when typing function parameters that accept a Kysely instance
 */
export type KyselyDB = Kysely<DB>;
