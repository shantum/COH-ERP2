/**
 * Express Adapter for Rules Engine
 * Provides middleware and utilities for Express routes
 */

import type { Request, Response, NextFunction } from 'express';
import type { RuleOperation, RulesExecutionResult } from '../core/types.js';
import { executeRules, enforceRules, checkRules } from '../core/executor.js';
import { BusinessLogicError } from '../../utils/errors.js';
import type { PrismaOrTransaction } from '../../utils/patterns/types.js';

// Ensure rules are registered
import '../definitions/index.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Options for enforcing rules in Express
 */
interface EnforceRulesOptions<TData> {
    /** Prisma client or transaction (overrides req.prisma if provided) */
    prisma?: PrismaOrTransaction;
    /** User ID (overrides req.user.id if provided) */
    userId?: string;
    /** Data to validate */
    data: TData;
    /** Execution phase */
    phase: 'pre' | 'transaction';
}

/**
 * Data extractor function for middleware
 */
type DataExtractor<TData> = (req: Request) => TData | Promise<TData>;

// ============================================
// EXPRESS INTEGRATION FUNCTIONS
// ============================================

/**
 * Enforce rules in an Express route, throwing BusinessLogicError on failure
 *
 * @example
 * ```typescript
 * router.post('/:id/cancel', async (req, res) => {
 *     const order = await req.prisma.order.findUnique({ ... });
 *
 *     // Enforce rules - throws BusinessLogicError if any fail
 *     await enforceRulesInExpress('cancelOrder', req, {
 *         data: { order },
 *         phase: 'pre',
 *     });
 *
 *     // Proceed with cancellation...
 * });
 * ```
 */
export async function enforceRulesInExpress<TData = unknown>(
    operation: RuleOperation,
    req: Request,
    options: EnforceRulesOptions<TData>
): Promise<RulesExecutionResult> {
    const prisma = options.prisma ?? req.prisma;
    const userId = options.userId ?? req.user?.id;

    if (!userId) {
        throw new BusinessLogicError('User ID required for rule enforcement', 'UNAUTHORIZED');
    }

    return enforceRules(operation, {
        prisma,
        userId,
        data: options.data,
        phase: options.phase,
    });
}

/**
 * Execute rules in an Express route without throwing
 * Returns results for manual handling
 */
export async function executeRulesInExpress<TData = unknown>(
    operation: RuleOperation,
    req: Request,
    options: EnforceRulesOptions<TData>
): Promise<RulesExecutionResult> {
    const prisma = options.prisma ?? req.prisma;
    const userId = options.userId ?? req.user?.id ?? 'anonymous';

    return executeRules(operation, {
        prisma,
        userId,
        data: options.data,
        phase: options.phase,
    });
}

/**
 * Check rules in an Express route - returns boolean result
 */
export async function checkRulesInExpress<TData = unknown>(
    operation: RuleOperation,
    req: Request,
    options: EnforceRulesOptions<TData>
): Promise<{
    allowed: boolean;
    message?: string;
    errorCode?: string;
    warnings?: string[];
}> {
    const prisma = options.prisma ?? req.prisma;
    const userId = options.userId ?? req.user?.id ?? 'anonymous';

    return checkRules(operation, {
        prisma,
        userId,
        data: options.data,
        phase: options.phase,
    });
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================

/**
 * Create Express middleware that enforces rules before route handler
 *
 * @example
 * ```typescript
 * // Inline data extraction
 * router.post(
 *     '/:id/cancel',
 *     enforceRulesMiddleware('cancelOrder', async (req) => {
 *         const order = await req.prisma.order.findUnique({
 *             where: { id: req.params.id },
 *         });
 *         return { order };
 *     }),
 *     async (req, res) => {
 *         // Rules already validated, proceed with logic
 *     }
 * );
 * ```
 */
export function enforceRulesMiddleware<TData>(
    operation: RuleOperation,
    extractData: DataExtractor<TData>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await extractData(req);
            await enforceRulesInExpress(operation, req, {
                data,
                phase: 'pre',
            });
            next();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Create Express middleware that checks rules and attaches result to request
 * Does not throw - allows route handler to decide how to handle failures
 *
 * @example
 * ```typescript
 * router.post(
 *     '/:id/cancel',
 *     checkRulesMiddleware('cancelOrder', async (req) => ({ order })),
 *     async (req, res) => {
 *         const ruleResult = req.ruleResult;
 *         if (!ruleResult.success) {
 *             return res.status(400).json({ error: ruleResult.errors[0].message });
 *         }
 *         // Proceed...
 *     }
 * );
 * ```
 */
export function checkRulesMiddleware<TData>(
    operation: RuleOperation,
    extractData: DataExtractor<TData>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await extractData(req);
            const result = await executeRulesInExpress(operation, req, {
                data,
                phase: 'pre',
            });

            // Attach result to request for route handler
            (req as Request & { ruleResult: RulesExecutionResult }).ruleResult = result;
            next();
        } catch (error) {
            next(error);
        }
    };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Send rule validation error response
 */
export function sendRuleError(res: Response, result: RulesExecutionResult): void {
    if (result.success) {
        throw new Error('Cannot send error for successful result');
    }

    const firstError = result.errors[0];
    res.status(422).json({
        error: firstError.message,
        errorCode: firstError.errorCode,
        rule: firstError.ruleId,
    });
}

/**
 * Extend Express Request type to include rule result
 */
declare global {
    namespace Express {
        interface Request {
            ruleResult?: RulesExecutionResult;
        }
    }
}
