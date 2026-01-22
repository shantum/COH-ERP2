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
export interface PasswordValidationResult {
    isValid: boolean;
    errors: string[];
}
export interface AwbValidationResult {
    valid: boolean;
    error?: string;
}
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
export declare function validatePassword(password: string): PasswordValidationResult;
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
export declare const AWB_PATTERNS: Record<string, RegExp>;
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
export declare function validateAwbFormat(awbNumber: string, courier?: string | null): AwbValidationResult;
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
export declare function isValidEmail(email: string): boolean;
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
export declare function isValidPhone(phone: string): boolean;
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
export declare function isValidUuid(uuid: string): boolean;
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
export declare function isValidSkuCode(code: string): boolean;
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
export declare function isPositiveInteger(value: unknown): value is number;
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
export declare function isNonNegativeNumber(value: unknown): value is number;
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
export declare function sanitizeSearchInput(input: string): string;
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
export declare function sanitizeOrderNumber(orderNumber: string): string;
//# sourceMappingURL=index.d.ts.map