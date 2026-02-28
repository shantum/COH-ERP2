/**
 * Toast Utility Module
 *
 * Centralized toast notifications using Sonner.
 * Provides consistent UX across the application with:
 * - Success/error toast helpers
 * - Zod error formatting for validation failures
 * - Auto-save error toasts with retry action
 */

import { toast } from 'sonner';
import type { ZodError } from 'zod';
import { getReturnErrorMessage, isReturnErrorCode } from '@coh/shared/errors';
import { reportError } from './errorReporter';

/**
 * Format Zod validation errors into user-friendly messages
 */
export function formatZodError(error: ZodError): string {
    const firstIssue = error.issues[0];
    if (!firstIssue) return 'Validation failed';

    const path = firstIssue.path.join('.');
    return path ? `${path}: ${firstIssue.message}` : firstIssue.message;
}

/**
 * Show a success toast
 */
export function showSuccess(message: string, options?: { description?: string }) {
    toast.success(message, {
        duration: 3000,
        description: options?.description,
    });
}

/**
 * Show an error toast with optional description and retry action
 */
export function showError(
    message: string,
    options?: {
        description?: string;
        action?: { label: string; onClick: () => void };
    }
) {
    toast.error(message, {
        duration: 5000,
        description: options?.description,
        action: options?.action,
    });
}

/**
 * Show an info toast
 */
export function showInfo(message: string, options?: { description?: string }) {
    toast.info(message, {
        duration: 4000,
        description: options?.description,
    });
}

/**
 * Show a warning toast
 */
export function showWarning(message: string, options?: { description?: string }) {
    toast.warning(message, {
        duration: 4000,
        description: options?.description,
    });
}

/**
 * Show an auto-save error toast with retry button
 * Used by useDebouncedAutoSave and inline edit cells
 */
export function showAutoSaveError(
    entityType: string,
    entityId: string,
    onRetry?: () => void
) {
    toast.error(`Failed to save ${entityType}`, {
        description: `ID: ${entityId}`,
        duration: 8000,
        action: onRetry
            ? {
                  label: 'Retry',
                  onClick: onRetry,
              }
            : undefined,
    });
}

/**
 * Show a mutation error toast with optional context
 */
export function showMutationError(
    operation: string,
    error: Error | unknown,
    options?: {
        entityId?: string;
        onRetry?: () => void;
    }
) {
    reportError(error, { domain: 'mutation', operation, entityId: options?.entityId });

    const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred';

    toast.error(`${operation} failed`, {
        description: options?.entityId
            ? `${errorMessage} (ID: ${options.entityId})`
            : errorMessage,
        duration: 6000,
        action: options?.onRetry
            ? {
                  label: 'Retry',
                  onClick: options.onRetry,
              }
            : undefined,
    });
}

/**
 * Dismiss all active toasts
 */
export function dismissAllToasts() {
    toast.dismiss();
}

// ============================================
// RETURNS-SPECIFIC ERROR HANDLING
// ============================================

/**
 * Type guard for structured error responses from server functions
 */
interface StructuredError {
    code: string;
    message?: string;
}

interface ErrorResult {
    success: false;
    error: StructuredError;
}

function isErrorResult(value: unknown): value is ErrorResult {
    return (
        typeof value === 'object' &&
        value !== null &&
        'success' in value &&
        value.success === false &&
        'error' in value &&
        typeof (value as ErrorResult).error === 'object'
    );
}

function isStructuredError(value: unknown): value is StructuredError {
    return (
        typeof value === 'object' &&
        value !== null &&
        'code' in value &&
        typeof (value as StructuredError).code === 'string'
    );
}

/**
 * Check if an error message looks like a Prisma/technical error
 * that should be sanitized before showing to users
 */
function isTechnicalError(message: string): boolean {
    const technicalPatterns = [
        'prisma',
        'Invalid `',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'at Object.',
        'at Module.',
        'at async',
        'TypeError:',
        'ReferenceError:',
        'SyntaxError:',
        'PrismaClientKnownRequestError',
        'PrismaClientValidationError',
        'unique constraint',
        'foreign key constraint',
    ];

    const lowerMessage = message.toLowerCase();
    return technicalPatterns.some((pattern) => lowerMessage.includes(pattern.toLowerCase()));
}

/**
 * Show a returns-specific error toast with proper messaging
 *
 * Handles multiple error formats:
 * - Structured error results: { success: false, error: { code, message } }
 * - Structured errors: { code, message }
 * - Standard Error objects
 * - Unknown errors
 *
 * Technical/Prisma errors are sanitized to show user-friendly messages.
 */
export function showReturnError(
    error: unknown,
    operation?: string
): void {
    const title = operation ? `${operation} failed` : 'Return Error';
    let userMessage: string;

    // Handle structured error result from server function
    if (isErrorResult(error)) {
        const { code, message } = error.error;
        userMessage = isReturnErrorCode(code)
            ? getReturnErrorMessage(code, message)
            : message || 'An error occurred';
    }
    // Handle structured error object
    else if (isStructuredError(error)) {
        const { code, message } = error;
        userMessage = isReturnErrorCode(code)
            ? getReturnErrorMessage(code, message)
            : message || 'An error occurred';
    }
    // Handle standard Error
    else if (error instanceof Error) {
        if (isTechnicalError(error.message)) {
            userMessage = 'A database error occurred. Please try again.';
            reportError(error, { domain: 'returns', type: 'technical', operation });
        } else {
            userMessage = error.message;
        }
    }
    // Unknown error
    else {
        userMessage = 'An unexpected error occurred';
        reportError(error, { domain: 'returns', type: 'unknown', operation });
    }

    toast.error(title, {
        duration: 5000,
        description: userMessage,
    });
}

/**
 * Show a returns success toast
 */
export function showReturnSuccess(
    message: string,
    options?: { description?: string }
): void {
    toast.success(message, {
        duration: 3000,
        description: options?.description,
    });
}
