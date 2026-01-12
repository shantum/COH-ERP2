/**
 * @module validation
 * Express middleware for Zod validation.
 *
 * Most validation utilities have been moved to @coh/shared:
 * - Schemas: CreateOrderSchema, UpdateOrderSchema, ShipOrderSchema, CustomizeLineSchema, awbSchema
 * - Validators: validatePassword, validateAwbFormat, isValidEmail, isValidPhone, isValidUuid, isValidSkuCode
 * - Sanitizers: sanitizeSearchInput, sanitizeOrderNumber
 *
 * This file contains server-only Express middleware.
 *
 * CRITICAL GOTCHA:
 * - validate() middleware attaches validated data to req.validatedBody (NOT req.body)
 * - Zod transforms run after validation (e.g., AWB uppercase normalization)
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// Re-export everything from shared for convenience
export * from '@coh/shared';

// ============================================
// VALIDATION MIDDLEWARE
// ============================================

/**
 * Validation middleware factory
 * Creates Express middleware that validates request body against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 *
 * @example
 * router.post('/', validate(CreateOrderSchema), (req, res) => {
 *     const { customerName, lines } = req.validatedBody;
 *     // ...
 * });
 */
export function validate<T extends z.ZodTypeAny>(schema: T) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            // Log validation failures for debugging
            console.error('[Validation Error]', {
                path: req.path,
                body: req.body,
                errors: result.error.issues,
            });

            res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map(issue => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            });
            return;
        }

        // Attach validated and transformed data to request
        req.validatedBody = result.data as Record<string, unknown>;
        next();
    };
}
