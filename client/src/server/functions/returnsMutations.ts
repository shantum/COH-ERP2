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

// ============================================
// REPACKING QUEUE MUTATIONS
// ============================================

const addToQueueInputSchema = z.object({
    skuId: z.string().uuid().optional(),
    skuCode: z.string().optional(),
    qty: z.number().int().positive().optional().default(1),
    condition: z.string().optional(),
    returnRequestId: z.string().uuid().optional(),
    returnLineId: z.string().uuid().optional(),
    inspectionNotes: z.string().optional(),
});

const updateQueueItemInputSchema = z.object({
    id: z.string().uuid(),
    status: z.string().optional(),
    condition: z.string().optional(),
    inspectionNotes: z.string().optional(),
    returnRequestId: z.string().uuid().optional(),
    returnLineId: z.string().uuid().optional(),
    orderLineId: z.string().uuid().optional(),
});

const deleteQueueItemInputSchema = z.object({
    id: z.string().uuid(),
});

const processRepackingItemInputSchema = z.object({
    itemId: z.string().uuid(),
    action: z.enum(['ready', 'write_off']),
    writeOffReason: z.string().optional(),
    qcComments: z.string().optional(),
    notes: z.string().optional(),
});

// Type for queue item result
export interface RepackingQueueItemResult {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    condition: string | null;
    status: string;
}

/**
 * Add item to repacking queue
 * Supports: skuId or skuCode lookup
 */
export const addToRepackingQueue = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => addToQueueInputSchema.parse(input))
    .handler(async ({ data }): Promise<{ success: boolean; queueItem: RepackingQueueItemResult }> => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        let skuId = data.skuId;

        // If no skuId, try to find by skuCode
        if (!skuId) {
            if (!data.skuCode) {
                throw new Error('Either skuId or skuCode is required');
            }

            const sku = await prisma.sku.findFirst({
                where: { skuCode: data.skuCode },
                select: { id: true, skuCode: true },
            });

            if (!sku) {
                throw new Error(`SKU not found: ${data.skuCode}`);
            }

            skuId = sku.id;
        }

        // Create queue item
        const queueItem = await prisma.repackingQueueItem.create({
            data: {
                skuId,
                qty: data.qty,
                condition: data.condition || 'pending_inspection', // Required field - default to pending
                returnRequestId: data.returnRequestId || null,
                returnLineId: data.returnLineId || null,
                inspectionNotes: data.inspectionNotes || null,
                status: 'pending',
            },
        });

        // Fetch SKU details separately for the response
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            include: {
                variation: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        return {
            success: true,
            queueItem: {
                id: queueItem.id,
                skuId: queueItem.skuId,
                skuCode: sku?.skuCode || '',
                productName: sku?.variation?.product?.name || '',
                colorName: sku?.variation?.colorName || '',
                size: sku?.size || '',
                qty: queueItem.qty,
                condition: queueItem.condition,
                status: queueItem.status,
            },
        };
    });

/**
 * Update repacking queue item
 * Used for: linking to return/RTO, updating condition, etc.
 */
export const updateRepackingQueueItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateQueueItemInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const { id, ...updateData } = data;

        // Verify item exists
        const existing = await prisma.repackingQueueItem.findUnique({
            where: { id },
        });

        if (!existing) {
            throw new Error('Queue item not found');
        }

        // Build update object (only include defined fields)
        const updateFields: Record<string, unknown> = {};
        if (updateData.status !== undefined) updateFields.status = updateData.status;
        if (updateData.condition !== undefined) updateFields.condition = updateData.condition;
        if (updateData.inspectionNotes !== undefined) updateFields.inspectionNotes = updateData.inspectionNotes;
        if (updateData.returnRequestId !== undefined) updateFields.returnRequestId = updateData.returnRequestId;
        if (updateData.returnLineId !== undefined) updateFields.returnLineId = updateData.returnLineId;
        if (updateData.orderLineId !== undefined) updateFields.orderLineId = updateData.orderLineId;

        const updated = await prisma.repackingQueueItem.update({
            where: { id },
            data: updateFields,
        });

        return { success: true, queueItem: updated };
    });

/**
 * Delete repacking queue item
 */
export const deleteRepackingQueueItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteQueueItemInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        // Verify item exists
        const existing = await prisma.repackingQueueItem.findUnique({
            where: { id: data.id },
        });

        if (!existing) {
            throw new Error('Queue item not found');
        }

        await prisma.repackingQueueItem.delete({
            where: { id: data.id },
        });

        return { success: true };
    });

/**
 * Process repacking queue item (QC decision)
 * Action: 'ready' -> add to stock, 'write_off' -> create write-off log
 */
export const processRepackingQueueItem = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => processRepackingItemInputSchema.parse(input))
    .handler(async ({ data, context }: { data: z.infer<typeof processRepackingItemInputSchema>; context: { user: AuthUser } }) => {
        const { PrismaClient } = await import('@prisma/client');
        const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
        const prisma = globalForPrisma.prisma ?? new PrismaClient();
        if (process.env.NODE_ENV !== 'production') {
            globalForPrisma.prisma = prisma;
        }

        const { itemId, action, writeOffReason, qcComments, notes } = data;

        // Get queue item with SKU info
        const queueItem = await prisma.repackingQueueItem.findUnique({
            where: { id: itemId },
            include: {
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        if (!queueItem) {
            throw new Error('Queue item not found');
        }

        if (queueItem.status !== 'pending') {
            throw new Error(`Item already processed with status: ${queueItem.status}`);
        }

        const now = new Date();

        if (action === 'ready') {
            // Add to stock - create inward transaction
            await prisma.$transaction(async (tx) => {
                // Create inventory inward transaction
                await tx.inventoryTransaction.create({
                    data: {
                        skuId: queueItem.skuId,
                        txnType: 'inward',
                        qty: queueItem.qty,
                        reason: 'repack_complete',
                        referenceId: queueItem.id,
                        notes: notes || qcComments || 'QC passed - added to stock',
                        createdById: context.user.id,
                    },
                });

                // Update queue item status
                await tx.repackingQueueItem.update({
                    where: { id: itemId },
                    data: {
                        status: 'ready',
                        qcComments: qcComments || null,
                        processedAt: now,
                        processedById: context.user.id,
                    },
                });
            });

            return {
                success: true,
                message: `${queueItem.sku.skuCode} added to stock`,
                action: 'ready',
                skuCode: queueItem.sku.skuCode,
                qty: queueItem.qty,
            };
        } else {
            // Write-off - create write-off log
            await prisma.$transaction(async (tx) => {
                // Create write-off log
                await tx.writeOffLog.create({
                    data: {
                        skuId: queueItem.skuId,
                        qty: queueItem.qty,
                        reason: writeOffReason || 'defective',
                        sourceType: 'repacking',
                        sourceId: queueItem.id,
                        notes: notes || qcComments || 'QC failed - written off',
                        createdById: context.user.id,
                    },
                });

                // Update SKU write-off count
                await tx.sku.update({
                    where: { id: queueItem.skuId },
                    data: {
                        writeOffCount: { increment: queueItem.qty },
                    },
                });

                // Update queue item status
                await tx.repackingQueueItem.update({
                    where: { id: itemId },
                    data: {
                        status: 'write_off',
                        qcComments: qcComments || null,
                        processedAt: now,
                        processedById: context.user.id,
                    },
                });
            });

            return {
                success: true,
                message: `${queueItem.sku.skuCode} written off`,
                action: 'write_off',
                skuCode: queueItem.sku.skuCode,
                qty: queueItem.qty,
            };
        }
    });
