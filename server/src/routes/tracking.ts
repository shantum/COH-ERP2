/**
 * Tracking Debug Routes
 *
 * API endpoints for debugging iThink tracking data.
 * Provides access to stored raw API responses for troubleshooting.
 *
 * @module routes/tracking
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { getTrackingResponses, getStorageStats } from '../services/trackingResponseStorage.js';
import { trackingLogger } from '../utils/logger.js';

const router: Router = Router();

// ============================================================================
// Input Validation Schemas
// ============================================================================

const GetResponsesParamsSchema = z.object({
    awbNumber: z.string().min(1, 'AWB number is required'),
});

const GetResponsesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(10).optional().default(5),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/tracking/:awbNumber/responses
 *
 * Get stored raw API responses for an AWB number.
 * Useful for debugging tracking issues.
 *
 * Requires admin authentication.
 */
router.get(
    '/:awbNumber/responses',
    authenticateToken,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
        try {
            // Validate params
            const paramsResult = GetResponsesParamsSchema.safeParse(req.params);
            if (!paramsResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid AWB number',
                    details: paramsResult.error.issues,
                });
                return;
            }

            // Validate query
            const queryResult = GetResponsesQuerySchema.safeParse(req.query);
            if (!queryResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: queryResult.error.issues,
                });
                return;
            }

            const { awbNumber } = paramsResult.data;
            const { limit } = queryResult.data;

            const responses = await getTrackingResponses(awbNumber, limit);

            res.json({
                success: true,
                awbNumber,
                count: responses.length,
                responses: responses.map((r) => ({
                    id: r.id,
                    source: r.source,
                    statusCode: r.statusCode,
                    response: r.response,
                    createdAt: r.createdAt.toISOString(),
                })),
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            trackingLogger.error({ error: message }, 'Failed to get tracking responses');
            res.status(500).json({
                success: false,
                error: message,
            });
        }
    }
);

/**
 * GET /api/tracking/debug/stats
 *
 * Get storage statistics for tracking responses.
 * Useful for monitoring storage usage.
 *
 * Requires admin authentication.
 */
router.get(
    '/debug/stats',
    authenticateToken,
    requireAdmin,
    async (_req: Request, res: Response): Promise<void> => {
        try {
            const stats = await getStorageStats();

            res.json({
                success: true,
                stats: {
                    totalResponses: stats.totalResponses,
                    uniqueAwbs: stats.uniqueAwbs,
                    maxResponsesPerAwb: 5,
                },
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            trackingLogger.error({ error: message }, 'Failed to get storage stats');
            res.status(500).json({
                success: false,
                error: message,
            });
        }
    }
);

export default router;
