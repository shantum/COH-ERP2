/**
 * Returns Mutations - TanStack Start Server Functions
 *
 * Phase 1 mutations - Simple CRUD with NO SSE broadcasting and NO cache invalidation.
 *
 * Mutations:
 * - updateReturnStatus: Update return request status with state machine validation
 *
 * Status flow:
 *   requested -> reverse_initiated -> in_transit -> received -> processed
 *   (can transition to cancelled from most states)
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware, type AuthUser } from '../middleware/auth';
import type { PrismaClient } from '@prisma/client';

// ============================================
// STATUS SCHEMA & STATE MACHINE (Zod is source of truth)
// ============================================

/**
 * Valid return statuses
 */
const returnStatusSchema = z.enum([
    'requested',
    'reverse_initiated',
    'in_transit',
    'received',
    'processed',
    'cancelled',
]);

type ReturnStatus = z.infer<typeof returnStatusSchema>;

/**
 * Valid status transitions (state machine)
 * Key = current status, Value = array of allowed next statuses
 */
const VALID_STATUS_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
    requested: ['reverse_initiated', 'in_transit', 'cancelled'],
    reverse_initiated: ['in_transit', 'received', 'cancelled'],
    in_transit: ['received', 'cancelled'],
    received: ['processed'],
    processed: [], // Terminal state
    cancelled: [], // Terminal state
};

/**
 * Validates if a status transition is allowed
 */
function isValidStatusTransition(
    fromStatus: ReturnStatus,
    toStatus: ReturnStatus
): boolean {
    // Allow same status (no-op)
    if (fromStatus === toStatus) return true;

    const allowedTransitions = VALID_STATUS_TRANSITIONS[fromStatus];
    if (!allowedTransitions) return false;

    return allowedTransitions.includes(toStatus);
}

// ============================================
// INPUT SCHEMAS (Zod is source of truth)
// ============================================

/**
 * Update return status input schema
 * Matches tRPC returns.updateStatus input
 */
const UpdateReturnStatusInputSchema = z.object({
    id: z.string().uuid(),
    newStatus: returnStatusSchema,
    notes: z.string().optional(),
});

export type UpdateReturnStatusInput = z.infer<typeof UpdateReturnStatusInputSchema>;

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * Update status response
 */
export interface UpdateReturnStatusResponse {
    success: boolean;
    message: string;
}

// ============================================
// UPDATE RETURN STATUS MUTATION
// ============================================

/**
 * Update return request status with state machine validation
 *
 * Validates:
 * - Return request exists
 * - Status transition is valid per state machine
 *
 * On success:
 * - Updates return status
 * - Creates status history entry for audit trail
 *
 * @returns Success message with status transition details
 */
export const updateReturnStatus = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): UpdateReturnStatusInput =>
            UpdateReturnStatusInputSchema.parse(input)
    )
    .handler(
        async ({
            data,
            context,
        }: {
            data: UpdateReturnStatusInput;
            context: { user: AuthUser };
        }): Promise<UpdateReturnStatusResponse> => {
            const { id, newStatus, notes } = data;
            const user = context.user;

            // Dynamic Prisma import to prevent bundling into client
            const { PrismaClient } = await import('@prisma/client');
            const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
            const prisma = globalForPrisma.prisma ?? new PrismaClient();
            if (process.env.NODE_ENV !== 'production') {
                globalForPrisma.prisma = prisma;
            }

            // Fetch current return request
            const returnRequest = await prisma.returnRequest.findUnique({
                where: { id },
                select: { id: true, status: true, requestNumber: true },
            });

            if (!returnRequest) {
                throw new Error('Return request not found');
            }

            const currentStatus = returnRequest.status as ReturnStatus;

            // Validate status transition
            if (!isValidStatusTransition(currentStatus, newStatus)) {
                const allowedStr =
                    VALID_STATUS_TRANSITIONS[currentStatus].join(', ') ||
                    'none (terminal state)';
                throw new Error(
                    `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedStr}`
                );
            }

            // Skip if same status
            if (currentStatus === newStatus) {
                return { success: true, message: 'Status unchanged' };
            }

            // Update status in transaction
            await prisma.$transaction(async (tx) => {
                await tx.returnRequest.update({
                    where: { id },
                    data: { status: newStatus },
                });

                await tx.returnStatusHistory.create({
                    data: {
                        requestId: id,
                        fromStatus: currentStatus,
                        toStatus: newStatus,
                        changedById: user.id,
                        notes: notes || `Status updated to ${newStatus}`,
                    },
                });
            });

            return {
                success: true,
                message: `Status updated from ${currentStatus} to ${newStatus}`,
            };
        }
    );
