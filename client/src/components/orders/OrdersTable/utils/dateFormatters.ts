/**
 * Shared date formatting utilities for OrdersTable cells
 * Centralizes date formatting to avoid recreating formatters in each cell
 */

// Pre-created formatters (created once, reused)
const shortDateFormatter = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short'
});

const fullDateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});

/**
 * Format date as "DD Mon" (e.g., "15 Jan")
 */
export function formatShortDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    try {
        return shortDateFormatter.format(new Date(dateStr));
    } catch {
        return '-';
    }
}

/**
 * Format date string for production display (e.g., "15 Jan")
 * Handles timezone by adding T00:00:00 to date-only strings
 */
export function formatProductionDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Get relative day string (Today, Tomorrow, Yesterday, Xd ago, In Xd)
 */
export function getRelativeDay(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays < -1) return `${Math.abs(diffDays)}d ago`;
    return `In ${diffDays}d`;
}

/**
 * Format date and relative time for two-line display
 * Returns object with formatted strings and age indicator
 */
export function formatDateTime(date: Date): {
    dateStr: string;
    relativeStr: string;
    isOld: boolean;
} {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const isOld = diffDays >= 3;

    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    let relativeStr: string;
    if (diffMins < 60) {
        relativeStr = `${diffMins}m ago`;
    } else if (diffHours < 24) {
        relativeStr = `${diffHours}h ago`;
    } else {
        relativeStr = `${diffDays}d ago`;
    }

    return { dateStr, relativeStr, isOld };
}

/**
 * Format the last tracking update time
 * Returns compact relative time string
 */
export function formatLastUpdate(dateStr: string | null): string | null {
    if (!dateStr) return null;

    const date = new Date(dateStr);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
