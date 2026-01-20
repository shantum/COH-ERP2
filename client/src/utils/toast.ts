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
