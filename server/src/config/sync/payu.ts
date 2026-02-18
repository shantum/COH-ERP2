/**
 * PayU Settlement Sync Configuration
 */

/** Interval between settlement syncs (12 hours) */
export const PAYU_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Number of days to look back for new settlements */
export const PAYU_LOOKBACK_DAYS = 7;

/** Delay before first settlement sync after server start (8 min — after remittance sync) */
export const PAYU_STARTUP_DELAY_MS = 8 * 60 * 1000;

/** Max date range per API call (PayU limit) */
export const PAYU_MAX_DATE_RANGE_DAYS = 3;

/** Page size for settlement API (max 100) */
export const PAYU_PAGE_SIZE = 100;

/** API request timeout (ms) */
export const PAYU_API_TIMEOUT_MS = 30_000;
