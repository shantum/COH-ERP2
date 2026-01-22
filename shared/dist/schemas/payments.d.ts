/**
 * Payment-related validation schemas
 */
import { z } from 'zod';
export declare const CreatePaymentSchema: z.ZodObject<{
    orderId: z.ZodString;
    amount: z.ZodNumber;
    paymentMethod: z.ZodOptional<z.ZodString>;
    reference: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
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
//# sourceMappingURL=payments.d.ts.map