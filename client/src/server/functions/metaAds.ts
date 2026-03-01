/**
 * Meta Ads Server Functions
 *
 * Read-only campaign performance data from Facebook/Instagram Ads.
 * IMPORTANT: Dynamic imports to prevent Node.js code from being bundled into client.
 *
 * Types are defined here (not re-exported from @server/) to avoid Vite
 * resolution issues with the @server alias during SSR.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// TYPES (mirrored from server/src/services/metaAdsClient.ts)
// ============================================

export interface MetaCampaignRow {
    campaignId: string;
    campaignName: string;
    objective: string;
    spend: number;
    impressions: number;
    clicks: number;
    cpc: number;
    cpm: number;
    ctr: number;
    purchases: number;
    purchaseValue: number;
    costPerPurchase: number;
    roas: number;
    addToCarts: number;
}

export interface MetaDailyRow {
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
}

export interface MetaAccountSummary {
    spend: number;
    impressions: number;
    reach: number;
    frequency: number;
    clicks: number;
    cpc: number;
    cpm: number;
    ctr: number;
    purchases: number;
    purchaseValue: number;
    addToCarts: number;
    initiateCheckouts: number;
    viewContents: number;
    roas: number;
}

export interface MetaAdsetRow {
    adsetId: string;
    adsetName: string;
    campaignId: string;
    campaignName: string;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    cpc: number;
    cpm: number;
    ctr: number;
    purchases: number;
    purchaseValue: number;
    costPerPurchase: number;
    roas: number;
}

export interface MetaAdRow {
    adId: string;
    adName: string;
    adsetName: string;
    campaignName: string;
    spend: number;
    impressions: number;
    clicks: number;
    cpc: number;
    ctr: number;
    purchases: number;
    purchaseValue: number;
    costPerPurchase: number;
    roas: number;
}

export interface MetaAgeGenderRow {
    age: string;
    gender: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    purchases: number;
    purchaseValue: number;
    costPerPurchase: number;
    roas: number;
}

export interface MetaPlacementRow {
    platform: string;
    position: string;
    label: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpm: number;
    purchases: number;
    purchaseValue: number;
    roas: number;
}

export interface MetaRegionRow {
    region: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
    roas: number;
}

export interface MetaDeviceRow {
    device: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
    roas: number;
}

// ============================================
// INPUT SCHEMAS
// ============================================

const daysInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
});

// ============================================
// HELPERS
// ============================================

async function getMetaClient() {
    return import('@server/services/metaAdsClient.js');
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Campaign performance — spend, impressions, clicks, purchases, ROAS per campaign
 */
export const getMetaCampaigns = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getCampaignInsights } = await getMetaClient();
        return getCampaignInsights(data.days);
    });

/**
 * Daily spend trend — spend, impressions, clicks, purchases per day
 */
export const getMetaDailyTrend = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getDailyInsights } = await getMetaClient();
        return getDailyInsights(data.days);
    });

/**
 * Account summary — total spend, ROAS, CPC, CTR etc.
 */
export const getMetaSummary = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getAccountSummary } = await getMetaClient();
        return getAccountSummary(data.days);
    });

/**
 * Adset-level performance — drill down from campaigns
 */
export const getMetaAdsets = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getAdsetInsights } = await getMetaClient();
        return getAdsetInsights(data.days);
    });

/**
 * Ad-level performance — creative analysis
 */
export const getMetaAds = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getAdInsights } = await getMetaClient();
        return getAdInsights(data.days);
    });

/**
 * Age + Gender breakdown
 */
export const getMetaAgeGender = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getAgeGenderInsights } = await getMetaClient();
        return getAgeGenderInsights(data.days);
    });

/**
 * Placement breakdown — platform + position
 */
export const getMetaPlacements = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getPlacementInsights } = await getMetaClient();
        return getPlacementInsights(data.days);
    });

/**
 * Region/geography breakdown
 */
export const getMetaRegions = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getRegionInsights } = await getMetaClient();
        return getRegionInsights(data.days);
    });

/**
 * Device platform breakdown
 */
export const getMetaDevices = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getDeviceInsights } = await getMetaClient();
        return getDeviceInsights(data.days);
    });
