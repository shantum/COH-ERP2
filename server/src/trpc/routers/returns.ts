/**
 * Returns tRPC Router
 * Return request (ticket) management procedures
 *
 * Status flow:
 *   requested -> reverse_initiated -> in_transit -> received -> processed
 *   (can transition to cancelled from most states)
 *
 * Procedures:
 * - list: Query returns with optional status filter, pagination
 * - get: Query single return by ID with full details
 * - updateStatus: Mutation to update return status with validation
 * - process: Mutation to process a received return (restock/dispose)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';

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

/**
 * Item condition options for processing
 */
const itemConditionSchema = z.enum(['good', 'damaged']);

/**
 * Processing action options
 */
const processingActionSchema = z.enum(['restock', 'dispose']);

/**
 * List procedure
 * Query returns with optional status filter and pagination
 */
const list = protectedProcedure
    .input(
        z.object({
            status: returnStatusSchema.optional(),
            page: z.number().min(1).default(1),
            limit: z.number().min(1).max(100).default(20),
        }).optional()
    )
    .query(async ({ input, ctx }) => {
        const { status, page = 1, limit = 20 } = input ?? {};
        const skip = (page - 1) * limit;

        // Build where clause
        const where: { status?: ReturnStatus } = {};
        if (status) {
            where.status = status;
        }

        // Get returns with order and line info
        const [returns, total] = await Promise.all([
            ctx.prisma.returnRequest.findMany({
                where,
                include: {
                    originalOrder: {
                        select: {
                            id: true,
                            orderNumber: true,
                            orderDate: true,
                        },
                    },
                    lines: {
                        include: {
                            sku: {
                                include: {
                                    variation: {
                                        include: {
                                            product: {
                                                select: {
                                                    id: true,
                                                    name: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    customer: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            ctx.prisma.returnRequest.count({ where }),
        ]);

        return {
            items: returns,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

/**
 * Get procedure
 * Query single return by ID with full details
 */
const get = protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        const returnRequest = await ctx.prisma.returnRequest.findUnique({
            where: { id: input.id },
            include: {
                originalOrder: {
                    select: {
                        id: true,
                        orderNumber: true,
                        orderDate: true,
                        totalAmount: true,
                        shippingAddress: true,
                    },
                },
                exchangeOrder: {
                    select: {
                        id: true,
                        orderNumber: true,
                        orderDate: true,
                    },
                },
                customer: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                    },
                },
                lines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: {
                                            select: {
                                                id: true,
                                                name: true,
                                                imageUrl: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        exchangeSku: {
                            select: {
                                id: true,
                                skuCode: true,
                                size: true,
                            },
                        },
                    },
                },
                shipping: true,
                statusHistory: {
                    include: {
                        changedBy: {
                            select: { name: true },
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!returnRequest) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Return request not found',
            });
        }

        return returnRequest;
    });

/**
 * Update status procedure
 * Mutation to update return status with state machine validation
 */
const updateStatus = protectedProcedure
    .input(
        z.object({
            id: z.string().uuid(),
            newStatus: returnStatusSchema,
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, newStatus, notes } = input;

        // Fetch current return request
        const returnRequest = await ctx.prisma.returnRequest.findUnique({
            where: { id },
            select: { id: true, status: true, requestNumber: true },
        });

        if (!returnRequest) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Return request not found',
            });
        }

        const currentStatus = returnRequest.status as ReturnStatus;

        // Validate status transition
        if (!isValidStatusTransition(currentStatus, newStatus)) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${VALID_STATUS_TRANSITIONS[currentStatus].join(', ') || 'none (terminal state)'}`,
            });
        }

        // Skip if same status
        if (currentStatus === newStatus) {
            return { success: true, message: 'Status unchanged' };
        }

        // Update status in transaction
        await ctx.prisma.$transaction(async (tx) => {
            await tx.returnRequest.update({
                where: { id },
                data: { status: newStatus },
            });

            await tx.returnStatusHistory.create({
                data: {
                    requestId: id,
                    fromStatus: currentStatus,
                    toStatus: newStatus,
                    changedById: ctx.user.id,
                    notes: notes || `Status updated to ${newStatus}`,
                },
            });
        });

        return {
            success: true,
            message: `Status updated from ${currentStatus} to ${newStatus}`,
        };
    });

/**
 * Process procedure
 * Mutation to process a received return (restock or dispose)
 */
const process = protectedProcedure
    .input(
        z.object({
            id: z.string().uuid(),
            condition: itemConditionSchema,
            action: processingActionSchema,
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, condition, action, notes } = input;

        // Fetch return request with lines
        const returnRequest = await ctx.prisma.returnRequest.findUnique({
            where: { id },
            include: {
                lines: {
                    include: {
                        sku: true,
                    },
                },
            },
        });

        if (!returnRequest) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Return request not found',
            });
        }

        // Validate status - must be 'received' to process
        if (returnRequest.status !== 'received') {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Cannot process return - current status is '${returnRequest.status}'. Return must be in 'received' status.`,
            });
        }

        // Validate all lines have been received (have itemCondition set)
        const unreceivedLines = returnRequest.lines.filter(
            (l) => l.itemCondition === null
        );
        if (unreceivedLines.length > 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Cannot process - ${unreceivedLines.length} item(s) have not been received yet.`,
            });
        }

        // Process in transaction
        await ctx.prisma.$transaction(async (tx) => {
            // Update status to processed
            await tx.returnRequest.update({
                where: { id },
                data: {
                    status: 'processed',
                    resolutionNotes: notes,
                },
            });

            // Create status history entry
            await tx.returnStatusHistory.create({
                data: {
                    requestId: id,
                    fromStatus: 'received',
                    toStatus: 'processed',
                    changedById: ctx.user.id,
                    notes:
                        notes ||
                        `Processed: condition=${condition}, action=${action}`,
                },
            });

            // Handle inventory based on action
            if (action === 'restock' && condition === 'good') {
                // Create inward inventory transactions for each line
                for (const line of returnRequest.lines) {
                    await tx.inventoryTransaction.create({
                        data: {
                            skuId: line.skuId,
                            txnType: 'inward',
                            qty: line.qty,
                            reason: 'return_receipt',
                            referenceId: returnRequest.id,
                            createdById: ctx.user.id,
                        },
                    });
                }
            } else if (action === 'dispose' || condition === 'damaged') {
                // Create write-off log for disposed/damaged items
                for (const line of returnRequest.lines) {
                    await tx.writeOffLog.create({
                        data: {
                            skuId: line.skuId,
                            qty: line.qty,
                            reason: condition === 'damaged' ? 'damaged' : 'disposed',
                            sourceType: 'return',
                            sourceId: returnRequest.id,
                            notes: notes || `Return ${returnRequest.requestNumber} - ${condition}`,
                            createdById: ctx.user.id,
                        },
                    });
                }
            }
        });

        return {
            success: true,
            message: `Return processed: ${action} (${condition} condition)`,
            action,
            condition,
        };
    });

/**
 * Returns router - combines all return procedures
 */
export const returnsRouter = router({
    list,
    get,
    updateStatus,
    process,
});
