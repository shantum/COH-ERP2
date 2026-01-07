/**
 * Validation utilities and Zod schemas
 * - Password validation utility
 * - Zod schemas for order operations
 */

import { z } from 'zod';

// ============================================
// PASSWORD VALIDATION
// ============================================

export function validatePassword(password) {
    const errors = [];

    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }

    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"|,.<>/?)');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

// ============================================
// ORDER SCHEMAS
// ============================================

/**
 * Ship order validation schema
 */
export const ShipOrderSchema = z.object({
    awbNumber: z.string().min(1, 'AWB number is required').trim(),
    courier: z.string().min(1, 'Courier is required').trim(),
});

/**
 * Create order validation schema
 */
export const CreateOrderSchema = z.object({
    orderNumber: z.string().optional(),
    channel: z.string().default('offline'),
    customerName: z.string().min(1, 'Customer name is required').trim(),
    customerEmail: z.string().email('Invalid email format').optional().nullable(),
    customerPhone: z.string().optional().nullable(),
    shippingAddress: z.string().optional().nullable(),
    orderDate: z.string().datetime().optional(),
    paymentMethod: z.enum(['Prepaid', 'COD']).default('Prepaid'),
    totalAmount: z.number().positive('Total amount must be positive').optional(),
    customerNotes: z.string().optional().nullable(),
    internalNotes: z.string().optional().nullable(),
    lines: z.array(z.object({
        skuId: z.string().uuid('Invalid SKU ID format'),
        qty: z.number().int('Quantity must be an integer').positive('Quantity must be positive'),
        unitPrice: z.number().positive('Unit price must be positive').optional(),
    })).min(1, 'At least one line item is required'),
});

/**
 * Update order validation schema
 */
export const UpdateOrderSchema = z.object({
    customerName: z.string().min(1, 'Customer name cannot be empty').trim().optional(),
    customerEmail: z.string().email('Invalid email format').optional().nullable(),
    customerPhone: z.string().optional().nullable(),
    shippingAddress: z.string().optional().nullable(),
    channel: z.string().optional(),
    customerNotes: z.string().optional().nullable(),
    internalNotes: z.string().optional().nullable(),
    totalAmount: z.number().positive('Total amount must be positive').optional(),
});

/**
 * Cancel order validation schema
 */
export const CancelOrderSchema = z.object({
    reason: z.string().optional(),
});

/**
 * Add line to order validation schema
 */
export const AddOrderLineSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID format'),
    qty: z.number().int('Quantity must be an integer').positive('Quantity must be positive'),
    unitPrice: z.number().positive('Unit price must be positive').optional(),
});

/**
 * Update order line validation schema
 */
export const UpdateOrderLineSchema = z.object({
    qty: z.number().int('Quantity must be an integer').positive('Quantity must be positive').optional(),
    unitPrice: z.number().positive('Unit price must be positive').optional(),
});

/**
 * Bulk update lines validation schema
 */
export const BulkUpdateLinesSchema = z.object({
    lineIds: z.array(z.string().uuid('Invalid line ID format')).min(1, 'At least one line ID is required'),
    action: z.enum(['allocate', 'unallocate', 'pick', 'unpick', 'pack', 'unpack', 'cancel']),
    productionBatchId: z.string().uuid('Invalid batch ID format').optional(),
});

/**
 * Archive before date validation schema
 */
export const ArchiveBeforeDateSchema = z.object({
    beforeDate: z.string().datetime('Invalid date format'),
    dryRun: z.boolean().optional().default(false),
});

/**
 * Mark delivered validation schema
 */
export const MarkDeliveredSchema = z.object({
    deliveredAt: z.string().datetime('Invalid date format').optional(),
});

/**
 * Mark RTO validation schema
 */
export const MarkRtoSchema = z.object({
    rtoInitiatedAt: z.string().datetime('Invalid date format').optional(),
});

/**
 * Receive RTO validation schema
 */
export const ReceiveRtoSchema = z.object({
    rtoReceivedAt: z.string().datetime('Invalid date format').optional(),
});

// ============================================
// VALIDATION MIDDLEWARE
// ============================================

/**
 * Validation middleware factory
 * Creates Express middleware that validates request body against a Zod schema
 *
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware function
 *
 * @example
 * router.post('/', validate(CreateOrderSchema), (req, res) => {
 *     const { customerName, lines } = req.validatedBody;
 *     // ...
 * });
 */
export function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map(issue => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }

        // Attach validated and transformed data to request
        req.validatedBody = result.data;
        next();
    };
}

/**
 * Validation middleware for query parameters
 *
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware function
 */
export function validateQuery(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.query);

        if (!result.success) {
            return res.status(400).json({
                error: 'Invalid query parameters',
                details: result.error.issues.map(issue => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }

        req.validatedQuery = result.data;
        next();
    };
}

// ============================================
// QUERY PARAMETER SCHEMAS
// ============================================

/**
 * Pagination query schema
 */
export const PaginationQuerySchema = z.object({
    limit: z.string().optional().transform(val => val ? Number(val) : 50),
    offset: z.string().optional().transform(val => val ? Number(val) : 0),
});

/**
 * Shipped orders query schema
 */
export const ShippedOrdersQuerySchema = z.object({
    limit: z.string().optional().transform(val => val ? Number(val) : 100),
    offset: z.string().optional().transform(val => val ? Number(val) : 0),
    days: z.string().optional().transform(val => val ? Number(val) : 30),
});

/**
 * Archived orders query schema
 */
export const ArchivedOrdersQuerySchema = z.object({
    limit: z.string().optional().transform(val => val ? Number(val) : 100),
    offset: z.string().optional().transform(val => val ? Number(val) : 0),
    days: z.string().optional().transform(val => val ? Number(val) : 90),
    sortBy: z.enum(['orderDate', 'archivedAt']).optional().default('archivedAt'),
});
