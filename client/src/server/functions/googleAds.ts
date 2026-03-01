/**
 * Google Ads Server Functions
 *
 * Read-only campaign performance data from Google Ads via BigQuery.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RE-EXPORT TYPES
// ============================================

export type {
    GAdsAccountSummary, GAdsCampaignRow, GAdsDailyRow,
    GAdsProductRow, GAdsGeoRow, GAdsHourlyRow, GAdsDeviceRow,
    GAdsAgeRow, GAdsGenderRow, GAdsSearchTermRow, GAdsKeywordRow,
    GAdsLandingPageRow, GAdsImpressionShareRow, GAdsBudgetRow,
    GAdsCreativeRow, GAdsVideoRow, GAdsAssetGroupRow, GAdsAudienceSegmentRow,
    GAdsProductFunnelRow, GAdsSearchConversionRow, GAdsCampaignConversionRow,
} from '@server/services/googleAdsClient.js';

// ============================================
// INPUT SCHEMAS
// ============================================

const daysInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
});

// ============================================
// HELPERS
// ============================================

async function getGAdsClient() {
    return import('@server/services/googleAdsClient.js');
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Account-level summary — spend, impressions, clicks, conversions, ROAS
 */
export const getGAdsAccountSummary = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAccountSummary: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Campaign performance — spend, clicks, conversions, ROAS per campaign
 */
export const getGAdsCampaigns = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsCampaigns: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Daily spend trend — spend, impressions, clicks, conversions per day
 */
export const getGAdsDailyTrend = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsDailyTrend: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Shopping/PMax product-level performance
 */
export const getGAdsProducts = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsProducts: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Geographic performance by location × campaign
 */
export const getGAdsGeo = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsGeo: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Hourly/day-of-week performance
 */
export const getGAdsHourly = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsHourly: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Device breakdown
 */
export const getGAdsDevices = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsDevices: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Age range demographics
 */
export const getGAdsAge = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAge: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Gender demographics
 */
export const getGAdsGender = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsGender: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Search terms — what people actually searched
 */
export const getGAdsSearchTerms = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsSearchTerms: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Keywords with quality scores
 */
export const getGAdsKeywords = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsKeywords: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Landing page performance
 */
export const getGAdsLandingPages = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsLandingPages: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Impression share & competitive metrics
 */
export const getGAdsImpressionShare = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsImpressionShare: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Budget utilization per campaign
 */
export const getGAdsBudgets = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsBudgets: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Ad creative performance
 */
export const getGAdsCreatives = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsCreatives: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Video/YouTube performance
 */
export const getGAdsVideos = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsVideos: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * PMax asset group performance
 */
export const getGAdsAssetGroups = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAssetGroups: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Audience segment performance
 */
export const getGAdsAudienceSegments = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAudienceSegments: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Product conversion funnel — View → ATC → Purchase by product type
 */
export const getGAdsProductFunnel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsProductFunnel: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Search term conversion breakdown by action
 */
export const getGAdsSearchConversions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsSearchConversions: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Campaign conversion breakdown by action
 */
export const getGAdsCampaignConversions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsCampaignConversions: fn } = await getGAdsClient();
        return fn(data.days);
    });
