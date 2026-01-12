/**
 * tRPC Base Infrastructure
 * Core tRPC setup with context creation and procedure definitions
 *
 * Context includes:
 * - prisma: PrismaClient instance
 * - user: Authenticated user JWT payload (null if not authenticated)
 * - userPermissions: User's effective permissions array
 *
 * Procedures:
 * - publicProcedure: No authentication required
 * - protectedProcedure: Requires authentication (user must be logged in)
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { PrismaClient } from '@prisma/client';
import superjson from 'superjson';

/**
 * tRPC context type
 * Matches Express request augmentations from express.d.ts
 */
export interface Context {
    prisma: PrismaClient;
    user: {
        id: string;
        email: string;
        role: string;
        roleId: string;
        tokenVersion: number;
    } | null;
    userPermissions: string[];
}

/**
 * Create tRPC context from Express request
 * Extracts user and permissions from Express middleware (authenticateToken)
 */
export const createContext = ({ req }: CreateExpressContextOptions): Context => {
    return {
        prisma: req.prisma,
        user: req.user || null,
        userPermissions: req.userPermissions || [],
    };
};

/**
 * Initialize tRPC with SuperJSON transformer for Date/Map/Set support
 */
const t = initTRPC.context<Context>().create({
    transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Protected procedure - requires authentication
 * Throws UNAUTHORIZED if user is not logged in
 * Returns context with guaranteed non-null user
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'You must be logged in to access this resource',
        });
    }
    return next({
        ctx: {
            ...ctx,
            user: ctx.user, // User is now guaranteed to be defined
        },
    });
});
