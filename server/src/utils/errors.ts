/**
 * Custom error classes for better error handling
 * Use these instead of generic Error for specific error types
 */

/**
 * Base interface for custom errors with HTTP status codes
 */
export interface CustomError extends Error {
    readonly statusCode: number;
}

/**
 * Validation error - thrown when input validation fails
 * Use for schema validation, format validation, etc.
 *
 * @example
 * throw new ValidationError('Invalid email format', { email: 'test@' });
 */
export class ValidationError extends Error implements CustomError {
    readonly name = 'ValidationError' as const;
    readonly statusCode = 400 as const;
    readonly details: unknown;

    constructor(message: string, details: unknown = null) {
        super(message);
        this.details = details;
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}

/**
 * Not found error - thrown when a resource is not found
 * Use for database queries that return null/undefined
 *
 * @example
 * throw new NotFoundError('Order not found');
 */
export class NotFoundError extends Error implements CustomError {
    readonly name = 'NotFoundError' as const;
    readonly statusCode = 404 as const;
    readonly resourceType: string | null;
    readonly resourceId: string | number | null;

    constructor(
        message: string = 'Resource not found',
        resourceType: string | null = null,
        resourceId: string | number | null = null
    ) {
        super(message);
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        Object.setPrototypeOf(this, NotFoundError.prototype);
    }
}

/**
 * Unauthorized error - thrown when authentication fails
 * Use for missing/invalid tokens, insufficient permissions
 *
 * @example
 * throw new UnauthorizedError('Invalid token');
 */
export class UnauthorizedError extends Error implements CustomError {
    readonly name = 'UnauthorizedError' as const;
    readonly statusCode = 401 as const;

    constructor(message: string = 'Unauthorized') {
        super(message);
        Object.setPrototypeOf(this, UnauthorizedError.prototype);
    }
}

/**
 * Forbidden error - thrown when user lacks permissions
 * Use when user is authenticated but not authorized for the action
 *
 * @example
 * throw new ForbiddenError('Insufficient permissions to delete order');
 */
export class ForbiddenError extends Error implements CustomError {
    readonly name = 'ForbiddenError' as const;
    readonly statusCode = 403 as const;

    constructor(message: string = 'Forbidden') {
        super(message);
        Object.setPrototypeOf(this, ForbiddenError.prototype);
    }
}

/**
 * Conflict error - thrown when operation conflicts with current state
 * Use for duplicate entries, state conflicts, etc.
 *
 * @example
 * throw new ConflictError('Order already shipped');
 */
export class ConflictError extends Error implements CustomError {
    readonly name = 'ConflictError' as const;
    readonly statusCode = 409 as const;
    readonly conflictType: string | null;

    constructor(message: string = 'Conflict', conflictType: string | null = null) {
        super(message);
        this.conflictType = conflictType;
        Object.setPrototypeOf(this, ConflictError.prototype);
    }
}

/**
 * Business logic error - thrown when business rules are violated
 * Use for domain-specific validation failures
 *
 * @example
 * throw new BusinessLogicError('Cannot ship order with pending lines');
 */
export class BusinessLogicError extends Error implements CustomError {
    readonly name = 'BusinessLogicError' as const;
    readonly statusCode = 422 as const;
    readonly rule: string | null;

    constructor(message: string, rule: string | null = null) {
        super(message);
        this.rule = rule;
        Object.setPrototypeOf(this, BusinessLogicError.prototype);
    }
}

/**
 * External service error - thrown when external API calls fail
 * Use for Shopify API, tracking API, etc.
 *
 * @example
 * throw new ExternalServiceError('Shopify API timeout', 'shopify', originalError);
 */
export class ExternalServiceError extends Error implements CustomError {
    readonly name = 'ExternalServiceError' as const;
    readonly statusCode = 502 as const;
    readonly serviceName: string | null;
    readonly originalError: Error | null;

    constructor(
        message: string,
        serviceName: string | null = null,
        originalError: Error | null = null
    ) {
        super(message);
        this.serviceName = serviceName;
        this.originalError = originalError;
        Object.setPrototypeOf(this, ExternalServiceError.prototype);
    }
}

/**
 * Database error - thrown when database operations fail
 * Use for transaction failures, constraint violations, etc.
 *
 * @example
 * throw new DatabaseError('Transaction failed', originalError);
 */
export class DatabaseError extends Error implements CustomError {
    readonly name = 'DatabaseError' as const;
    readonly statusCode = 500 as const;
    readonly originalError: Error | null;

    constructor(message: string, originalError: Error | null = null) {
        super(message);
        this.originalError = originalError;
        Object.setPrototypeOf(this, DatabaseError.prototype);
    }
}

/**
 * Type guard to check if an error is a custom error with statusCode
 */
export function isCustomError(error: unknown): error is CustomError {
    return (
        error instanceof Error &&
        'statusCode' in error &&
        typeof (error as CustomError).statusCode === 'number'
    );
}
