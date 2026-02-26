/**
 * Payment Mutations - TanStack Start Server Functions
 *
 * Mutations:
 * - createPayment: Add a new payment to an order
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware, type AuthUser } from '../middleware/auth';
import { CreatePaymentSchema, type CreatePaymentInput } from '@coh/shared';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * Payment record returned after creation
 */
export interface PaymentRecord {
    id: string;
    orderId: string;
    amount: number;
    paymentMethod: string | null;
    reference: string | null;
    notes: string | null;
    recordedAt: Date;
    recordedBy: {
        email: string;
    };
}

/**
 * Create payment response
 */
export interface CreatePaymentResponse {
    payment: PaymentRecord;
    warning?: string;
}

// ============================================
// CREATE PAYMENT MUTATION
// ============================================

/**
 * Create a new payment transaction for an order
 *
 * Validates:
 * - Order exists
 * - Calculates total paid vs order total
 *
 * Note: Allows overpayment with warning (business decision)
 *
 * @returns Created payment record with optional overpayment warning
 */
export const createPayment = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): CreatePaymentInput => CreatePaymentSchema.parse(input)
    )
    .handler(
        async ({
            data,
            context,
        }: {
            data: CreatePaymentInput;
            context: { user: AuthUser };
        }): Promise<CreatePaymentResponse> => {
            const { orderId, amount, paymentMethod, reference, notes } = data;
            const user = context.user;

            const prisma = await getPrisma();

            // Atomic: read order + check totals + create payment
            const { payment, isOverpayment, orderTotal, newTotal } = await prisma.$transaction(async (tx: PrismaTransaction) => {
                const order = await tx.order.findUnique({
                    where: { id: orderId },
                    include: { payments: true },
                });

                if (!order) {
                    throw new Error('Order not found');
                }

                const totalPaid = order.payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
                const total = totalPaid + amount;
                const overpaying = total > order.totalAmount;

                const created = await tx.orderPayment.create({
                    data: {
                        orderId,
                        amount,
                        paymentMethod,
                        reference,
                        notes,
                        recordedById: user.id,
                    },
                    include: {
                        recordedBy: {
                            select: { email: true },
                        },
                    },
                });

                return { payment: created, isOverpayment: overpaying, orderTotal: order.totalAmount, newTotal: total };
            });

            // SSE broadcast after transaction (non-critical)
            const { notifySSE } = await import('@coh/shared/services/sseBroadcast');
            await notifySSE({ type: 'payment_created', orderId }, user.id);

            return {
                payment,
                warning: isOverpayment
                    ? `Payment creates overpayment. Total: ${newTotal}, Order: ${orderTotal}`
                    : undefined,
            };
        }
    );
