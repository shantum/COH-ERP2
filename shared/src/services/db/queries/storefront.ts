/**
 * Storefront Analytics — Kysely Queries
 *
 * Aggregation queries against StorefrontEvent for the Storefront Live dashboard.
 * First-party, unsampled replacement for GA4 storefront analytics.
 *
 * ⚠️  DYNAMIC IMPORTS ONLY — DO NOT USE STATIC IMPORTS ⚠️
 * Uses `await import('kysely')` for sql template tag.
 * Static imports would break client bundling.
 */

import { getKysely } from '../kysely.js';

// ============================================
// OUTPUT TYPES
// ============================================

export interface HeroMetrics {
    sessions: number;
    visitors: number;
    pageViews: number;
    productViews: number;
    addToCarts: number;
    checkouts: number;
    purchases: number;
    revenue: number;
    orderCount: number;
    prevSessions: number;
    prevVisitors: number;
    prevPageViews: number;
    prevProductViews: number;
    prevAddToCarts: number;
    prevCheckouts: number;
    prevPurchases: number;
    prevRevenue: number;
    prevOrderCount: number;
}

export interface OnSiteNow {
    total: number;
    mobile: number;
    desktop: number;
    tablet: number;
}

export interface ProductFunnelRow {
    productTitle: string;
    gender: string | null;
    imageUrl: string | null;
    views: number;
    atcCount: number;
    purchases: number;
    revenue: number;
    netConversion: number;
}

export interface ProductVariantRow {
    color: string;
    size: string;
    views: number;
    atcCount: number;
    purchases: number;
    revenue: number;
}

export interface LiveFeedEvent {
    id: string;
    eventName: string;
    eventTime: Date;
    createdAt: Date;
    sessionId: string;
    visitorId: string;
    pageUrl: string | null;
    productTitle: string | null;
    searchQuery: string | null;
    cartValue: number | null;
    orderValue: number | null;
    deviceType: string | null;
    country: string | null;
    region: string | null;
    utmSource: string | null;
}

export interface TrafficSourceRow {
    source: string;
    sessions: number;
    atcCount: number;
    orders: number;
    revenue: number;
}

export interface CampaignAttributionRow {
    utmSource: string;
    utmMedium: string | null;
    utmCampaign: string;
    clicks: number;
    atcCount: number;
    orders: number;
    revenue: number;
    conversionRate: number;
}

export interface GeoBreakdownRow {
    country: string | null;
    region: string | null;
    sessions: number;
    pageViews: number;
    atcCount: number;
    orders: number;
    revenue: number;
}

export interface TopPageRow {
    pageUrl: string;
    views: number;
    uniqueViews: number;
}

export interface TopSearchRow {
    searchQuery: string;
    count: number;
}

export interface DeviceBreakdownRow {
    deviceType: string;
    sessions: number;
}

// ============================================
// QUERIES
// ============================================

/**
 * Hero metrics — single query with FILTER clauses for current + previous period.
 */
export async function getHeroMetrics(days: number): Promise<HeroMetrics> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<HeroMetrics>`
        SELECT
            -- Current period
            COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= now() - make_interval(days => ${days}))::int AS "sessions",
            COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= now() - make_interval(days => ${days}))::int AS "visitors",
            COUNT(*) FILTER (WHERE "eventName" = 'page_viewed' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "pageViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_viewed' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "productViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "addToCarts",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_started' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "checkouts",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "purchases",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days})), 0)::numeric AS "revenue",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "orderCount",
            -- Previous period (for delta comparison)
            COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevSessions",
            COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevVisitors",
            COUNT(*) FILTER (WHERE "eventName" = 'page_viewed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevPageViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_viewed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevProductViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevAddToCarts",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_started' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevCheckouts",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevPurchases",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days})), 0)::numeric AS "prevRevenue",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevOrderCount"
        FROM "StorefrontEvent"
        WHERE "createdAt" >= now() - make_interval(days => ${days * 2})
    `.execute(db);

    const r = result.rows[0];
    return {
        sessions: r?.sessions ?? 0,
        visitors: r?.visitors ?? 0,
        pageViews: r?.pageViews ?? 0,
        productViews: r?.productViews ?? 0,
        addToCarts: r?.addToCarts ?? 0,
        checkouts: r?.checkouts ?? 0,
        purchases: r?.purchases ?? 0,
        revenue: Number(r?.revenue ?? 0),
        orderCount: r?.orderCount ?? 0,
        prevSessions: r?.prevSessions ?? 0,
        prevVisitors: r?.prevVisitors ?? 0,
        prevPageViews: r?.prevPageViews ?? 0,
        prevProductViews: r?.prevProductViews ?? 0,
        prevAddToCarts: r?.prevAddToCarts ?? 0,
        prevCheckouts: r?.prevCheckouts ?? 0,
        prevPurchases: r?.prevPurchases ?? 0,
        prevRevenue: Number(r?.prevRevenue ?? 0),
        prevOrderCount: r?.prevOrderCount ?? 0,
    };
}

/**
 * On-site now — unique sessions in the last 5 minutes, split by device type.
 */
export async function getOnSiteNow(): Promise<OnSiteNow> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<{ deviceType: string | null; count: number }>`
        SELECT "deviceType", COUNT(DISTINCT "sessionId")::int AS "count"
        FROM "StorefrontEvent"
        WHERE "createdAt" > now() - interval '5 minutes'
        GROUP BY "deviceType"
    `.execute(db);

    let total = 0, mobile = 0, desktop = 0, tablet = 0;
    for (const row of result.rows) {
        const c = row.count;
        total += c;
        const dt = (row.deviceType ?? '').toLowerCase();
        if (dt === 'mobile') mobile += c;
        else if (dt === 'desktop') desktop += c;
        else if (dt === 'tablet') tablet += c;
    }

    return { total, mobile, desktop, tablet };
}

/**
 * Product funnel — views → ATC → purchase with conversion rates.
 */
export async function getProductFunnel(days: number, limit = 10): Promise<ProductFunnelRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<ProductFunnelRow>`
        SELECT
            se."productTitle",
            p."gender",
            MIN(p."imageUrl") AS "imageUrl",
            COUNT(*) FILTER (WHERE se."eventName" = 'product_viewed')::int AS "views",
            COUNT(*) FILTER (WHERE se."eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE se."eventName" = 'checkout_completed')::int AS "purchases",
            COALESCE(SUM(se."orderValue") FILTER (WHERE se."eventName" = 'checkout_completed'), 0)::numeric AS "revenue",
            CASE
                WHEN COUNT(*) FILTER (WHERE se."eventName" = 'product_viewed') = 0 THEN 0
                ELSE ROUND(
                    COUNT(*) FILTER (WHERE se."eventName" = 'checkout_completed')::numeric /
                    COUNT(*) FILTER (WHERE se."eventName" = 'product_viewed')::numeric * 100, 2
                )
            END AS "netConversion"
        FROM "StorefrontEvent" se
        LEFT JOIN "Product" p ON se."productId" = p."shopifyProductId"
        WHERE se."productTitle" IS NOT NULL
          AND se."createdAt" >= now() - make_interval(days => ${days})
        GROUP BY se."productTitle", p."gender"
        ORDER BY COUNT(*) FILTER (WHERE se."eventName" = 'product_viewed') DESC
        LIMIT ${limit}
    `.execute(db);

    return result.rows.map(r => ({
        ...r,
        revenue: Number(r.revenue),
        netConversion: Number(r.netConversion),
    }));
}

/**
 * Product variant breakdown — views/ATC/purchases per variant for a specific product.
 */
export async function getProductVariantBreakdown(
    productTitle: string,
    gender: string | null,
    days: number,
): Promise<ProductVariantRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<ProductVariantRow>`
        SELECT
            COALESCE(SPLIT_PART(se."variantTitle", ' / ', 1), 'Unknown') AS "color",
            COALESCE(NULLIF(SPLIT_PART(se."variantTitle", ' / ', 2), ''), '-') AS "size",
            COUNT(*) FILTER (WHERE se."eventName" = 'product_viewed')::int AS "views",
            COUNT(*) FILTER (WHERE se."eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE se."eventName" = 'checkout_completed')::int AS "purchases",
            COALESCE(SUM(se."orderValue") FILTER (WHERE se."eventName" = 'checkout_completed'), 0)::numeric AS "revenue"
        FROM "StorefrontEvent" se
        LEFT JOIN "Product" p ON se."productId" = p."shopifyProductId"
        WHERE se."productTitle" = ${productTitle}
          AND (${gender}::text IS NULL AND p."gender" IS NULL OR p."gender" = ${gender})
          AND se."createdAt" >= now() - make_interval(days => ${days})
        GROUP BY "color", "size"
        ORDER BY "color", COUNT(*) FILTER (WHERE se."eventName" = 'product_viewed') DESC
    `.execute(db);

    return result.rows.map(r => ({
        ...r,
        revenue: Number(r.revenue),
    }));
}

/**
 * Live feed — latest events for the activity stream.
 */
export async function getLiveFeed(limit = 20): Promise<LiveFeedEvent[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<LiveFeedEvent>`
        SELECT "id", "eventName", "eventTime", "createdAt", "sessionId", "visitorId",
               "pageUrl", "productTitle", "searchQuery", "cartValue", "orderValue",
               "deviceType", "country", "region", "utmSource"
        FROM "StorefrontEvent"
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
    `.execute(db);

    return result.rows;
}

/**
 * Traffic sources — sessions, ATC, orders, revenue by source.
 */
export async function getTrafficSources(days: number): Promise<TrafficSourceRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<TrafficSourceRow>`
        SELECT
            COALESCE("utmSource", 'direct') AS "source",
            COUNT(DISTINCT "sessionId")::int AS "sessions",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed')::int AS "orders",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed'), 0)::numeric AS "revenue"
        FROM "StorefrontEvent"
        WHERE "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY COALESCE("utmSource", 'direct')
        ORDER BY COUNT(DISTINCT "sessionId") DESC
    `.execute(db);

    return result.rows.map(r => ({ ...r, revenue: Number(r.revenue) }));
}

/**
 * Campaign attribution — grouped by source/medium/campaign.
 */
export async function getCampaignAttribution(days: number): Promise<CampaignAttributionRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<CampaignAttributionRow>`
        SELECT
            "utmSource",
            "utmMedium",
            "utmCampaign",
            COUNT(DISTINCT "sessionId")::int AS "clicks",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed')::int AS "orders",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed'), 0)::numeric AS "revenue",
            CASE
                WHEN COUNT(DISTINCT "sessionId") = 0 THEN 0
                ELSE ROUND(
                    COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed')::numeric /
                    COUNT(DISTINCT "sessionId")::numeric * 100, 2
                )
            END AS "conversionRate"
        FROM "StorefrontEvent"
        WHERE "utmCampaign" IS NOT NULL
          AND "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY "utmSource", "utmMedium", "utmCampaign"
        ORDER BY COUNT(DISTINCT "sessionId") DESC
    `.execute(db);

    return result.rows.map(r => ({
        ...r,
        revenue: Number(r.revenue),
        conversionRate: Number(r.conversionRate),
    }));
}

/**
 * Geographic breakdown — sessions, ATC, orders by country/region.
 */
export async function getGeoBreakdown(days: number, limit = 10): Promise<GeoBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<GeoBreakdownRow>`
        SELECT
            "country",
            "region",
            COUNT(DISTINCT "sessionId")::int AS "sessions",
            COUNT(*) FILTER (WHERE "eventName" = 'page_viewed')::int AS "pageViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed')::int AS "orders",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed'), 0)::numeric AS "revenue"
        FROM "StorefrontEvent"
        WHERE "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY "country", "region"
        ORDER BY COUNT(DISTINCT "sessionId") DESC
        LIMIT ${limit}
    `.execute(db);

    return result.rows.map(r => ({ ...r, revenue: Number(r.revenue) }));
}

/**
 * Top pages — page views and unique views.
 */
export async function getTopPages(days: number, limit = 10): Promise<TopPageRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<TopPageRow>`
        SELECT
            "pageUrl",
            COUNT(*)::int AS "views",
            COUNT(DISTINCT "sessionId")::int AS "uniqueViews"
        FROM "StorefrontEvent"
        WHERE "eventName" = 'page_viewed'
          AND "pageUrl" IS NOT NULL
          AND "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY "pageUrl"
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `.execute(db);

    return result.rows;
}

/**
 * Top searches — search queries by count.
 */
export async function getTopSearches(days: number, limit = 10): Promise<TopSearchRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<TopSearchRow>`
        SELECT
            "searchQuery",
            COUNT(*)::int AS "count"
        FROM "StorefrontEvent"
        WHERE "eventName" = 'search_submitted'
          AND "searchQuery" IS NOT NULL
          AND "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY "searchQuery"
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `.execute(db);

    return result.rows;
}

/**
 * Device breakdown — session counts by device type.
 */
export async function getDeviceBreakdown(days: number): Promise<DeviceBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<DeviceBreakdownRow>`
        SELECT
            COALESCE("deviceType", 'unknown') AS "deviceType",
            COUNT(DISTINCT "sessionId")::int AS "sessions"
        FROM "StorefrontEvent"
        WHERE "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY COALESCE("deviceType", 'unknown')
        ORDER BY COUNT(DISTINCT "sessionId") DESC
    `.execute(db);

    return result.rows;
}
