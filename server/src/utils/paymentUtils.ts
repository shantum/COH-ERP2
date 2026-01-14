/**
 * Payment calculation utilities
 * For computing payment status and summary from OrderPayment transactions
 */

import type { PrismaClient } from '@prisma/client';
import type { PaymentSummary } from '@coh/shared';

// ============================================
// PAYMENT STATUS CALCULATION
// ============================================

/**
 * Calculate payment status based on total paid vs order total
 */
export function calculatePaymentStatus(
    orderTotal: number,
    totalPaid: number
): 'pending' | 'partially_paid' | 'paid' | 'overpaid' {
    if (totalPaid === 0) return 'pending';
    if (totalPaid < orderTotal) return 'partially_paid';
    if (totalPaid === orderTotal) return 'paid';
    return 'overpaid'; // Edge case - show warning
}

// ============================================
// ORDER PAYMENT SUMMARY
// ============================================

/**
 * Get complete payment summary for an order
 * Includes total paid, due, status, and all payment transactions
 */
export async function getOrderPaymentSummary(
    prisma: PrismaClient | any,
    orderId: string
): Promise<PaymentSummary> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            payments: {
                orderBy: { recordedAt: 'desc' },
                include: {
                    recordedBy: {
                        select: { email: true },
                    },
                },
            },
        },
    });

    if (!order) {
        throw new Error('Order not found');
    }

    const totalPaid = order.payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
    const totalDue = Math.max(0, order.totalAmount - totalPaid); // Never negative
    const status = calculatePaymentStatus(order.totalAmount, totalPaid);

    return {
        totalPaid,
        totalDue,
        status,
        payments: order.payments,
    };
}
