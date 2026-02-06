/**
 * IST (Indian Standard Time) Date Utilities
 *
 * Converts IST timestamps to UTC for database queries.
 * IST is UTC+5:30, so IST midnight = UTC previous day 18:30.
 */

/** IST offset in milliseconds (5 hours 30 minutes) */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Get IST midnight as UTC Date for database queries.
 * @param daysOffset - Days from today (0 = today, -1 = yesterday, etc.)
 *
 * Server-timezone agnostic: uses UTC methods throughout.
 * Example: daysOffset=0 at IST Feb 1 07:00 → Jan 31 18:30 UTC (= Feb 1 00:00 IST)
 */
export function getISTMidnightAsUTC(daysOffset = 0): Date {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    // Use UTC methods to get IST date components from shifted timestamp
    const istYear = nowIST.getUTCFullYear();
    const istMonth = nowIST.getUTCMonth();
    const istDay = nowIST.getUTCDate();

    // Create IST midnight as UTC timestamp, then subtract IST offset
    const istMidnightUTC = Date.UTC(istYear, istMonth, istDay + daysOffset) - IST_OFFSET_MS;
    return new Date(istMidnightUTC);
}

/**
 * Get the first day of a month in IST as UTC Date.
 * @param monthOffset - Months from current (0 = this month, -1 = last month)
 *
 * Server-timezone agnostic: uses UTC methods throughout.
 */
export function getISTMonthStartAsUTC(monthOffset = 0): Date {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    // Use UTC methods to get IST year/month from shifted timestamp
    const istYear = nowIST.getUTCFullYear();
    const istMonth = nowIST.getUTCMonth();

    // First day of target month at IST midnight, converted to UTC
    const istMonthStartUTC = Date.UTC(istYear, istMonth + monthOffset, 1) - IST_OFFSET_MS;
    return new Date(istMonthStartUTC);
}

/**
 * Get the last moment of a month in IST as UTC Date.
 * @param monthOffset - Months from current (0 = this month, -1 = last month)
 *
 * Server-timezone agnostic: uses UTC methods throughout.
 */
export function getISTMonthEndAsUTC(monthOffset = 0): Date {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    // Use UTC methods to get IST year/month from shifted timestamp
    const istYear = nowIST.getUTCFullYear();
    const istMonth = nowIST.getUTCMonth();

    // Last moment of target month: day 0 of next month at 23:59:59.999 IST
    const istMonthEndUTC = Date.UTC(istYear, istMonth + monthOffset + 1, 0, 23, 59, 59, 999) - IST_OFFSET_MS;
    return new Date(istMonthEndUTC);
}

/**
 * Get the current day of month in IST (1-31).
 * Critical for daily average calculations on servers in UTC timezone.
 *
 * Server-timezone agnostic: uses getUTCDate() on IST-shifted timestamp.
 */
export function getISTDayOfMonth(): number {
    const nowUTC = new Date();
    // Shift UTC timestamp to IST, then extract UTC day (which is now IST day)
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);
    return nowIST.getUTCDate();
}

/**
 * Get the number of days in a given month in IST.
 * @param monthOffset - Months from current (0 = this month, -1 = last month)
 *
 * Server-timezone agnostic: uses UTC methods throughout.
 */
export function getISTDaysInMonth(monthOffset = 0): number {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);
    // Use UTC methods to get IST year/month from shifted timestamp
    const istYear = nowIST.getUTCFullYear();
    const istMonth = nowIST.getUTCMonth();
    // Day 0 of next month gives the last day of target month (works with Date.UTC)
    const lastDayTimestamp = Date.UTC(istYear, istMonth + monthOffset + 1, 0);
    return new Date(lastDayTimestamp).getUTCDate();
}

/**
 * Parse a YYYY-MM-DD date string as IST midnight, returned as UTC.
 * Use this when user provides dates that should be interpreted in IST.
 *
 * Server-timezone agnostic: uses Date.UTC() to avoid dependency on server locale.
 * Example: "2025-01-15" → Jan 14 2025 18:30:00 UTC (= Jan 15 2025 00:00:00 IST)
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 */
export function parseISTDateAsUTC(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    // Date.UTC gives us UTC midnight; subtract IST offset to get IST midnight as UTC
    const utcTimestamp = Date.UTC(year, month - 1, day) - IST_OFFSET_MS;
    return new Date(utcTimestamp);
}

/**
 * Parse a YYYY-MM-DD date string as IST end-of-day (23:59:59.999), returned as UTC.
 *
 * Server-timezone agnostic: uses Date.UTC() to avoid dependency on server locale.
 * Example: "2025-01-15" → Jan 15 2025 18:29:59.999 UTC (= Jan 15 2025 23:59:59.999 IST)
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 */
export function parseISTDateEndAsUTC(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    // IST 23:59:59.999 = UTC midnight next day minus 5:30 hours minus 1ms
    // Simpler: UTC midnight + (24h - 5.5h - 1ms) = UTC midnight + 18h 29m 59.999s
    const utcTimestamp = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - IST_OFFSET_MS;
    return new Date(utcTimestamp);
}
