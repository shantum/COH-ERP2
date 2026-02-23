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

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnRefundCompletedAt: now,
                returnRefundReference: reference || null,
                refundedAt: now,
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

        if (line.returnStatus !== 'received') {
            return returnError(
                RETURN_ERROR_CODES.WRONG_STATUS,
                `Cannot complete: current status is '${line.returnStatus}', expected 'received'`
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
            data: { returnStatus: 'complete' },
        });

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

        const exchangeSku = await prisma.sku.findUnique({
            where: { id: exchangeSkuId },
            select: { id: true, skuCode: true, mrp: true },
        });

        if (!exchangeSku) {
            return returnError(RETURN_ERROR_CODES.EXCHANGE_SKU_NOT_FOUND);
        }

        const originalValue = line.unitPrice * (line.returnQty || line.qty);
        const exchangeValue = exchangeSku.mrp * exchangeQty;
        const priceDiff = exchangeValue - originalValue;

        const count = await prisma.order.count({ where: { isExchange: true } });
        const exchangeOrderNumber = `EXC${String(count + 1).padStart(5, '0')}`;

        const exchangeOrder = await prisma.$transaction(async (tx: PrismaTransaction) => {
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

        // Push exchange order to "Orders from COH" sheet (fire-and-forget)
        const PORT = process.env.PORT || 3001;
        fetch(`http://127.0.0.1:${PORT}/api/internal/push-order-to-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: exchangeOrder.id }),
        }).catch(() => {});

        return returnSuccess(
            {
                exchangeOrderId: exchangeOrder.id,
                exchangeOrderNumber,
                priceDiff,
            },
            `Exchange order ${exchangeOrderNumber} created`
        );
    });
