/**
 * Centralized Error Handler Middleware
 * Handles all errors thrown in async routes and provides consistent error responses
 *
 * Must be added AFTER all routes in Express app:
 * app.use(errorHandler);
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
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
 * Extended error type to handle various error shapes
 */
interface ExtendedError extends Error {
    statusCode?: number;
    code?: string;
    meta?: {
        target?: string | string[];
        [key: string]: unknown;
    };
    details?: unknown;
    resourceType?: string | null;
    resourceId?: string | number | null;
    conflictType?: string | null;
    rule?: string | null;
    serviceName?: string | null;
    issues?: ZodError['issues'];
}

/**
 * Error log structure for consistent logging
 */
interface ErrorLog {
    timestamp: string;
    method: string;
    path: string;
    error: string;
    type: string;
    userId?: number | string;
    stack?: string;
}

// User type is now defined globally in src/types/express.d.ts

/**
 * Global error handling middleware
 * Catches all errors and formats consistent responses
 */
export const errorHandler: ErrorRequestHandler = (
    err: ExtendedError,
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    // req.user is now typed globally via src/types/express.d.ts

    // Log error details
    const errorLog: ErrorLog = {
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
        res.status(400).json({
            error: err.message,
            type: 'ValidationError',
            details: err.details
        });
        return;
    }

    if (err instanceof NotFoundError) {
        res.status(404).json({
            error: err.message,
            type: 'NotFoundError',
            resourceType: err.resourceType,
            resourceId: err.resourceId
        });
        return;
    }

    if (err instanceof UnauthorizedError) {
        res.status(401).json({
            error: err.message,
            type: 'UnauthorizedError'
        });
        return;
    }

    if (err instanceof ForbiddenError) {
        res.status(403).json({
            error: err.message,
            type: 'ForbiddenError'
        });
        return;
    }

    if (err instanceof ConflictError) {
        res.status(409).json({
            error: err.message,
            type: 'ConflictError',
            conflictType: err.conflictType
        });
        return;
    }

    if (err instanceof BusinessLogicError) {
        res.status(422).json({
            error: err.message,
            type: 'BusinessLogicError',
            rule: err.rule
        });
        return;
    }

    if (err instanceof ExternalServiceError) {
        res.status(502).json({
            error: err.message,
            type: 'ExternalServiceError',
            service: err.serviceName
        });
        return;
    }

    if (err instanceof DatabaseError) {
        res.status(500).json({
            error: 'Database operation failed',
            type: 'DatabaseError',
            // Don't expose internal DB errors in production
            ...(process.env.NODE_ENV === 'development' && {
                details: err.message
            })
        });
        return;
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
            res.status(409).json({
                error: 'Unique constraint violation',
                type: 'ConflictError',
                field: err.meta?.target
            });
            return;
        }

        if (err.code === 'P2025') {
            res.status(404).json({
                error: 'Record not found',
                type: 'NotFoundError'
            });
            return;
        }

        // Generic Prisma error
        res.status(500).json({
            error: 'Database operation failed',
            type: 'DatabaseError'
        });
        return;
    }

    // Handle Zod validation errors
    if (err instanceof ZodError || err.name === 'ZodError') {
        const zodError = err as ZodError;
        res.status(400).json({
            error: 'Validation failed',
            type: 'ValidationError',
            details: zodError.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message
            }))
        });
        return;
    }

    // Default 500 error
    const statusCode = err.statusCode || 500;
    const response: {
        error: string;
        type: string;
        stack?: string;
    } = {
        error: err.message || 'Internal server error',
        type: err.name || 'Error'
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

export default errorHandler;
