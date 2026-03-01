/**
 * Google Ads BigQuery Client
 *
 * Reads Google Ads performance data from BigQuery Data Transfer tables.
 * Uses the same BigQuery singleton as GA4 analytics.
 *
 * Key schema notes:
 * - Cost fields are in micros (÷ 1,000,000 for INR)
 * - Stats tables have segments_date (DATE) for daily breakdowns
 * - Campaign dimension table has campaign_name, status, channel type
 * - Conversions are FLOAT (fractional attribution)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
    GOOGLE_ADS_PROJECT,
    GOOGLE_ADS_DATASET,
    GOOGLE_ADS_CUSTOMER_ID,
    GADS_CACHE_TTL,
} from '../config/googleAds.js';
import { runQuery } from './bigqueryClient.js';

// Lazy-loaded geo target name lookup (ID -> "City, State")
let _geoLookup: Record<string, string> | null = null;
function getGeoLookup(): Record<string, string> {
    if (!_geoLookup) {
        try {
            const dir = dirname(fileURLToPath(import.meta.url));
            const data = readFileSync(join(dir, '../config/geoTargets.json'), 'utf-8');
            _geoLookup = JSON.parse(data);
        } catch {
            _geoLookup = {};
        }
    }
    return _geoLookup!;
}

// ============================================
// HELPERS
// ============================================

function table(name: string): string {
    return `\`${GOOGLE_ADS_PROJECT}.${GOOGLE_ADS_DATASET}.ads_${name}_${GOOGLE_ADS_CUSTOMER_ID}\``;
}

/** Returns a SQL condition for filtering segments_date by the given day range. */
function dateFilterSQL(days: number, col = 'segments_date'): string {
    if (days === 1) return `${col} = CURRENT_DATE()`;                                    // Today only
    if (days === 2) return `${col} = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)`;          // Yesterday only
    return `${col} >= DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)`;                   // Last N days
}

// ============================================
// PUBLIC TYPES
// ============================================

export interface GAdsAccountSummary {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    cpc: number;
    ctr: number;
    roas: number;
}

export interface GAdsCampaignRow {
    campaignId: number;
    campaignName: string;
    channelType: string;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    cpc: number;
    ctr: number;
    roas: number;
}

export interface GAdsDailyRow {
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
}

export interface GAdsProductRow {
    productItemId: string;
    productBrand: string;
    productCategory: string;
    productType: string;
    productChannel: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    cpc: number;
    ctr: number;
    roas: number;
    impressionShare: number;
}

export interface GAdsGeoRow {
    locationId: string;
    locationName: string;
    campaignName: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    cpc: number;
    ctr: number;
    roas: number;
}

export interface GAdsHourlyRow {
    hour: number;
    dayOfWeek: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
}

export interface GAdsDeviceRow {
    device: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    cpc: number;
    ctr: number;
    roas: number;
}

export interface GAdsAgeRow {
    ageRange: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    roas: number;
}

export interface GAdsGenderRow {
    gender: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    roas: number;
}

export interface GAdsSearchTermRow {
    searchTerm: string;
    matchType: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GAdsKeywordRow {
    keyword: string;
    matchType: string;
    qualityScore: number | null;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GAdsLandingPageRow {
    landingPageUrl: string;
    campaignName: string;
    adGroupName: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
}

export interface GAdsImpressionShareRow {
    campaignId: number;
    campaignName: string;
    searchImpressionShare: number;
    budgetLostImpressionShare: number;
    rankLostImpressionShare: number;
    searchAbsoluteTopIS: number;
    searchTopIS: number;
}

export interface GAdsBudgetRow {
    campaignId: number;
    campaignName: string;
    dailyBudget: number;
    actualSpend: number;
    utilization: number;
    impressions: number;
    clicks: number;
    conversions: number;
    roas: number;
}

export interface GAdsCreativeRow {
    adId: number;
    adType: string;
    adStrength: string;
    headlines: string[];
    descriptions: string[];
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GAdsVideoRow {
    videoId: string;
    videoTitle: string;
    durationSec: number;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GAdsAssetGroupRow {
    assetGroupName: string;
    campaignName: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GAdsAudienceSegmentRow {
    campaignName: string;
    criterionId: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GAdsProductFunnelRow {
    productType: string;
    views: number;
    addToCarts: number;
    purchases: number;
    purchaseValue: number;
    viewToAtcRate: number;
    atcToPurchaseRate: number;
}

export interface GAdsSearchConversionRow {
    searchTerm: string;
    action: string;
    conversions: number;
    conversionValue: number;
}

export interface GAdsCampaignConversionRow {
    campaignName: string;
    action: string;
    conversions: number;
    conversionValue: number;
}

// ============================================
// QUERIES
// ============================================

/**
 * Account-level summary for the last N days.
 */
export async function getGAdsAccountSummary(days: number): Promise<GAdsAccountSummary> {
    const sql = `
SELECT
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('AccountBasicStats')}
WHERE ${dateFilterSQL(days)}
`;
    const rows = await runQuery<{
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:summary:${days}`, cacheTtl: GADS_CACHE_TTL });

    const r = rows[0];
    if (!r || !r.spend) {
        return { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, cpc: 0, ctr: 0, roas: 0 };
    }

    const spend = Number(r.spend);
    const clicks = Number(r.clicks);
    const impressions = Number(r.impressions);
    const conversions = Number(r.conversions);
    const conversionValue = Number(r.conversion_value);

    return {
        spend,
        impressions,
        clicks,
        conversions: Math.round(conversions * 100) / 100,
        conversionValue,
        cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
    };
}

/**
 * Campaign-level performance for the last N days.
 */
export async function getGAdsCampaigns(days: number): Promise<GAdsCampaignRow[]> {
    const sql = `
SELECT
    s.campaign_id,
    c.campaign_name,
    c.campaign_advertising_channel_type AS channel_type,
    c.campaign_status AS status,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('CampaignBasicStats')} s
JOIN ${table('Campaign')} c USING(campaign_id)
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2, 3, 4
ORDER BY spend DESC
`;
    const rows = await runQuery<{
        campaign_id: number; campaign_name: string; channel_type: string; status: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:campaigns:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);

        return {
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            channelType: r.channel_type?.replace('_', ' ') ?? '',
            status: r.status ?? '',
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Daily spend/performance trend for the last N days.
 */
export async function getGAdsDailyTrend(days: number): Promise<GAdsDailyRow[]> {
    const sql = `
SELECT
    CAST(segments_date AS STRING) AS date,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('AccountBasicStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY segments_date
ORDER BY segments_date
`;
    const rows = await runQuery<{
        date: string; impressions: number; clicks: number;
        spend: number; conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:daily:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        date: String(r.date),
        spend: Number(r.spend),
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        conversions: Math.round(Number(r.conversions) * 100) / 100,
        conversionValue: Number(r.conversion_value),
    }));
}

// ============================================
// LOOKUP MAPS
// ============================================

const AGE_MAP: Record<number, string> = {
    503001: '18-24', 503002: '25-34', 503003: '35-44',
    503004: '45-54', 503005: '55-64', 503006: '65+', 503999: 'Undetermined',
};

const GENDER_MAP: Record<number, string> = {
    10: 'Male', 11: 'Female', 20: 'Undetermined',
};

// ============================================
// EXTENDED QUERIES
// ============================================

/**
 * Shopping/PMax product-level performance.
 */
export async function getGAdsProducts(days: number): Promise<GAdsProductRow[]> {
    const sql = `
SELECT
    segments_product_item_id AS product_item_id,
    segments_product_brand AS product_brand,
    segments_product_category_level1 AS product_category,
    segments_product_type_l1 AS product_type,
    segments_product_channel AS product_channel,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value,
    AVG(metrics_search_impression_share) AS impression_share
FROM ${table('ShoppingProductStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1, 2, 3, 4, 5
HAVING spend > 0
ORDER BY spend DESC
LIMIT 500
`;
    const rows = await runQuery<{
        product_item_id: string | null; product_brand: string | null;
        product_category: string | null; product_type: string | null;
        product_channel: string | null; impressions: number; clicks: number;
        spend: number; conversions: number; conversion_value: number;
        impression_share: number | null;
    }>(sql, { cacheKey: `gads:products:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            productItemId: r.product_item_id ?? '(unknown)',
            productBrand: r.product_brand ?? '(unknown)',
            productCategory: r.product_category ?? '',
            productType: r.product_type ?? '',
            productChannel: r.product_channel ?? '',
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
            impressionShare: r.impression_share != null ? Math.round(Number(r.impression_share) * 10000) / 100 : 0,
        };
    });
}

/**
 * Geographic performance — aggregated by location × campaign.
 */
export async function getGAdsGeo(days: number): Promise<GAdsGeoRow[]> {
    const sql = `
SELECT
    g.segments_geo_target_most_specific_location AS location_id,
    c.campaign_name,
    SUM(g.metrics_impressions) AS impressions,
    SUM(g.metrics_clicks) AS clicks,
    SUM(g.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(g.metrics_conversions) AS conversions,
    SUM(g.metrics_conversions_value) AS conversion_value
FROM ${table('GeoStats')} g
JOIN ${table('Campaign')} c USING(campaign_id)
WHERE ${dateFilterSQL(days, 'g.segments_date')}
GROUP BY 1, 2
HAVING spend > 0
ORDER BY spend DESC
LIMIT 200
`;
    const rows = await runQuery<{
        location_id: string; campaign_name: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:geo:${days}`, cacheTtl: GADS_CACHE_TTL });

    const geo = getGeoLookup();
    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        const rawId = String(r.location_id).replace('geoTargetConstants/', '');
        return {
            locationId: rawId,
            locationName: geo[rawId] ?? rawId,
            campaignName: r.campaign_name,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Hourly performance — aggregated by hour × day-of-week.
 */
export async function getGAdsHourly(days: number): Promise<GAdsHourlyRow[]> {
    const sql = `
SELECT
    segments_hour AS hour,
    segments_day_of_week AS day_of_week,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('HourlyCampaignStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1, 2
ORDER BY 1, 2
`;
    const rows = await runQuery<{
        hour: number; day_of_week: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:hourly:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        return {
            hour: Number(r.hour),
            dayOfWeek: r.day_of_week,
            spend: Number(r.spend),
            impressions,
            clicks,
            conversions: Math.round(Number(r.conversions) * 100) / 100,
            conversionValue: Number(r.conversion_value),
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        };
    });
}

/**
 * Device breakdown — aggregated from CampaignBasicStats.
 */
export async function getGAdsDevices(days: number): Promise<GAdsDeviceRow[]> {
    const sql = `
SELECT
    segments_device AS device,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('CampaignBasicStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1
ORDER BY spend DESC
`;
    const rows = await runQuery<{
        device: string; impressions: number; clicks: number;
        spend: number; conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:devices:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            device: r.device ?? 'Unknown',
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Age range demographic performance.
 */
export async function getGAdsAge(days: number): Promise<GAdsAgeRow[]> {
    const sql = `
SELECT
    ad_group_criterion_criterion_id AS criterion_id,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('AgeRangeBasicStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1
ORDER BY spend DESC
`;
    const rows = await runQuery<{
        criterion_id: number; impressions: number; clicks: number;
        spend: number; conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:age:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            ageRange: AGE_MAP[r.criterion_id] ?? `Unknown (${r.criterion_id})`,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Gender demographic performance.
 */
export async function getGAdsGender(days: number): Promise<GAdsGenderRow[]> {
    const sql = `
SELECT
    ad_group_criterion_criterion_id AS criterion_id,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('GenderBasicStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1
ORDER BY spend DESC
`;
    const rows = await runQuery<{
        criterion_id: number; impressions: number; clicks: number;
        spend: number; conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:gender:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            gender: GENDER_MAP[r.criterion_id] ?? `Unknown (${r.criterion_id})`,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Search terms — what people actually typed before clicking.
 */
export async function getGAdsSearchTerms(days: number): Promise<GAdsSearchTermRow[]> {
    const sql = `
SELECT
    search_term_view_search_term AS search_term,
    segments_search_term_match_type AS match_type,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend,
    SUM(metrics_conversions) AS conversions,
    SUM(metrics_conversions_value) AS conversion_value
FROM ${table('SearchQueryStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1, 2
ORDER BY spend DESC
LIMIT 500
`;
    const rows = await runQuery<{
        search_term: string; match_type: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:search-terms:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            searchTerm: r.search_term,
            matchType: r.match_type?.replace('_', ' ') ?? '',
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Keywords — bid keywords with quality scores and performance.
 */
export async function getGAdsKeywords(days: number): Promise<GAdsKeywordRow[]> {
    const sql = `
SELECT
    k.ad_group_criterion_keyword_text AS keyword,
    k.ad_group_criterion_keyword_match_type AS match_type,
    k.ad_group_criterion_quality_info_quality_score AS quality_score,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('KeywordBasicStats')} s
JOIN ${table('Keyword')} k
    ON s.ad_group_criterion_criterion_id = k.ad_group_criterion_criterion_id
    AND s.ad_group_id = k.ad_group_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2, 3
ORDER BY spend DESC
LIMIT 500
`;
    const rows = await runQuery<{
        keyword: string; match_type: string; quality_score: number | null;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:keywords:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            keyword: r.keyword,
            matchType: r.match_type?.replace('_', ' ') ?? '',
            qualityScore: r.quality_score != null && r.quality_score > 0 ? Number(r.quality_score) : null,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Landing page performance from ads.
 */
export async function getGAdsLandingPages(days: number): Promise<GAdsLandingPageRow[]> {
    const sql = `
SELECT
    landing_page_view_unexpanded_final_url AS landing_page_url,
    campaign_name,
    ad_group_name,
    SUM(metrics_impressions) AS impressions,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_cost_micros) / 1000000.0 AS spend
FROM ${table('LandingPageStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1, 2, 3
HAVING clicks > 0
ORDER BY clicks DESC
LIMIT 200
`;
    const rows = await runQuery<{
        landing_page_url: string; campaign_name: string; ad_group_name: string;
        impressions: number; clicks: number; spend: number;
    }>(sql, { cacheKey: `gads:landing-pages:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        return {
            landingPageUrl: r.landing_page_url,
            campaignName: r.campaign_name ?? '',
            adGroupName: r.ad_group_name ?? '',
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
        };
    });
}

/**
 * Impression share & competitive metrics per campaign.
 * Shows how much search market you're capturing vs losing (and why).
 */
export async function getGAdsImpressionShare(days: number): Promise<GAdsImpressionShareRow[]> {
    const sql = `
SELECT
    x.campaign_id,
    c.campaign_name,
    AVG(x.metrics_search_impression_share) AS search_is,
    AVG(x.metrics_search_budget_lost_impression_share) AS budget_lost_is,
    AVG(x.metrics_search_rank_lost_impression_share) AS rank_lost_is,
    AVG(x.metrics_search_absolute_top_impression_share) AS abs_top_is,
    AVG(x.metrics_search_top_impression_share) AS top_is
FROM ${table('CampaignCrossDeviceStats')} x
JOIN ${table('Campaign')} c ON x.campaign_id = c.campaign_id
WHERE ${dateFilterSQL(days, 'x.segments_date')}
    AND c.campaign_status = 'ENABLED'
GROUP BY 1, 2
HAVING search_is > 0
ORDER BY search_is DESC
`;
    const rows = await runQuery<{
        campaign_id: number; campaign_name: string;
        search_is: number; budget_lost_is: number; rank_lost_is: number;
        abs_top_is: number; top_is: number;
    }>(sql, { cacheKey: `gads:impression-share:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        campaignId: Number(r.campaign_id),
        campaignName: r.campaign_name,
        searchImpressionShare: Math.round(Number(r.search_is) * 10000) / 100,
        budgetLostImpressionShare: Math.round(Number(r.budget_lost_is) * 10000) / 100,
        rankLostImpressionShare: Math.round(Number(r.rank_lost_is) * 10000) / 100,
        searchAbsoluteTopIS: Math.round(Number(r.abs_top_is) * 10000) / 100,
        searchTopIS: Math.round(Number(r.top_is) * 10000) / 100,
    }));
}

/**
 * Budget utilization — daily budget vs actual spend per campaign.
 */
export async function getGAdsBudgets(days: number): Promise<GAdsBudgetRow[]> {
    const sql = `
SELECT
    c.campaign_id,
    c.campaign_name,
    c.campaign_budget_amount_micros / 1000000.0 AS daily_budget,
    SUM(s.metrics_cost_micros) / 1000000.0 AS actual_spend,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('CampaignBasicStats')} s
JOIN ${table('Campaign')} c ON s.campaign_id = c.campaign_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND c.campaign_status = 'ENABLED'
    AND c.campaign_budget_amount_micros > 0
GROUP BY 1, 2, 3
HAVING actual_spend > 0
ORDER BY actual_spend DESC
`;
    const rows = await runQuery<{
        campaign_id: number; campaign_name: string; daily_budget: number;
        actual_spend: number; impressions: number; clicks: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:budgets:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.actual_spend);
        const dailyBudget = Number(r.daily_budget);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        // Budget is daily; multiply by days in range for total budget
        const totalBudget = dailyBudget * days;
        return {
            campaignId: Number(r.campaign_id),
            campaignName: r.campaign_name,
            dailyBudget,
            actualSpend: spend,
            utilization: totalBudget > 0 ? Math.round((spend / totalBudget) * 10000) / 100 : 0,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Ad creative performance — headlines, descriptions, ad strength, and metrics.
 */
export async function getGAdsCreatives(days: number): Promise<GAdsCreativeRow[]> {
    const sql = `
SELECT
    a.ad_group_ad_ad_id AS ad_id,
    a.ad_group_ad_ad_type AS ad_type,
    a.ad_group_ad_ad_strength AS ad_strength,
    a.ad_group_ad_ad_responsive_search_ad_headlines AS rsa_headlines,
    a.ad_group_ad_ad_responsive_search_ad_descriptions AS rsa_descriptions,
    a.ad_group_ad_ad_name AS ad_name,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('AdBasicStats')} s
JOIN ${table('Ad')} a ON s.ad_group_ad_ad_id = a.ad_group_ad_ad_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2, 3, 4, 5, 6
HAVING spend > 0
ORDER BY spend DESC
LIMIT 100
`;
    const rows = await runQuery<{
        ad_id: number; ad_type: string; ad_strength: string | null;
        rsa_headlines: string | null; rsa_descriptions: string | null; ad_name: string | null;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:creatives:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);

        // Parse RSA headlines/descriptions from JSON array
        let headlines: string[] = [];
        let descriptions: string[] = [];
        try {
            if (r.rsa_headlines) {
                const parsed = JSON.parse(r.rsa_headlines);
                headlines = Array.isArray(parsed) ? parsed.map((h: { text?: string }) => h.text ?? '').filter(Boolean) : [];
            }
        } catch { /* ignore parse errors */ }
        try {
            if (r.rsa_descriptions) {
                const parsed = JSON.parse(r.rsa_descriptions);
                descriptions = Array.isArray(parsed) ? parsed.map((d: { text?: string }) => d.text ?? '').filter(Boolean) : [];
            }
        } catch { /* ignore parse errors */ }

        return {
            adId: Number(r.ad_id),
            adType: (r.ad_type ?? '').replace(/_/g, ' '),
            adStrength: r.ad_strength ?? 'N/A',
            headlines,
            descriptions,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Video/YouTube performance — views, clicks, cost per video.
 */
export async function getGAdsVideos(days: number): Promise<GAdsVideoRow[]> {
    const sql = `
SELECT
    v.video_id,
    v.video_title,
    v.video_duration_millis,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('VideoBasicStats')} s
JOIN ${table('Video')} v ON s.video_id = v.video_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2, 3
HAVING spend > 0
ORDER BY spend DESC
LIMIT 100
`;
    const rows = await runQuery<{
        video_id: string; video_title: string; video_duration_millis: number;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:videos:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            videoId: r.video_id,
            videoTitle: r.video_title ?? '(untitled)',
            durationSec: Math.round(Number(r.video_duration_millis) / 1000),
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * PMax asset group performance — spend/clicks/conversions per asset group.
 */
export async function getGAdsAssetGroups(days: number): Promise<GAdsAssetGroupRow[]> {
    const sql = `
SELECT
    ag.asset_group_name,
    c.campaign_name,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('AssetGroupProductGroupStats')} s
JOIN ${table('AssetGroup')} ag
    ON CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/assetGroups/', ag.asset_group_id) = s.asset_group_product_group_view_asset_group
JOIN ${table('Campaign')} c
    ON ag.asset_group_campaign = CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/campaigns/', CAST(c.campaign_id AS STRING))
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2
HAVING spend > 0
ORDER BY spend DESC
LIMIT 100
`;
    const rows = await runQuery<{
        asset_group_name: string; campaign_name: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:asset-groups:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            assetGroupName: r.asset_group_name,
            campaignName: r.campaign_name,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * Audience segment performance per campaign.
 */
export async function getGAdsAudienceSegments(days: number): Promise<GAdsAudienceSegmentRow[]> {
    const sql = `
SELECT
    c.campaign_name,
    s.campaign_criterion_criterion_id AS criterion_id,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('CampaignAudienceBasicStats')} s
JOIN ${table('Campaign')} c ON s.campaign_id = c.campaign_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2
HAVING spend > 0
ORDER BY spend DESC
LIMIT 200
`;
    const rows = await runQuery<{
        campaign_name: string; criterion_id: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:audience-segments:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            campaignName: r.campaign_name,
            criterionId: String(r.criterion_id),
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

// ============================================
// CONVERSION FUNNEL QUERIES
// ============================================

/** Conversion actions we care about, in funnel order */
const FUNNEL_ACTIONS = [
    'Google Shopping App View Item',
    'Creatures of Habit - GA4 (web) view_item',
    'Google Shopping App Add To Cart',
    'Creatures of Habit - GA4 (web) add_to_cart',
    'Google Shopping App Begin Checkout',
    'Google Shopping App Purchase',
    'Shopify Purchase (Elevar GTM Server)',
    'Shopify Purchase (Elevar GTM Web)',
    'Creatures of Habit - GA4 (web) purchase',
];

const VIEW_ACTIONS = new Set([
    'Google Shopping App View Item',
    'Creatures of Habit - GA4 (web) view_item',
]);
const ATC_ACTIONS = new Set([
    'Google Shopping App Add To Cart',
    'Creatures of Habit - GA4 (web) add_to_cart',
]);
const PURCHASE_ACTIONS = new Set([
    'Google Shopping App Purchase',
    'Shopify Purchase (Elevar GTM Server)',
    'Shopify Purchase (Elevar GTM Web)',
    'Creatures of Habit - GA4 (web) purchase',
]);

/**
 * Product conversion funnel — View → ATC → Purchase per product type.
 */
export async function getGAdsProductFunnel(days: number): Promise<GAdsProductFunnelRow[]> {
    const actionList = FUNNEL_ACTIONS.map(a => `'${a}'`).join(', ');
    const sql = `
SELECT
    segments_product_type_l1 AS product_type,
    segments_conversion_action_name AS action,
    SUM(metrics_all_conversions) AS conv,
    SUM(metrics_all_conversions_value) AS conv_value
FROM ${table('ShoppingProductConversionStats')}
WHERE ${dateFilterSQL(days)}
    AND segments_conversion_action_name IN (${actionList})
    AND metrics_all_conversions > 0
GROUP BY 1, 2
ORDER BY product_type
`;
    const rows = await runQuery<{
        product_type: string; action: string; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:product-funnel:${days}`, cacheTtl: GADS_CACHE_TTL });

    // Pivot into funnel rows per product type
    const map = new Map<string, { views: number; atc: number; purchases: number; purchaseValue: number }>();
    for (const r of rows) {
        const pt = r.product_type || '(unknown)';
        const entry = map.get(pt) ?? { views: 0, atc: 0, purchases: 0, purchaseValue: 0 };
        const conv = Number(r.conv);
        const val = Number(r.conv_value);
        if (VIEW_ACTIONS.has(r.action)) entry.views += conv;
        else if (ATC_ACTIONS.has(r.action)) entry.atc += conv;
        else if (PURCHASE_ACTIONS.has(r.action)) { entry.purchases += conv; entry.purchaseValue += val; }
        map.set(pt, entry);
    }

    return Array.from(map.entries())
        .map(([productType, d]) => ({
            productType,
            views: Math.round(d.views),
            addToCarts: Math.round(d.atc * 100) / 100,
            purchases: Math.round(d.purchases * 100) / 100,
            purchaseValue: Math.round(d.purchaseValue),
            viewToAtcRate: d.views > 0 ? Math.round((d.atc / d.views) * 10000) / 100 : 0,
            atcToPurchaseRate: d.atc > 0 ? Math.round((d.purchases / d.atc) * 10000) / 100 : 0,
        }))
        .filter(r => r.views > 0 || r.addToCarts > 0 || r.purchases > 0)
        .sort((a, b) => b.purchases - a.purchases || b.addToCarts - a.addToCarts);
}

/**
 * Search term conversion breakdown — which terms drive ATCs and purchases.
 */
export async function getGAdsSearchConversions(days: number): Promise<GAdsSearchConversionRow[]> {
    const actionList = FUNNEL_ACTIONS.map(a => `'${a}'`).join(', ');
    const sql = `
SELECT
    search_term_view_search_term AS search_term,
    segments_conversion_action_name AS action,
    SUM(metrics_all_conversions) AS conv,
    SUM(metrics_all_conversions_value) AS conv_value
FROM ${table('SearchQueryConversionStats')}
WHERE ${dateFilterSQL(days)}
    AND segments_conversion_action_name IN (${actionList})
    AND metrics_all_conversions > 0
GROUP BY 1, 2
ORDER BY conv DESC
LIMIT 200
`;
    const rows = await runQuery<{
        search_term: string; action: string; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:search-conversions:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        searchTerm: r.search_term,
        action: simplifyActionName(r.action),
        conversions: Math.round(Number(r.conv) * 100) / 100,
        conversionValue: Math.round(Number(r.conv_value)),
    }));
}

/**
 * Campaign conversion breakdown — conversions per action per campaign.
 */
export async function getGAdsCampaignConversions(days: number): Promise<GAdsCampaignConversionRow[]> {
    const sql = `
SELECT
    c.campaign_name,
    s.segments_conversion_action_name AS action,
    SUM(s.metrics_conversions) AS conv,
    SUM(s.metrics_conversions_value) AS conv_value
FROM ${table('CampaignConversionStats')} s
JOIN ${table('Campaign')} c ON s.campaign_id = c.campaign_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND c.campaign_status = 'ENABLED'
GROUP BY 1, 2
HAVING conv > 0
ORDER BY campaign_name, conv DESC
`;
    const rows = await runQuery<{
        campaign_name: string; action: string; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:campaign-conversions:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        campaignName: r.campaign_name,
        action: simplifyActionName(r.action),
        conversions: Math.round(Number(r.conv) * 100) / 100,
        conversionValue: Math.round(Number(r.conv_value)),
    }));
}

// ============================================
// GEO CONVERSIONS
// ============================================

export interface GAdsGeoConversionRow {
    locationId: string;
    locationName: string;
    action: string;
    conversions: number;
    conversionValue: number;
}

/**
 * Geographic conversion breakdown — which locations actually convert, by action.
 */
export async function getGAdsGeoConversions(days: number): Promise<GAdsGeoConversionRow[]> {
    const sql = `
SELECT
    REGEXP_EXTRACT(segments_geo_target_most_specific_location, r'geoTargetConstants/(\\d+)') AS loc_id,
    segments_conversion_action_name AS action,
    SUM(metrics_all_conversions) AS conv,
    SUM(metrics_all_conversions_value) AS conv_value
FROM ${table('GeoConversionStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1, 2
HAVING conv > 0.1
ORDER BY conv_value DESC
LIMIT 500
`;
    const rows = await runQuery<{
        loc_id: string; action: string; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:geo-conversions:${days}`, cacheTtl: GADS_CACHE_TTL });

    const geo = getGeoLookup();
    return rows.map(r => ({
        locationId: r.loc_id,
        locationName: geo[r.loc_id] ?? r.loc_id,
        action: simplifyActionName(r.action),
        conversions: Math.round(Number(r.conv) * 100) / 100,
        conversionValue: Math.round(Number(r.conv_value)),
    }));
}

// ============================================
// USER LOCATIONS
// ============================================

export interface GAdsUserLocationRow {
    locationId: string;
    locationName: string;
    isTargeted: boolean;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpc: number;
}

/**
 * User physical location — where users actually are when they see/click ads.
 */
export async function getGAdsUserLocations(days: number): Promise<GAdsUserLocationRow[]> {
    const sql = `
SELECT
    REGEXP_EXTRACT(segments_geo_target_most_specific_location, r'geoTargetConstants/(\\d+)') AS loc_id,
    LOGICAL_OR(user_location_view_targeting_location) AS is_targeted,
    SUM(metrics_cost_micros) / 1e6 AS spend,
    SUM(metrics_impressions) AS impr,
    SUM(metrics_clicks) AS clicks,
    SUM(metrics_conversions) AS conv
FROM ${table('LocationsUserLocationsStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1
HAVING spend > 0
ORDER BY spend DESC
LIMIT 500
`;
    const rows = await runQuery<{
        loc_id: string; is_targeted: boolean; spend: number; impr: number; clicks: number; conv: number;
    }>(sql, { cacheKey: `gads:user-locations:${days}`, cacheTtl: GADS_CACHE_TTL });

    const geo = getGeoLookup();
    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impr = Number(r.impr);
        return {
            locationId: r.loc_id,
            locationName: geo[r.loc_id] ?? r.loc_id,
            isTargeted: r.is_targeted,
            spend: Math.round(spend),
            impressions: impr,
            clicks,
            conversions: Math.round(Number(r.conv) * 100) / 100,
            ctr: impr > 0 ? (clicks / impr) * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0,
        };
    });
}

// ============================================
// CLICK STATS
// ============================================

export interface GAdsClickRow {
    date: string;
    device: string;
    slot: string;
    clickType: string;
    pageNumber: number;
    keyword: string;
    presenceCity: string;
    clicks: number;
}

/**
 * Click-level data aggregated by slot/device/keyword — for click quality analysis.
 */
export async function getGAdsClickStats(days: number): Promise<GAdsClickRow[]> {
    const sql = `
SELECT
    CAST(segments_date AS STRING) AS dt,
    segments_device AS device,
    segments_slot AS slot,
    segments_click_type AS click_type,
    click_view_page_number AS page_number,
    IFNULL(click_view_keyword_info_text, '(none)') AS keyword,
    REGEXP_EXTRACT(click_view_location_of_presence_city, r'geoTargetConstants/(\\d+)') AS presence_city_id,
    SUM(metrics_clicks) AS clicks
FROM ${table('ClickStats')}
WHERE ${dateFilterSQL(days)}
GROUP BY 1, 2, 3, 4, 5, 6, 7
ORDER BY clicks DESC
LIMIT 1000
`;
    const rows = await runQuery<{
        dt: string; device: string; slot: string; click_type: string;
        page_number: number; keyword: string; presence_city_id: string | null; clicks: number;
    }>(sql, { cacheKey: `gads:click-stats:${days}`, cacheTtl: GADS_CACHE_TTL });

    const geo = getGeoLookup();
    return rows.map(r => ({
        date: r.dt,
        device: r.device,
        slot: r.slot?.replace('SEARCH_', '').replace('_', ' ') ?? 'OTHER',
        clickType: r.click_type ?? 'URL_CLICKS',
        pageNumber: Number(r.page_number) || 1,
        keyword: r.keyword,
        presenceCity: r.presence_city_id ? (geo[r.presence_city_id] ?? r.presence_city_id) : 'Unknown',
        clicks: Number(r.clicks),
    }));
}

// ============================================
// ASSET PERFORMANCE
// ============================================

export interface GAdsAssetPerfRow {
    assetName: string;
    assetType: string;
    fieldType: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
}

/**
 * Campaign asset performance — which creative assets (headlines, images, sitelinks) perform best.
 */
export async function getGAdsAssetPerformance(days: number): Promise<GAdsAssetPerfRow[]> {
    const sql = `
SELECT
    IFNULL(a.asset_name, 'Unnamed') AS asset_name,
    a.asset_type,
    s.campaign_asset_field_type AS field_type,
    SUM(s.metrics_cost_micros) / 1e6 AS spend,
    SUM(s.metrics_impressions) AS impr,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_conversions) AS conv,
    SUM(s.metrics_conversions_value) AS conv_value
FROM ${table('CampaignAssetStats')} s
JOIN ${table('Asset')} a
    ON CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/assets/', a.asset_id) = s.campaign_asset_asset
    AND a._DATA_DATE = a._LATEST_DATE
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND s.campaign_asset_status = 'ENABLED'
GROUP BY 1, 2, 3
HAVING spend > 0 OR clicks > 0
ORDER BY spend DESC
LIMIT 300
`;
    const rows = await runQuery<{
        asset_name: string; asset_type: string; field_type: string;
        spend: number; impr: number; clicks: number; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:asset-perf:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impr = Number(r.impr);
        return {
            assetName: r.asset_name,
            assetType: r.asset_type,
            fieldType: r.field_type,
            spend: Math.round(spend),
            impressions: impr,
            clicks,
            conversions: Math.round(Number(r.conv) * 100) / 100,
            conversionValue: Math.round(Number(r.conv_value)),
            ctr: impr > 0 ? (clicks / impr) * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0,
        };
    });
}

// ============================================
// AD GROUPS
// ============================================

export interface GAdsAdGroupRow {
    adGroupId: number;
    adGroupName: string;
    campaignName: string;
    adGroupType: string;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

/**
 * Ad group performance — the level between campaign and keyword.
 */
export async function getGAdsAdGroups(days: number): Promise<GAdsAdGroupRow[]> {
    const sql = `
SELECT
    ag.ad_group_id,
    ag.ad_group_name,
    c.campaign_name,
    ag.ad_group_type,
    ag.ad_group_status,
    SUM(s.metrics_cost_micros) / 1e6 AS spend,
    SUM(s.metrics_impressions) AS impr,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_conversions) AS conv,
    SUM(s.metrics_conversions_value) AS conv_value
FROM ${table('AdGroupBasicStats')} s
JOIN ${table('AdGroup')} ag ON s.ad_group_id = ag.ad_group_id AND ag._DATA_DATE = ag._LATEST_DATE
JOIN ${table('Campaign')} c ON ag.campaign_id = c.campaign_id AND c._DATA_DATE = c._LATEST_DATE
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND ag.ad_group_status = 'ENABLED'
GROUP BY 1, 2, 3, 4, 5
HAVING spend > 0
ORDER BY spend DESC
LIMIT 200
`;
    const rows = await runQuery<{
        ad_group_id: number; ad_group_name: string; campaign_name: string;
        ad_group_type: string; ad_group_status: string;
        spend: number; impr: number; clicks: number; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:ad-groups:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impr = Number(r.impr);
        const conv = Number(r.conv);
        const convValue = Number(r.conv_value);
        return {
            adGroupId: r.ad_group_id,
            adGroupName: r.ad_group_name,
            campaignName: r.campaign_name,
            adGroupType: r.ad_group_type?.replace(/_/g, ' '),
            status: r.ad_group_status,
            spend: Math.round(spend),
            impressions: impr,
            clicks,
            conversions: Math.round(conv * 100) / 100,
            conversionValue: Math.round(convValue),
            ctr: impr > 0 ? (clicks / impr) * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0,
            roas: spend > 0 ? convValue / spend : 0,
        };
    });
}

// ============================================
// AD GROUP CRITERIA (Targeting)
// ============================================

export interface GAdsAdGroupCriterionRow {
    adGroupName: string;
    criterionType: string;
    displayName: string;
    isNegative: boolean;
    status: string;
    bidModifier: number | null;
}

/**
 * Ad group targeting criteria — keywords, audiences, placements per ad group.
 */
export async function getGAdsAdGroupCriteria(days: number): Promise<GAdsAdGroupCriterionRow[]> {
    // days param unused but kept for API consistency; criteria is dimensional, not time-series
    void days;
    const sql = `
SELECT
    ad_group_name,
    ad_group_criterion_type AS criterion_type,
    IFNULL(ad_group_criterion_display_name, '') AS display_name,
    ad_group_criterion_negative AS is_negative,
    ad_group_criterion_status AS status,
    ad_group_criterion_bid_modifier AS bid_modifier
FROM ${table('AdGroupCriterion')}
WHERE _DATA_DATE = _LATEST_DATE
    AND ad_group_criterion_status != 'REMOVED'
ORDER BY ad_group_name, criterion_type
LIMIT 500
`;
    const rows = await runQuery<{
        ad_group_name: string; criterion_type: string; display_name: string;
        is_negative: boolean; status: string; bid_modifier: number | null;
    }>(sql, { cacheKey: `gads:adgroup-criteria`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        adGroupName: r.ad_group_name,
        criterionType: r.criterion_type?.replace(/_/g, ' '),
        displayName: r.display_name,
        isNegative: r.is_negative,
        status: r.status,
        bidModifier: r.bid_modifier != null ? Number(r.bid_modifier) : null,
    }));
}

// ============================================
// AUDIENCE CONVERSIONS
// ============================================

export interface GAdsAudienceConversionRow {
    campaignName: string;
    criterionId: string;
    action: string;
    conversions: number;
    conversionValue: number;
}

/**
 * Audience segment conversion breakdown — which audiences actually convert.
 */
export async function getGAdsAudienceConversions(days: number): Promise<GAdsAudienceConversionRow[]> {
    const sql = `
SELECT
    c.campaign_name,
    s.campaign_criterion_criterion_id AS criterion_id,
    s.segments_conversion_action_name AS action,
    SUM(s.metrics_all_conversions) AS conv,
    SUM(s.metrics_all_conversions_value) AS conv_value
FROM ${table('CampaignAudienceConversionStats')} s
JOIN ${table('Campaign')} c ON s.campaign_id = c.campaign_id AND c._DATA_DATE = c._LATEST_DATE
WHERE ${dateFilterSQL(days, 's.segments_date')}
GROUP BY 1, 2, 3
HAVING conv > 0.1
ORDER BY conv_value DESC
LIMIT 300
`;
    const rows = await runQuery<{
        campaign_name: string; criterion_id: string; action: string; conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:audience-conversions:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        campaignName: r.campaign_name,
        criterionId: r.criterion_id,
        action: simplifyActionName(r.action),
        conversions: Math.round(Number(r.conv) * 100) / 100,
        conversionValue: Math.round(Number(r.conv_value)),
    }));
}

/** Shorten verbose conversion action names for display */
function simplifyActionName(action: string): string {
    if (action.includes('View Item') || action.includes('view_item')) return 'View Item';
    if (action.includes('Page View')) return 'Page View';
    if (action.includes('Add To Cart') || action.includes('add_to_cart')) return 'Add to Cart';
    if (action.includes('Begin Checkout')) return 'Begin Checkout';
    if (action.includes('Purchase') || action.includes('purchase')) return 'Purchase';
    if (action.includes('Search')) return 'Search';
    return action;
}

// ============================================
// PMAX DEEP DIVE TYPES
// ============================================

export interface GPMaxCampaignRow {
    campaignId: number;
    campaignName: string;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    cpc: number;
    ctr: number;
    roas: number;
}

export interface GPMaxAssetGroupPerfRow {
    assetGroupName: string;
    campaignId: number;
    campaignName: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    roas: number;
}

export interface GPMaxAssetLabelRow {
    assetId: string;
    assetGroupName: string;
    campaignId: number;
    campaignName: string;
    assetName: string;
    assetType: string;
    performanceLabel: string;
    fieldType: string;
}

export interface GPMaxDailyRow {
    date: string;
    campaignId: number;
    spend: number;
    conversions: number;
    conversionValue: number;
}

export interface GPMaxProductFunnelRow {
    campaignId: number;
    productType: string;
    views: number;
    addToCarts: number;
    purchases: number;
    purchaseValue: number;
    viewToAtcRate: number;
    atcToPurchaseRate: number;
}

// ============================================
// PMAX DEEP DIVE QUERIES
// ============================================

/**
 * PMax campaigns — summary stats filtered to PERFORMANCE_MAX channel type.
 */
export async function getPMaxCampaigns(days: number): Promise<GPMaxCampaignRow[]> {
    const sql = `
SELECT
    s.campaign_id,
    c.campaign_name,
    c.campaign_status AS status,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('CampaignBasicStats')} s
JOIN ${table('Campaign')} c USING(campaign_id)
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND c.campaign_advertising_channel_type = 'PERFORMANCE_MAX'
GROUP BY 1, 2, 3
ORDER BY spend DESC
`;
    const rows = await runQuery<{
        campaign_id: number; campaign_name: string; status: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:pmax-campaigns:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            status: r.status ?? '',
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * PMax asset group performance — aggregated from AssetGroupProductGroupStats.
 */
export async function getPMaxAssetGroupPerf(days: number): Promise<GPMaxAssetGroupPerfRow[]> {
    const sql = `
SELECT
    ag.asset_group_name,
    c.campaign_id,
    c.campaign_name,
    SUM(s.metrics_impressions) AS impressions,
    SUM(s.metrics_clicks) AS clicks,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('AssetGroupProductGroupStats')} s
JOIN ${table('AssetGroup')} ag
    ON CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/assetGroups/', ag.asset_group_id) = s.asset_group_product_group_view_asset_group
JOIN ${table('Campaign')} c
    ON ag.asset_group_campaign = CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/campaigns/', CAST(c.campaign_id AS STRING))
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND c.campaign_advertising_channel_type = 'PERFORMANCE_MAX'
GROUP BY 1, 2, 3
HAVING spend > 0
ORDER BY spend DESC
`;
    const rows = await runQuery<{
        asset_group_name: string; campaign_id: number; campaign_name: string;
        impressions: number; clicks: number; spend: number;
        conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:pmax-assetgroup-perf:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => {
        const spend = Number(r.spend);
        const clicks = Number(r.clicks);
        const impressions = Number(r.impressions);
        const conversions = Number(r.conversions);
        const conversionValue = Number(r.conversion_value);
        return {
            assetGroupName: r.asset_group_name,
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            spend,
            impressions,
            clicks,
            conversions: Math.round(conversions * 100) / 100,
            conversionValue,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
            cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
            roas: spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0,
        };
    });
}

/**
 * PMax asset performance labels — BEST/GOOD/LOW/LEARNING labels per asset.
 */
export async function getPMaxAssetLabels(days: number): Promise<GPMaxAssetLabelRow[]> {
    void days; // Not date-filtered — dimension table with current labels
    const sql = `
SELECT
    a.asset_id,
    ag.asset_group_name,
    c.campaign_id,
    c.campaign_name,
    a.asset_name,
    a.asset_type,
    aga.asset_group_asset_performance_label AS performance_label,
    aga.asset_group_asset_field_type AS field_type
FROM ${table('AssetGroupAsset')} aga
JOIN ${table('Asset')} a
    ON aga.asset_group_asset_asset = CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/assets/', a.asset_id)
JOIN ${table('AssetGroup')} ag
    ON aga.asset_group_asset_asset_group = CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/assetGroups/', ag.asset_group_id)
JOIN ${table('Campaign')} c
    ON ag.asset_group_campaign = CONCAT('customers/${GOOGLE_ADS_CUSTOMER_ID}/campaigns/', CAST(c.campaign_id AS STRING))
WHERE c.campaign_advertising_channel_type = 'PERFORMANCE_MAX'
    AND aga._DATA_DATE = aga._LATEST_DATE
    AND a._DATA_DATE = a._LATEST_DATE
    AND ag._DATA_DATE = ag._LATEST_DATE
    AND c._DATA_DATE = c._LATEST_DATE
ORDER BY ag.asset_group_name, aga.asset_group_asset_field_type
`;
    const rows = await runQuery<{
        asset_id: number; asset_group_name: string; campaign_id: number; campaign_name: string;
        asset_name: string; asset_type: string;
        performance_label: string; field_type: string;
    }>(sql, { cacheKey: `gads:pmax-asset-labels:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        assetId: String(r.asset_id),
        assetGroupName: r.asset_group_name ?? '',
        campaignId: r.campaign_id,
        campaignName: r.campaign_name ?? '',
        assetName: r.asset_name ?? '(unnamed)',
        assetType: r.asset_type ?? '',
        performanceLabel: r.performance_label ?? 'UNKNOWN',
        fieldType: r.field_type ?? '',
    }));
}

/**
 * PMax daily trend — spend + conversions per day per campaign.
 */
export async function getPMaxDailyTrend(days: number): Promise<GPMaxDailyRow[]> {
    const sql = `
SELECT
    CAST(s.segments_date AS STRING) AS date,
    s.campaign_id,
    SUM(s.metrics_cost_micros) / 1000000.0 AS spend,
    SUM(s.metrics_conversions) AS conversions,
    SUM(s.metrics_conversions_value) AS conversion_value
FROM ${table('CampaignBasicStats')} s
JOIN ${table('Campaign')} c USING(campaign_id)
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND c.campaign_advertising_channel_type = 'PERFORMANCE_MAX'
GROUP BY 1, 2
ORDER BY date
`;
    const rows = await runQuery<{
        date: string; campaign_id: number;
        spend: number; conversions: number; conversion_value: number;
    }>(sql, { cacheKey: `gads:pmax-daily:${days}`, cacheTtl: GADS_CACHE_TTL });

    return rows.map(r => ({
        date: String(r.date),
        campaignId: r.campaign_id,
        spend: Number(r.spend),
        conversions: Math.round(Number(r.conversions) * 100) / 100,
        conversionValue: Number(r.conversion_value),
    }));
}

/**
 * PMax product conversion funnel — View → ATC → Purchase per product type per campaign.
 */
export async function getPMaxProductFunnel(days: number): Promise<GPMaxProductFunnelRow[]> {
    const actionList = FUNNEL_ACTIONS.map(a => `'${a}'`).join(', ');
    const sql = `
SELECT
    s.campaign_id,
    s.segments_product_type_l1 AS product_type,
    s.segments_conversion_action_name AS action,
    SUM(s.metrics_all_conversions) AS conv,
    SUM(s.metrics_all_conversions_value) AS conv_value
FROM ${table('ShoppingProductConversionStats')} s
JOIN ${table('Campaign')} c ON s.campaign_id = c.campaign_id
WHERE ${dateFilterSQL(days, 's.segments_date')}
    AND c.campaign_advertising_channel_type = 'PERFORMANCE_MAX'
    AND s.segments_conversion_action_name IN (${actionList})
    AND s.metrics_all_conversions > 0
GROUP BY 1, 2, 3
ORDER BY product_type
`;
    const rows = await runQuery<{
        campaign_id: number; product_type: string; action: string;
        conv: number; conv_value: number;
    }>(sql, { cacheKey: `gads:pmax-product-funnel:${days}`, cacheTtl: GADS_CACHE_TTL });

    // Pivot into funnel rows per campaign × product type
    const map = new Map<string, { campaignId: number; views: number; atc: number; purchases: number; purchaseValue: number }>();
    for (const r of rows) {
        const pt = r.product_type || '(unknown)';
        const key = `${r.campaign_id}::${pt}`;
        const entry = map.get(key) ?? { campaignId: r.campaign_id, views: 0, atc: 0, purchases: 0, purchaseValue: 0 };
        const conv = Number(r.conv);
        const val = Number(r.conv_value);
        if (VIEW_ACTIONS.has(r.action)) entry.views += conv;
        else if (ATC_ACTIONS.has(r.action)) entry.atc += conv;
        else if (PURCHASE_ACTIONS.has(r.action)) { entry.purchases += conv; entry.purchaseValue += val; }
        map.set(key, entry);
    }

    return Array.from(map.entries())
        .map(([key, d]) => {
            const productType = key.split('::')[1];
            return {
                campaignId: d.campaignId,
                productType,
                views: Math.round(d.views),
                addToCarts: Math.round(d.atc * 100) / 100,
                purchases: Math.round(d.purchases * 100) / 100,
                purchaseValue: Math.round(d.purchaseValue),
                viewToAtcRate: d.views > 0 ? Math.round((d.atc / d.views) * 10000) / 100 : 0,
                atcToPurchaseRate: d.atc > 0 ? Math.round((d.purchases / d.atc) * 10000) / 100 : 0,
            };
        })
        .filter(r => r.views > 0 || r.addToCarts > 0 || r.purchases > 0)
        .sort((a, b) => b.purchases - a.purchases || b.addToCarts - a.addToCarts);
}
