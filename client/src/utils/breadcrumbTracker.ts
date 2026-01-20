/**
 * Breadcrumb Tracker Utility
 *
 * Tracks recent navigation events and actions for debugging and error reporting.
 * Uses a circular buffer to store the last N breadcrumbs.
 *
 * Usage:
 * - addBreadcrumb('navigation', { pathname: '/orders', search: { view: 'open' } })
 * - addBreadcrumb('action', { type: 'ship_order', orderId: '123' })
 * - addBreadcrumb('error', { message: 'API failed', code: 500 })
 *
 * In error handlers:
 * - getBreadcrumbs() returns the breadcrumb trail
 * - clearBreadcrumbs() resets the buffer
 */

export interface Breadcrumb {
    type: 'navigation' | 'action' | 'error';
    timestamp: number;
    data: Record<string, unknown>;
}

const MAX_BREADCRUMBS = 20;
const breadcrumbs: Breadcrumb[] = [];

/**
 * Add a breadcrumb to the trail
 * Automatically removes oldest entries when max is reached
 */
export function addBreadcrumb(type: Breadcrumb['type'], data: Record<string, unknown>) {
    breadcrumbs.push({
        type,
        timestamp: Date.now(),
        data,
    });

    // Maintain circular buffer
    if (breadcrumbs.length > MAX_BREADCRUMBS) {
        breadcrumbs.shift();
    }
}

/**
 * Get all breadcrumbs (returns a copy to prevent external mutation)
 */
export function getBreadcrumbs(): Breadcrumb[] {
    return [...breadcrumbs];
}

/**
 * Clear all breadcrumbs
 */
export function clearBreadcrumbs() {
    breadcrumbs.length = 0;
}

/**
 * Get formatted breadcrumbs for error reporting
 * Returns a human-readable string representation
 */
export function getFormattedBreadcrumbs(): string {
    return breadcrumbs
        .map((b) => {
            const time = new Date(b.timestamp).toISOString();
            const dataStr = JSON.stringify(b.data);
            return `[${time}] ${b.type}: ${dataStr}`;
        })
        .join('\n');
}

/**
 * Get diagnostics object for error reporting
 * Includes breadcrumbs, URL, timestamp, and user agent
 */
export function getDiagnostics(error?: Error): Record<string, unknown> {
    return {
        error: error
            ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
              }
            : undefined,
        breadcrumbs: getBreadcrumbs(),
        url: window.location.href,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
    };
}
