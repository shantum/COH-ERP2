/**
 * Async Handler Middleware
 * Wraps async route handlers to automatically catch errors and pass to error middleware
 *
 * Usage:
 * router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await someAsyncOperation();
 *     res.json(data);
 * }));
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Type for an async route handler function
 */
type AsyncRequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<void | Response>;

/**
 * Wraps an async Express route handler to catch errors automatically
 *
 * @param fn - Async route handler function
 * @returns Express middleware function
 *
 * @example
 * // Before (with try-catch)
 * router.get('/orders', async (req, res) => {
 *     try {
 *         const orders = await prisma.order.findMany();
 *         res.json(orders);
 *     } catch (error) {
 *         console.error('Error:', error);
 *         res.status(500).json({ error: 'Failed to fetch orders' });
 *     }
 * });
 *
 * // After (with asyncHandler)
 * router.get('/orders', asyncHandler(async (req, res) => {
 *     const orders = await prisma.order.findMany();
 *     res.json(orders);
 * }));
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

export default asyncHandler;
