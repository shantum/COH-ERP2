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
// AWB VALIDATION
// ============================================

/**
 * AWB (Air Waybill) number validation patterns by courier
 * Each courier has specific AWB formats
 *
 * Common formats:
 * - iThink Logistics: 12-15 alphanumeric characters (e.g., "IT123456789012")
 * - Delhivery: 10-15 digits or alphanumeric
 * - BlueDart: 11-digit numeric
 * - FedEx: 12-15 digits
 * - DHL: 10-digit numeric
 *
 * Generic validation: alphanumeric, 8-20 characters
 */
const AWB_PATTERNS = {
    // Generic pattern for any courier - alphanumeric, 8-20 chars
    generic: /^[A-Za-z0-9]{8,20}$/,

    // Specific courier patterns (can be extended)
    ithink: /^[A-Za-z]{0,3}[0-9]{8,15}$/,      // Optional 1-3 letter prefix + 8-15 digits
    delhivery: /^[0-9]{10,15}$/,               // 10-15 digits
    bluedart: /^[0-9]{11}$/,                   // 11 digits
    fedex: /^[0-9]{12,15}$/,                   // 12-15 digits
    ecom_express: /^[A-Za-z]{3,5}[0-9]{9,12}$/ // 3-5 letters + 9-12 digits
};

/**
 * Validate AWB number format
 * @param {string} awbNumber - The AWB number to validate
 * @param {string} courier - Optional courier name for specific validation
 * @returns {{valid: boolean, error?: string}}
 */
export function validateAwbFormat(awbNumber, courier = null) {
    if (!awbNumber || typeof awbNumber !== 'string') {
        return { valid: false, error: 'AWB number is required' };
    }

    const cleanAwb = awbNumber.trim().toUpperCase();

    // Basic length check
    if (cleanAwb.length < 8 || cleanAwb.length > 20) {
        return { valid: false, error: 'AWB number must be 8-20 characters' };
    }

    // Check for invalid characters (only alphanumeric allowed)
    if (!/^[A-Za-z0-9]+$/.test(cleanAwb)) {
        return { valid: false, error: 'AWB number can only contain letters and numbers' };
    }

    // If courier is specified, try courier-specific validation
    if (courier) {
        const courierLower = courier.toLowerCase();

        // Try courier-specific pattern
        if (courierLower.includes('ithink') || courierLower.includes('i-think')) {
            if (!AWB_PATTERNS.ithink.test(cleanAwb)) {
                // Still allow if it passes generic
                if (!AWB_PATTERNS.generic.test(cleanAwb)) {
                    return { valid: false, error: 'Invalid AWB format for iThink Logistics' };
                }
            }
        } else if (courierLower.includes('delhivery')) {
            if (!AWB_PATTERNS.delhivery.test(cleanAwb) && !AWB_PATTERNS.generic.test(cleanAwb)) {
                return { valid: false, error: 'Invalid AWB format for Delhivery' };
            }
        } else if (courierLower.includes('bluedart') || courierLower.includes('blue dart')) {
            if (!AWB_PATTERNS.bluedart.test(cleanAwb) && !AWB_PATTERNS.generic.test(cleanAwb)) {
                return { valid: false, error: 'Invalid AWB format for BlueDart' };
            }
        }
        // Add more courier-specific validations as needed
    }

    // Generic validation passed
    return { valid: true };
}

/**
 * Custom Zod refinement for AWB validation
 */
const awbSchema = z.string()
    .min(1, 'AWB number is required')
    .trim()
    .transform(val => val.toUpperCase())
    .refine(
        (val) => /^[A-Za-z0-9]{8,20}$/.test(val),
        { message: 'AWB number must be 8-20 alphanumeric characters' }
    );

// ============================================
// ORDER SCHEMAS
// ============================================

/**
 * Ship order validation schema
 * Validates AWB format and courier name
 */
export const ShipOrderSchema = z.object({
    awbNumber: awbSchema,
    courier: z.string().min(1, 'Courier is required').trim(),
}).refine(
    (data) => {
        const result = validateAwbFormat(data.awbNumber, data.courier);
        return result.valid;
    },
    {
        message: 'Invalid AWB number format for the specified courier',
        path: ['awbNumber'],
    }
);

/**
 * Create order validation schema
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
    shippingAddress: z.string().optional().nullable(),
    orderDate: z.string().datetime().optional(),
    paymentMethod: z.enum(['Prepaid', 'COD']).default('Prepaid'),
    // totalAmount can be 0 or negative for exchange orders
    totalAmount: z.number().optional(),
    customerNotes: z.string().optional().nullable(),
    internalNotes: z.string().optional().nullable(),
    lines: z.array(z.object({
        skuId: z.string().uuid('Invalid SKU ID format'),
        qty: z.number().int('Quantity must be an integer').positive('Quantity must be positive'),
        unitPrice: z.number().min(0, 'Unit price cannot be negative').optional(),
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
 * Customize order line validation schema
 * Used for creating custom SKUs for order lines
 */
export const CustomizeLineSchema = z.object({
    type: z.enum(['length', 'size', 'measurements', 'other'], {
        errorMap: () => ({ message: 'Type must be one of: length, size, measurements, other' }),
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
            // Log validation failures for debugging
            console.error('[Validation Error]', {
                path: req.path,
                body: req.body,
                errors: result.error.issues,
            });

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
