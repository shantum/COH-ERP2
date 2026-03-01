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

import {
    GOOGLE_ADS_PROJECT,
    GOOGLE_ADS_DATASET,
    GOOGLE_ADS_CUSTOMER_ID,
    GADS_CACHE_TTL,
} from '../config/googleAds.js';
import { runQuery } from './bigqueryClient.js';

// ============================================
// HELPERS
// ============================================

function table(name: string): string {
    return `\`${GOOGLE_ADS_PROJECT}.${GOOGLE_ADS_DATASET}.ads_${name}_${GOOGLE_ADS_CUSTOMER_ID}\``;
}

function daysAgoSQL(days: number): string {
    return `DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY)`;
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
WHERE segments_date >= ${daysAgoSQL(days)}
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
WHERE s.segments_date >= ${daysAgoSQL(days)}
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
WHERE segments_date >= ${daysAgoSQL(days)}
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
