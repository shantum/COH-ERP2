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
//# sourceMappingURL=payments.js.map