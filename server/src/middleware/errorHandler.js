/**
 * Centralized Error Handler Middleware
 * Handles all errors thrown in async routes and provides consistent error responses
 * 
 * Must be added AFTER all routes in Express app:
 * app.use(errorHandler);
 */

import {
    ValidationError,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    BusinessLogicError,
    ExternalServiceError,
    DatabaseError
} from '../utils/errors.js';

/**
 * Global error handling middleware
 * Catches all errors and formats consistent responses
 * 
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
export function errorHandler(err, req, res, next) {
    // Log error details
    const errorLog = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        error: err.message,
        type: err.name,
        userId: req.user?.id,
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
        errorLog.stack = err.stack;
    }

    console.error('[Error Handler]', errorLog);

    // Handle custom error types
    if (err instanceof ValidationError) {
        return res.status(400).json({
            error: err.message,
            type: 'ValidationError',
            details: err.details
        });
    }

    if (err instanceof NotFoundError) {
        return res.status(404).json({
            error: err.message,
            type: 'NotFoundError',
            resourceType: err.resourceType,
            resourceId: err.resourceId
        });
    }

    if (err instanceof UnauthorizedError) {
        return res.status(401).json({
            error: err.message,
            type: 'UnauthorizedError'
        });
    }

    if (err instanceof ForbiddenError) {
        return res.status(403).json({
            error: err.message,
            type: 'ForbiddenError'
        });
    }

    if (err instanceof ConflictError) {
        return res.status(409).json({
            error: err.message,
            type: 'ConflictError',
            conflictType: err.conflictType
        });
    }

    if (err instanceof BusinessLogicError) {
        return res.status(422).json({
            error: err.message,
            type: 'BusinessLogicError',
            rule: err.rule
        });
    }

    if (err instanceof ExternalServiceError) {
        return res.status(502).json({
            error: err.message,
            type: 'ExternalServiceError',
            service: err.serviceName
        });
    }

    if (err instanceof DatabaseError) {
        return res.status(500).json({
            error: 'Database operation failed',
            type: 'DatabaseError',
            // Don't expose internal DB errors in production
            ...(process.env.NODE_ENV === 'development' && {
                details: err.message
            })
        });
    }

    // Handle Prisma errors
    if (err.code && err.code.startsWith('P')) {
        console.error('[Prisma Error]', {
            code: err.code,
            meta: err.meta,
            message: err.message
        });

        // Common Prisma error codes
        if (err.code === 'P2002') {
            return res.status(409).json({
                error: 'Unique constraint violation',
                type: 'ConflictError',
                field: err.meta?.target
            });
        }

        if (err.code === 'P2025') {
            return res.status(404).json({
                error: 'Record not found',
                type: 'NotFoundError'
            });
        }

        // Generic Prisma error
        return res.status(500).json({
            error: 'Database operation failed',
            type: 'DatabaseError'
        });
    }

    // Handle Zod validation errors
    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: 'Validation failed',
            type: 'ValidationError',
            details: err.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message
            }))
        });
    }

    // Default 500 error
    const statusCode = err.statusCode || 500;
    const response = {
        error: err.message || 'Internal server error',
        type: err.name || 'Error'
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
}

export default errorHandler;
