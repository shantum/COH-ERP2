/**
 * Client Error Reporter
 *
 * Sends frontend errors to the server log so they appear in
 * Settings > Server Logs alongside backend errors.
 *
 * Fire-and-forget — never blocks UI or retries on failure.
 * Deduplicates: same message won't be sent twice within 10s.
 */

import * as Sentry from '@sentry/react';
import { getDiagnostics } from './breadcrumbTracker';

const DEDUP_WINDOW_MS = 10_000;
const recentErrors = new Map<string, number>();

function getApiBaseUrl(): string {
    if (typeof window !== 'undefined' && window.location) {
        return window.location.origin;
    }
    return '';
}

function extractError(error: unknown): { message: string; name?: string; stack?: string } {
    if (error instanceof Error) {
        return { message: error.message, name: error.name, stack: error.stack };
    }
    if (typeof error === 'string') {
        return { message: error };
    }
    return { message: String(error) };
}

/**
 * Report a client-side error to the server log.
 * Fire-and-forget — safe to call anywhere without await.
 */
export function reportError(
    error: unknown,
    context?: Record<string, unknown>
): void {
    // SSR guard
    if (typeof window === 'undefined') return;

    const { message, name, stack } = extractError(error);
    if (!message) return;

    // Dedup: skip if same message was sent recently
    const now = Date.now();
    const lastSent = recentErrors.get(message);
    if (lastSent && now - lastSent < DEDUP_WINDOW_MS) return;
    recentErrors.set(message, now);

    // Clean old entries periodically
    if (recentErrors.size > 50) {
        for (const [key, ts] of recentErrors) {
            if (now - ts > DEDUP_WINDOW_MS) recentErrors.delete(key);
        }
    }

    // Send to Sentry
    if (error instanceof Error) {
        Sentry.captureException(error, { extra: context });
    } else {
        Sentry.captureMessage(message, { level: 'error', extra: context });
    }

    const diagnostics = getDiagnostics(error instanceof Error ? error : undefined);

    const payload = {
        level: 'error',
        message: `[CLIENT] ${message}`,
        context: {
            errorName: name,
            stack,
            url: window.location.href,
            userAgent: navigator.userAgent,
            breadcrumbs: diagnostics.breadcrumbs,
            ...context,
        },
    };

    // Fire-and-forget
    fetch(`${getApiBaseUrl()}/api/logs/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch(() => {
        // Server unreachable — nothing we can do
    });
}

/**
 * Report a client-side warning to the server log.
 */
export function reportWarning(
    message: string,
    context?: Record<string, unknown>
): void {
    if (typeof window === 'undefined') return;

    const payload = {
        level: 'warn',
        message: `[CLIENT] ${message}`,
        context: {
            url: window.location.href,
            ...context,
        },
    };

    fetch(`${getApiBaseUrl()}/api/logs/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch(() => {});
}
