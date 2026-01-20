/**
 * Prisma Client Re-export
 *
 * This module re-exports the Prisma client from '../db' for backward compatibility.
 * For Kysely queries, import `kysely` from '../db' directly.
 *
 * For new code, prefer importing directly from '../db':
 *   import { prisma, kysely } from '../db';
 */

import { prisma } from '../db/index.js';

export default prisma;

// Re-export types for convenience
export type { KyselyDB, DB } from '../db/index.js';
