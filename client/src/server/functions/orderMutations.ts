/**
 * Order Mutations Server Functions
 *
 * TanStack Start Server Functions for order line mutations.
 *
 * NOTE: These Server Functions are currently DISABLED (see serverFunctionFlags.ts).
 * The app uses tRPC for mutations. These are placeholder implementations for
 * future migration to TanStack Start Server Functions.
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
// SERVER FUNCTIONS (DISABLED - Placeholders)
// ============================================

/**
 * Mark a shipped line as delivered
 *
 * NOTE: Currently disabled. Uses tRPC via useOrderDeliveryMutations hook.
 * Enable via serverFunctionFlags.lineDeliveryMutations when ready to migrate.
 */
export const markLineDelivered = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => markLineDeliveredSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<MarkLineDeliveredResult>> => {
        console.log('[Server Function] markLineDelivered called with:', data);

        // TODO: Implement with Prisma when migrating from tRPC
        // See db.ts for Prisma initialization pattern
        throw new Error('Server Function not implemented - use tRPC mutation');
    });

/**
 * Initiate RTO for a shipped line
 *
 * NOTE: Currently disabled. Uses tRPC via useOrderDeliveryMutations hook.
 * Enable via serverFunctionFlags.lineRtoMutations when ready to migrate.
 */
export const markLineRto = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => markLineRtoSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<MarkLineRtoResult>> => {
        console.log('[Server Function] markLineRto called with:', data);

        // TODO: Implement with Prisma when migrating from tRPC
        // See db.ts for Prisma initialization pattern
        throw new Error('Server Function not implemented - use tRPC mutation');
    });

/**
 * Mark RTO as received (item returned to warehouse)
 *
 * NOTE: Currently disabled. Uses tRPC via useOrderDeliveryMutations hook.
 * Enable via serverFunctionFlags.lineRtoMutations when ready to migrate.
 */
export const receiveLineRto = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => receiveLineRtoSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<ReceiveLineRtoResult>> => {
        console.log('[Server Function] receiveLineRto called with:', data);

        // TODO: Implement with Prisma when migrating from tRPC
        // See db.ts for Prisma initialization pattern
        throw new Error('Server Function not implemented - use tRPC mutation');
    });

/**
 * Cancel an order line
 *
 * NOTE: Currently disabled. Uses tRPC via useOrderStatusMutations hook.
 * Enable via serverFunctionFlags.lineCancelMutations when ready to migrate.
 */
export const cancelLine = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => cancelLineSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<CancelLineResult>> => {
        console.log('[Server Function] cancelLine called with:', data);

        // TODO: Implement with Prisma when migrating from tRPC
        // See db.ts for Prisma initialization pattern
        throw new Error('Server Function not implemented - use tRPC mutation');
    });
