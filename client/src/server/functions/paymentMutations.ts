/**
 * Payment Mutations - TanStack Start Server Functions
 *
 * Phase 1 mutations - Simple CRUD with NO SSE broadcasting and NO cache invalidation.
 *
 * Mutations:
 * - createPayment: Add a new payment to an order
 */
'use server';

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware, type AuthUser } from '../middleware/auth';
import { CreatePaymentSchema, type CreatePaymentInput } from '@coh/shared';
import { getPrisma } from '@coh/shared/services/db';

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

            // Validate order exists and get current payment summary
            const order = await prisma.order.findUnique({
                where: { id: orderId },
                include: { payments: true },
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // Calculate current total paid
            const totalPaid = order.payments.reduce((sum: number, p: typeof order.payments[number]) => sum + p.amount, 0);
            const newTotal = totalPaid + amount;

            // Allow overpayment with warning (Option B from tRPC implementation)
            const isOverpayment = newTotal > order.totalAmount;

            // Create payment transaction
            const payment = await prisma.orderPayment.create({
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

            return {
                payment,
                warning: isOverpayment
                    ? `Payment creates overpayment. Total: ${newTotal}, Order: ${order.totalAmount}`
                    : undefined,
            };
        }
    );
