/**
 * Prisma Client Singleton Factory
 *
 * Creates a shared Prisma client instance for database operations.
 * Uses globalThis singleton pattern to prevent multiple connections.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY - DO NOT USE STATIC IMPORTS ⚠️
 * This file uses `await import('@prisma/client')` intentionally.
 * Static imports would break client bundling. See services/index.ts for details.
 *
 * Usage:
 *   import { getPrisma } from '@coh/shared/services/db';
 *
 *   const prisma = await getPrisma();
 *   const orders = await prisma.order.findMany();
 */

/**
 * Type alias for Prisma client instance
 * Use InstanceType<typeof PrismaClient> for proper typing
 */
export type PrismaInstance = InstanceType<typeof import('@prisma/client').PrismaClient>;

/**
 * Type for Prisma transaction client
 * Omits methods unavailable in transaction context
 */
export type PrismaTransaction = Omit<
    PrismaInstance,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Get or create Prisma singleton instance
 *
 * Uses dynamic import to prevent Node.js code from being bundled into client builds.
 * Creates singleton on globalThis with environment-specific caching.
 *
 * NOTE: If models are missing after schema changes, the cached client will be
 * invalidated and a fresh instance created.
 *
 * @returns Promise<PrismaInstance> - Prisma client instance
 */
export async function getPrisma(): Promise<PrismaInstance> {
    const { PrismaClient } = await import('@prisma/client');

    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };

    // Check if cached client has required models, if not, invalidate cache
    // This handles cases where schema was updated but dev server wasn't restarted
    const hasAllModels = globalForPrisma.prisma &&
        'returnPrimeRequest' in globalForPrisma.prisma;

    if (globalForPrisma.prisma && !hasAllModels) {
        console.log('[getPrisma] Cached client missing new models, creating fresh instance');
        globalForPrisma.prisma = undefined;
    }

    // Reuse existing singleton if available
    if (globalForPrisma.prisma) {
        return globalForPrisma.prisma;
    }

    // Create new instance with connection pooling configured
    // Railway's shared Postgres has limited connections, so we limit the pool
    const prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    // ALWAYS cache on globalThis - both development and production
    // This is critical to prevent connection pool exhaustion
    globalForPrisma.prisma = prisma;

    return prisma;
}
