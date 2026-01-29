/**
 * Currency and Number Formatting Utilities
 *
 * Shared pure functions for consistent formatting across client and server.
 * Used by dashboard cards, reports, and analytics components.
 */

/**
 * Format currency amount in Indian Rupees
 *
 * @param amount - The amount to format
 * @param options - Formatting options
 * @returns Formatted currency string
 *
 * @example
 * formatCurrency(1500) // "₹1.5K"
 * formatCurrency(150000) // "₹1.5L"
 * formatCurrency(1500, { compact: false }) // "₹1,500"
 */
export function formatCurrency(
    amount: number,
    options?: {
        /** Use compact notation (K, L, Cr). Default: true */
        compact?: boolean;
        /** Show decimals for small amounts. Default: true */
        showDecimals?: boolean;
        /** Locale for formatting. Default: 'en-IN' */
        locale?: string;
    }
): string {
    const { compact = true, showDecimals = true, locale = 'en-IN' } = options ?? {};

    // Handle edge cases
    if (!Number.isFinite(amount)) return '₹0';

    if (compact) {
        const absAmount = Math.abs(amount);
        const sign = amount < 0 ? '-' : '';

        if (absAmount >= 1_00_00_000) {
            // 1 Crore = 10 million
            return `${sign}₹${(absAmount / 1_00_00_000).toFixed(1)}Cr`;
        }
        if (absAmount >= 1_00_000) {
            // 1 Lakh = 100 thousand
            return `${sign}₹${(absAmount / 1_00_000).toFixed(1)}L`;
        }
        if (absAmount >= 1_000) {
            return `${sign}₹${(absAmount / 1_000).toFixed(1)}K`;
        }
    }

    // Full format with locale
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: showDecimals && amount < 100 ? 2 : 0,
        minimumFractionDigits: 0,
    }).format(amount);
}

/**
 * Format number with optional compact notation
 *
 * @param value - The number to format
 * @param options - Formatting options
 * @returns Formatted number string
 *
 * @example
 * formatNumber(1500) // "1.5K"
 * formatNumber(150000) // "1.5L"
 * formatNumber(1500, { compact: false }) // "1,500"
 */
export function formatNumber(
    value: number,
    options?: {
        /** Use compact notation (K, L, Cr). Default: true */
        compact?: boolean;
        /** Decimal places for compact notation. Default: 1 */
        decimals?: number;
        /** Locale for formatting. Default: 'en-IN' */
        locale?: string;
    }
): string {
    const { compact = true, decimals = 1, locale = 'en-IN' } = options ?? {};

    // Handle edge cases
    if (!Number.isFinite(value)) return '0';

    if (compact) {
        const absValue = Math.abs(value);
        const sign = value < 0 ? '-' : '';

        if (absValue >= 1_00_00_000) {
            return `${sign}${(absValue / 1_00_00_000).toFixed(decimals)}Cr`;
        }
        if (absValue >= 1_00_000) {
            return `${sign}${(absValue / 1_00_000).toFixed(decimals)}L`;
        }
        if (absValue >= 1_000) {
            return `${sign}${(absValue / 1_000).toFixed(decimals)}K`;
        }
    }

    return value.toLocaleString(locale);
}

/**
 * Format percentage with optional decimal places
 *
 * @param value - The percentage value (0-100)
 * @param decimals - Number of decimal places. Default: 0
 * @returns Formatted percentage string
 *
 * @example
 * formatPercent(45.678) // "46%"
 * formatPercent(45.678, 1) // "45.7%"
 */
export function formatPercent(value: number, decimals = 0): string {
    if (!Number.isFinite(value)) return '0%';
    return `${value.toFixed(decimals)}%`;
}

/**
 * Calculate percentage change between two values
 *
 * @param current - Current value
 * @param previous - Previous value to compare against
 * @returns Percentage change (positive = increase, negative = decrease), null if previous is 0
 *
 * @example
 * calculateChange(110, 100) // 10 (10% increase)
 * calculateChange(90, 100) // -10 (10% decrease)
 * calculateChange(100, 0) // null (can't calculate from 0)
 */
export function calculateChange(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return Math.round(((current - previous) / previous) * 100);
}
