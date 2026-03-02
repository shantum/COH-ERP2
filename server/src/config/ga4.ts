/**
 * GA4 BigQuery Configuration
 *
 * GA4 exports event data to BigQuery daily (events_YYYYMMDD) and
 * streaming (events_intraday_YYYYMMDD). This config holds dataset
 * references and cache TTLs for the growth analytics dashboard.
 */

import { resolve } from 'path';
import { existsSync } from 'fs';

/** GCP project ID */
export const GA4_PROJECT = 'coh-erp';

/** BigQuery dataset created by GA4 export */
export const GA4_DATASET = process.env.GA4_DATASET || 'analytics_287841955';

/** Full table reference prefix */
export const GA4_EVENTS_TABLE = `${GA4_PROJECT}.${GA4_DATASET}.events_*`;
export const GA4_INTRADAY_TABLE = `${GA4_PROJECT}.${GA4_DATASET}.events_intraday_*`;

/**
 * Path to Google service account key file (same as Sheets).
 * Checks multiple locations to work from both server cwd and client (Vite SSR) cwd.
 */
function resolveServiceAccountPath(): string {
    const candidates = [
        resolve(process.cwd(), 'server/config/google-service-account.json'),    // project root cwd (production)
        resolve(process.cwd(), 'config/google-service-account.json'),           // server cwd (dev)
        resolve(process.cwd(), '../server/config/google-service-account.json'), // client cwd (Vite SSR dev)
    ];
    return candidates.find(p => existsSync(p)) ?? candidates[0];
}
export const GOOGLE_SERVICE_ACCOUNT_PATH = resolveServiceAccountPath();

/** Cache TTLs in milliseconds */
export const CACHE_TTL_INTRADAY = 5 * 60 * 1000;  // 5 min for today's data
export const CACHE_TTL_HISTORICAL = 60 * 60 * 1000; // 1 hr for past data

/** BigQuery API limits */
export const BQ_MAX_RETRIES = 3;
export const BQ_RETRY_DELAY_MS = 1000;

// ============================================
// GA4 Analytics Data API (live query fallback)
// ============================================

/** GA4 Property ID */
export const GA4_PROPERTY_ID = '287841955';

/** Analytics Data API scope */
export const ANALYTICS_DATA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** Cache TTL for API queries (5 min) */
export const API_CACHE_TTL = 5 * 60 * 1000;
