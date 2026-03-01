/**
 * BigQuery Client (Authenticated)
 *
 * Queries GA4 event data exported to BigQuery for the growth analytics dashboard.
 * Follows the googleSheetsClient.ts singleton pattern.
 *
 * Features:
 * - Lazy auth: authenticates on first query using service account
 * - Retry: exponential backoff on transient errors
 * - In-memory cache with configurable TTL
 * - Queries both daily (events_*) and intraday (events_intraday_*) tables
 */

import { BigQuery } from '@google-cloud/bigquery';
import { readFileSync, existsSync } from 'fs';
import {
    GA4_PROJECT,
    GA4_DATASET,
    GOOGLE_SERVICE_ACCOUNT_PATH,
    BQ_MAX_RETRIES,
    BQ_RETRY_DELAY_MS,
    CACHE_TTL_HISTORICAL,
} from '../config/ga4.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'bigquery' });

// ============================================
// SINGLETON STATE
// ============================================

let bqClient: BigQuery | null = null;

// Simple in-memory cache
interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

// ============================================
// AUTH
// ============================================

function getClient(): BigQuery {
    if (bqClient) return bqClient;

    const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (envJson) {
        const credentials = JSON.parse(envJson);
        bqClient = new BigQuery({ projectId: GA4_PROJECT, credentials });
        log.info('BigQuery client initialized from GOOGLE_SERVICE_ACCOUNT_JSON env var');
    } else if (existsSync(GOOGLE_SERVICE_ACCOUNT_PATH)) {
        const credentials = JSON.parse(readFileSync(GOOGLE_SERVICE_ACCOUNT_PATH, 'utf-8'));
        bqClient = new BigQuery({ projectId: GA4_PROJECT, credentials });
        log.info('BigQuery client initialized from key file');
    } else {
        throw new Error(
            'Google service account credentials not found. ' +
            'Set GOOGLE_SERVICE_ACCOUNT_JSON env var or place key file at server/config/google-service-account.json'
        );
    }

    return bqClient;
}

// ============================================
// RETRY LOGIC
// ============================================

async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= BQ_MAX_RETRIES; attempt++) {
        try {
            return await operation();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const statusCode = error instanceof Error && 'code' in error
                ? Number((error as Error & { code: unknown }).code)
                : undefined;

            const isTransient = statusCode === 429 || statusCode === 500 || statusCode === 503;
            if (!isTransient || attempt === BQ_MAX_RETRIES) {
                throw lastError;
            }

            const delay = Math.pow(2, attempt) * BQ_RETRY_DELAY_MS;
            log.warn({ attempt: attempt + 1, delay, statusCode, label }, 'Retrying after transient error');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError ?? new Error(`${label}: exhausted retries`);
}

// ============================================
// CACHE HELPERS
// ============================================

function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Format a Date as YYYYMMDD string for BigQuery table suffix filtering.
 */
export function formatDateSuffix(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

/**
 * Get the date suffix range for the last N days.
 * Returns [startSuffix, endSuffix] as YYYYMMDD strings.
 */
export function getDateRange(days: number): { startDate: string; endDate: string } {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
        startDate: formatDateSuffix(start),
        endDate: formatDateSuffix(end),
    };
}

export interface QueryOptions {
    /** Cache key — if provided, results are cached */
    cacheKey?: string;
    /** Cache TTL in ms (defaults to CACHE_TTL_HISTORICAL) */
    cacheTtl?: number;
    /** Query parameters */
    params?: Record<string, string | number>;
}

/**
 * Run a BigQuery SQL query against the GA4 dataset.
 *
 * @param sql - The SQL query string. Use @param placeholders for parameters.
 * @param options - Cache key, TTL, and query parameters.
 * @returns Array of row objects.
 */
export async function runQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    options: QueryOptions = {},
): Promise<T[]> {
    const { cacheKey, cacheTtl = CACHE_TTL_HISTORICAL, params } = options;

    // Check cache
    if (cacheKey) {
        const cached = getCached<T[]>(cacheKey);
        if (cached) {
            log.debug({ cacheKey }, 'BigQuery cache hit');
            return cached;
        }
    }

    const client = getClient();

    const [rows] = await withRetry(
        () => client.query({
            query: sql,
            params,
            location: 'asia-southeast2',
        }),
        cacheKey ?? 'bigquery',
    );

    const result = (rows ?? []) as T[];

    // Cache the result
    if (cacheKey) {
        setCache(cacheKey, result, cacheTtl);
        log.debug({ cacheKey, rowCount: result.length }, 'BigQuery result cached');
    }

    return result;
}

/**
 * Build a UNION ALL query that combines daily + intraday tables.
 * This gives us complete historical data plus today's streaming data.
 */
export function buildEventsQuery(
    selectClause: string,
    whereClause: string,
    groupByClause: string,
    orderByClause: string,
    startDate: string,
    endDate: string,
): string {
    const dailyTable = `\`${GA4_PROJECT}.${GA4_DATASET}.events_*\``;
    const intradayTable = `\`${GA4_PROJECT}.${GA4_DATASET}.events_intraday_*\``;
    const todaySuffix = formatDateSuffix(new Date());

    return `
WITH all_events AS (
    SELECT * FROM ${dailyTable}
    WHERE _TABLE_SUFFIX BETWEEN '${startDate}' AND '${endDate}'
    UNION ALL
    SELECT * FROM ${intradayTable}
    WHERE _TABLE_SUFFIX = '${todaySuffix}'
)
SELECT ${selectClause}
FROM all_events
WHERE ${whereClause}
${groupByClause ? `GROUP BY ${groupByClause}` : ''}
${orderByClause ? `ORDER BY ${orderByClause}` : ''}
`;
}

/**
 * Check if the GA4 dataset exists and has tables.
 * Useful for health checks and initial setup verification.
 */
export async function checkDatasetHealth(): Promise<{
    exists: boolean;
    tableCount: number;
    latestTable: string | null;
}> {
    try {
        const client = getClient();
        const dataset = client.dataset(GA4_DATASET);
        const [tables] = await dataset.getTables();

        const tableNames = tables.map(t => t.id).filter(Boolean).sort();
        return {
            exists: true,
            tableCount: tableNames.length,
            latestTable: tableNames[tableNames.length - 1] ?? null,
        };
    } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && (error as Error & { code: number }).code === 404) {
            return { exists: false, tableCount: 0, latestTable: null };
        }
        throw error;
    }
}
