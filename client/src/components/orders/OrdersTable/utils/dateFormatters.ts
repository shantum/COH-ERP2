/**
 * Shared date formatting utilities for OrdersTable cells
 * Centralizes date formatting to avoid recreating formatters in each cell
 */

// ============================================
// LOCAL DATE STRING UTILITIES
// Use these instead of toISOString().split('T')[0] to avoid timezone bugs
// ============================================

/**
 * Get today's date as YYYY-MM-DD string in LOCAL timezone
 * Use this instead of: new Date().toISOString().split('T')[0]
 */
export function getLocalDateString(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Get a date string N days from today in LOCAL timezone
 */
export function getLocalDateStringOffset(daysOffset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return getLocalDateString(date);
}

/**
 * Get today's date as YYYY-MM-DD string in LOCAL timezone
 * Convenience alias for getLocalDateString()
 */
export function getTodayString(): string {
    return getLocalDateString();
}

/**
 * Get tomorrow's date as YYYY-MM-DD string in LOCAL timezone
 */
export function getTomorrowString(): string {
    return getLocalDateStringOffset(1);
}

// ============================================
// DATE FORMATTING UTILITIES
// ============================================

// Pre-created formatters (created once, reused)
const shortDateFormatter = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short'
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
