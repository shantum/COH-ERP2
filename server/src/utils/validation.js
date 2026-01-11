/**
 * @module validation
 * Validation utilities, Zod schemas, and input sanitization.
 *
 * Key patterns:
 * - Password validation: validatePassword (8+ chars, uppercase, lowercase, number, special char)
 * - AWB validation: validateAwbFormat (courier-specific patterns, 8-20 alphanumeric)
 * - Zod schemas: ShipOrderSchema, CreateOrderSchema, UpdateOrderSchema, CustomizeLineSchema
 * - Sanitization: sanitizeSearchInput (SQL injection prevention), sanitizeOrderNumber
 * - Format validators: isValidEmail, isValidPhone (Indian format), isValidUuid, isValidSkuCode
 *
 * CRITICAL GOTCHAS:
 * - AWB validation is permissive (generic pattern fallback) to support new couriers
 * - Phone validation expects Indian format (+91 prefix optional)
 * - validate() middleware attaches validated data to req.validatedBody (NOT req.body)
 * - Zod transforms run after validation (e.g., AWB uppercase normalization)
 */

import { z } from 'zod';

// ============================================
// PASSWORD VALIDATION
// ============================================

/**
 * Validate password strength
 * Requirements: 8+ chars, uppercase, lowercase, number, special character
 *
 * @param {string} password - Password to validate
 * @returns {Object} Validation result:
 *   - isValid: true if all requirements met
 *   - errors: Array of human-readable error messages
 *
 * @example
 * const result = validatePassword('Test@123');
 * if (!result.isValid) {
 *   return res.status(400).json({ errors: result.errors });
 * }
 */
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
 * Each courier has specific AWB formats, with generic fallback.
 *
 * Common formats:
 * - iThink Logistics: Optional 1-3 letter prefix + 8-15 digits (e.g., "IT123456789012")
 * - Delhivery: 10-15 digits
 * - BlueDart: 11 digits exactly
 * - FedEx: 12-15 digits
 * - Ecom Express: 3-5 letter prefix + 9-12 digits
 * - Generic: 8-20 alphanumeric (allows new couriers without code changes)
 *
 * GOTCHA: Validation is permissive - if courier-specific pattern fails, falls back to generic.
 * This prevents blocking valid AWBs from new/unknown couriers.
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
 * Uses courier-specific patterns when courier provided, falls back to generic.
 *
 * @param {string} awbNumber - AWB number to validate
 * @param {string|null} [courier=null] - Courier name for pattern selection (case-insensitive)
 * @returns {Object} Validation result:
 *   - valid: true if AWB matches courier pattern or generic pattern
 *   - error: Human-readable error message if invalid
 *
 * @example
 * const result = validateAwbFormat('IT123456789012', 'iThink Logistics');
 * if (!result.valid) {
 *   throw new Error(result.error);
 * }
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
 * Supports both regular orders and exchange orders.
 *
 * Key fields:
 * - isExchange: true for exchange orders (allows negative/zero totalAmount)
 * - originalOrderId: Required for exchange orders (links to original order)
 * - shipByDate: Optional shipping deadline (ISO datetime string)
 * - lines[].shippingAddress: Optional line-level address (JSON string)
 *
 * GOTCHA: Exchange orders can have negative totalAmount (exchange down = customer gets refund).
 *
 * @example
 * const data = {
 *   customerName: 'John Doe',
 *   lines: [{ skuId: 'uuid', qty: 1, unitPrice: 1500 }],
 *   paymentMethod: 'Prepaid'
 * };
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
    shipByDate: z.string().datetime().optional().nullable(), // Optional shipping deadline
    paymentMethod: z.enum(['Prepaid', 'COD']).default('Prepaid'),
    // totalAmount can be 0 or negative for exchange orders
    totalAmount: z.number().optional(),
    customerNotes: z.string().optional().nullable(),
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
    shipByDate: z.string().datetime().optional().nullable(),
    isExchange: z.boolean().optional(),
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

// ============================================
// INPUT SANITIZATION
// ============================================

/**
 * Sanitize search input to prevent SQL injection and special character issues
 * Escapes SQL wildcards (%, _) and removes potentially dangerous characters
 * 
 * @param {string} input - User input to sanitize
 * @returns {string} Sanitized input safe for database queries
 * 
 * @example
 * sanitizeSearchInput("test%_input") // "test\\%\\_input"
 * sanitizeSearchInput("user@email.com") // "user@email.com"
 */
export function sanitizeSearchInput(input) {
    if (!input || typeof input !== 'string') return '';

    return input
        .replace(/[%_]/g, '\\$&')           // Escape SQL wildcards
        .replace(/[^\w\s@.-]/g, '')         // Remove special chars except @, ., -
        .trim();
}

/**
 * Validate SKU code format
 * SKU codes should be uppercase alphanumeric with optional hyphens
 * 
 * @param {string} code - SKU code to validate
 * @returns {boolean} True if valid SKU code format
 * 
 * @example
 * isValidSkuCode("ABC-123") // true
 * isValidSkuCode("abc_123") // false
 */
export function isValidSkuCode(code) {
    if (!code || typeof code !== 'string') return false;
    return /^[A-Z0-9-]+$/.test(code);
}

/**
 * Validate email format
 * Basic email validation using regex
 * 
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 * 
 * @example
 * isValidEmail("user@example.com") // true
 * isValidEmail("invalid.email") // false
 */
export function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate phone number format (Indian format)
 * Accepts formats: +91XXXXXXXXXX, 91XXXXXXXXXX, XXXXXXXXXX
 * 
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid phone format
 * 
 * @example
 * isValidPhone("+919876543210") // true
 * isValidPhone("9876543210") // true
 * isValidPhone("123") // false
 */
export function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/[\s-]/g, '');
    return /^(\+91|91)?[6-9]\d{9}$/.test(cleaned);
}

/**
 * Validate UUID format
 * 
 * @param {string} uuid - UUID string to validate
 * @returns {boolean} True if valid UUID format
 * 
 * @example
 * isValidUuid("123e4567-e89b-12d3-a456-426614174000") // true
 * isValidUuid("invalid-uuid") // false
 */
export function isValidUuid(uuid) {
    if (!uuid || typeof uuid !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Sanitize and validate order number
 * Order numbers should be alphanumeric with optional hyphens
 * 
 * @param {string} orderNumber - Order number to sanitize
 * @returns {string} Sanitized order number
 * 
 * @example
 * sanitizeOrderNumber("ORD-123") // "ORD-123"
 * sanitizeOrderNumber("ord@123!") // "ord-123"
 */
export function sanitizeOrderNumber(orderNumber) {
    if (!orderNumber || typeof orderNumber !== 'string') return '';
    return orderNumber
        .replace(/[^a-zA-Z0-9-]/g, '')
        .trim()
        .toUpperCase();
}

/**
 * Validate positive integer
 * 
 * @param {any} value - Value to validate
 * @returns {boolean} True if value is a positive integer
 * 
 * @example
 * isPositiveInteger(5) // true
 * isPositiveInteger(-1) // false
 * isPositiveInteger(1.5) // false
 */
export function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Validate non-negative number
 * 
 * @param {any} value - Value to validate
 * @returns {boolean} True if value is a non-negative number
 * 
 * @example
 * isNonNegativeNumber(0) // true
 * isNonNegativeNumber(5.5) // true
 * isNonNegativeNumber(-1) // false
 */
export function isNonNegativeNumber(value) {
    return typeof value === 'number' && !isNaN(value) && value >= 0;
}
