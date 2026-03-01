/**
 * GA4 Growth Analytics Server Functions
 *
 * Queries GA4 event data from BigQuery for the growth analytics dashboard.
 * All queries combine daily + intraday tables for complete coverage.
 *
 * IMPORTANT: BigQuery imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RESPONSE TYPES
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
// INPUT SCHEMAS
// ============================================

const daysInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
});

const landingPagesInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(200).default(50),
});

const geoInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(200).default(50),
});

// ============================================
// HELPERS
// ============================================

async function getBqClient() {
    const { runQuery, getDateRange, buildEventsQuery } = await import('@server/services/bigqueryClient.js');
    return { runQuery, getDateRange, buildEventsQuery };
}

function safeDiv(numerator: number, denominator: number): number {
    return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Conversion Funnel — sessions → add_to_cart → checkout → purchase
 */
export const getConversionFunnel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<ConversionFunnelResponse> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `event_date AS date,
             COUNTIF(event_name = 'session_start') AS sessions,
             COUNTIF(event_name = 'add_to_cart') AS addToCarts,
             COUNTIF(event_name = 'begin_checkout') AS checkouts,
             COUNTIF(event_name = 'purchase') AS purchases,
             SUM(IF(event_name = 'purchase', ecommerce.purchase_revenue, 0)) AS revenue`,
            `event_name IN ('session_start', 'add_to_cart', 'begin_checkout', 'purchase')`,
            `event_date`,
            `event_date`,
            startDate,
            endDate,
        );

        const rows = await runQuery<{
            date: string; sessions: number; addToCarts: number;
            checkouts: number; purchases: number; revenue: number;
        }>(sql, {
            cacheKey: `ga4:funnel:${data.days}`,
            cacheTtl: 5 * 60 * 1000,
        });

        const daily: FunnelDay[] = rows.map(r => ({
            date: r.date,
            sessions: Number(r.sessions),
            addToCarts: Number(r.addToCarts),
            checkouts: Number(r.checkouts),
            purchases: Number(r.purchases),
            revenue: Number(r.revenue),
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
                ...totals,
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
    });

/**
 * Landing Page Performance
 */
export const getLandingPages = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => landingPagesInputSchema.parse(input))
    .handler(async ({ data }): Promise<LandingPageRow[]> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS landingPage,
             COUNT(DISTINCT user_pseudo_id) AS users,
             COUNTIF(event_name = 'session_start') AS sessions,
             COUNTIF(event_name = 'purchase') AS purchases,
             SUM(IF(event_name = 'purchase', ecommerce.purchase_revenue, 0)) AS revenue`,
            `event_name IN ('session_start', 'page_view', 'purchase')`,
            `landingPage`,
            `sessions DESC LIMIT ${data.limit}`,
            startDate,
            endDate,
        );

        const rows = await runQuery<{
            landingPage: string | null; users: number; sessions: number;
            purchases: number; revenue: number;
        }>(sql, {
            cacheKey: `ga4:landing:${data.days}:${data.limit}`,
            cacheTtl: 5 * 60 * 1000,
        });

        return rows
            .filter(r => r.landingPage)
            .map(r => ({
                landingPage: r.landingPage!,
                sessions: Number(r.sessions),
                users: Number(r.users),
                purchases: Number(r.purchases),
                revenue: Number(r.revenue),
                conversionRate: safeDiv(Number(r.purchases), Number(r.sessions)),
            }));
    });

/**
 * Traffic Sources — source/medium breakdown
 */
export const getTrafficSources = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<TrafficSourceRow[]> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `traffic_source.source AS source,
             traffic_source.medium AS medium,
             COUNT(DISTINCT user_pseudo_id) AS users,
             COUNTIF(event_name = 'session_start') AS sessions,
             COUNTIF(event_name = 'purchase') AS purchases,
             SUM(IF(event_name = 'purchase', ecommerce.purchase_revenue, 0)) AS revenue`,
            `event_name IN ('session_start', 'purchase')`,
            `traffic_source.source, traffic_source.medium`,
            `sessions DESC`,
            startDate,
            endDate,
        );

        const rows = await runQuery<{
            source: string | null; medium: string | null; users: number;
            sessions: number; purchases: number; revenue: number;
        }>(sql, {
            cacheKey: `ga4:sources:${data.days}`,
            cacheTtl: 5 * 60 * 1000,
        });

        return rows.map(r => ({
            source: r.source ?? '(direct)',
            medium: r.medium ?? '(none)',
            sessions: Number(r.sessions),
            users: Number(r.users),
            purchases: Number(r.purchases),
            revenue: Number(r.revenue),
            conversionRate: safeDiv(Number(r.purchases), Number(r.sessions)),
        }));
    });

/**
 * Campaign Performance
 */
export const getCampaigns = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<CampaignRow[]> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `traffic_source.name AS campaign,
             traffic_source.source AS source,
             traffic_source.medium AS medium,
             COUNT(DISTINCT user_pseudo_id) AS users,
             COUNTIF(event_name = 'purchase') AS purchases,
             SUM(IF(event_name = 'purchase', ecommerce.purchase_revenue, 0)) AS revenue`,
            `event_name IN ('session_start', 'purchase')
             AND traffic_source.name IS NOT NULL
             AND traffic_source.name != '(not set)'`,
            `traffic_source.name, traffic_source.source, traffic_source.medium`,
            `revenue DESC`,
            startDate,
            endDate,
        );

        const rows = await runQuery<{
            campaign: string; source: string; medium: string;
            users: number; purchases: number; revenue: number;
        }>(sql, {
            cacheKey: `ga4:campaigns:${data.days}`,
            cacheTtl: 5 * 60 * 1000,
        });

        return rows.map(r => ({
            campaign: r.campaign,
            source: r.source ?? '(direct)',
            medium: r.medium ?? '(none)',
            users: Number(r.users),
            purchases: Number(r.purchases),
            revenue: Number(r.revenue),
            conversionRate: safeDiv(Number(r.purchases), Number(r.users)),
        }));
    });

/**
 * Geographic Conversion — by city (India only)
 */
export const getGeoConversion = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => geoInputSchema.parse(input))
    .handler(async ({ data }): Promise<GeoRow[]> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `geo.city AS city,
             geo.region AS region,
             COUNT(DISTINCT user_pseudo_id) AS users,
             COUNTIF(event_name = 'session_start') AS sessions,
             COUNTIF(event_name = 'purchase') AS purchases,
             SUM(IF(event_name = 'purchase', ecommerce.purchase_revenue, 0)) AS revenue`,
            `event_name IN ('session_start', 'purchase')
             AND geo.country = 'India'
             AND geo.city IS NOT NULL
             AND geo.city != '(not set)'`,
            `geo.city, geo.region`,
            `sessions DESC LIMIT ${data.limit}`,
            startDate,
            endDate,
        );

        const rows = await runQuery<{
            city: string; region: string; users: number;
            sessions: number; purchases: number; revenue: number;
        }>(sql, {
            cacheKey: `ga4:geo:${data.days}:${data.limit}`,
            cacheTtl: 5 * 60 * 1000,
        });

        return rows.map(r => ({
            city: r.city,
            region: r.region ?? '',
            sessions: Number(r.sessions),
            users: Number(r.users),
            purchases: Number(r.purchases),
            revenue: Number(r.revenue),
            conversionRate: safeDiv(Number(r.purchases), Number(r.sessions)),
        }));
    });

/**
 * Device Breakdown — mobile/desktop/tablet
 */
export const getDeviceBreakdown = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<DeviceRow[]> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `device.category AS device,
             COUNT(DISTINCT user_pseudo_id) AS users,
             COUNTIF(event_name = 'session_start') AS sessions,
             COUNTIF(event_name = 'purchase') AS purchases`,
            `event_name IN ('session_start', 'purchase')`,
            `device.category`,
            `sessions DESC`,
            startDate,
            endDate,
        );

        const rows = await runQuery<{
            device: string; users: number; sessions: number; purchases: number;
        }>(sql, {
            cacheKey: `ga4:device:${data.days}`,
            cacheTtl: 5 * 60 * 1000,
        });

        return rows.map(r => ({
            device: r.device ?? 'unknown',
            sessions: Number(r.sessions),
            users: Number(r.users),
            purchases: Number(r.purchases),
            conversionRate: safeDiv(Number(r.purchases), Number(r.sessions)),
        }));
    });

/**
 * Growth Overview — KPI summary for the overview tab
 */
export const getGrowthOverview = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<GrowthOverview> => {
        const { runQuery, getDateRange, buildEventsQuery } = await getBqClient();
        const { startDate, endDate } = getDateRange(data.days);

        const sql = buildEventsQuery(
            `COUNT(DISTINCT IF(event_name = 'session_start', CONCAT(user_pseudo_id, CAST(event_timestamp AS STRING)), NULL)) AS totalSessions,
             COUNT(DISTINCT IF(event_name = 'purchase', CONCAT(user_pseudo_id, CAST(event_timestamp AS STRING)), NULL)) AS totalPurchases,
             SUM(IF(event_name = 'purchase', ecommerce.purchase_revenue, 0)) AS totalRevenue`,
            `event_name IN ('session_start', 'purchase')`,
            ``,
            ``,
            startDate,
            endDate,
        );

        // Also get top source, city, landing page
        const topSourceSql = buildEventsQuery(
            `traffic_source.source AS source,
             COUNTIF(event_name = 'session_start') AS sessions`,
            `event_name = 'session_start'
             AND traffic_source.source IS NOT NULL
             AND traffic_source.source != '(direct)'`,
            `traffic_source.source`,
            `sessions DESC LIMIT 1`,
            startDate,
            endDate,
        );

        const topCitySql = buildEventsQuery(
            `geo.city AS city,
             COUNTIF(event_name = 'session_start') AS sessions`,
            `event_name = 'session_start'
             AND geo.country = 'India'
             AND geo.city IS NOT NULL AND geo.city != '(not set)'`,
            `geo.city`,
            `sessions DESC LIMIT 1`,
            startDate,
            endDate,
        );

        const topPageSql = buildEventsQuery(
            `(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page,
             COUNTIF(event_name = 'session_start') AS sessions`,
            `event_name = 'session_start'`,
            `page`,
            `sessions DESC LIMIT 1`,
            startDate,
            endDate,
        );

        const [overview, topSource, topCity, topPage] = await Promise.all([
            runQuery<{ totalSessions: number; totalPurchases: number; totalRevenue: number }>(sql, {
                cacheKey: `ga4:overview:main:${data.days}`,
                cacheTtl: 5 * 60 * 1000,
            }),
            runQuery<{ source: string; sessions: number }>(topSourceSql, {
                cacheKey: `ga4:overview:source:${data.days}`,
                cacheTtl: 5 * 60 * 1000,
            }),
            runQuery<{ city: string; sessions: number }>(topCitySql, {
                cacheKey: `ga4:overview:city:${data.days}`,
                cacheTtl: 5 * 60 * 1000,
            }),
            runQuery<{ page: string; sessions: number }>(topPageSql, {
                cacheKey: `ga4:overview:page:${data.days}`,
                cacheTtl: 5 * 60 * 1000,
            }),
        ]);

        const o = overview[0];
        const sessions = Number(o?.totalSessions ?? 0);
        const purchases = Number(o?.totalPurchases ?? 0);
        const revenue = Number(o?.totalRevenue ?? 0);

        return {
            totalSessions: sessions,
            totalPurchases: purchases,
            overallConversionRate: safeDiv(purchases, sessions),
            totalRevenue: revenue,
            avgOrderValue: purchases > 0 ? Math.round(revenue / purchases) : 0,
            topSource: topSource[0]?.source ?? '-',
            topCity: topCity[0]?.city ?? '-',
            topLandingPage: topPage[0]?.page ?? '-',
        };
    });

/**
 * Dataset Health Check — verify BQ data is flowing
 */
export const getGA4Health = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { checkDatasetHealth } = await import('@server/services/bigqueryClient.js');
        return checkDatasetHealth();
    });
