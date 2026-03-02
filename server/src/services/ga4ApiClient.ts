/**
 * GA4 Analytics Data API Client
 *
 * Queries GA4 event data via the Analytics Data API (v1beta).
 * Used as the primary data source for the growth analytics dashboard.
 * BigQuery export can be added later as an enrichment layer.
 *
 * Auth: same service account as Google Sheets (coh-sheets@coh-erp.iam.gserviceaccount.com)
 * Property: 287841955 (Creatures of Habit - GA4)
 */

import { google, type analyticsdata_v1beta } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import {
    GA4_PROPERTY_ID,
    GOOGLE_SERVICE_ACCOUNT_PATH,
    ANALYTICS_DATA_SCOPE,
    API_CACHE_TTL,
    BQ_MAX_RETRIES,
    BQ_RETRY_DELAY_MS,
} from '../config/ga4.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'ga4-api' });

// ============================================
// TYPES (match ga4Analytics.ts exactly)
// ============================================

export interface FunnelDay {
    date: string;
    sessions: number;
    addToCarts: number;
    checkouts: number;
    purchases: number;
    revenue: number;
}

export interface FunnelSummary {
    totalSessions: number;
    totalAddToCarts: number;
    totalCheckouts: number;
    totalPurchases: number;
    totalRevenue: number;
    cartRate: number;
    checkoutRate: number;
    purchaseRate: number;
}

export interface ConversionFunnelResponse {
    daily: FunnelDay[];
    summary: FunnelSummary;
}

export interface LandingPageRow {
    landingPage: string;
    sessions: number;
    users: number;
    purchases: number;
    revenue: number;
    conversionRate: number;
}

export interface TrafficSourceRow {
    source: string;
    medium: string;
    sessions: number;
    users: number;
    purchases: number;
    revenue: number;
    conversionRate: number;
}

export interface CampaignRow {
    campaign: string;
    source: string;
    medium: string;
    users: number;
    purchases: number;
    revenue: number;
    conversionRate: number;
}

export interface GeoRow {
    city: string;
    region: string;
    sessions: number;
    users: number;
    purchases: number;
    revenue: number;
    conversionRate: number;
}

export interface DeviceRow {
    device: string;
    sessions: number;
    users: number;
    purchases: number;
    conversionRate: number;
}

export interface GrowthOverview {
    totalSessions: number;
    totalPurchases: number;
    overallConversionRate: number;
    totalRevenue: number;
    avgOrderValue: number;
    topSource: string;
    topCity: string;
    topLandingPage: string;
}

// ============================================
// SINGLETON CLIENT
// ============================================

let client: analyticsdata_v1beta.Analyticsdata | null = null;

function getClient(): analyticsdata_v1beta.Analyticsdata {
    if (client) return client;

    let keyFile: { client_email: string; private_key: string };

    const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (envJson) {
        keyFile = JSON.parse(envJson);
        log.info('GA4 API client initialized from env var');
    } else if (existsSync(GOOGLE_SERVICE_ACCOUNT_PATH)) {
        keyFile = JSON.parse(readFileSync(GOOGLE_SERVICE_ACCOUNT_PATH, 'utf-8'));
        log.info('GA4 API client initialized from key file');
    } else {
        throw new Error(
            'Google service account credentials not found. ' +
            'Set GOOGLE_SERVICE_ACCOUNT_JSON env var or place key file at server/config/google-service-account.json'
        );
    }

    const auth = new google.auth.JWT({
        email: keyFile.client_email,
        key: keyFile.private_key,
        scopes: [ANALYTICS_DATA_SCOPE],
    });

    client = google.analyticsdata({ version: 'v1beta', auth });
    return client;
}

// ============================================
// CACHE
// ============================================

interface CacheEntry<T> { data: T; expiresAt: number; }
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.data as T;
}

function setCache<T>(key: string, data: T, ttl: number): void {
    cache.set(key, { data, expiresAt: Date.now() + ttl });
}

// ============================================
// HELPERS
// ============================================

const PROPERTY = `properties/${GA4_PROPERTY_ID}`;

function safeDiv(numerator: number, denominator: number): number {
    return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function getDateRange(days: number): { startDate: string; endDate: string } {
    if (days === 1) return { startDate: 'today', endDate: 'today' };
    if (days === 2) return { startDate: 'yesterday', endDate: 'yesterday' };
    return { startDate: `${days}daysAgo`, endDate: 'today' };
}

function formatDate(yyyymmdd: string): string {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

type Schema = analyticsdata_v1beta.Schema$RunReportRequest;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= BQ_MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt === BQ_MAX_RETRIES) break;
            const delay = BQ_RETRY_DELAY_MS * Math.pow(2, attempt);
            log.warn({ attempt: attempt + 1, delay, label, error: lastError.message }, 'Retrying GA4 API call');
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

interface ParsedRow {
    dims: Record<string, string>;
    mets: Record<string, number>;
}

function parseRows(response: analyticsdata_v1beta.Schema$RunReportResponse): ParsedRow[] {
    const dimHeaders = response.dimensionHeaders?.map(h => h.name!) ?? [];
    const metHeaders = response.metricHeaders?.map(h => h.name!) ?? [];

    return (response.rows ?? []).map(row => {
        const dims: Record<string, string> = {};
        (row.dimensionValues ?? []).forEach((v, i) => { dims[dimHeaders[i]] = v.value ?? ''; });
        const mets: Record<string, number> = {};
        (row.metricValues ?? []).forEach((v, i) => { mets[metHeaders[i]] = Number(v.value ?? 0); });
        return { dims, mets };
    });
}

async function runReport(request: Schema, cacheKey?: string): Promise<ParsedRow[]> {
    if (cacheKey) {
        const cached = getCached<ParsedRow[]>(cacheKey);
        if (cached) return cached;
    }

    const response = await withRetry(async () => {
        const res = await getClient().properties.runReport({
            property: PROPERTY,
            requestBody: request,
        });
        return res.data;
    }, cacheKey ?? 'ga4-report');

    const rows = parseRows(response);
    if (cacheKey) setCache(cacheKey, rows, API_CACHE_TTL);
    return rows;
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Conversion Funnel — sessions → add_to_cart → checkout → purchase
 */
export async function queryConversionFunnel(days: number): Promise<ConversionFunnelResponse> {
    const { startDate, endDate } = getDateRange(days);

    const rows = await runReport({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
            { name: 'sessions' },
            { name: 'addToCarts' },
            { name: 'checkouts' },
            { name: 'ecommercePurchases' },
            { name: 'purchaseRevenue' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
    }, `ga4api:funnel:${days}`);

    const daily: FunnelDay[] = rows.map(r => ({
        date: formatDate(r.dims.date),
        sessions: r.mets.sessions,
        addToCarts: r.mets.addToCarts,
        checkouts: r.mets.checkouts,
        purchases: r.mets.ecommercePurchases,
        revenue: r.mets.purchaseRevenue,
    }));

    const totals = daily.reduce(
        (acc, d) => ({
            sessions: acc.sessions + d.sessions,
            addToCarts: acc.addToCarts + d.addToCarts,
            checkouts: acc.checkouts + d.checkouts,
            purchases: acc.purchases + d.purchases,
            revenue: acc.revenue + d.revenue,
        }),
        { sessions: 0, addToCarts: 0, checkouts: 0, purchases: 0, revenue: 0 },
    );

    return {
        daily,
        summary: {
            totalSessions: totals.sessions,
            totalAddToCarts: totals.addToCarts,
            totalCheckouts: totals.checkouts,
            totalPurchases: totals.purchases,
            totalRevenue: totals.revenue,
            cartRate: safeDiv(totals.addToCarts, totals.sessions),
            checkoutRate: safeDiv(totals.checkouts, totals.addToCarts),
            purchaseRate: safeDiv(totals.purchases, totals.sessions),
        },
    };
}

/**
 * Landing Page Performance
 */
export async function queryLandingPages(days: number, limit: number): Promise<LandingPageRow[]> {
    const { startDate, endDate } = getDateRange(days);

    const rows = await runReport({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'ecommercePurchases' },
            { name: 'purchaseRevenue' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: String(limit),
    }, `ga4api:landing:${days}:${limit}`);

    return rows
        .filter(r => r.dims.landingPagePlusQueryString && r.dims.landingPagePlusQueryString !== '(not set)')
        .map(r => ({
            landingPage: r.dims.landingPagePlusQueryString,
            sessions: r.mets.sessions,
            users: r.mets.activeUsers,
            purchases: r.mets.ecommercePurchases,
            revenue: r.mets.purchaseRevenue,
            conversionRate: safeDiv(r.mets.ecommercePurchases, r.mets.sessions),
        }));
}

/**
 * Traffic Sources — source/medium breakdown
 */
export async function queryTrafficSources(days: number): Promise<TrafficSourceRow[]> {
    const { startDate, endDate } = getDateRange(days);

    const rows = await runReport({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'ecommercePurchases' },
            { name: 'purchaseRevenue' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }, `ga4api:sources:${days}`);

    return rows.map(r => ({
        source: r.dims.sessionSource || '(direct)',
        medium: r.dims.sessionMedium || '(none)',
        sessions: r.mets.sessions,
        users: r.mets.activeUsers,
        purchases: r.mets.ecommercePurchases,
        revenue: r.mets.purchaseRevenue,
        conversionRate: safeDiv(r.mets.ecommercePurchases, r.mets.sessions),
    }));
}

/**
 * Campaign Performance
 */
export async function queryCampaigns(days: number): Promise<CampaignRow[]> {
    const { startDate, endDate } = getDateRange(days);

    const rows = await runReport({
        dateRanges: [{ startDate, endDate }],
        dimensions: [
            { name: 'sessionCampaignName' },
            { name: 'sessionSource' },
            { name: 'sessionMedium' },
        ],
        metrics: [
            { name: 'activeUsers' },
            { name: 'ecommercePurchases' },
            { name: 'purchaseRevenue' },
        ],
        dimensionFilter: {
            notExpression: {
                filter: {
                    fieldName: 'sessionCampaignName',
                    stringFilter: { value: '(not set)', matchType: 'EXACT' },
                },
            },
        },
        orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
    }, `ga4api:campaigns:${days}`);

    return rows.map(r => ({
        campaign: r.dims.sessionCampaignName,
        source: r.dims.sessionSource || '(direct)',
        medium: r.dims.sessionMedium || '(none)',
        users: r.mets.activeUsers,
        purchases: r.mets.ecommercePurchases,
        revenue: r.mets.purchaseRevenue,
        conversionRate: safeDiv(r.mets.ecommercePurchases, r.mets.activeUsers),
    }));
}

/**
 * Geographic Conversion — by city (India only)
 */
export async function queryGeoConversion(days: number, limit: number): Promise<GeoRow[]> {
    const { startDate, endDate } = getDateRange(days);

    const rows = await runReport({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'city' }, { name: 'region' }],
        metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'ecommercePurchases' },
            { name: 'purchaseRevenue' },
        ],
        dimensionFilter: {
            andGroup: {
                expressions: [
                    {
                        filter: {
                            fieldName: 'country',
                            stringFilter: { value: 'India', matchType: 'EXACT' },
                        },
                    },
                    {
                        notExpression: {
                            filter: {
                                fieldName: 'city',
                                stringFilter: { value: '(not set)', matchType: 'EXACT' },
                            },
                        },
                    },
                ],
            },
        },
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: String(limit),
    }, `ga4api:geo:${days}:${limit}`);

    return rows.map(r => ({
        city: r.dims.city,
        region: r.dims.region ?? '',
        sessions: r.mets.sessions,
        users: r.mets.activeUsers,
        purchases: r.mets.ecommercePurchases,
        revenue: r.mets.purchaseRevenue,
        conversionRate: safeDiv(r.mets.ecommercePurchases, r.mets.sessions),
    }));
}

/**
 * Device Breakdown — mobile/desktop/tablet
 */
export async function queryDeviceBreakdown(days: number): Promise<DeviceRow[]> {
    const { startDate, endDate } = getDateRange(days);

    const rows = await runReport({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'ecommercePurchases' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }, `ga4api:device:${days}`);

    return rows.map(r => ({
        device: r.dims.deviceCategory || 'unknown',
        sessions: r.mets.sessions,
        users: r.mets.activeUsers,
        purchases: r.mets.ecommercePurchases,
        conversionRate: safeDiv(r.mets.ecommercePurchases, r.mets.sessions),
    }));
}

/**
 * Growth Overview — KPI summary using batchRunReports (4 queries in 1 call)
 */
export async function queryGrowthOverview(days: number): Promise<GrowthOverview> {
    const cacheKey = `ga4api:overview:${days}`;
    const cached = getCached<GrowthOverview>(cacheKey);
    if (cached) return cached;

    const { startDate, endDate } = getDateRange(days);
    const dateRanges = [{ startDate, endDate }];

    const response = await withRetry(async () => {
        const res = await getClient().properties.batchRunReports({
            property: PROPERTY,
            requestBody: {
                requests: [
                    // 0: totals
                    {
                        dateRanges,
                        metrics: [
                            { name: 'sessions' },
                            { name: 'ecommercePurchases' },
                            { name: 'purchaseRevenue' },
                        ],
                    },
                    // 1: top source (excluding direct)
                    {
                        dateRanges,
                        dimensions: [{ name: 'sessionSource' }],
                        metrics: [{ name: 'sessions' }],
                        dimensionFilter: {
                            notExpression: {
                                filter: {
                                    fieldName: 'sessionSource',
                                    stringFilter: { value: '(direct)', matchType: 'EXACT' },
                                },
                            },
                        },
                        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                        limit: '1',
                    },
                    // 2: top city (India only)
                    {
                        dateRanges,
                        dimensions: [{ name: 'city' }],
                        metrics: [{ name: 'sessions' }],
                        dimensionFilter: {
                            andGroup: {
                                expressions: [
                                    {
                                        filter: {
                                            fieldName: 'country',
                                            stringFilter: { value: 'India', matchType: 'EXACT' },
                                        },
                                    },
                                    {
                                        notExpression: {
                                            filter: {
                                                fieldName: 'city',
                                                stringFilter: { value: '(not set)', matchType: 'EXACT' },
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                        limit: '1',
                    },
                    // 3: top landing page
                    {
                        dateRanges,
                        dimensions: [{ name: 'landingPagePlusQueryString' }],
                        metrics: [{ name: 'sessions' }],
                        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                        limit: '1',
                    },
                ],
            },
        });
        return res.data;
    }, 'ga4-overview-batch');

    const reports = response.reports ?? [];

    // Parse totals (report 0)
    const totalsRow = parseRows(reports[0] ?? {})[0];
    const sessions = totalsRow?.mets.sessions ?? 0;
    const purchases = totalsRow?.mets.ecommercePurchases ?? 0;
    const revenue = totalsRow?.mets.purchaseRevenue ?? 0;

    // Parse top source (report 1)
    const sourceRow = parseRows(reports[1] ?? {})[0];
    const topSource = sourceRow?.dims.sessionSource ?? '-';

    // Parse top city (report 2)
    const cityRow = parseRows(reports[2] ?? {})[0];
    const topCity = cityRow?.dims.city ?? '-';

    // Parse top landing page (report 3)
    const pageRow = parseRows(reports[3] ?? {})[0];
    const topLandingPage = pageRow?.dims.landingPagePlusQueryString ?? '-';

    const result: GrowthOverview = {
        totalSessions: sessions,
        totalPurchases: purchases,
        overallConversionRate: safeDiv(purchases, sessions),
        totalRevenue: revenue,
        avgOrderValue: purchases > 0 ? Math.round(revenue / purchases) : 0,
        topSource,
        topCity,
        topLandingPage,
    };

    setCache(cacheKey, result, API_CACHE_TTL);
    return result;
}

/**
 * Health Check — verify GA4 API is accessible
 * Returns same shape as BigQuery health check for UI compatibility.
 */
export async function checkApiHealth(): Promise<{ exists: boolean; tableCount: number; latestTable: string | null }> {
    try {
        const response = await getClient().properties.runReport({
            property: PROPERTY,
            requestBody: {
                dateRanges: [{ startDate: 'today', endDate: 'today' }],
                metrics: [{ name: 'sessions' }],
            },
        });
        const sessions = Number(response.data.rows?.[0]?.metricValues?.[0]?.value ?? 0);
        return { exists: true, tableCount: 1, latestTable: `GA4 API (${sessions} sessions today)` };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error({ error: msg }, 'GA4 API health check failed');
        return { exists: false, tableCount: 0, latestTable: null };
    }
}
