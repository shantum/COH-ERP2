/**
 * Return Resolution Mutations - TanStack Start Server Functions
 *
 * Refunds, exchanges, and completion for line-level returns.
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

import {
    ProcessReturnRefundInputSchema,
    CreateExchangeOrderInputSchema,
    type ProcessReturnRefundInput,
    type CreateExchangeOrderInput,
} from '@coh/shared/schemas/returns';
import {
    RETURN_ERROR_CODES,
    returnSuccess,
    returnError,
    type ReturnResult,
} from '@coh/shared/errors';
import { getInternalApiBaseUrl } from '../utils';

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
 * Process refund for a return
 */
export const processLineReturnRefund = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): ProcessReturnRefundInput => ProcessReturnRefundInputSchema.parse(input))
    .handler(async ({ data }: { data: ProcessReturnRefundInput }): Promise<ReturnResult<{ orderLineId: string; netAmount: number }>> => {
        const prisma = await getPrisma();
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

        // 1D: Refund status guard — must be inspected first
        const refundAllowedStatuses = ['inspected'];
        if (!refundAllowedStatuses.includes(line.returnStatus || '')) {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot process refund: item must be received first (current: '${line.returnStatus}')`
            );
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
                refundAmount: netAmount,
                refundReason: 'customer_return',
            },
        });

        logReturnEvent('return.refund_processed', orderLineId,
            `Refund calculated — ₹${netAmount.toLocaleString('en-IN')}`,
            undefined,
            { grossAmount, discountClawback, deductions, netAmount, refundMethod }
        );

        broadcastReturnUpdate('return_refund_processed', {
            lineId: orderLineId,
            changes: { returnNetAmount: netAmount },
        }, '');

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
        const prisma = await getPrisma();
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
        const prisma = await getPrisma();
        const { orderLineId, reference } = data;

        const now = new Date();

        // Fetch line with order to check refund method + customer
        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            select: {
                returnRefundMethod: true,
                returnNetAmount: true,
                order: { select: { customerId: true } },
            },
        });

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnRefundCompletedAt: now,
                returnRefundReference: reference || null,
                refundedAt: now,
            },
        });

        // If store credit, increment customer balance
        if (line?.returnRefundMethod === 'store_credit' && line.returnNetAmount && line.order.customerId) {
            await prisma.customer.update({
                where: { id: line.order.customerId },
                data: {
                    storeCreditBalance: { increment: line.returnNetAmount },
                },
            });
        }

        logReturnEvent('return.refund_completed', orderLineId,
            `Refund completed${line?.returnRefundMethod ? ` via ${line.returnRefundMethod}` : ''}`,
            undefined,
            { refundMethod: line?.returnRefundMethod, netAmount: line?.returnNetAmount, reference }
        );

        return { success: true, message: 'Refund completed', orderLineId };
    });

/**
 * Complete a return (final status)
 */
export const completeLineReturn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderLineId: z.string().uuid() }).parse(input))
    .handler(async ({ data }: { data: { orderLineId: string } }): Promise<ReturnResult<{ orderLineId: string }>> => {
        const prisma = await getPrisma();
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

        // Allow completion from 'inspected'
        const completableStatuses = ['inspected'];
        if (!completableStatuses.includes(line.returnStatus || '')) {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot complete: current status is '${line.returnStatus}', expected 'inspected'`
            );
        }

        if (line.returnResolution === 'refund' && !line.returnRefundCompletedAt) {
            return returnError(RETURN_ERROR_CODES.REFUND_NOT_COMPLETED);
        }

        if (line.returnResolution === 'exchange' && !line.returnExchangeOrderId) {
            return returnError(RETURN_ERROR_CODES.EXCHANGE_NOT_CREATED);
        }

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: { returnStatus: 'refunded' },
        });

        logReturnEvent('return.completed', orderLineId,
            'Return marked as complete',
            undefined,
            { resolution: line.returnResolution }
        );

        broadcastReturnUpdate('return_completed', { lineId: orderLineId }, '');

        return returnSuccess({ orderLineId }, 'Return completed');
    });

/**
 * Create exchange order from a return line
 * Staff-initiated - can be done at any point during the return process
 */
export const createExchangeOrder = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown): CreateExchangeOrderInput => CreateExchangeOrderInputSchema.parse(input))
    .handler(async ({ data }: { data: CreateExchangeOrderInput }): Promise<ReturnResult<{ exchangeOrderId: string; exchangeOrderNumber: string; priceDiff: number }>> => {
        const prisma = await getPrisma();
        const { orderLineId, exchangeSkuId, exchangeQty } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: true,
                sku: { select: { mrp: true, variationId: true } },
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

        const exchangeSku = await prisma.sku.findUnique({
            where: { id: exchangeSkuId },
            select: { id: true, skuCode: true, mrp: true, variationId: true },
        });

        if (!exchangeSku) {
            return returnError(RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND);
        }

        // 1E: Fix exchange pricing — same product preserves original discount
        const isSameProduct = line.sku.variationId === exchangeSku.variationId;
        const exchangeUnitPrice = isSameProduct ? line.unitPrice : exchangeSku.mrp;
        const originalValue = line.unitPrice * (line.returnQty || line.qty);
        const exchangeValue = exchangeUnitPrice * exchangeQty;
        const priceDiff = exchangeValue - originalValue;

        const exchangeOrder = await prisma.$transaction(async (tx: PrismaTransaction) => {
            // 1I: Race-safe order number generation — EXC-MMYYXXXX format
            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yy = String(now.getFullYear()).slice(-2);
            const monthPrefix = `EXC-${mm}${yy}`;

            const [maxResult] = await tx.$queryRaw<[{ max_seq: number | null }]>`
                SELECT MAX(CAST(SUBSTRING("orderNumber" FROM ${monthPrefix.length + 1}) AS INTEGER)) as max_seq
                FROM "Order" WHERE "orderNumber" LIKE ${monthPrefix + '%'}
            `;
            const nextSeq = (maxResult?.max_seq || 0) + 1;
            const exchangeOrderNumber = `${monthPrefix}${String(nextSeq).padStart(4, '0')}`;

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
                            unitPrice: exchangeUnitPrice,
                            lineStatus: 'pending',
                        },
                    },
                },
            });

            await tx.orderLine.update({
                where: { id: orderLineId },
                data: {
                    returnExchangeOrderId: newOrder.id,
                    returnExchangeSkuId: exchangeSkuId,
                    returnExchangePriceDiff: priceDiff,
                },
            });

            if (line.order.customerId) {
                await tx.customer.update({
                    where: { id: line.order.customerId },
                    data: { exchangeCount: { increment: 1 } },
                });
            }

            return newOrder;
        });

        const baseUrl = getInternalApiBaseUrl();

        // Push exchange order to "Orders from COH" sheet (fire-and-forget)
        fetch(`${baseUrl}/api/internal/push-order-to-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: exchangeOrder.id }),
        }).catch(() => {});

        logReturnEvent('return.exchange_created', orderLineId,
            `Exchange order ${exchangeOrder.orderNumber} created`,
            undefined,
            { exchangeOrderId: exchangeOrder.id, exchangeOrderNumber: exchangeOrder.orderNumber, priceDiff }
        );

        // SSE broadcast exchange creation
        broadcastReturnUpdate('return_exchange_created', {
            lineId: orderLineId,
            exchangeOrderId: exchangeOrder.id,
            exchangeOrderNumber: exchangeOrder.orderNumber,
        }, '');

        // Also broadcast the new order creation for the Orders page
        const { notifySSE } = await import('@coh/shared/services/sseBroadcast');
        notifySSE({ type: 'order_created', orderId: exchangeOrder.id }).catch(() => {});

        return returnSuccess(
            {
                exchangeOrderId: exchangeOrder.id,
                exchangeOrderNumber: exchangeOrder.orderNumber,
                priceDiff,
            },
            `Exchange order ${exchangeOrder.orderNumber} created`
        );
    });
