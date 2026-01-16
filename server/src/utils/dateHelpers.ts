/**
 * Date Helper Utilities
 * Safe date-to-string conversions that handle both Date objects and strings
 *
 * Background: Prisma returns Date objects, but code often expects strings.
 * Calling .split() on a Date object throws "split is not a function".
 * These utilities provide safe conversions.
 */

/**
 * Convert a Date or ISO string to YYYY-MM-DD format
 * Handles: Date objects, ISO strings, null/undefined
 */
export function toDateString(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    if (date instanceof Date) return date.toISOString().split('T')[0];
    if (typeof date === 'string') return date.split('T')[0];
    return null;
}

/**
 * Convert a Date or ISO string to full ISO string format
 * Handles: Date objects, ISO strings, null/undefined
 */
export function toISOString(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    if (date instanceof Date) return date.toISOString();
    if (typeof date === 'string') return date;
    return null;
}

/**
 * Format date for display (e.g., "Jan 16, 2026")
 */
export function toDisplayDate(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Format date for batch codes (e.g., "20260116")
 */
export function toBatchDateCode(date: Date | string | null | undefined): string | null {
    const dateStr = toDateString(date);
    if (!dateStr) return null;
    return dateStr.replace(/-/g, '');
}
