/**
 * Meta (Facebook) Ads API Configuration
 *
 * Read-only access to ad campaign performance data.
 * Token is long-lived (60 days) — needs periodic refresh.
 */

/** Meta App credentials */
export const META_APP_ID = process.env.META_APP_ID || '';
export const META_APP_SECRET = process.env.META_APP_SECRET || '';

/** Long-lived user access token (60 days, needs refresh) */
export const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';

/** Ad Account ID (format: act_XXXXXXXXXX) */
export const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '';

/** Graph API version */
export const META_API_VERSION = 'v25.0';
export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

/** Rate limits — Marketing API: 200 calls per hour per ad account */
export const META_MIN_CALL_DELAY_MS = 200;
export const META_MAX_RETRIES = 3;

/** Cache TTLs */
export const META_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
