/**
 * Currency & Number Formatting — thin wrappers over @coh/shared/domain/formatting
 *
 * Use these instead of defining local formatCurrency helpers.
 */
export { formatCurrency, formatNumber, formatPercent } from '@coh/shared/domain/formatting';

/**
 * Format currency, returning '-' for null/undefined.
 * Use in AG-Grid valueFormatters and table cells.
 */
export function formatCurrencyOrDash(value: number | null | undefined): string {
    if (value == null) return '-';
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/**
 * Format currency with exactly 2 decimal places (e.g. order line items).
 */
export function formatCurrencyExact(amount: number): string {
    return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format currency via Intl (full format, no compact, 0 decimals).
 */
export function formatCurrencyFull(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}
