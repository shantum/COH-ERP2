/**
 * Tracking Routes
 *
 * API endpoints for tracking shipments and debugging iThink tracking data.
 * Provides tracking lookup and access to stored raw API responses.
 *
 * @module routes/tracking
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { getTrackingResponses, getStorageStats } from '../services/trackingResponseStorage.js';
import { trackingLogger } from '../utils/logger.js';
import ithinkLogistics from '../services/ithinkLogistics/index.js';

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
 * GET /api/tracking/lookup/:awbNumber
 *
 * Lookup tracking for an AWB with both formatted data and raw API response.
 * Used by the tracking page for debugging and full visibility.
 */
router.get(
    '/lookup/:awbNumber',
    authenticateToken,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const awbNumber = String(req.params.awbNumber || '');

            if (!awbNumber) {
                res.status(400).json({
                    success: false,
                    error: 'AWB number is required',
                });
                return;
            }

            // Get raw tracking data from iThink
            const rawData = await ithinkLogistics.trackShipments(awbNumber, true);
            const rawResponse = rawData[awbNumber];

            if (!rawResponse || rawResponse.message !== 'success') {
                res.status(404).json({
                    success: false,
                    error: 'Tracking data not found for this AWB',
                    rawApiResponse: rawResponse || null,
                });
                return;
            }

            // Get formatted tracking data
            const trackingData = await ithinkLogistics.getTrackingStatus(awbNumber);

            res.json({
                success: true,
                awbNumber,
                trackingData,
                rawApiResponse: rawResponse,
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            trackingLogger.error({ error: message, awbNumber: String(req.params.awbNumber || '') }, 'Tracking lookup failed');
            res.status(500).json({
                success: false,
                error: message,
            });
        }
    }
);

/**
 * GET /api/tracking/order-awb/:orderNumber
 *
 * Get the AWB number for an order by order number.
 * Used to lookup tracking when user searches by order number.
 */
router.get(
    '/order-awb/:orderNumber',
    authenticateToken,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const orderNumber = String(req.params.orderNumber || '');

            if (!orderNumber) {
                res.status(400).json({
                    success: false,
                    error: 'Order number is required',
                });
                return;
            }

            // Find order by orderNumber with first shipped line
            const order = await req.prisma.order.findFirst({
                where: {
                    orderNumber: {
                        equals: orderNumber,
                        mode: 'insensitive',
                    },
                },
                include: {
                    orderLines: {
                        where: {
                            awbNumber: { not: null },
                        },
                        take: 1,
                    },
                },
            });

            if (!order) {
                res.status(404).json({
                    success: false,
                    error: 'Order not found',
                });
                return;
            }

            const firstLineWithAwb = order.orderLines[0];
            if (!firstLineWithAwb?.awbNumber) {
                res.status(404).json({
                    success: false,
                    error: 'Order has no AWB (not shipped yet)',
                    orderNumber: order.orderNumber,
                });
                return;
            }

            res.json({
                success: true,
                orderId: order.id,
                orderNumber: order.orderNumber,
                awbNumber: firstLineWithAwb.awbNumber,
                courier: firstLineWithAwb.courier,
                trackingStatus: firstLineWithAwb.trackingStatus,
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            trackingLogger.error({ error: message, orderNumber: String(req.params.orderNumber || '') }, 'Order AWB lookup failed');
            res.status(500).json({
                success: false,
                error: message,
            });
        }
    }
);

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
