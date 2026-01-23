/**
 * Kysely Singleton Factory
 *
 * Creates a shared Kysely query builder instance for type-safe SQL queries.
 * Uses globalThis singleton pattern to prevent multiple connections.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY - DO NOT USE STATIC IMPORTS ⚠️
 * This file uses `await import('kysely')` and `await import('pg')` intentionally.
 * Static imports would break client bundling. See services/index.ts for details.
 *
 * Usage:
 *   import { getKysely } from '@coh/shared/services/db';
 *
 *   const db = await getKysely();
 *   const result = await db
 *     .selectFrom('Order')
 *     .select(['id', 'orderNumber'])
 *     .where('status', '=', 'open')
 *     .execute();
 */

import type { Kysely } from 'kysely';

/**
 * Database type interface - matches Prisma schema
 * This is generated from server/src/db/types.ts
 *
 * We use a generic placeholder here to avoid direct dependency on server types.
 * The actual DB type will be provided by the consuming module.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

/**
 * Get or create Kysely singleton instance
 *
 * Uses dynamic imports to prevent Node.js code (pg, Buffer) from being
 * bundled into client builds. Creates singleton on globalThis.
 *
 * @returns Promise<Kysely<Database>> - Kysely query builder instance
 */
export async function getKysely(): Promise<Kysely<Database>> {
    const { Kysely: KyselyClass, PostgresDialect } = await import('kysely');
    const { Pool } = await import('pg');

    // Use globalThis for singleton storage
    const globalForKysely = globalThis as unknown as {
        kyselyInstance: Kysely<Database> | undefined;
    };

    if (!globalForKysely.kyselyInstance) {
        globalForKysely.kyselyInstance = new KyselyClass<Database>({
            dialect: new PostgresDialect({
                pool: new Pool({
                    connectionString: process.env.DATABASE_URL,
                    max: 10, // Connection pool size
                }),
            }),
        });
    }

    return globalForKysely.kyselyInstance;
}

/**
 * Type helper for Kysely instance
 * Use this when typing function parameters that accept a Kysely instance
 */
export type KyselyDB = Kysely<Database>;
