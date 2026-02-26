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

// ============================================
// EVENT LOGGING + SSE BROADCAST
// ============================================

async function logReturnEvent(
    event: string,
    entityId: string,
    summary: string,
    actorId?: string,
    meta?: Record<string, unknown>
): Promise<void> {
    const { logEventDeferred } = await import('@coh/shared/services/eventLog');
    logEventDeferred({
        domain: 'returns',
        event,
        entityType: 'OrderLine',
        entityId,
        summary,
        ...(meta ? { meta: meta as import('@prisma/client').Prisma.InputJsonValue } : {}),
        ...(actorId ? { actorId } : {}),
    });
}

async function broadcastReturnUpdate(
    type: string,
    data: Record<string, unknown>,
    excludeUserId: string
): Promise<void> {
    const { notifySSE } = await import('@coh/shared/services/sseBroadcast');
    await notifySSE({ type, ...data }, excludeUserId);
}

/**
 * Fire-and-forget: push ERP status change to Return Prime.
 * Calls the Express endpoint which handles RP API + error capture for retry.
 */
function pushToReturnPrime(orderLineId: string, erpStatus: string): void {
    const baseUrl = getInternalApiBaseUrl();
    fetch(`${baseUrl}/api/returnprime/push-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderLineId, erpStatus }),
    }).catch(() => {});
}

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

        // Exchange resolution requires exchangeSkuId
        if (returnResolution === 'exchange' && !exchangeSkuId) {
            return returnError(
                RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND,
                'Exchange SKU is required when resolution is exchange'
            );
        }

        const orderLines = await prisma.orderLine.findMany({
            where: { id: { in: lines.map(l => l.orderLineId) } },
            include: {
                order: true,
                sku: {
                    include: {
                        variation: {
                            select: {
                                id: true,
                                product: { select: { isReturnable: true, nonReturnableReason: true } },
                            },
                        },
                    },
                },
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

        // Validate active return status
        for (const line of orderLines) {
            if (line.returnStatus && !['cancelled', 'refunded', 'archived', 'rejected'].includes(line.returnStatus)) {
                return returnError(
                    RETURN_ERROR_CODES.ALREADY_ACTIVE,
                    `Line ${line.sku.skuCode} already has an active return`
                );
            }
        }

        // Validate quantities
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

        // Server-side eligibility enforcement (1C)
        const { checkEligibility } = await import('@coh/shared/domain/returns/eligibility.js');
        let eligibilitySettings: { windowDays: number; windowWarningDays: number } | undefined;
        const dbSettings = await prisma.returnSettings.findUnique({ where: { id: 'default' } });
        if (dbSettings) {
            eligibilitySettings = { windowDays: dbSettings.windowDays, windowWarningDays: dbSettings.windowWarningDays };
        }

        for (const line of orderLines) {
            const result = checkEligibility({
                deliveredAt: line.deliveredAt ?? null,
                returnStatus: line.returnStatus,
                isNonReturnable: line.isNonReturnable,
                productIsReturnable: line.sku.variation?.product?.isReturnable ?? true,
                productNonReturnableReason: line.sku.variation?.product?.nonReturnableReason ?? null,
            }, eligibilitySettings);

            // Block hard ineligible (already_active, line_blocked, not_delivered)
            if (!result.eligible && result.reason !== 'expired_override') {
                return returnError(RETURN_ERROR_CODES.WINDOW_EXPIRED, `${line.sku.skuCode}: ${result.reason}`);
            }
            // expired_override is allowed (staff can override) — eligibility returns eligible=true with reason='expired_override'
        }

        // Validate and capture exchange SKU + price diff at initiation
        let exchangePriceDiff: number | null = null;
        let exchangeSkuVariationId: string | null = null;
        if (returnResolution === 'exchange' && exchangeSkuId) {
            const exchangeSku = await prisma.sku.findUnique({
                where: { id: exchangeSkuId },
                select: { id: true, skuCode: true, mrp: true, variationId: true },
            });
            if (!exchangeSku) {
                return returnError(RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND);
            }
            exchangeSkuVariationId = exchangeSku.variationId;

            // Calculate price diff per line (using first line's pricing as representative)
            const firstLine = orderLines[0];
            const firstLineReturnQty = qtyMap.get(firstLine.id) || firstLine.qty;
            const originalValue = firstLine.unitPrice * firstLineReturnQty;
            // Same product (same variation) = honour original discount; different product = MRP
            const isSameProduct = firstLine.sku.variationId === exchangeSkuVariationId;
            const exchangeUnitPrice = isSameProduct ? firstLine.unitPrice : exchangeSku.mrp;
            const exchangeValue = exchangeUnitPrice * firstLineReturnQty;
            exchangePriceDiff = exchangeValue - originalValue;
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
                        ...(exchangePriceDiff !== null ? { returnExchangePriceDiff: exchangePriceDiff } : {}),
                        returnPickupType: pickupType || null,
                        // Reset QC fields from any previous return
                        returnQcResult: null,
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
        let exchangeOrderNumber: string | undefined;

        // Immediately create exchange order at initiation (JIT production needs lead time)
        if (returnResolution === 'exchange' && exchangeSkuId) {
            try {
                const { createExchangeOrder } = await import('./returnResolution');
                // Use first line as the anchor for the exchange order
                const firstLineId = orderLines[0].id;
                const firstLineReturnQty = qtyMap.get(firstLineId) || orderLines[0].qty;
                const exchangeResult = await createExchangeOrder({
                    data: {
                        orderLineId: firstLineId,
                        exchangeSkuId,
                        exchangeQty: firstLineReturnQty,
                    },
                });

                if (exchangeResult.success && exchangeResult.data) {
                    exchangeOrderNumber = exchangeResult.data.exchangeOrderNumber;
                } else {
                    console.warn('[initiateLineReturn] Exchange order creation failed:', exchangeResult);
                }
            } catch (exchangeError: unknown) {
                console.error('[initiateLineReturn] Exchange order error:', exchangeError);
                // Non-fatal: return batch is created, exchange can be retried manually
            }
        }

        // Event logging
        for (const line of orderLines) {
            logReturnEvent('return.requested', line.id,
                `Return requested — batch ${batchNumber}`,
                context.user.id,
                { batchNumber, reason: returnReasonCategory, resolution: returnResolution }
            );
        }

        // SSE broadcast
        broadcastReturnUpdate('return_initiated', {
            orderLineIds: orderLines.map((l: typeof orderLines[number]) => l.id),
            batchNumber,
            orderId: order.id,
            ...(exchangeOrderNumber ? { exchangeOrderNumber } : {}),
        }, context.user.id);

        const message = exchangeOrderNumber
            ? `Return batch ${batchNumber} created for ${skuCodes} — exchange order ${exchangeOrderNumber} sent to production`
            : `Return batch ${batchNumber} created for ${skuCodes}`;

        return returnSuccess(
            {
                batchNumber,
                lineCount: orderLines.length,
                orderLineIds: orderLines.map((l: typeof orderLines[number]) => l.id),
                ...(exchangeOrderNumber ? { exchangeOrderNumber } : {}),
            },
            message
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

        // Manual pickup — update all lines in batch (1F fix)
        const pickupData = {
            returnStatus: 'approved' as const,
            returnPickupType: pickupType,
            returnCourier: courier || null,
            returnAwbNumber: awbNumber || null,
            returnPickupScheduledAt: scheduledAt || new Date(),
        };

        if (line.returnBatchNumber) {
            // Update all batch siblings still in 'requested' status
            await prisma.orderLine.updateMany({
                where: {
                    returnBatchNumber: line.returnBatchNumber,
                    returnStatus: 'requested',
                },
                data: pickupData,
            });
        } else {
            await prisma.orderLine.update({
                where: { id: orderLineId },
                data: pickupData,
            });
        }

        // Event logging
        logReturnEvent('return.approved', orderLineId,
            `Return approved — pickup scheduled${courier ? ` via ${courier}` : ''}`,
            undefined,
            { pickupType, courier, awbNumber, batchNumber: line.returnBatchNumber }
        );

        // SSE broadcast
        broadcastReturnUpdate('return_status_updated', {
            lineId: orderLineId,
            batchNumber: line.returnBatchNumber,
            changes: { returnStatus: 'approved' },
        }, '');

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

        const allowedStatuses = ['requested', 'approved'];
        if (!allowedStatuses.includes(line.returnStatus || '')) {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot mark in transit: current status is '${line.returnStatus}'`
            );
        }

        const updateData: Record<string, unknown> = {
            returnStatus: 'approved',
            returnPickupAt: new Date(),
        };
        if (awbNumber) updateData.returnAwbNumber = awbNumber;
        if (courier) updateData.returnCourier = courier;

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: updateData,
        });

        logReturnEvent('return.in_transit', orderLineId,
            `Item picked up from customer${courier ? ` — ${courier}` : ''}`,
            undefined,
            { awbNumber, courier }
        );

        broadcastReturnUpdate('return_status_updated', {
            lineId: orderLineId,
            changes: { returnStatus: 'approved' },
        }, '');

        return returnSuccess({ orderLineId }, 'Marked as approved');
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

        const allowedStatuses = ['requested', 'approved'];
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
                    returnStatus: 'inspected',
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

        logReturnEvent('return.inspected', orderLineId,
            `Received at warehouse — condition: ${condition}`,
            context.user.id,
            { condition, conditionNotes }
        );

        broadcastReturnUpdate('return_status_updated', {
            lineId: orderLineId,
            changes: { returnStatus: 'inspected' },
        }, context.user.id);

        // Sync to Return Prime (fire-and-forget)
        pushToReturnPrime(orderLineId, 'inspected');

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
                returnBatchNumber: true,
                skuId: true,
                order: { select: { customerId: true } },
            },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        const terminalStatuses = ['refunded', 'archived', 'rejected', 'cancelled'];
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

            // Fix 1B: Only decrement customer.returnCount when this is the LAST active line in the batch
            // (Initiation increments by 1 per batch, so cancellation should only decrement when batch is fully cancelled)
            if (line.order.customerId) {
                let shouldDecrementCustomer = true;
                if (line.returnBatchNumber) {
                    const otherActiveInBatch = await tx.orderLine.count({
                        where: {
                            returnBatchNumber: line.returnBatchNumber,
                            id: { not: orderLineId },
                            returnStatus: { notIn: ['cancelled', 'refunded', 'archived', 'rejected'] },
                        },
                    });
                    shouldDecrementCustomer = otherActiveInBatch === 0;
                }
                if (shouldDecrementCustomer) {
                    await tx.customer.update({
                        where: { id: line.order.customerId },
                        data: { returnCount: { decrement: 1 } },
                    });
                }
            }

            await tx.sku.update({
                where: { id: line.skuId },
                data: { returnCount: { decrement: line.returnQty || 1 } },
            });
        });

        logReturnEvent('return.cancelled', orderLineId,
            `Return cancelled${reason ? ` — ${reason}` : ''}`,
            context.user.id,
            { reason }
        );

        broadcastReturnUpdate('return_cancelled', {
            lineId: orderLineId,
            batchNumber: line.returnBatchNumber,
        }, context.user.id);

        // Sync to Return Prime (fire-and-forget)
        pushToReturnPrime(orderLineId, 'cancelled');

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

        // Validate line exists and has active return (1G fix)
        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: { id: true, returnStatus: true },
        });

        if (!line) {
            return returnError(RETURN_ERROR_CODES.LINE_NOT_FOUND);
        }

        if (!line.returnStatus) {
            return returnError(RETURN_ERROR_CODES.NO_ACTIVE_RETURN, 'No return to close');
        }

        if (['refunded', 'archived', 'rejected', 'cancelled'].includes(line.returnStatus)) {
            return returnError(RETURN_ERROR_CODES.ALREADY_TERMINAL);
        }

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnStatus: 'refunded',
                returnClosedManually: true,
                returnClosedManuallyAt: new Date(),
                returnClosedManuallyById: context.user.id,
                returnClosedReason: reason,
            },
        });

        logReturnEvent('return.closed_manually', orderLineId,
            `Return closed manually — ${reason}`,
            context.user.id,
            { reason }
        );

        broadcastReturnUpdate('return_completed', { lineId: orderLineId }, context.user.id);

        // Sync to Return Prime — manually closed = "refunded" status in ERP
        pushToReturnPrime(orderLineId, 'refunded');

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

        if (!line.returnStatus || ['cancelled', 'refunded', 'archived', 'rejected'].includes(line.returnStatus)) {
            return returnError(RETURN_ERROR_CODES.NO_ACTIVE_RETURN, 'No active return on this line');
        }

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: { returnNotes },
        });

        logReturnEvent('return.notes_updated', orderLineId,
            `Notes updated`,
            undefined,
            { notes: returnNotes }
        );

        return returnSuccess(
            { orderLineId },
            `Notes updated for ${line.sku.skuCode}`
        );
    });
