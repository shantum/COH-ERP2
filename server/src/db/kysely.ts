/**
 * Kysely Query Builder Configuration
 *
 * Uses prisma-extension-kysely to share Prisma's connection pool.
 * Import the extended client from './index.ts' for queries.
 *
 * Usage:
 *   import { prisma } from '../db';
 *
 *   // Kysely queries
 *   const result = await prisma.$kysely
 *     .selectFrom('Order')
 *     .select(['id', 'orderNumber'])
 *     .where('status', '=', 'open')
 *     .execute();
 */

import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import kyselyExtension from 'prisma-extension-kysely';
import type { DB } from './types.js';

/**
 * Creates the Kysely extension for Prisma
 * This enables $kysely on the Prisma client and shares the connection pool
 */
export function createKyselyExtension() {
    return kyselyExtension({
        kysely: (driver) =>
            new Kysely<DB>({
                dialect: {
                    createDriver: () => driver,
                    createAdapter: () => new PostgresAdapter(),
                    createIntrospector: (db) => new PostgresIntrospector(db),
                    createQueryCompiler: () => new PostgresQueryCompiler(),
                },
            }),
    });
}

/**
 * Type helper for Kysely instance
 * Use this when typing function parameters that accept a Kysely instance
 */
export type KyselyDB = Kysely<DB>;

/**
 * Re-export generated types for convenience
 */
export type { DB } from './types.js';
