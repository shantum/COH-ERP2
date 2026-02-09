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

/**
 * IST Timezone Utilities
 * India Standard Time is UTC+5:30
 * All functions return UTC Date objects representing IST boundaries
 *
 * IMPORTANT: All functions are server-timezone agnostic. They use UTC methods
 * to ensure correct behavior regardless of server locale (Railway runs UTC).
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds

/**
 * Get current time shifted to IST (as a Date object)
 * Note: The returned Date has an internal UTC timestamp shifted by IST offset.
 * Use getUTC* methods to extract IST date/time components.
 */
export function nowIST(): Date {
    const utc = new Date();
    return new Date(utc.getTime() + IST_OFFSET_MS);
}

/**
 * Get start of today in IST (returned as UTC Date for database queries)
 * Server-timezone agnostic: uses UTC methods throughout.
 * Example: If IST is 2026-01-20 5:30 PM, returns 2026-01-19 18:30:00 UTC (midnight IST Jan 20)
 */
export function todayStartIST(): Date {
    const ist = nowIST();
    // Use UTC methods to get IST date components
    const istYear = ist.getUTCFullYear();
    const istMonth = ist.getUTCMonth();
    const istDay = ist.getUTCDate();
    // Create UTC timestamp for IST midnight, then subtract offset
    const istMidnightUTC = Date.UTC(istYear, istMonth, istDay) - IST_OFFSET_MS;
    return new Date(istMidnightUTC);
}

/**
 * Get start of yesterday in IST (returned as UTC Date for database queries)
 */
export function yesterdayStartIST(): Date {
    const today = todayStartIST();
    return new Date(today.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Get start of a date N days ago in IST (returned as UTC Date for database queries)
 */
export function daysAgoStartIST(days: number): Date {
    const today = todayStartIST();
    return new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Get start of this month in IST (returned as UTC Date for database queries)
 * Server-timezone agnostic: uses UTC methods throughout.
 */
export function thisMonthStartIST(): Date {
    const ist = nowIST();
    const istYear = ist.getUTCFullYear();
    const istMonth = ist.getUTCMonth();
    const istMonthStartUTC = Date.UTC(istYear, istMonth, 1) - IST_OFFSET_MS;
    return new Date(istMonthStartUTC);
}

/**
 * Get start of last month in IST (returned as UTC Date for database queries)
 * Server-timezone agnostic: uses UTC methods throughout.
 */
export function lastMonthStartIST(): Date {
    const ist = nowIST();
    const istYear = ist.getUTCFullYear();
    const istMonth = ist.getUTCMonth();
    const lastMonthStartUTC = Date.UTC(istYear, istMonth - 1, 1) - IST_OFFSET_MS;
    return new Date(lastMonthStartUTC);
}

/**
 * Get end of last month (= start of this month) in IST (returned as UTC Date)
 */
export function lastMonthEndIST(): Date {
    return thisMonthStartIST();
}

/**
 * Get same time yesterday (for same-time comparisons)
 * This is timezone-agnostic as it's just 24 hours ago.
 */
export function sameTimeYesterdayIST(): Date {
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

/**
 * Get IST midnight boundaries for any given month
 * Returns UTC Date objects representing IST midnight start/end of the month
 * @param year - Full year (e.g. 2026)
 * @param month - 1-based month (1=Jan, 12=Dec)
 */
export function monthBoundariesIST(year: number, month: number): { start: Date; end: Date } {
    // IST midnight on 1st of the given month → UTC
    const monthStartUTC = Date.UTC(year, month - 1, 1) - IST_OFFSET_MS;
    // IST midnight on 1st of NEXT month → UTC
    const nextMonthStartUTC = Date.UTC(year, month, 1) - IST_OFFSET_MS;
    return {
        start: new Date(monthStartUTC),
        end: new Date(nextMonthStartUTC),
    };
}

/**
 * Get same time last month (for same-time comparisons)
 * Note: Uses UTC methods for consistency.
 */
export function sameTimeLastMonthIST(): Date {
    const now = new Date();
    const lastMonth = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - 1,
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds()
    ));
    return lastMonth;
}
