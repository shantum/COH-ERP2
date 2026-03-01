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
