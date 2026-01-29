/**
 * Prisma Client with Kysely Support
 *
 * This module exports:
 * - `prisma`: Standard PrismaClient (backward compatible)
 * - `kysely`: Kysely query builder for type-safe SQL
 *
 * Usage:
 *   import { prisma, kysely } from './db';
 *
 *   // Prisma queries (unchanged)
 *   const orders = await prisma.order.findMany();
 *
 *   // Kysely queries (new)
 *   const result = await kysely
 *     .selectFrom('Order')
 *     .select(['id', 'orderNumber'])
 *     .where('status', '=', 'open')
 *     .execute();
 */

import { PrismaClient } from '@prisma/client';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types.js';

// Prevent multiple instances during hot reload
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    kysely: Kysely<DB> | undefined;
};

// Standard PrismaClient - backward compatible
// ALWAYS cache to prevent connection pool exhaustion
const prismaInstance =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

// Standalone Kysely instance - uses same DATABASE_URL
const kyselyInstance =
    globalForPrisma.kysely ??
    new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: process.env.DATABASE_URL,
                max: 10, // Separate pool for Kysely queries
            }),
        }),
    });

// ALWAYS cache on globalThis - both development and production
// This is critical to prevent connection pool exhaustion in production
globalForPrisma.prisma = prismaInstance;
globalForPrisma.kysely = kyselyInstance;

export const prisma = prismaInstance;
export const kysely = kyselyInstance;

// Type exports
export type { DB } from './types.js';
export type KyselyDB = Kysely<DB>;
