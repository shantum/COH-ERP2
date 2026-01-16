/**
 * Deprecation Middleware
 * Logs warnings and adds headers for deprecated REST routes that have tRPC equivalents
 */

import type { Request, Response, NextFunction } from 'express';

interface DeprecationConfig {
    endpoint: string;
    trpcAlternative: string;
    deprecatedSince: string;
}

/**
 * Middleware to mark a REST route as deprecated
 * - Logs a warning with user/request context
 * - Adds Deprecation and X-Trpc-Alternative headers to response
 *
 * Routes remain functional during deprecation period to allow monitoring
 * before removal.
 *
 * @example
 * router.get('/', deprecated({
 *     endpoint: 'GET /orders',
 *     trpcAlternative: 'orders.list',
 *     deprecatedSince: '2026-01-16',
 * }), handler);
 */
export function deprecated(config: DeprecationConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        console.warn(`[DEPRECATED] ${config.endpoint} called - use tRPC ${config.trpcAlternative}`, {
            path: req.originalUrl,
            method: req.method,
            userId: req.user?.id,
            timestamp: new Date().toISOString(),
        });

        res.setHeader('Deprecation', config.deprecatedSince);
        res.setHeader('X-Trpc-Alternative', config.trpcAlternative);
        next();
    };
}
