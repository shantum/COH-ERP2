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

// ============================================
// Additional Return Request Mutations
// ============================================

const createReturnRequestInputSchema = z.object({
    requestType: z.enum(['return', 'exchange']),
    resolution: z.string(),
    originalOrderId: z.string().uuid(),
    reasonCategory: z.string(),
    reasonDetails: z.string().optional(),
    lines: z.array(
        z.object({
            skuId: z.string().uuid(),
            qty: z.number().int().positive(),
            unitPrice: z.number().optional(),
        })
    ),
    returnValue: z.number().optional(),
    courier: z.string().optional(),
    awbNumber: z.string().optional(),
});

/**
 * Create a new return request
 */
export const createReturnRequest = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => createReturnRequestInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        // Get order to extract customer
        const order = await prisma.order.findUnique({
            where: { id: data.originalOrderId },
            select: { customerId: true },
        });

        if (!order || !order.customerId) {
            throw new Error('Order not found or has no customer');
        }

        // Generate request number
        const count = await prisma.returnRequest.count();
        const requestNumber = `RET${String(count + 1).padStart(5, '0')}`;

        // Create return request with lines
        const returnRequest = await prisma.returnRequest.create({
            data: {
                requestNumber,
                requestType: data.requestType,
                resolution: data.resolution,
                originalOrderId: data.originalOrderId,
                customerId: order.customerId,
                status: 'requested',
                reasonCategory: data.reasonCategory,
                reasonDetails: data.reasonDetails || null,
                returnValue: data.returnValue || null,
                lines: {
                    create: data.lines.map((line) => ({
                        skuId: line.skuId,
                        qty: line.qty,
                        unitPrice: line.unitPrice || null,
                    })),
                },
            },
            include: {
                lines: true,
            },
        });

        return { success: true, returnRequest };
    });

const updateReturnRequestInputSchema = z.object({
    id: z.string().uuid(),
    reasonCategory: z.string().optional(),
    reasonDetails: z.string().optional(),
    courier: z.string().optional(),
    awbNumber: z.string().optional(),
});

/**
 * Update a return request
 */
export const updateReturnRequest = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateReturnRequestInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const { id, ...updateData } = data;

        const returnRequest = await prisma.returnRequest.update({
            where: { id },
            data: updateData,
        });

        return { success: true, returnRequest };
    });

const deleteReturnRequestInputSchema = z.object({
    id: z.string().uuid(),
});

/**
 * Delete a return request
 */
export const deleteReturnRequest = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteReturnRequestInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        await prisma.returnRequest.delete({
            where: { id: data.id },
        });

        return { success: true };
    });

const markReverseReceivedInputSchema = z.object({
    id: z.string().uuid(),
});

/**
 * Mark return as reverse received
 */
export const markReverseReceived = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markReverseReceivedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const returnRequest = await prisma.returnRequest.update({
            where: { id: data.id },
            data: {
                reverseReceived: true,
                reverseReceivedAt: new Date(),
            },
        });

        return { success: true, returnRequest };
    });

/**
 * Unmark return as reverse received
 */
export const unmarkReverseReceived = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markReverseReceivedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const returnRequest = await prisma.returnRequest.update({
            where: { id: data.id },
            data: {
                reverseReceived: false,
                reverseReceivedAt: null,
            },
        });

        return { success: true, returnRequest };
    });

/**
 * Mark forward as delivered (for exchanges)
 */
export const markForwardDelivered = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markReverseReceivedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const returnRequest = await prisma.returnRequest.update({
            where: { id: data.id },
            data: {
                forwardDelivered: true,
                forwardDeliveredAt: new Date(),
            },
        });

        return { success: true, returnRequest };
    });

/**
 * Unmark forward as delivered
 */
export const unmarkForwardDelivered = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => markReverseReceivedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const returnRequest = await prisma.returnRequest.update({
            where: { id: data.id },
            data: {
                forwardDelivered: false,
                forwardDeliveredAt: null,
            },
        });

        return { success: true, returnRequest };
    });

const receiveReturnItemInputSchema = z.object({
    requestId: z.string().uuid(),
    lineId: z.string().uuid(),
    condition: z.enum(['good', 'damaged', 'defective', 'wrong_item']),
});

/**
 * Receive a return item and add to repacking queue
 */
export const receiveReturnItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => receiveReturnItemInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        // Get return line
        const returnLine = await prisma.returnRequestLine.findUnique({
            where: { id: data.lineId },
            include: {
                request: true,
            },
        });

        if (!returnLine) {
            throw new Error('Return line not found');
        }

        // Update return line with condition
        await prisma.returnRequestLine.update({
            where: { id: data.lineId },
            data: {
                itemCondition: data.condition,
            },
        });

        // Add to repacking queue
        await prisma.repackingQueueItem.create({
            data: {
                skuId: returnLine.skuId,
                qty: returnLine.qty,
                returnRequestId: returnLine.requestId,
                returnLineId: returnLine.id,
                condition: data.condition,
                inspectionNotes: null,
                status: 'pending',
            },
        });

        return { success: true, message: 'Item received and added to QC queue' };
    });
