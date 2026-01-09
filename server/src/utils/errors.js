/**
 * Custom error classes for better error handling
 * Use these instead of generic Error for specific error types
 */

/**
 * Validation error - thrown when input validation fails
 * Use for schema validation, format validation, etc.
 * 
 * @example
 * throw new ValidationError('Invalid email format', { email: 'test@' });
 */
export class ValidationError extends Error {
    constructor(message, details = null) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
        this.statusCode = 400;
    }
}

/**
 * Not found error - thrown when a resource is not found
 * Use for database queries that return null/undefined
 * 
 * @example
 * throw new NotFoundError('Order not found');
 */
export class NotFoundError extends Error {
    constructor(message = 'Resource not found', resourceType = null, resourceId = null) {
        super(message);
        this.name = 'NotFoundError';
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        this.statusCode = 404;
    }
}

/**
 * Unauthorized error - thrown when authentication fails
 * Use for missing/invalid tokens, insufficient permissions
 * 
 * @example
 * throw new UnauthorizedError('Invalid token');
 */
export class UnauthorizedError extends Error {
    constructor(message = 'Unauthorized') {
        super(message);
        this.name = 'UnauthorizedError';
        this.statusCode = 401;
    }
}

/**
 * Forbidden error - thrown when user lacks permissions
 * Use when user is authenticated but not authorized for the action
 * 
 * @example
 * throw new ForbiddenError('Insufficient permissions to delete order');
 */
export class ForbiddenError extends Error {
    constructor(message = 'Forbidden') {
        super(message);
        this.name = 'ForbiddenError';
        this.statusCode = 403;
    }
}

/**
 * Conflict error - thrown when operation conflicts with current state
 * Use for duplicate entries, state conflicts, etc.
 * 
 * @example
 * throw new ConflictError('Order already shipped');
 */
export class ConflictError extends Error {
    constructor(message = 'Conflict', conflictType = null) {
        super(message);
        this.name = 'ConflictError';
        this.conflictType = conflictType;
        this.statusCode = 409;
    }
}

/**
 * Business logic error - thrown when business rules are violated
 * Use for domain-specific validation failures
 * 
 * @example
 * throw new BusinessLogicError('Cannot ship order with pending lines');
 */
export class BusinessLogicError extends Error {
    constructor(message, rule = null) {
        super(message);
        this.name = 'BusinessLogicError';
        this.rule = rule;
        this.statusCode = 422;
    }
}

/**
 * External service error - thrown when external API calls fail
 * Use for Shopify API, tracking API, etc.
 * 
 * @example
 * throw new ExternalServiceError('Shopify API timeout', 'shopify', originalError);
 */
export class ExternalServiceError extends Error {
    constructor(message, serviceName = null, originalError = null) {
        super(message);
        this.name = 'ExternalServiceError';
        this.serviceName = serviceName;
        this.originalError = originalError;
        this.statusCode = 502;
    }
}

/**
 * Database error - thrown when database operations fail
 * Use for transaction failures, constraint violations, etc.
 * 
 * @example
 * throw new DatabaseError('Transaction failed', originalError);
 */
export class DatabaseError extends Error {
    constructor(message, originalError = null) {
        super(message);
        this.name = 'DatabaseError';
        this.originalError = originalError;
        this.statusCode = 500;
    }
}
