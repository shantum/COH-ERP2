/**
 * Order Mutations Server Functions
 *
 * TanStack Start Server Functions for order line mutations.
 * Calls domain layer directly from the server.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// ============================================
// INPUT SCHEMAS
// ============================================

const markLineDeliveredSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    deliveredAt: z.string().datetime().optional(),
});

const markLineRtoSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
});

const receiveLineRtoSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    condition: z.enum(['good', 'unopened', 'damaged', 'wrong_product']).optional().default('good'),
});

const cancelLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    reason: z.string().optional(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT';
        message: string;
    };
}

export interface MarkLineDeliveredResult {
    lineId: string;
    orderId: string;
    deliveredAt: Date;
    orderTerminal: boolean;
}

export interface MarkLineRtoResult {
    lineId: string;
    orderId: string;
    rtoInitiatedAt: Date;
}

export interface ReceiveLineRtoResult {
    lineId: string;
    orderId: string;
    rtoReceivedAt: Date;
    condition: string;
    orderTerminal: boolean;
    inventoryRestored: boolean;
}

export interface CancelLineResult {
    lineId: string;
    orderId: string;
    lineStatus: 'cancelled';
    inventoryReleased: boolean;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Mark a shipped line as delivered
 */
export const markLineDelivered = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => markLineDeliveredSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<MarkLineDeliveredResult>> => {
        console.log('[Server Function] markLineDelivered called with:', data);

        try {
            // Dynamic imports
            const { createKysely, getKysely } = await import('@coh/shared/database');
            const { markLineDeliveredKysely } = await import(
                '@coh/shared/domain/orders/lineMutations'
            );

            // Initialize Kysely
            createKysely(process.env.DATABASE_URL);
            const db = getKysely();

            // Call domain function
            const result = await markLineDeliveredKysely(db, {
                lineId: data.lineId,
                deliveredAt: data.deliveredAt,
            });

            // Deferred: Broadcast SSE update (fire-and-forget)
            if (result.success && result.data) {
                setImmediate(async () => {
                    try {
                        // SSE broadcast would go here if we had access to it
                        // For now, client will invalidate query cache
                        console.log('[Server Function] Delivery update broadcasted', result.data);
                    } catch (e) {
                        console.error('[Server Function] SSE broadcast failed', e);
                    }
                });
            }

            console.log('[Server Function] markLineDelivered result:', result);
            return result;
        } catch (error) {
            console.error('[Server Function] Error in markLineDelivered:', error);
            throw error;
        }
    });

/**
 * Initiate RTO for a shipped line
 */
export const markLineRto = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => markLineRtoSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<MarkLineRtoResult>> => {
        console.log('[Server Function] markLineRto called with:', data);

        try {
            // Dynamic imports
            const { createKysely, getKysely } = await import('@coh/shared/database');
            const { markLineRtoKysely } = await import('@coh/shared/domain/orders/lineMutations');

            // Initialize Kysely
            createKysely(process.env.DATABASE_URL);
            const db = getKysely();

            // Call domain function
            const result = await markLineRtoKysely(db, { lineId: data.lineId });

            // Deferred: Broadcast SSE update
            if (result.success && result.data) {
                setImmediate(async () => {
                    console.log('[Server Function] RTO update broadcasted', result.data);
                });
            }

            console.log('[Server Function] markLineRto result:', result);
            return result;
        } catch (error) {
            console.error('[Server Function] Error in markLineRto:', error);
            throw error;
        }
    });

/**
 * Mark RTO as received (item returned to warehouse)
 */
export const receiveLineRto = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => receiveLineRtoSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<ReceiveLineRtoResult>> => {
        console.log('[Server Function] receiveLineRto called with:', data);

        try {
            // Dynamic imports
            const { createKysely, getKysely } = await import('@coh/shared/database');
            const { receiveLineRtoKysely } = await import(
                '@coh/shared/domain/orders/lineMutations'
            );

            // Initialize Kysely
            createKysely(process.env.DATABASE_URL);
            const db = getKysely();

            // Call domain function
            const result = await receiveLineRtoKysely(db, {
                lineId: data.lineId,
                condition: data.condition,
            });

            // Deferred: Broadcast SSE update + invalidate inventory cache
            if (result.success && result.data) {
                setImmediate(async () => {
                    console.log('[Server Function] RTO receive broadcasted', result.data);
                });
            }

            console.log('[Server Function] receiveLineRto result:', result);
            return result;
        } catch (error) {
            console.error('[Server Function] Error in receiveLineRto:', error);
            throw error;
        }
    });

/**
 * Cancel an order line
 */
export const cancelLine = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => cancelLineSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<CancelLineResult>> => {
        console.log('[Server Function] cancelLine called with:', data);

        try {
            // Dynamic imports
            const { createKysely, getKysely } = await import('@coh/shared/database');
            const { cancelLineKysely } = await import('@coh/shared/domain/orders/lineMutations');

            // Initialize Kysely
            createKysely(process.env.DATABASE_URL);
            const db = getKysely();

            // Call domain function
            const result = await cancelLineKysely(db, {
                lineId: data.lineId,
                reason: data.reason,
            });

            // Deferred: Broadcast SSE update + invalidate inventory cache
            if (result.success && result.data) {
                setImmediate(async () => {
                    console.log('[Server Function] Cancel broadcasted', result.data);
                });
            }

            console.log('[Server Function] cancelLine result:', result);
            return result;
        } catch (error) {
            console.error('[Server Function] Error in cancelLine:', error);
            throw error;
        }
    });
