/**
 * Return Lifecycle Mutations - TanStack Start Server Functions
 *
 * Initiation, logistics, status transitions, and notes for line-level returns.
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware, type AuthUser } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';
import { getInternalApiBaseUrl } from '../utils';
import type { PrismaClient } from '@prisma/client';

import {
    InitiateReturnBatchInputSchema,
    ScheduleReturnPickupInputSchema,
    MarkReturnInTransitInputSchema,
    ReceiveReturnInputSchema,
    CloseReturnManuallyInputSchema,
    UpdateReturnNotesInputSchema,
    type InitiateReturnBatchInput,
    type ScheduleReturnPickupInput,
    type MarkReturnInTransitInput,
    type ReceiveReturnInput,
    type CloseReturnManuallyInput,
    type UpdateReturnNotesInput,
} from '@coh/shared/schemas/returns';
import {
    RETURN_ERROR_CODES,
    returnSuccess,
    returnError,
    type ReturnResult,
} from '@coh/shared/errors';

/**
 * Generate the next batch number for an order
 * Format: "{orderNumber}/{sequence}" e.g., "64168/1", "64168/2"
 */
async function generateBatchNumber(prisma: PrismaClient, orderId: string, orderNumber: string): Promise<string> {
    const existingBatches = await prisma.orderLine.findMany({
        where: {
            orderId,
            returnBatchNumber: { not: null },
        },
        select: { returnBatchNumber: true },
        distinct: ['returnBatchNumber'],
    });

    const nextSequence = existingBatches.length + 1;
    return `${orderNumber}/${nextSequence}`;
}

/**
 * Initiate returns on order lines (batch)
 * All lines initiated together share one batch number for grouped pickup
 */
export const initiateLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): InitiateReturnBatchInput => {
        return InitiateReturnBatchInputSchema.parse(input);
    })
    .handler(async ({ data, context }: { data: InitiateReturnBatchInput; context: { user: AuthUser } }): Promise<ReturnResult<{ batchNumber: string; lineCount: number; orderLineIds: string[] }>> => {
        try {
        const prisma = await getPrisma();
        const { lines, returnReasonCategory, returnReasonDetail, returnResolution, returnNotes, exchangeSkuId, pickupType } = data;

        const orderLines = await prisma.orderLine.findMany({
            where: { id: { in: lines.map(l => l.orderLineId) } },
            include: {
                order: true,
                sku: true,
            },
        });

        if (orderLines.length === 0) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        const orderIds = new Set(orderLines.map((l: typeof orderLines[number]) => l.orderId));
        if (orderIds.size > 1) {
            return returnError(
                RETURN_ERROR_CODES.INVALID_QUANTITY,
                'All lines must belong to the same order'
            );
        }

        for (const line of orderLines) {
            if (line.returnStatus && !['cancelled', 'complete'].includes(line.returnStatus)) {
                return returnError(
                    RETURN_ERROR_CODES.ALREADY_ACTIVE,
                    `Line ${line.sku.skuCode} already has an active return`
                );
            }
        }

        const qtyMap = new Map(lines.map(l => [l.orderLineId, l.returnQty]));
        for (const line of orderLines) {
            const returnQty = qtyMap.get(line.id) || line.qty;
            if (returnQty > line.qty) {
                return returnError(
                    RETURN_ERROR_CODES.INVALID_QUANTITY,
                    `Return qty (${returnQty}) exceeds line qty (${line.qty}) for ${line.sku.skuCode}`
                );
            }
        }

        if (returnResolution === 'exchange' && exchangeSkuId) {
            const exchangeSku = await prisma.sku.findUnique({
                where: { id: exchangeSkuId },
                select: { id: true },
            });
            if (!exchangeSku) {
                return returnError(RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND);
            }
        }

        const order = orderLines[0].order;
        const batchNumber = await generateBatchNumber(prisma, order.id, order.orderNumber);
        const now = new Date();

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            for (const line of orderLines) {
                const returnQty = qtyMap.get(line.id) || line.qty;

                await tx.orderLine.update({
                    where: { id: line.id },
                    data: {
                        returnBatchNumber: batchNumber,
                        returnStatus: 'requested',
                        returnQty,
                        returnRequestedAt: now,
                        returnRequestedById: context.user.id,
                        returnReasonCategory,
                        returnReasonDetail: returnReasonDetail || null,
                        returnResolution,
                        returnNotes: returnNotes || null,
                        returnExchangeSkuId: exchangeSkuId || null,
                        returnPickupType: pickupType || null,
                    },
                });

                await tx.sku.update({
                    where: { id: line.skuId },
                    data: { returnCount: { increment: returnQty } },
                });
            }

            if (order.customerId) {
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: { returnCount: { increment: 1 } },
                });
            }
        });

        const skuCodes = orderLines.map((l: typeof orderLines[number]) => l.sku.skuCode).join(', ');
        return returnSuccess(
            {
                batchNumber,
                lineCount: orderLines.length,
                orderLineIds: orderLines.map((l: typeof orderLines[number]) => l.id),
            },
            `Return batch ${batchNumber} created for ${skuCodes}`
        );
        } catch (error: unknown) {
            console.error('[initiateLineReturn] Error:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            return returnError(RETURN_ERROR_CODES.UNKNOWN, message);
        }
    });

/**
 * Schedule pickup for a return batch
 *
 * When scheduleWithIthink=true, calls the Express route to book with iThink Logistics.
 * When false, just updates DB with provided courier/AWB (manual entry).
 */
export const scheduleReturnPickup = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): ScheduleReturnPickupInput => ScheduleReturnPickupInputSchema.parse(input))
    .handler(async ({ data }: { data: ScheduleReturnPickupInput }): Promise<ReturnResult<{
        orderLineId: string;
        orderLineIds?: string[];
        lineCount?: number;
        batchNumber?: string;
        awbNumber?: string;
        courier?: string;
    }>> => {
        const prisma = await getPrisma();
        const { orderLineId, pickupType, courier, awbNumber, scheduledAt, scheduleWithIthink } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: { id: true, returnStatus: true, returnBatchNumber: true },
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

        const shouldUseIthink = scheduleWithIthink === true ||
            (pickupType === 'arranged_by_us' && !awbNumber && scheduleWithIthink !== false);

        if (shouldUseIthink) {
            try {
                const baseUrl = getInternalApiBaseUrl();
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
                    data?: {
                        orderLineId: string;
                        orderLineIds: string[];
                        lineCount: number;
                        batchNumber: string | null;
                        awbNumber: string;
                        courier: string;
                    };
                };

                if (!result.success) {
                    return returnError(
                        RETURN_ERROR_CODES.WRONG_STATUS,
                        result.error || 'Failed to schedule pickup with courier'
                    );
                }

                const lineCount = result.data?.lineCount || 1;
                const message = lineCount > 1
                    ? `Pickup scheduled for ${lineCount} items in batch ${result.data?.batchNumber}`
                    : `Pickup scheduled with ${result.data?.courier || 'courier'}`;

                return returnSuccess(
                    {
                        orderLineId,
                        orderLineIds: result.data?.orderLineIds,
                        lineCount: result.data?.lineCount,
                        batchNumber: result.data?.batchNumber || undefined,
                        awbNumber: result.data?.awbNumber,
                        courier: result.data?.courier,
                    },
                    message
                );
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                return returnError(RETURN_ERROR_CODES.WRONG_STATUS, `Failed to schedule pickup: ${message}`);
            }
        }

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

        return returnSuccess(
            {
                orderLineId,
                batchNumber: line.returnBatchNumber || undefined,
                awbNumber: awbNumber || undefined,
                courier: courier || undefined,
            },
            'Pickup scheduled'
        );
    });

/**
 * Mark return as in transit
 */
export const markReturnInTransit = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): MarkReturnInTransitInput => MarkReturnInTransitInputSchema.parse(input))
    .handler(async ({ data }: { data: MarkReturnInTransitInput }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrisma();
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
        const prisma = await getPrisma();
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

        await prisma.$transaction(async (tx: PrismaTransaction) => {
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
 * Cancel a return
 */
export const cancelLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({
        orderLineId: z.string().uuid(),
        reason: z.string().optional(),
    }).parse(input))
    .handler(async ({ data, context }: { data: { orderLineId: string; reason?: string }; context: { user: AuthUser } }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrisma();
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

        await prisma.$transaction(async (tx: PrismaTransaction) => {
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
        const prisma = await getPrisma();
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
 * Update return notes on an order line
 */
export const updateReturnNotes = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): UpdateReturnNotesInput => UpdateReturnNotesInputSchema.parse(input))
    .handler(async ({ data }: { data: UpdateReturnNotesInput }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrisma();
        const { orderLineId, returnNotes } = data;

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

        if (!line.returnStatus || ['cancelled', 'complete'].includes(line.returnStatus)) {
            return returnError(RETURN_ERROR_CODES.NO_ACTIVE_RETURN, 'No active return on this line');
        }

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: { returnNotes },
        });

        return returnSuccess(
            { orderLineId },
            `Notes updated for ${line.sku.skuCode}`
        );
    });
