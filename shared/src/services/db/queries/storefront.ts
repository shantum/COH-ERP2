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
    purchases: number;
    revenue: number;
    orderCount: number;
    prevSessions: number;
    prevVisitors: number;
    prevPageViews: number;
    prevProductViews: number;
    prevAddToCarts: number;
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
    imageUrl: string | null;
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
    pageTitle: string | null;
    productTitle: string | null;
    variantTitle: string | null;
    collectionTitle: string | null;
    productId: string | null;
    searchQuery: string | null;
    cartValue: number | null;
    orderValue: number | null;
    deviceType: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    utmSource: string | null;
    utmCampaign: string | null;
    imageUrl: string | null;
    asOrganization: string | null;
    isVpn: boolean | null;
    browser: string | null;
    os: string | null;
    fbclid: string | null;
    gclid: string | null;
    browserTimezone: string | null;
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
    city: string | null;
    latitude: string | null;
    longitude: string | null;
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

export interface VisitorSummary {
    visitorId: string;
    sessionCount: number;
    eventCount: number;
    firstSeen: Date;
    lastSeen: Date;
    lastEvent: string;
    source: string | null;
    campaign: string | null;
    deviceType: string | null;
    city: string | null;
    country: string | null;
    maxFunnelStep: number;  // 0=browse, 1=ATC, 2=checkout, 3=purchased
    totalCartValue: number | null;
    totalOrderValue: number | null;
    fbclid: string | null;
    gclid: string | null;
}

export interface VisitorEvent {
    id: string;
    eventName: string;
    eventTime: Date;
    sessionId: string;
    pageUrl: string | null;
    pageTitle: string | null;
    productTitle: string | null;
    variantTitle: string | null;
    collectionTitle: string | null;
    searchQuery: string | null;
    cartValue: number | null;
    orderValue: number | null;
    imageUrl: string | null;
}

export interface VisitorSession {
    sessionId: string;
    source: string | null;
    campaign: string | null;
    deviceType: string | null;
    city: string | null;
    country: string | null;
    landingUrl: string | null;
    asOrganization: string | null;
    isVpn: boolean | null;
    browser: string | null;
    os: string | null;
    startTime: Date;
}

export interface VisitorDetail {
    visitorId: string;
    sessions: VisitorSession[];
    events: VisitorEvent[];
    matchedOrders: { orderId: string; orderNumber: string; customerName: string; amount: number; orderDate: Date }[];
}

export interface ClickIdBreakdown {
    platform: string;
    sessions: number;
    atcCount: number;
    orders: number;
    revenue: number;
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
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "purchases",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days})), 0)::numeric AS "revenue",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed' AND "createdAt" >= now() - make_interval(days => ${days}))::int AS "orderCount",
            -- Previous period (for delta comparison)
            COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevSessions",
            COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevVisitors",
            COUNT(*) FILTER (WHERE "eventName" = 'page_viewed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevPageViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_viewed' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevProductViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart' AND "createdAt" >= now() - make_interval(days => ${days * 2}) AND "createdAt" < now() - make_interval(days => ${days}))::int AS "prevAddToCarts",
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
        purchases: r?.purchases ?? 0,
        revenue: Number(r?.revenue ?? 0),
        orderCount: r?.orderCount ?? 0,
        prevSessions: r?.prevSessions ?? 0,
        prevVisitors: r?.prevVisitors ?? 0,
        prevPageViews: r?.prevPageViews ?? 0,
        prevProductViews: r?.prevProductViews ?? 0,
        prevAddToCarts: r?.prevAddToCarts ?? 0,
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
            MIN(p."imageUrl") AS "imageUrl",
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
        SELECT se."id", se."eventName", se."eventTime", se."createdAt",
               se."sessionId", se."visitorId", se."pageUrl", se."pageTitle",
               se."productTitle", se."variantTitle", se."collectionTitle",
               se."productId", se."searchQuery",
               se."cartValue", se."orderValue",
               se."deviceType", se."country", se."region", se."city",
               se."utmSource", se."utmCampaign",
               se."asOrganization", se."isVpn", se."browser", se."os",
               se.fbclid, se.gclid, se."browserTimezone",
               p."imageUrl"
        FROM "StorefrontEvent" se
        LEFT JOIN "Product" p ON se."productId" = p."shopifyProductId"
        WHERE NOT (
            se."eventName" = 'page_viewed'
            AND (se."pageUrl" LIKE '%/products/%' OR se."pageUrl" LIKE '%/collections/%')
        )
        ORDER BY se."createdAt" DESC
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
 * Geographic breakdown — sessions, ATC, orders by country/region/city.
 */
export async function getGeoBreakdown(days: number, limit = 10): Promise<GeoBreakdownRow[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<GeoBreakdownRow>`
        SELECT
            "country",
            "region",
            "city",
            (array_agg(latitude ORDER BY "eventTime" DESC) FILTER (WHERE latitude IS NOT NULL))[1] AS "latitude",
            (array_agg(longitude ORDER BY "eventTime" DESC) FILTER (WHERE longitude IS NOT NULL))[1] AS "longitude",
            COUNT(DISTINCT "sessionId")::int AS "sessions",
            COUNT(*) FILTER (WHERE "eventName" = 'page_viewed')::int AS "pageViews",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed')::int AS "orders",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed'), 0)::numeric AS "revenue"
        FROM "StorefrontEvent"
        WHERE "createdAt" >= now() - make_interval(days => ${days})
        GROUP BY "country", "region", "city"
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

/**
 * Visitor list — paginated, aggregated visitor summaries with optional filters.
 * Filters are applied in application code to avoid dynamic SQL injection risks.
 */
export async function getVisitorList(
    days: number,
    limit = 50,
    offset = 0,
    filter?: { status?: string; source?: string; deviceType?: string },
): Promise<VisitorSummary[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // Fetch a generous batch from the CTE, then filter + paginate in JS.
    // The CTE is bounded by the day range so the result set is manageable.
    const batchLimit = 2000;

    const result = await sql<VisitorSummary>`
        WITH visitor_agg AS (
            SELECT
                "visitorId",
                COUNT(DISTINCT "sessionId")::int AS "sessionCount",
                COUNT(*)::int AS "eventCount",
                MIN("eventTime") AS "firstSeen",
                MAX("eventTime") AS "lastSeen",
                CASE
                    WHEN COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed') > 0 THEN 2
                    WHEN COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart') > 0 THEN 1
                    ELSE 0
                END AS "maxFunnelStep",
                MAX("cartValue") AS "totalCartValue",
                MAX("orderValue") AS "totalOrderValue",
                (array_agg("utmSource" ORDER BY "eventTime") FILTER (WHERE "utmSource" IS NOT NULL))[1] AS "source",
                (array_agg("utmCampaign" ORDER BY "eventTime") FILTER (WHERE "utmCampaign" IS NOT NULL))[1] AS "campaign",
                (array_agg("deviceType" ORDER BY "eventTime") FILTER (WHERE "deviceType" IS NOT NULL))[1] AS "deviceType",
                (array_agg("city" ORDER BY "eventTime" DESC) FILTER (WHERE "city" IS NOT NULL))[1] AS "city",
                (array_agg("country" ORDER BY "eventTime" DESC) FILTER (WHERE "country" IS NOT NULL))[1] AS "country",
                (array_agg(fbclid ORDER BY "eventTime") FILTER (WHERE fbclid IS NOT NULL))[1] AS "fbclid",
                (array_agg(gclid ORDER BY "eventTime") FILTER (WHERE gclid IS NOT NULL))[1] AS "gclid",
                (array_agg("eventName" ORDER BY "eventTime" DESC))[1] AS "lastEvent"
            FROM "StorefrontEvent"
            WHERE "createdAt" >= now() - make_interval(days => ${days})
            GROUP BY "visitorId"
        )
        SELECT * FROM visitor_agg
        ORDER BY "lastSeen" DESC
        LIMIT ${batchLimit}
    `.execute(db);

    // Apply filters in application code
    let filtered = result.rows.map(r => ({
        ...r,
        maxFunnelStep: Number(r.maxFunnelStep),
        totalCartValue: r.totalCartValue != null ? Number(r.totalCartValue) : null,
        totalOrderValue: r.totalOrderValue != null ? Number(r.totalOrderValue) : null,
    }));

    if (filter?.status === 'converted') {
        filtered = filtered.filter(r => r.maxFunnelStep === 3);
    } else if (filter?.status === 'atc') {
        filtered = filtered.filter(r => r.maxFunnelStep === 1 || r.maxFunnelStep === 2);
    } else if (filter?.status === 'browsing') {
        filtered = filtered.filter(r => r.maxFunnelStep === 0);
    }

    if (filter?.source === 'paid') {
        filtered = filtered.filter(r => r.source != null);
    } else if (filter?.source === 'direct') {
        filtered = filtered.filter(r => r.source == null && r.fbclid == null && r.gclid == null);
    }

    if (filter?.deviceType) {
        filtered = filtered.filter(r => r.deviceType === filter.deviceType);
    }

    return filtered.slice(offset, offset + limit);
}

/**
 * Visitor detail — full event history, session metadata, and matched orders for a single visitor.
 */
export async function getVisitorDetail(visitorId: string): Promise<VisitorDetail> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    // 1. All events for this visitor
    const eventsResult = await sql<VisitorEvent>`
        SELECT
            se."id",
            se."eventName",
            se."eventTime",
            se."sessionId",
            se."pageUrl",
            se."pageTitle",
            se."productTitle",
            se."variantTitle",
            se."collectionTitle",
            se."searchQuery",
            se."cartValue",
            se."orderValue",
            p."imageUrl"
        FROM "StorefrontEvent" se
        LEFT JOIN "Product" p ON se."productId" = p."shopifyProductId"
        WHERE se."visitorId" = ${visitorId}
        ORDER BY se."eventTime" ASC
    `.execute(db);

    const events = eventsResult.rows.map(r => ({
        ...r,
        cartValue: r.cartValue != null ? Number(r.cartValue) : null,
        orderValue: r.orderValue != null ? Number(r.orderValue) : null,
    }));

    // 2. Session metadata — first event per session for source/device/geo
    const sessionsResult = await sql<VisitorSession>`
        SELECT DISTINCT ON ("sessionId")
            "sessionId",
            "utmSource" AS "source",
            "utmCampaign" AS "campaign",
            "deviceType",
            "city",
            "country",
            "pageUrl" AS "landingUrl",
            "asOrganization",
            "isVpn",
            "browser",
            "os",
            "eventTime" AS "startTime"
        FROM "StorefrontEvent"
        WHERE "visitorId" = ${visitorId}
        ORDER BY "sessionId", "eventTime" ASC
    `.execute(db);

    // 3. Match orders — find orders where checkout_completed events have an orderId in rawData
    let matchedOrders: { orderId: string; orderNumber: string; customerName: string; amount: number; orderDate: Date }[] = [];
    try {
        const ordersResult = await sql<{ orderId: string; orderNumber: string; customerName: string; amount: number; orderDate: Date }>`
            SELECT DISTINCT
                o."id" AS "orderId",
                o."orderNumber"::text AS "orderNumber",
                COALESCE(o."customerFirstName" || ' ' || o."customerLastName", '') AS "customerName",
                o."totalPrice"::numeric AS "amount",
                o."orderDate"
            FROM "StorefrontEvent" se
            JOIN "Order" o ON o."shopifyOrderId" = se."rawData"->>'orderId'
            WHERE se."visitorId" = ${visitorId}
              AND se."eventName" = 'checkout_completed'
              AND se."rawData"->>'orderId' IS NOT NULL
        `.execute(db);

        matchedOrders = ordersResult.rows.map(r => ({
            ...r,
            amount: Number(r.amount),
        }));
    } catch (error: unknown) {
        console.error('[Storefront] Order matching failed:', error instanceof Error ? error.message : error);
    }

    return {
        visitorId,
        sessions: sessionsResult.rows,
        events,
        matchedOrders,
    };
}

/**
 * Click ID breakdown — sessions, ATC, orders, revenue grouped by click ID platform.
 */
export async function getClickIdBreakdown(days: number): Promise<ClickIdBreakdown[]> {
    const db = await getKysely();
    const { sql } = await import('kysely');

    const result = await sql<ClickIdBreakdown>`
        SELECT
            platform,
            COUNT(DISTINCT "sessionId")::int AS "sessions",
            COUNT(*) FILTER (WHERE "eventName" = 'product_added_to_cart')::int AS "atcCount",
            COUNT(*) FILTER (WHERE "eventName" = 'checkout_completed')::int AS "orders",
            COALESCE(SUM("orderValue") FILTER (WHERE "eventName" = 'checkout_completed'), 0)::numeric AS "revenue"
        FROM (
            SELECT *,
                CASE
                    WHEN fbclid IS NOT NULL THEN 'facebook'
                    WHEN gclid IS NOT NULL THEN 'google'
                    WHEN ttclid IS NOT NULL THEN 'tiktok'
                    WHEN msclkid IS NOT NULL THEN 'microsoft'
                    WHEN gbraid IS NOT NULL OR wbraid IS NOT NULL THEN 'google (app)'
                    ELSE 'none'
                END AS platform
            FROM "StorefrontEvent"
            WHERE "createdAt" >= now() - make_interval(days => ${days})
        ) sub
        WHERE platform != 'none'
        GROUP BY platform
        ORDER BY COUNT(DISTINCT "sessionId") DESC
    `.execute(db);

    return result.rows.map(r => ({ ...r, revenue: Number(r.revenue) }));
}
