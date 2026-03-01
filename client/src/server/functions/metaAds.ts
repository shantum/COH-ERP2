/**
 * Meta Ads Server Functions
 *
 * Read-only campaign performance data from Facebook/Instagram Ads.
 * IMPORTANT: Dynamic imports to prevent Node.js code from being bundled into client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RE-EXPORT TYPES
// ============================================

export type { MetaCampaignRow, MetaDailyRow, MetaAccountSummary } from '../../../../server/src/services/metaAdsClient.js';

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
    return import('../../../../server/src/services/metaAdsClient.js');
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
