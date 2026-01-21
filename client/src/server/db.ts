/**
 * Database Initialization Pattern for TanStack Start Server Functions
 *
 * Each Server Function dynamically imports and initializes Prisma inline
 * to prevent bundling Node.js-only code into the client bundle.
 *
 * Pattern used in Server Functions:
 *
 * ```typescript
 * import type { Prisma, PrismaClient } from '@prisma/client';
 *
 * // Inside handler:
 * const { PrismaClient } = await import('@prisma/client');
 * const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
 * const prisma = globalForPrisma.prisma ?? new PrismaClient();
 * if (process.env.NODE_ENV !== 'production') {
 *     globalForPrisma.prisma = prisma;
 * }
 *
 * // Use Prisma types for type safety
 * const where: Prisma.CustomerWhereInput = {};
 * ```
 *
 * This ensures:
 * 1. Prisma is only loaded on the server (dynamic import)
 * 2. A single Prisma instance is reused across requests (global singleton)
 * 3. No Node.js code leaks into the browser bundle
 * 4. Full type safety via static type imports
 */
'use server';

// This file intentionally has no exports.
// See the pattern above for how to use Prisma in Server Functions.
