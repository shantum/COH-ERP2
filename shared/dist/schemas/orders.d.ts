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
/**
 * AWB (Air Waybill) number schema
 * Auto-uppercases and validates 8-20 alphanumeric characters
 */
export declare const awbSchema: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
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
export declare const ShipOrderSchema: z.ZodObject<{
    awbNumber: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    courier: z.ZodString;
}, z.core.$strip>;
export type ShipOrderInput = z.infer<typeof ShipOrderSchema>;
/**
 * Mark order payment as paid validation schema
 * Used for confirming payment receipt for offline orders
 */
export declare const MarkPaymentPaidSchema: z.ZodObject<{
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MarkPaymentPaidInput = z.infer<typeof MarkPaymentPaidSchema>;
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
export declare const CreateOrderSchema: z.ZodObject<{
    orderNumber: z.ZodOptional<z.ZodString>;
    channel: z.ZodDefault<z.ZodString>;
    isExchange: z.ZodDefault<z.ZodBoolean>;
    originalOrderId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    customerName: z.ZodString;
    customerEmail: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    customerPhone: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    customerId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    shippingAddress: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    orderDate: z.ZodOptional<z.ZodString>;
    shipByDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    paymentMethod: z.ZodDefault<z.ZodEnum<{
        Prepaid: "Prepaid";
        COD: "COD";
    }>>;
    paymentStatus: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        paid: "paid";
    }>>>;
    totalAmount: z.ZodOptional<z.ZodNumber>;
    internalNotes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    lines: z.ZodArray<z.ZodObject<{
        skuId: z.ZodString;
        qty: z.ZodNumber;
        unitPrice: z.ZodOptional<z.ZodNumber>;
        shippingAddress: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
/**
 * Update order validation schema
 */
export declare const UpdateOrderSchema: z.ZodObject<{
    customerName: z.ZodOptional<z.ZodString>;
    customerEmail: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    customerPhone: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    shippingAddress: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    channel: z.ZodOptional<z.ZodString>;
    internalNotes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    totalAmount: z.ZodOptional<z.ZodNumber>;
    shipByDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    paymentMethod: z.ZodOptional<z.ZodEnum<{
        Prepaid: "Prepaid";
        COD: "COD";
    }>>;
    paymentStatus: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        paid: "paid";
        partially_paid: "partially_paid";
        refunded: "refunded";
        partially_refunded: "partially_refunded";
    }>>;
    isExchange: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type UpdateOrderInput = z.infer<typeof UpdateOrderSchema>;
/**
 * Customize order line validation schema
 * Used for creating custom SKUs for order lines
 */
export declare const CustomizeLineSchema: z.ZodObject<{
    type: z.ZodEnum<{
        size: "size";
        length: "length";
        measurements: "measurements";
        other: "other";
    }>;
    value: z.ZodString;
    notes: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
}, z.core.$strip>;
export type CustomizeLineInput = z.infer<typeof CustomizeLineSchema>;
/**
 * Update line notes schema
 * Used for inline notes editing in orders table
 */
export declare const UpdateLineNotesSchema: z.ZodObject<{
    lineId: z.ZodString;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateLineNotesInput = z.infer<typeof UpdateLineNotesSchema>;
/**
 * Update line tracking schema
 * Used for inline AWB/courier editing in orders table
 */
export declare const UpdateLineTrackingSchema: z.ZodObject<{
    lineId: z.ZodString;
    awbNumber: z.ZodNullable<z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>;
    courier: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateLineTrackingInput = z.infer<typeof UpdateLineTrackingSchema>;
/**
 * Update ship by date schema
 * Used for inline date editing in orders table
 */
export declare const UpdateShipByDateSchema: z.ZodObject<{
    orderId: z.ZodString;
    shipByDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateShipByDateInput = z.infer<typeof UpdateShipByDateSchema>;
/**
 * Update line quantity schema
 * Used for inline quantity editing in order modals
 */
export declare const UpdateLineQuantitySchema: z.ZodObject<{
    lineId: z.ZodString;
    qty: z.ZodNumber;
}, z.core.$strip>;
export type UpdateLineQuantityInput = z.infer<typeof UpdateLineQuantitySchema>;
/**
 * Update line unit price schema
 * Used for inline price editing in order modals
 */
export declare const UpdateLineUnitPriceSchema: z.ZodObject<{
    lineId: z.ZodString;
    unitPrice: z.ZodNumber;
}, z.core.$strip>;
export type UpdateLineUnitPriceInput = z.infer<typeof UpdateLineUnitPriceSchema>;
/**
 * Update order internal notes schema
 * Used for order-level notes editing
 */
export declare const UpdateOrderNotesSchema: z.ZodObject<{
    orderId: z.ZodString;
    internalNotes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateOrderNotesInput = z.infer<typeof UpdateOrderNotesSchema>;
//# sourceMappingURL=orders.d.ts.map