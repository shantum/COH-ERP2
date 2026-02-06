/**
 * Date formatting utilities for the client app
 *
 * Centralized date formatters to avoid duplication across components.
 * All formatters use 'en-IN' locale for consistency.
 */

/** Format a date string as "02 Jan 2026" */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Format a date string as "02 Jan 2026, 10:30 am" */
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Format a date string as "02 Jan" (no year) */
export function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}
