/**
 * Prisma Client Singleton Factory
 *
 * Creates a shared Prisma client instance for database operations.
 * Uses globalThis singleton pattern to prevent multiple connections.
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
 * @returns Promise<PrismaInstance> - Prisma client instance
 */
export async function getPrisma(): Promise<PrismaInstance> {
    const { PrismaClient } = await import('@prisma/client');

    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };

    // Create new instance or reuse existing singleton
    const prisma = globalForPrisma.prisma ?? new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    // In development, cache on globalThis to survive hot reloads
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }

    return prisma;
}
