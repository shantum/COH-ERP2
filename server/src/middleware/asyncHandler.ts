/**
 * Async Handler & Typed Route Middleware
 *
 * asyncHandler — wraps async route handlers to catch errors automatically
 * typedRoute  — combines Zod validation + asyncHandler for type-safe routes
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { z } from 'zod';

// ============================================
// Core types
// ============================================

type AsyncRequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<void | Response>;

/** Request with a typed validatedBody after Zod validation */
export type TypedRequest<TBody = unknown, TParams = Request['params'], TQuery = Request['query']> =
    Omit<Request, 'validatedBody'> & {
        validatedBody: TBody;
        params: TParams & Request['params'];
        query: TQuery & Request['query'];
    };

type TypedHandler<TBody, TParams, TQuery> = (
    req: TypedRequest<TBody, TParams, TQuery>,
    res: Response,
) => Promise<void | Response>;

// ============================================
// asyncHandler — unchanged, for unvalidated routes
// ============================================

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// ============================================
// typedRoute — Zod body validation + asyncHandler
// ============================================

/**
 * Combines Zod body validation with asyncHandler in one call.
 * Returns a RequestHandler[] to spread into router methods.
 *
 * @example
 * router.post('/confirm', requireAdmin, ...typedRoute(ConfirmSchema, async (req, res) => {
 *     const { txnId } = req.validatedBody; // ← fully typed
 *     res.json({ success: true });
 * }));
 */
export function typedRoute<T extends z.ZodTypeAny>(
    schema: T,
    handler: TypedHandler<z.infer<T>, Record<string, string>, Record<string, string>>,
): RequestHandler[] {
    const validateMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({
                error: result.error.issues[0]?.message || 'Validation failed',
                details: result.error.issues.map((issue: z.ZodIssue) => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            });
            return;
        }
        (req as TypedRequest<z.infer<T>>).validatedBody = result.data;
        next();
    };

    return [
        validateMiddleware,
        asyncHandler(handler as unknown as AsyncRequestHandler),
    ];
}

/**
 * Like typedRoute but also validates params.
 *
 * @example
 * router.delete('/:id', requireAdmin, ...typedRouteWithParams(ParamSchema, BodySchema, async (req, res) => {
 *     const { id } = req.params; // ← typed from ParamSchema
 * }));
 */
export function typedRouteWithParams<
    TParams extends z.ZodTypeAny,
    TBody extends z.ZodTypeAny,
>(
    paramsSchema: TParams,
    bodySchema: TBody | null,
    handler: TypedHandler<z.infer<TBody>, z.infer<TParams>, Record<string, string>>,
): RequestHandler[] {
    const validateMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
        const paramsResult = paramsSchema.safeParse(req.params);
        if (!paramsResult.success) {
            res.status(400).json({
                error: paramsResult.error.issues[0]?.message || 'Invalid params',
                details: paramsResult.error.issues.map((issue: z.ZodIssue) => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            });
            return;
        }
        Object.assign(req.params, paramsResult.data);

        if (bodySchema) {
            const bodyResult = bodySchema.safeParse(req.body);
            if (!bodyResult.success) {
                res.status(400).json({
                    error: bodyResult.error.issues[0]?.message || 'Validation failed',
                    details: bodyResult.error.issues.map((issue: z.ZodIssue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                });
                return;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (req as any).validatedBody = bodyResult.data;
        }

        next();
    };

    return [
        validateMiddleware,
        asyncHandler(handler as unknown as AsyncRequestHandler),
    ];
}

export default asyncHandler;
