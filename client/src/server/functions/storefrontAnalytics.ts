/**
 * Storefront Live — Server Functions
 *
 * Wraps Kysely queries for the Storefront Live dashboard.
 * Dynamic imports prevent Node.js code from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RE-EXPORT TYPES from the query module
// ============================================

export type {
    HeroMetrics,
    OnSiteNow,
    ProductFunnelRow,
    LiveFeedEvent,
    TrafficSourceRow,
    CampaignAttributionRow,
    GeoBreakdownRow,
    TopPageRow,
    TopSearchRow,
    DeviceBreakdownRow,
} from '@coh/shared/services/db/queries/storefront';

// ============================================
// INPUT SCHEMAS
// ============================================

const daysInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(1),
});

const paginatedInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(1),
    limit: z.number().int().min(1).max(200).default(10),
});

const feedInputSchema = z.object({
    limit: z.number().int().min(1).max(100).default(20),
});

// ============================================
// HELPERS
// ============================================

async function getQueries() {
    return import('@coh/shared/services/db/queries/storefront');
}

// ============================================
// SERVER FUNCTIONS
// ============================================

export const getStorefrontHeroMetrics = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getHeroMetrics } = await getQueries();
        return getHeroMetrics(data.days);
    });

export const getStorefrontOnSiteNow = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { getOnSiteNow } = await getQueries();
        return getOnSiteNow();
    });

export const getStorefrontProductFunnel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => paginatedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getProductFunnel } = await getQueries();
        return getProductFunnel(data.days, data.limit);
    });

export const getStorefrontLiveFeed = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => feedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getLiveFeed } = await getQueries();
        return getLiveFeed(data.limit);
    });

export const getStorefrontTrafficSources = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getTrafficSources } = await getQueries();
        return getTrafficSources(data.days);
    });

export const getStorefrontCampaignAttribution = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getCampaignAttribution } = await getQueries();
        return getCampaignAttribution(data.days);
    });

export const getStorefrontGeoBreakdown = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => paginatedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getGeoBreakdown } = await getQueries();
        return getGeoBreakdown(data.days, data.limit);
    });

export const getStorefrontTopPages = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => paginatedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getTopPages } = await getQueries();
        return getTopPages(data.days, data.limit);
    });

export const getStorefrontTopSearches = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => paginatedInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getTopSearches } = await getQueries();
        return getTopSearches(data.days, data.limit);
    });

export const getStorefrontDeviceBreakdown = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { getDeviceBreakdown } = await getQueries();
        return getDeviceBreakdown(data.days);
    });
