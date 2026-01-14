/**
 * Payments tRPC Router
 * Procedures for managing order payment transactions
 *
 * Procedures:
 * - create: Add a new payment to an order
 * - listByOrder: Get all payments for an order
 * - getSummary: Get payment summary (total paid, due, status)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import { CreatePaymentSchema } from '@coh/shared';
import { getOrderPaymentSummary } from '../../utils/paymentUtils.js';

// ============================================
// CREATE PAYMENT PROCEDURE
// ============================================

/**
 * Create a new payment transaction for an order
 * Validates that payment doesn't exceed order total (with warning for overpayment)
 */
const create = protectedProcedure
    .input(CreatePaymentSchema)
    .mutation(async ({ input, ctx }) => {
        const { orderId, amount, paymentMethod, reference, notes } = input;

        // Validate order exists and get current payment summary
        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { payments: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Calculate current total paid
        const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
        const newTotal = totalPaid + amount;

        // Allow overpayment with warning (Option B)
        const isOverpayment = newTotal > order.totalAmount;

        // Create payment transaction
        const payment = await ctx.prisma.orderPayment.create({
            data: {
                orderId,
                amount,
                paymentMethod,
                reference,
                notes,
                recordedById: ctx.user.id,
            },
            include: {
                recordedBy: {
                    select: { email: true },
                },
            },
        });

        return {
            payment,
            warning: isOverpayment
                ? `Payment creates overpayment. Total: ₹${newTotal}, Order: ₹${order.totalAmount}`
                : undefined,
        };
    });

// ============================================
// LIST PAYMENTS PROCEDURE
// ============================================

/**
 * List all payment transactions for an order
 */
const listByOrder = protectedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        return await ctx.prisma.orderPayment.findMany({
            where: { orderId: input.orderId },
            orderBy: { recordedAt: 'desc' },
            include: {
                recordedBy: {
                    select: { email: true },
                },
            },
        });
    });

// ============================================
// GET PAYMENT SUMMARY PROCEDURE
// ============================================

/**
 * Get payment summary for an order
 * Includes total paid, total due, status, and all payments
 */
const getSummary = protectedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
        return await getOrderPaymentSummary(ctx.prisma, input.orderId);
    });

// ============================================
// EXPORT ROUTER
// ============================================

/**
 * Payments router - combines all payment procedures
 */
export const paymentsRouter = router({
    create,
    listByOrder,
    getSummary,
});
