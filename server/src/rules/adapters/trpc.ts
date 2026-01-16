/**
 * tRPC Adapter for Rules Engine
 * Provides integration with tRPC procedures
 */

import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import type { RuleOperation, RulesExecutionResult } from '../core/types.js';
import { executeRules, enforceRules, checkRules } from '../core/executor.js';
import type { PrismaOrTransaction } from '../../utils/patterns/types.js';

// Ensure rules are registered
import '../definitions/index.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * tRPC context shape (minimal required fields)
 */
interface TrpcContext {
    prisma: PrismaClient;
    user: {
        id: string;
        email: string;
        role: string;
    } | null;
}

/**
 * Options for enforcing rules in tRPC
 */
interface EnforceRulesOptions<TData> {
    /** Prisma client or transaction (overrides ctx.prisma if provided) */
    prisma?: PrismaOrTransaction;
    /** User ID (overrides ctx.user.id if provided) */
    userId?: string;
    /** Data to validate */
    data: TData;
    /** Execution phase */
    phase: 'pre' | 'transaction';
}

// ============================================
// TRPC INTEGRATION FUNCTIONS
// ============================================

/**
 * Enforce rules in a tRPC procedure, throwing TRPCError on failure
 *
 * This function maps BusinessLogicError to appropriate TRPCError codes.
 *
 * @example
 * ```typescript
 * const cancelOrder = protectedProcedure
 *     .input(z.object({ orderId: z.string() }))
 *     .mutation(async ({ input, ctx }) => {
 *         const order = await ctx.prisma.order.findUnique({ ... });
 *
 *         // Enforce rules - throws TRPCError if any fail
 *         await enforceRulesInTrpc('cancelOrder', ctx, {
 *             data: { order },
 *             phase: 'pre',
 *         });
 *
 *         // Proceed with cancellation...
 *     });
 * ```
 */
export async function enforceRulesInTrpc<TData = unknown>(
    operation: RuleOperation,
    ctx: TrpcContext,
    options: EnforceRulesOptions<TData>
): Promise<RulesExecutionResult> {
    const prisma = options.prisma ?? ctx.prisma;
    const userId = options.userId ?? ctx.user?.id;

    if (!userId) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'User ID required for rule enforcement',
        });
    }

    try {
        return await enforceRules(operation, {
            prisma,
            userId,
            data: options.data,
            phase: options.phase,
        });
    } catch (error) {
        // Map BusinessLogicError to TRPCError
        if (error instanceof Error && 'statusCode' in error) {
            const statusCode = (error as { statusCode: number }).statusCode;
            const errorCode = 'rule' in error ? (error as { rule: string | null }).rule : undefined;

            throw new TRPCError({
                code: mapStatusCodeToTrpc(statusCode),
                message: error.message,
                cause: errorCode ? { errorCode } : undefined,
            });
        }

        // Re-throw unknown errors
        throw error;
    }
}

/**
 * Execute rules in a tRPC procedure without throwing
 * Returns results for manual handling
 *
 * @example
 * ```typescript
 * const result = await executeRulesInTrpc('cancelOrder', ctx, {
 *     data: { order },
 *     phase: 'pre',
 * });
 *
 * if (!result.success) {
 *     // Custom error handling
 *     return { error: result.errors[0].message };
 * }
 * ```
 */
export async function executeRulesInTrpc<TData = unknown>(
    operation: RuleOperation,
    ctx: TrpcContext,
    options: EnforceRulesOptions<TData>
): Promise<RulesExecutionResult> {
    const prisma = options.prisma ?? ctx.prisma;
    const userId = options.userId ?? ctx.user?.id ?? 'anonymous';

    return executeRules(operation, {
        prisma,
        userId,
        data: options.data,
        phase: options.phase,
    });
}

/**
 * Check rules in a tRPC procedure - returns boolean result
 * Useful for UI validation
 *
 * @example
 * ```typescript
 * const canCancel = await checkRulesInTrpc('cancelOrder', ctx, {
 *     data: { order },
 *     phase: 'pre',
 * });
 *
 * if (!canCancel.allowed) {
 *     throw new TRPCError({
 *         code: 'BAD_REQUEST',
 *         message: canCancel.message,
 *     });
 * }
 * ```
 */
export async function checkRulesInTrpc<TData = unknown>(
    operation: RuleOperation,
    ctx: TrpcContext,
    options: EnforceRulesOptions<TData>
): Promise<{
    allowed: boolean;
    message?: string;
    errorCode?: string;
    warnings?: string[];
}> {
    const prisma = options.prisma ?? ctx.prisma;
    const userId = options.userId ?? ctx.user?.id ?? 'anonymous';

    return checkRules(operation, {
        prisma,
        userId,
        data: options.data,
        phase: options.phase,
    });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Map HTTP status code to tRPC error code
 */
function mapStatusCodeToTrpc(statusCode: number): TRPCError['code'] {
    switch (statusCode) {
        case 400:
            return 'BAD_REQUEST';
        case 401:
            return 'UNAUTHORIZED';
        case 403:
            return 'FORBIDDEN';
        case 404:
            return 'NOT_FOUND';
        case 409:
            return 'CONFLICT';
        case 422:
            return 'BAD_REQUEST'; // tRPC doesn't have UNPROCESSABLE_ENTITY
        case 500:
        default:
            return 'INTERNAL_SERVER_ERROR';
    }
}

/**
 * Create a tRPC error from a rule result
 */
export function createTrpcErrorFromRule(
    result: RulesExecutionResult
): TRPCError {
    if (result.success) {
        throw new Error('Cannot create error from successful result');
    }

    const firstError = result.errors[0];
    return new TRPCError({
        code: 'BAD_REQUEST',
        message: firstError.message ?? 'Rule validation failed',
        cause: firstError.errorCode ? { errorCode: firstError.errorCode } : undefined,
    });
}
