/**
 * Payment-related validation schemas
 */

import { z } from 'zod';

// ============================================
// CREATE PAYMENT SCHEMA
// ============================================

export const CreatePaymentSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    amount: z.number().positive('Amount must be positive'),
    paymentMethod: z.string().optional(),
    reference: z.string().max(200, 'Reference too long').optional(),
    notes: z.string().max(500, 'Notes too long').optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

// ============================================
// PAYMENT SUMMARY SCHEMA
// ============================================

export interface PaymentSummary {
    totalPaid: number;
    totalDue: number;
    status: 'pending' | 'partially_paid' | 'paid' | 'overpaid';
    payments: Array<{
        id: string;
        amount: number;
        paymentMethod: string | null;
        reference: string | null;
        notes: string | null;
        recordedAt: Date;
        recordedBy: {
            email: string;
        };
    }>;
}
