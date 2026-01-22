/**
 * Order validation schemas for COH ERP
 *
 * These Zod schemas are used for validating order-related data
 * on both server and client.
 *
 * Key patterns:
 * - AWB validation: awbSchema auto-uppercases and validates format
 * - Exchange orders: CreateOrderSchema supports negative totalAmount for exchanges
 * - Custom SKUs: CustomizeLineSchema for order line customizations
 */
import { z } from 'zod';
// ============================================
// AWB SCHEMA
// ============================================
/**
 * AWB (Air Waybill) number schema
 * Auto-uppercases and validates 8-20 alphanumeric characters
 */
export const awbSchema = z.string()
    .min(1, 'AWB number is required')
    .trim()
    .transform((val) => val.toUpperCase())
    .refine((val) => /^[A-Za-z0-9]{8,20}$/.test(val), { message: 'AWB number must be 8-20 alphanumeric characters' });
// ============================================
// SHIP ORDER SCHEMA
// ============================================
/**
 * Ship order validation schema
 * Validates AWB format against courier-specific patterns.
 * AWB is auto-uppercased via Zod transform.
 *
 * @example
 * router.post('/ship', validate(ShipOrderSchema), (req, res) => {
 *   const { awbNumber, courier } = req.validatedBody; // awbNumber is uppercased
 * });
 */
export const ShipOrderSchema = z.object({
    awbNumber: awbSchema,
    courier: z.string().min(1, 'Courier is required').trim(),
});
// ============================================
// MARK PAYMENT PAID SCHEMA
// ============================================
/**
 * Mark order payment as paid validation schema
 * Used for confirming payment receipt for offline orders
 */
export const MarkPaymentPaidSchema = z.object({
    notes: z.string().optional(),
});
// ============================================
// CREATE ORDER SCHEMA
// ============================================
/**
 * Create order validation schema
 * Supports both regular orders and exchange orders.
 *
 * Key fields:
 * - isExchange: true for exchange orders (allows negative/zero totalAmount)
 * - originalOrderId: Required for exchange orders (links to original order)
 * - shipByDate: Optional shipping deadline (ISO datetime string)
 * - lines[].shippingAddress: Optional line-level address (JSON string)
 *
 * GOTCHA: Exchange orders can have negative totalAmount (exchange down = customer gets refund).
 */
export const CreateOrderSchema = z.object({
    orderNumber: z.string().optional(),
    channel: z.string().default('offline'),
    // Exchange order fields
    isExchange: z.boolean().default(false),
    originalOrderId: z.string().uuid('Invalid original order ID').optional().nullable(),
    customerName: z.string().min(1, 'Customer name is required').trim(),
    customerEmail: z.string().email('Invalid email format').optional().nullable(),
    customerPhone: z.string().optional().nullable(),
    customerId: z.string().uuid('Invalid customer ID').optional().nullable(), // Link to existing customer
    shippingAddress: z.string().optional().nullable(),
    orderDate: z.string().datetime().optional(),
    shipByDate: z.string().optional().nullable(), // Optional shipping deadline (YYYY-MM-DD or ISO datetime)
    paymentMethod: z.enum(['Prepaid', 'COD']).default('Prepaid'),
    paymentStatus: z.enum(['pending', 'paid']).default('pending').optional(),
    // totalAmount can be 0 or negative for exchange orders
    totalAmount: z.number().optional(),
    internalNotes: z.string().optional().nullable(),
    lines: z.array(z.object({
        skuId: z.string().uuid('Invalid SKU ID format'),
        qty: z.number().int('Quantity must be an integer').positive('Quantity must be positive'),
        unitPrice: z.number().min(0, 'Unit price cannot be negative').optional(),
        shippingAddress: z.string().optional().nullable(), // Line-level shipping address (JSON string)
    })).min(1, 'At least one line item is required'),
}).refine((data) => {
    // For non-exchange orders, totalAmount must be positive if provided
    if (!data.isExchange && data.totalAmount !== undefined && data.totalAmount <= 0) {
        return false;
    }
    return true;
}, {
    message: 'Total amount must be positive for non-exchange orders',
    path: ['totalAmount'],
});
// ============================================
// UPDATE ORDER SCHEMA
// ============================================
/**
 * Update order validation schema
 */
export const UpdateOrderSchema = z.object({
    customerName: z.string().min(1, 'Customer name cannot be empty').trim().optional(),
    customerEmail: z.string().email('Invalid email format').optional().nullable(),
    customerPhone: z.string().optional().nullable(),
    shippingAddress: z.string().optional().nullable(),
    channel: z.string().optional(),
    internalNotes: z.string().optional().nullable(),
    totalAmount: z.number().positive('Total amount must be positive').optional(),
    shipByDate: z.string().optional().nullable(), // Accepts YYYY-MM-DD or ISO datetime
    paymentMethod: z.enum(['Prepaid', 'COD']).optional(),
    paymentStatus: z.enum(['pending', 'paid', 'partially_paid', 'refunded', 'partially_refunded']).optional(),
    isExchange: z.boolean().optional(),
});
// ============================================
// CUSTOMIZE LINE SCHEMA
// ============================================
/**
 * Customize order line validation schema
 * Used for creating custom SKUs for order lines
 */
export const CustomizeLineSchema = z.object({
    type: z.enum(['length', 'size', 'measurements', 'other'], {
        message: 'Type must be one of: length, size, measurements, other',
    }),
    value: z.string()
        .trim()
        .min(1, 'Customization value is required'),
    notes: z.string()
        .trim()
        .max(500, 'Notes cannot exceed 500 characters')
        .optional()
        .or(z.literal('')),
});
// ============================================
// INLINE EDIT SCHEMAS (for table cell edits)
// ============================================
/**
 * Update line notes schema
 * Used for inline notes editing in orders table
 */
export const UpdateLineNotesSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    notes: z.string().max(1000, 'Notes cannot exceed 1000 characters').optional().nullable(),
});
/**
 * Update line tracking schema
 * Used for inline AWB/courier editing in orders table
 */
export const UpdateLineTrackingSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    awbNumber: awbSchema.optional().nullable(),
    courier: z.string().trim().optional().nullable(),
});
/**
 * Update ship by date schema
 * Used for inline date editing in orders table
 */
export const UpdateShipByDateSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    shipByDate: z.string().optional().nullable(), // YYYY-MM-DD or ISO datetime
});
/**
 * Update line quantity schema
 * Used for inline quantity editing in order modals
 */
export const UpdateLineQuantitySchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    qty: z.number().int('Quantity must be an integer').positive('Quantity must be positive'),
});
/**
 * Update line unit price schema
 * Used for inline price editing in order modals
 */
export const UpdateLineUnitPriceSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    unitPrice: z.number().min(0, 'Unit price cannot be negative'),
});
/**
 * Update order internal notes schema
 * Used for order-level notes editing
 */
export const UpdateOrderNotesSchema = z.object({
    orderId: z.string().uuid('Invalid order ID'),
    internalNotes: z.string().max(2000, 'Notes cannot exceed 2000 characters').optional().nullable(),
});
//# sourceMappingURL=orders.js.map