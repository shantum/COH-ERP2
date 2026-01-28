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
 */
export function getISTMidnightAsUTC(daysOffset = 0): Date {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    // Get IST midnight for the target day
    const istMidnight = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate() + daysOffset);

    // Convert IST midnight back to UTC (subtract 5:30)
    return new Date(istMidnight.getTime() - IST_OFFSET_MS);
}

/**
 * Get the first day of a month in IST as UTC Date.
 * @param monthOffset - Months from current (0 = this month, -1 = last month)
 */
export function getISTMonthStartAsUTC(monthOffset = 0): Date {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    // Get first day of target month in IST
    const istMonthStart = new Date(nowIST.getFullYear(), nowIST.getMonth() + monthOffset, 1);

    // Convert to UTC
    return new Date(istMonthStart.getTime() - IST_OFFSET_MS);
}

/**
 * Get the last moment of a month in IST as UTC Date.
 * @param monthOffset - Months from current (0 = this month, -1 = last month)
 */
export function getISTMonthEndAsUTC(monthOffset = 0): Date {
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + IST_OFFSET_MS);

    // Get last moment of target month in IST (day 0 of next month = last day of target month)
    const istMonthEnd = new Date(nowIST.getFullYear(), nowIST.getMonth() + monthOffset + 1, 0, 23, 59, 59, 999);

    // Convert to UTC
    return new Date(istMonthEnd.getTime() - IST_OFFSET_MS);
}
