/**
 * Database Services - Singleton Factories & Queries
 *
 * Exports Kysely and Prisma singleton factory functions.
 * Also exports high-performance query functions.
 * These can be imported from Server Functions and Express routes.
 */

export { getKysely, type KyselyDB, type Database } from './kysely.js';
export { getPrisma, type PrismaInstance, type PrismaTransaction } from './prisma.js';

// Re-export queries for convenience
export * from './queries/index.js';

// Re-export business graph layer
export * from '../business/index.js';
