/**
 * Validation utilities for COH ERP
 *
 * This module provides validation and sanitization functions
 * that are shared between server and client.
 *
 * Key patterns:
 * - Password validation: validatePassword (8+ chars, uppercase, lowercase, number, special char)
 * - AWB validation: validateAwbFormat (courier-specific patterns, 8-20 alphanumeric)
 * - Format validators: isValidEmail, isValidPhone (Indian format), isValidUuid, isValidSkuCode
 * - Sanitization: sanitizeSearchInput (SQL injection prevention), sanitizeOrderNumber
 *
 * CRITICAL GOTCHAS:
 * - AWB validation is permissive (generic pattern fallback) to support new couriers
 * - Phone validation expects Indian format (+91 prefix optional)
 */

// ============================================
// TYPES
// ============================================

export interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface AwbValidationResult {
    valid: boolean;
    error?: string;
}

// ============================================
// PASSWORD VALIDATION
// ============================================

/**
 * Validate password strength
 * Requirements: 8+ chars, uppercase, lowercase, number, special character
 *
 * @param password - Password to validate
 * @returns Validation result with isValid flag and error messages
 *
 * @example
 * const result = validatePassword('Test@123');
 * if (!result.isValid) {
 *   return res.status(400).json({ errors: result.errors });
 * }
 */
export function validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];

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
export const AWB_PATTERNS: Record<string, RegExp> = {
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
 * @param awbNumber - AWB number to validate
 * @param courier - Courier name for pattern selection (case-insensitive)
 * @returns Validation result with valid flag and optional error message
 *
 * @example
 * const result = validateAwbFormat('IT123456789012', 'iThink Logistics');
 * if (!result.valid) {
 *   throw new Error(result.error);
 * }
 */
export function validateAwbFormat(awbNumber: string, courier: string | null = null): AwbValidationResult {
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

// ============================================
// FORMAT VALIDATORS
// ============================================

/**
 * Validate email format
 * Basic email validation using regex
 *
 * @param email - Email address to validate
 * @returns True if valid email format
 *
 * @example
 * isValidEmail("user@example.com") // true
 * isValidEmail("invalid.email") // false
 */
export function isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate phone number format (Indian format)
 * Accepts formats: +91XXXXXXXXXX, 91XXXXXXXXXX, XXXXXXXXXX
 *
 * @param phone - Phone number to validate
 * @returns True if valid phone format
 *
 * @example
 * isValidPhone("+919876543210") // true
 * isValidPhone("9876543210") // true
 * isValidPhone("123") // false
 */
export function isValidPhone(phone: string): boolean {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/[\s-]/g, '');
    return /^(\+91|91)?[6-9]\d{9}$/.test(cleaned);
}

/**
 * Validate UUID format
 *
 * @param uuid - UUID string to validate
 * @returns True if valid UUID format
 *
 * @example
 * isValidUuid("123e4567-e89b-12d3-a456-426614174000") // true
 * isValidUuid("invalid-uuid") // false
 */
export function isValidUuid(uuid: string): boolean {
    if (!uuid || typeof uuid !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Validate SKU code format
 * SKU codes should be uppercase alphanumeric with optional hyphens
 *
 * @param code - SKU code to validate
 * @returns True if valid SKU code format
 *
 * @example
 * isValidSkuCode("ABC-123") // true
 * isValidSkuCode("abc_123") // false
 */
export function isValidSkuCode(code: string): boolean {
    if (!code || typeof code !== 'string') return false;
    return /^[A-Z0-9-]+$/.test(code);
}

/**
 * Validate positive integer
 *
 * @param value - Value to validate
 * @returns True if value is a positive integer
 *
 * @example
 * isPositiveInteger(5) // true
 * isPositiveInteger(-1) // false
 * isPositiveInteger(1.5) // false
 */
export function isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0;
}

/**
 * Validate non-negative number
 *
 * @param value - Value to validate
 * @returns True if value is a non-negative number
 *
 * @example
 * isNonNegativeNumber(0) // true
 * isNonNegativeNumber(5.5) // true
 * isNonNegativeNumber(-1) // false
 */
export function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value) && value >= 0;
}

// ============================================
// INPUT SANITIZATION
// ============================================

/**
 * Sanitize search input to prevent SQL injection and special character issues
 * Escapes SQL wildcards (%, _) and removes potentially dangerous characters
 *
 * @param input - User input to sanitize
 * @returns Sanitized input safe for database queries
 *
 * @example
 * sanitizeSearchInput("test%_input") // "test\\%\\_input"
 * sanitizeSearchInput("user@email.com") // "user@email.com"
 */
export function sanitizeSearchInput(input: string): string {
    if (!input || typeof input !== 'string') return '';

    return input
        .replace(/[%_]/g, '\\$&')           // Escape SQL wildcards
        .replace(/[^\w\s@.-]/g, '')         // Remove special chars except @, ., -
        .trim();
}

/**
 * Sanitize and validate order number
 * Order numbers should be alphanumeric with optional hyphens
 *
 * @param orderNumber - Order number to sanitize
 * @returns Sanitized order number
 *
 * @example
 * sanitizeOrderNumber("ORD-123") // "ORD-123"
 * sanitizeOrderNumber("ord@123!") // "ORD123"
 */
export function sanitizeOrderNumber(orderNumber: string): string {
    if (!orderNumber || typeof orderNumber !== 'string') return '';
    return orderNumber
        .replace(/[^a-zA-Z0-9-]/g, '')
        .trim()
        .toUpperCase();
}
