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
import { getCookie } from '@tanstack/react-start/server';
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

// ============================================
// LINE-LEVEL RETURN MUTATIONS (NEW)
// ============================================
// These mutations work on OrderLine.return* fields directly,
// following the existing RTO pattern on OrderLine.

import {
    InitiateReturnInputSchema,
    ScheduleReturnPickupInputSchema,
    MarkReturnInTransitInputSchema,
    ReceiveReturnInputSchema,
    ProcessReturnRefundInputSchema,
    CloseReturnManuallyInputSchema,
    CreateExchangeOrderInputSchema,
    UpdateReturnNotesInputSchema,
    type InitiateReturnInput,
    type ScheduleReturnPickupInput,
    type MarkReturnInTransitInput,
    type ReceiveReturnInput,
    type ProcessReturnRefundInput,
    type CloseReturnManuallyInput,
    type CreateExchangeOrderInput,
    type UpdateReturnNotesInput,
} from '@coh/shared/schemas/returns';
import {
    RETURN_ERROR_CODES,
    returnSuccess,
    returnError,
    type ReturnResult,
} from '@coh/shared/errors';

// Helper to get Prisma instance (reduces duplication)
async function getPrismaInstance(): Promise<PrismaClient> {
    const { PrismaClient: PClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
    const prisma = globalForPrisma.prisma ?? new PClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// Return window check (14 days from delivery)
const RETURN_WINDOW_DAYS = 14;

function isWithinReturnWindow(deliveredAt: Date | null): boolean {
    if (!deliveredAt) return false;
    const daysSinceDelivery = Math.floor(
        (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceDelivery <= RETURN_WINDOW_DAYS;
}

/**
 * Initiate a return on an order line
 * Sets returnStatus = 'requested' and captures return details
 *
 * Returns structured result: { success: true, ... } or { success: false, error: { code, message } }
 */
export const initiateLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): InitiateReturnInput => InitiateReturnInputSchema.parse(input))
    .handler(async ({ data, context }: { data: InitiateReturnInput; context: { user: AuthUser } }): Promise<ReturnResult<{ orderLineId: string; returnStatus: string; withinWindow: boolean; skuCode: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, returnQty, returnReasonCategory, returnReasonDetail, returnResolution, returnNotes, exchangeSkuId } = data;

        // Get order line with product info
        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: true,
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

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        // Check if already has an active return
        if (line.returnStatus && !['cancelled', 'complete'].includes(line.returnStatus)) {
            return returnError(RETURN_ERROR_CODES.ALREADY_ACTIVE);
        }

        // Check return qty doesn't exceed line qty - keep this one
        if (returnQty > line.qty) {
            return returnError(
                RETURN_ERROR_CODES.INVALID_QUANTITY,
                `Return qty (${returnQty}) cannot exceed line qty (${line.qty})`
            );
        }

        // Note: product.isReturnable = false is a soft warning, not a hard block
        // Staff can initiate returns even for non-returnable products if needed

        // Check line returnability - SOFT for debugging
        // if (line.isNonReturnable) {
        //     return returnError(RETURN_ERROR_CODES.LINE_NON_RETURNABLE);
        // }

        // Check return window - SOFT for debugging
        const withinWindow = isWithinReturnWindow(line.deliveredAt);
        // if (!withinWindow && !line.deliveredAt) {
        //     return returnError(RETURN_ERROR_CODES.NOT_DELIVERED);
        // }

        // Validate exchange SKU if provided (exchange order created later after receipt)
        if (returnResolution === 'exchange' && exchangeSkuId) {
            const exchangeSku = await prisma.sku.findUnique({
                where: { id: exchangeSkuId },
                select: { id: true, skuCode: true, mrp: true },
            });
            if (!exchangeSku) {
                return returnError(RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND);
            }
        }

        // Update order line with return details
        const now = new Date();
        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnStatus: 'requested',
                returnQty,
                returnRequestedAt: now,
                returnRequestedById: context.user.id,
                returnReasonCategory,
                returnReasonDetail: returnReasonDetail || null,
                returnResolution,
                returnNotes: returnNotes || null,
                returnExchangeSkuId: exchangeSkuId || null,
            },
        });

        // Update customer return count
        if (line.order.customerId) {
            await prisma.customer.update({
                where: { id: line.order.customerId },
                data: { returnCount: { increment: 1 } },
            });
        }

        // Update SKU return count
        await prisma.sku.update({
            where: { id: line.skuId },
            data: { returnCount: { increment: returnQty } },
        });

        return returnSuccess(
            {
                orderLineId,
                returnStatus: 'requested',
                withinWindow,
                skuCode: line.sku.skuCode,
            },
            `Return initiated for ${line.sku.skuCode}`
        );
    });

/**
 * Schedule pickup for a return
 *
 * When scheduleWithIthink=true, calls the Express route to book with iThink Logistics
 * When false, just updates DB with provided courier/AWB (manual entry)
 */
export const scheduleReturnPickup = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): ScheduleReturnPickupInput => ScheduleReturnPickupInputSchema.parse(input))
    .handler(async ({ data }: { data: ScheduleReturnPickupInput }): Promise<ReturnResult<{ orderLineId: string; awbNumber?: string; courier?: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, pickupType, courier, awbNumber, scheduledAt, scheduleWithIthink } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: { id: true, returnStatus: true },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        if (line.returnStatus !== 'requested') {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot schedule pickup: current status is '${line.returnStatus}'`
            );
        }

        // If scheduleWithIthink, call Express route to book with iThink
        if (scheduleWithIthink) {
            try {
                const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';
                const authToken = getCookie('auth_token');
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (authToken) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                }
                const response = await fetch(`${baseUrl}/api/returns/schedule-pickup`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ orderLineId }),
                });

                const result = await response.json() as {
                    success: boolean;
                    error?: string;
                    data?: { orderLineId: string; awbNumber: string; courier: string };
                };

                if (!result.success) {
                    return returnError(
                        RETURN_ERROR_CODES.WRONG_STATUS,
                        result.error || 'Failed to schedule pickup with courier'
                    );
                }

                // Express route already updated the DB, just return success
                return returnSuccess(
                    {
                        orderLineId,
                        awbNumber: result.data?.awbNumber,
                        courier: result.data?.courier,
                    },
                    `Pickup scheduled with ${result.data?.courier || 'courier'}`
                );
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                return returnError(RETURN_ERROR_CODES.WRONG_STATUS, `Failed to schedule pickup: ${message}`);
            }
        }

        // Manual entry - just update DB
        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnStatus: 'pickup_scheduled',
                returnPickupType: pickupType,
                returnCourier: courier || null,
                returnAwbNumber: awbNumber || null,
                returnPickupScheduledAt: scheduledAt || new Date(),
            },
        });

        return returnSuccess({ orderLineId, awbNumber: awbNumber || undefined, courier: courier || undefined }, 'Pickup scheduled');
    });

/**
 * Mark return as in transit
 */
export const markReturnInTransit = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): MarkReturnInTransitInput => MarkReturnInTransitInputSchema.parse(input))
    .handler(async ({ data }: { data: MarkReturnInTransitInput }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, awbNumber, courier } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: { id: true, returnStatus: true },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        const allowedStatuses = ['requested', 'pickup_scheduled'];
        if (!allowedStatuses.includes(line.returnStatus || '')) {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot mark in transit: current status is '${line.returnStatus}'`
            );
        }

        const updateData: Record<string, unknown> = {
            returnStatus: 'in_transit',
            returnPickupAt: new Date(),
        };
        if (awbNumber) updateData.returnAwbNumber = awbNumber;
        if (courier) updateData.returnCourier = courier;

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: updateData,
        });

        return returnSuccess({ orderLineId }, 'Marked as in transit');
    });

/**
 * Receive return at warehouse and add to QC queue
 */
export const receiveLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): ReceiveReturnInput => ReceiveReturnInputSchema.parse(input))
    .handler(async ({ data, context }: { data: ReceiveReturnInput; context: { user: AuthUser } }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, condition, conditionNotes } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: {
                id: true,
                returnStatus: true,
                returnQty: true,
                skuId: true,
            },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        const allowedStatuses = ['requested', 'pickup_scheduled', 'in_transit'];
        if (!allowedStatuses.includes(line.returnStatus || '')) {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot receive: current status is '${line.returnStatus}'`
            );
        }

        const now = new Date();

        // Update line and create repacking queue item in transaction
        await prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: orderLineId },
                data: {
                    returnStatus: 'received',
                    returnReceivedAt: now,
                    returnReceivedById: context.user.id,
                    returnCondition: condition,
                    returnConditionNotes: conditionNotes || null,
                },
            });

            // Add to repacking queue for QC
            await tx.repackingQueueItem.create({
                data: {
                    skuId: line.skuId,
                    qty: line.returnQty || 1,
                    orderLineId: orderLineId,
                    status: 'pending',
                    condition: condition,
                    inspectionNotes: conditionNotes || null,
                },
            });
        });

        return returnSuccess({ orderLineId }, 'Return received and added to QC queue');
    });

/**
 * Process refund for a return
 */
export const processLineReturnRefund = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): ProcessReturnRefundInput => ProcessReturnRefundInputSchema.parse(input))
    .handler(async ({ data }: { data: ProcessReturnRefundInput }): Promise<ReturnResult<{ orderLineId: string; netAmount: number }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, grossAmount, discountClawback, deductions, deductionNotes, refundMethod } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: { id: true, returnStatus: true, returnResolution: true },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        if (line.returnResolution !== 'refund') {
            return returnError(RETURN_ERROR_CODES.NOT_REFUND_RESOLUTION);
        }

        const netAmount = grossAmount - discountClawback - deductions;

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnGrossAmount: grossAmount,
                returnDiscountClawback: discountClawback,
                returnDeductions: deductions,
                returnDeductionNotes: deductionNotes || null,
                returnNetAmount: netAmount,
                returnRefundMethod: refundMethod || null,
                // Also update legacy refund fields for compatibility
                refundAmount: netAmount,
                refundReason: 'customer_return',
            },
        });

        return returnSuccess(
            { orderLineId, netAmount },
            'Refund processed'
        );
    });

/**
 * Send refund link to customer
 */
export const sendReturnRefundLink = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderLineId: z.string().uuid() }).parse(input))
    .handler(async ({ data }: { data: { orderLineId: string } }): Promise<ReturnResult<{ orderLineId: string; linkId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: { id: true, returnNetAmount: true, returnRefundMethod: true },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        if (!line.returnNetAmount) {
            return returnError(RETURN_ERROR_CODES.REFUND_NOT_CALCULATED);
        }

        // TODO: Integrate with Razorpay to create payment link
        // For now, just mark as sent
        const linkId = `REFUND_LINK_${Date.now()}`;

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnRefundLinkSentAt: new Date(),
                returnRefundLinkId: linkId,
            },
        });

        return returnSuccess({ orderLineId, linkId }, 'Refund link sent');
    });

/**
 * Mark refund as completed
 */
export const completeLineReturnRefund = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({
        orderLineId: z.string().uuid(),
        reference: z.string().optional(),
    }).parse(input))
    .handler(async ({ data }: { data: { orderLineId: string; reference?: string } }) => {
        const prisma = await getPrismaInstance();
        const { orderLineId, reference } = data;

        const now = new Date();

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnRefundCompletedAt: now,
                returnRefundReference: reference || null,
                refundedAt: now, // Also update legacy field
            },
        });

        return { success: true, message: 'Refund completed', orderLineId };
    });

/**
 * Complete a return (final status)
 */
export const completeLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderLineId: z.string().uuid() }).parse(input))
    .handler(async ({ data }: { data: { orderLineId: string } }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: {
                id: true,
                returnStatus: true,
                returnResolution: true,
                returnRefundCompletedAt: true,
                returnExchangeOrderId: true,
            },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        if (line.returnStatus !== 'received') {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot complete: current status is '${line.returnStatus}', expected 'received'`
            );
        }

        // Validate completion criteria based on resolution
        if (line.returnResolution === 'refund' && !line.returnRefundCompletedAt) {
            return returnError(RETURN_ERROR_CODES.REFUND_NOT_COMPLETED);
        }

        if (line.returnResolution === 'exchange' && !line.returnExchangeOrderId) {
            return returnError(RETURN_ERROR_CODES.EXCHANGE_NOT_CREATED);
        }

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: { returnStatus: 'complete' },
        });

        return returnSuccess({ orderLineId }, 'Return completed');
    });

/**
 * Cancel a return
 */
export const cancelLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({
        orderLineId: z.string().uuid(),
        reason: z.string().optional(),
    }).parse(input))
    .handler(async ({ data, context }: { data: { orderLineId: string; reason?: string }; context: { user: AuthUser } }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, reason } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: {
                id: true,
                returnStatus: true,
                returnQty: true,
                skuId: true,
                order: { select: { customerId: true } },
            },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        const terminalStatuses = ['complete', 'cancelled'];
        if (terminalStatuses.includes(line.returnStatus || '')) {
            return returnError(RETURN_ERROR_CODES.ALREADY_TERMINAL);
        }

        await prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: orderLineId },
                data: {
                    returnStatus: 'cancelled',
                    returnClosedManually: true,
                    returnClosedManuallyAt: new Date(),
                    returnClosedManuallyById: context.user.id,
                    returnClosedReason: reason || 'Cancelled by staff',
                },
            });

            // Decrement return counts
            if (line.order.customerId) {
                await tx.customer.update({
                    where: { id: line.order.customerId },
                    data: { returnCount: { decrement: 1 } },
                });
            }

            await tx.sku.update({
                where: { id: line.skuId },
                data: { returnCount: { decrement: line.returnQty || 1 } },
            });
        });

        return returnSuccess({ orderLineId }, 'Return cancelled');
    });

/**
 * Close return manually (for edge cases)
 */
export const closeLineReturnManually = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): CloseReturnManuallyInput => CloseReturnManuallyInputSchema.parse(input))
    .handler(async ({ data, context }: { data: CloseReturnManuallyInput; context: { user: AuthUser } }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, reason } = data;

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnStatus: 'complete',
                returnClosedManually: true,
                returnClosedManuallyAt: new Date(),
                returnClosedManuallyById: context.user.id,
                returnClosedReason: reason,
            },
        });

        return returnSuccess({ orderLineId }, 'Return closed manually');
    });

/**
 * Create exchange order from a return line
 * Staff-initiated - can be done at any point during the return process
 */
export const createExchangeOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): CreateExchangeOrderInput => CreateExchangeOrderInputSchema.parse(input))
    .handler(async ({ data }: { data: CreateExchangeOrderInput }): Promise<ReturnResult<{ exchangeOrderId: string; exchangeOrderNumber: string; priceDiff: number }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, exchangeSkuId, exchangeQty } = data;

        // Get original order line with order details
        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: true,
                sku: { select: { mrp: true } },
            },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        if (!line.returnStatus) {
            return returnError(RETURN_ERROR_CODES.NO_ACTIVE_RETURN);
        }

        if (line.returnExchangeOrderId) {
            return returnError(RETURN_ERROR_CODES.EXCHANGE_ALREADY_CREATED);
        }

        // Get exchange SKU
        const exchangeSku = await prisma.sku.findUnique({
            where: { id: exchangeSkuId },
            select: { id: true, skuCode: true, mrp: true },
        });

        if (!exchangeSku) {
            return returnError(RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND);
        }

        // Calculate price difference
        const originalValue = line.unitPrice * (line.returnQty || line.qty);
        const exchangeValue = exchangeSku.mrp * exchangeQty;
        const priceDiff = exchangeValue - originalValue;

        // Generate exchange order number
        const count = await prisma.order.count({ where: { isExchange: true } });
        const exchangeOrderNumber = `EXC${String(count + 1).padStart(5, '0')}`;

        // Create exchange order in transaction
        const exchangeOrder = await prisma.$transaction(async (tx) => {
            // Create the exchange order
            const newOrder = await tx.order.create({
                data: {
                    orderNumber: exchangeOrderNumber,
                    channel: 'exchange',
                    customerId: line.order.customerId,
                    customerName: line.order.customerName,
                    customerEmail: line.order.customerEmail,
                    customerPhone: line.order.customerPhone,
                    shippingAddress: line.order.shippingAddress,
                    orderDate: new Date(),
                    totalAmount: exchangeValue,
                    isExchange: true,
                    originalOrderId: line.orderId,
                    status: 'open',
                    orderLines: {
                        create: {
                            skuId: exchangeSkuId,
                            qty: exchangeQty,
                            unitPrice: exchangeSku.mrp,
                            lineStatus: 'pending',
                        },
                    },
                },
            });

            // Update original line with exchange reference
            await tx.orderLine.update({
                where: { id: orderLineId },
                data: {
                    returnExchangeOrderId: newOrder.id,
                    returnExchangeSkuId: exchangeSkuId,
                    returnExchangePriceDiff: priceDiff,
                },
            });

            // Update customer exchange count
            if (line.order.customerId) {
                await tx.customer.update({
                    where: { id: line.order.customerId },
                    data: { exchangeCount: { increment: 1 } },
                });
            }

            return newOrder;
        });

        return returnSuccess(
            {
                exchangeOrderId: exchangeOrder.id,
                exchangeOrderNumber,
                priceDiff,
            },
            `Exchange order ${exchangeOrderNumber} created`
        );
    });

/**
 * Update return notes on an order line
 * Allows staff to add/update notes at any point during the return process
 */
export const updateReturnNotes = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): UpdateReturnNotesInput => UpdateReturnNotesInputSchema.parse(input))
    .handler(async ({ data }: { data: UpdateReturnNotesInput }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrismaInstance();
        const { orderLineId, returnNotes } = data;

        // Get order line
        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: {
                id: true,
                returnStatus: true,
                sku: { select: { skuCode: true } },
            },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        // Check if line has an active return
        if (!line.returnStatus || ['cancelled', 'complete'].includes(line.returnStatus)) {
            return returnError(RETURN_ERROR_CODES.NO_ACTIVE_RETURN, 'No active return on this line');
        }

        // Update notes
        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: { returnNotes },
        });

        return returnSuccess(
            { orderLineId },
            `Notes updated for ${line.sku.skuCode}`
        );
    });
