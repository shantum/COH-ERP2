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
    GAdsGeoConversionRow, GAdsUserLocationRow, GAdsClickRow,
    GAdsAssetPerfRow, GAdsAdGroupRow, GAdsAdGroupCriterionRow, GAdsAudienceConversionRow,
    GPMaxCampaignRow, GPMaxAssetGroupPerfRow, GPMaxAssetLabelRow,
    GPMaxDailyRow, GPMaxProductFunnelRow,
} from '@server/services/googleAdsClient.js';

export type {
    GAdsPMaxAssetMedia, GAdsPMaxAssetGroupStrength,
} from '@server/services/googleAdsApi.js';

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

/**
 * Geographic conversion breakdown by location and action
 */
export const getGAdsGeoConversions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsGeoConversions: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * User physical locations — where users are when they see/click ads
 */
export const getGAdsUserLocations = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsUserLocations: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Click-level stats — slot, device, keyword, position
 */
export const getGAdsClickStats = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsClickStats: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Creative asset performance — headlines, images, sitelinks
 */
export const getGAdsAssetPerformance = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAssetPerformance: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Ad group performance
 */
export const getGAdsAdGroups = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAdGroups: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Ad group targeting criteria
 */
export const getGAdsAdGroupCriteria = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAdGroupCriteria: fn } = await getGAdsClient();
        return fn(data.days);
    });

/**
 * Audience segment conversion breakdown
 */
export const getGAdsAudienceConversions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGAdsAudienceConversions: fn } = await getGAdsClient();
        return fn(data.days);
    });

// ============================================
// PMAX DEEP DIVE
// ============================================

export const getPMaxCampaigns = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getPMaxCampaigns: fn } = await getGAdsClient();
        return fn(data.days);
    });

export const getPMaxAssetGroupPerf = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getPMaxAssetGroupPerf: fn } = await getGAdsClient();
        return fn(data.days);
    });

export const getPMaxAssetLabels = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getPMaxAssetLabels: fn } = await getGAdsClient();
        return fn(data.days);
    });

export const getPMaxDailyTrend = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getPMaxDailyTrend: fn } = await getGAdsClient();
        return fn(data.days);
    });

export const getPMaxProductFunnel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getPMaxProductFunnel: fn } = await getGAdsClient();
        return fn(data.days);
    });

// ============================================
// PMAX — Google Ads API (media + strength)
// ============================================

async function getGAdsApi() {
    return import('@server/services/googleAdsApi.js');
}

export const getPMaxAssetMedia = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { getPMaxAssetMedia: fn } = await getGAdsApi();
        return fn();
    });

export const getPMaxAssetGroupStrength = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { getPMaxAssetGroupStrength: fn } = await getGAdsApi();
        return fn();
    });
