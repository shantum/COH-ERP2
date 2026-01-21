/**
 * Deprecation Middleware
 * Logs warnings and adds headers for deprecated REST routes
 */

import type { Request, Response, NextFunction } from 'express';

interface DeprecationConfig {
    endpoint: string;
    alternative?: string;
    deprecatedSince: string;
}

/**
 * Middleware to mark a REST route as deprecated
 * - Logs a warning with user/request context
 * - Adds Deprecation header to response
 *
 * Routes remain functional during deprecation period to allow monitoring
 * before removal.
 *
 * @example
 * router.get('/', deprecated({
 *     endpoint: 'GET /orders',
 *     alternative: 'Server Function: getOrders',
 *     deprecatedSince: '2026-01-16',
 * }), handler);
 */
export function deprecated(config: DeprecationConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const alternativeMsg = config.alternative ? ` - use ${config.alternative}` : '';
        console.warn(`[DEPRECATED] ${config.endpoint} called${alternativeMsg}`, {
            path: req.originalUrl,
            method: req.method,
            userId: req.user?.id,
            timestamp: new Date().toISOString(),
        });

        res.setHeader('Deprecation', config.deprecatedSince);
        if (config.alternative) {
            res.setHeader('X-Alternative', config.alternative);
        }
        next();
    };
}
