/**
 * Tracking Response Storage Service
 *
 * Stores raw iThink API responses for debugging purposes.
 * Maintains a maximum of 5 responses per AWB, automatically rotating old ones.
 *
 * Usage:
 *   import { storeTrackingResponse, getTrackingResponses } from './trackingResponseStorage.js';
 *
 *   // Store a response
 *   await storeTrackingResponse('AWB123', 'sync', 200, rawApiResponse);
 *
 *   // Retrieve responses for debugging
 *   const responses = await getTrackingResponses('AWB123');
 */

import prisma from '../lib/prisma.js';
import { trackingLogger } from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of responses to keep per AWB
 */
const MAX_RESPONSES_PER_AWB = 5;

/**
 * Source types for tracking API responses
 */
export type TrackingResponseSource = 'sync' | 'manual' | 'webhook';

// ============================================================================
// Types
// ============================================================================

/**
 * Tracking API response record
 */
export interface TrackingApiResponseRecord {
    id: string;
    awbNumber: string;
    source: string;
    statusCode: number;
    response: unknown;
    createdAt: Date;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Store a tracking API response
 *
 * Stores the raw response and automatically rotates old responses
 * to maintain the maximum limit per AWB.
 *
 * @param awbNumber - The AWB number
 * @param source - Source of the request ('sync' | 'manual' | 'webhook')
 * @param statusCode - HTTP-like status code (200 for success, 404 for not found)
 * @param response - The raw API response
 */
export async function storeTrackingResponse(
    awbNumber: string,
    source: TrackingResponseSource,
    statusCode: number,
    response: unknown
): Promise<void> {
    try {
        // Create the new response record
        await prisma.trackingApiResponse.create({
            data: {
                awbNumber,
                source,
                statusCode,
                response: response as object, // Prisma Json type
            },
        });

        // Rotate old responses in the background (don't await)
        rotateResponses(awbNumber).catch((err) => {
            trackingLogger.warn(
                { awbNumber, error: err instanceof Error ? err.message : String(err) },
                'Failed to rotate tracking responses'
            );
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        trackingLogger.error(
            { awbNumber, source, error: message },
            'Failed to store tracking response'
        );
        // Don't throw - storage failures shouldn't break tracking operations
    }
}

/**
 * Store multiple tracking API responses in batch
 *
 * Optimized for bulk operations during tracking sync.
 *
 * @param responses - Array of responses to store
 */
export async function storeTrackingResponsesBatch(
    responses: Array<{
        awbNumber: string;
        source: TrackingResponseSource;
        statusCode: number;
        response: unknown;
    }>
): Promise<void> {
    if (responses.length === 0) return;

    try {
        // Create all responses in one transaction
        await prisma.trackingApiResponse.createMany({
            data: responses.map((r) => ({
                awbNumber: r.awbNumber,
                source: r.source,
                statusCode: r.statusCode,
                response: r.response as object,
            })),
        });

        // Rotate for each unique AWB (in background)
        const uniqueAwbs = [...new Set(responses.map((r) => r.awbNumber))];
        for (const awb of uniqueAwbs) {
            rotateResponses(awb).catch((err) => {
                trackingLogger.warn(
                    { awbNumber: awb, error: err instanceof Error ? err.message : String(err) },
                    'Failed to rotate tracking responses'
                );
            });
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        trackingLogger.error(
            { count: responses.length, error: message },
            'Failed to store tracking responses batch'
        );
    }
}

/**
 * Get tracking API responses for an AWB
 *
 * Returns responses in descending order (most recent first).
 *
 * @param awbNumber - The AWB number
 * @param limit - Maximum number of responses to return (default: all up to MAX)
 * @returns Array of tracking response records
 */
export async function getTrackingResponses(
    awbNumber: string,
    limit: number = MAX_RESPONSES_PER_AWB
): Promise<TrackingApiResponseRecord[]> {
    try {
        const responses = await prisma.trackingApiResponse.findMany({
            where: { awbNumber },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return responses;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        trackingLogger.error(
            { awbNumber, error: message },
            'Failed to get tracking responses'
        );
        return [];
    }
}

/**
 * Delete all tracking responses for an AWB
 *
 * Use when an AWB is no longer needed (e.g., archived orders).
 *
 * @param awbNumber - The AWB number
 * @returns Number of deleted records
 */
export async function deleteTrackingResponses(awbNumber: string): Promise<number> {
    try {
        const result = await prisma.trackingApiResponse.deleteMany({
            where: { awbNumber },
        });
        return result.count;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        trackingLogger.error(
            { awbNumber, error: message },
            'Failed to delete tracking responses'
        );
        return 0;
    }
}

/**
 * Rotate old responses to maintain the maximum limit
 *
 * Keeps only the most recent MAX_RESPONSES_PER_AWB responses,
 * deleting older ones.
 *
 * @param awbNumber - The AWB number
 */
async function rotateResponses(awbNumber: string): Promise<void> {
    // Get count of existing responses
    const count = await prisma.trackingApiResponse.count({
        where: { awbNumber },
    });

    if (count <= MAX_RESPONSES_PER_AWB) {
        return; // Nothing to rotate
    }

    // Find IDs of responses to keep (most recent)
    const toKeep = await prisma.trackingApiResponse.findMany({
        where: { awbNumber },
        orderBy: { createdAt: 'desc' },
        take: MAX_RESPONSES_PER_AWB,
        select: { id: true },
    });

    const keepIds = toKeep.map((r) => r.id);

    // Delete all others
    const deleted = await prisma.trackingApiResponse.deleteMany({
        where: {
            awbNumber,
            id: { notIn: keepIds },
        },
    });

    if (deleted.count > 0) {
        trackingLogger.debug(
            { awbNumber, deleted: deleted.count },
            'Rotated old tracking responses'
        );
    }
}

/**
 * Get storage statistics
 *
 * Useful for monitoring and debugging.
 */
export async function getStorageStats(): Promise<{
    totalResponses: number;
    uniqueAwbs: number;
}> {
    try {
        const [totalResult, uniqueResult] = await Promise.all([
            prisma.trackingApiResponse.count(),
            prisma.trackingApiResponse.groupBy({
                by: ['awbNumber'],
            }),
        ]);

        return {
            totalResponses: totalResult,
            uniqueAwbs: uniqueResult.length,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        trackingLogger.error({ error: message }, 'Failed to get storage stats');
        return { totalResponses: 0, uniqueAwbs: 0 };
    }
}
