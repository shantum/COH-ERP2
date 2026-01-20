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
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30; // 5 hours 30 minutes

/**
 * Get current time in IST (as a Date object)
 */
export function nowIST(): Date {
    const utc = new Date();
    return new Date(utc.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Get start of today in IST (returned as UTC Date for database queries)
 * Example: If IST is 2026-01-20 5:30 PM, returns 2026-01-19 18:30:00 UTC (midnight IST Jan 20)
 */
export function todayStartIST(): Date {
    const ist = nowIST();
    // Get midnight in IST
    const midnightIST = new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
    // Convert back to UTC for database comparison
    return new Date(midnightIST.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
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
 */
export function thisMonthStartIST(): Date {
    const ist = nowIST();
    const firstOfMonthIST = new Date(ist.getFullYear(), ist.getMonth(), 1);
    return new Date(firstOfMonthIST.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Get start of last month in IST (returned as UTC Date for database queries)
 */
export function lastMonthStartIST(): Date {
    const ist = nowIST();
    const firstOfLastMonthIST = new Date(ist.getFullYear(), ist.getMonth() - 1, 1);
    return new Date(firstOfLastMonthIST.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Get end of last month (= start of this month) in IST (returned as UTC Date)
 */
export function lastMonthEndIST(): Date {
    return thisMonthStartIST();
}

/**
 * Get same time yesterday in IST (for same-time comparisons)
 */
export function sameTimeYesterdayIST(): Date {
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

/**
 * Get same time last month (for same-time comparisons)
 */
export function sameTimeLastMonthIST(): Date {
    const now = new Date();
    return new Date(now.setMonth(now.getMonth() - 1));
}
