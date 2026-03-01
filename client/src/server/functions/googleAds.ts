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

export type { GAdsAccountSummary, GAdsCampaignRow, GAdsDailyRow } from '@server/services/googleAdsClient.js';

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
