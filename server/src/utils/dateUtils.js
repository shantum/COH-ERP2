/**
 * Date utility functions
 * Consolidates date operations from across the codebase
 */

/**
 * Calculate the number of days between two dates
 * 
 * @param {Date|string} date1 - Start date
 * @param {Date|string} date2 - End date
 * @returns {number} Number of days between dates (can be negative)
 * 
 * @example
 * daysBetween('2024-01-01', '2024-01-10') // 9
 */
export function daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate the number of days since a given date
 * 
 * @param {Date|string} date - The date to calculate from
 * @returns {number} Number of days since the date
 * 
 * @example
 * daysSince('2024-01-01') // depends on current date
 */
export function daysSince(date) {
    if (!date) return 0;
    return daysBetween(date, new Date());
}

/**
 * Calculate the number of days until a given date
 * 
 * @param {Date|string} date - The target date
 * @returns {number} Number of days until the date (negative if in the past)
 */
export function daysUntil(date) {
    if (!date) return 0;
    return daysBetween(new Date(), date);
}

/**
 * Parse date string from various formats
 * Handles formats like: "06-Jan-26", "2026-01-06", "01/06/2026"
 * 
 * @param {string} dateStr - Date string to parse
 * @returns {Date|null} Parsed date or null if invalid
 * 
 * @example
 * parseDate('06-Jan-26') // Date object for 2026-01-06
 * parseDate('2026-01-06') // Date object for 2026-01-06
 */
export function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;

    // Try ISO format first (YYYY-MM-DD)
    let date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;

    // Try DD-MMM-YY format (e.g., "06-Jan-26")
    const ddMmmYyMatch = dateStr.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (ddMmmYyMatch) {
        const [, day, monthStr, year] = ddMmmYyMatch;
        const monthMap = {
            jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
            jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        };
        const month = monthMap[monthStr.toLowerCase()];
        if (month !== undefined) {
            const fullYear = 2000 + parseInt(year, 10);
            date = new Date(fullYear, month, parseInt(day, 10));
            if (!isNaN(date.getTime())) return date;
        }
    }

    // Try DD/MM/YYYY format
    const ddMmYyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddMmYyyyMatch) {
        const [, day, month, year] = ddMmYyyyMatch;
        date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        if (!isNaN(date.getTime())) return date;
    }

    return null;
}

/**
 * Format date for display
 * 
 * @param {Date|string} date - Date to format
 * @param {string} format - Format string ('YYYY-MM-DD', 'DD/MM/YYYY', 'relative')
 * @returns {string} Formatted date string
 * 
 * @example
 * formatDate(new Date(), 'YYYY-MM-DD') // '2024-01-06'
 * formatDate(new Date(), 'relative') // '2 days ago'
 */
export function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return '';

    const d = new Date(date);
    if (isNaN(d.getTime())) return '';

    if (format === 'relative') {
        const days = daysSince(d);
        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days === -1) return 'Tomorrow';
        if (days > 0) return `${days} days ago`;
        return `In ${Math.abs(days)} days`;
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    if (format === 'YYYY-MM-DD') {
        return `${year}-${month}-${day}`;
    }

    if (format === 'DD/MM/YYYY') {
        return `${day}/${month}/${year}`;
    }

    return d.toISOString();
}

/**
 * Check if a date is within a range
 * 
 * @param {Date|string} date - Date to check
 * @param {Date|string} startDate - Start of range
 * @param {Date|string} endDate - End of range
 * @returns {boolean} True if date is within range (inclusive)
 */
export function isDateInRange(date, startDate, endDate) {
    const d = new Date(date);
    const start = new Date(startDate);
    const end = new Date(endDate);
    return d >= start && d <= end;
}

/**
 * Add days to a date
 * 
 * @param {Date|string} date - Starting date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date} New date with days added
 * 
 * @example
 * addDays(new Date(), 7) // Date 7 days from now
 */
export function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

/**
 * Get start of day (00:00:00)
 * 
 * @param {Date|string} date - Date to process
 * @returns {Date} Date with time set to 00:00:00
 */
export function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Get end of day (23:59:59)
 * 
 * @param {Date|string} date - Date to process
 * @returns {Date} Date with time set to 23:59:59
 */
export function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}
