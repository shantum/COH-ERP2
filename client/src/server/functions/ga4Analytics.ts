/**
 * GA4 Growth Analytics Server Functions
 *
 * Queries GA4 event data via the Analytics Data API for the growth dashboard.
 * BigQuery can be added later as an enrichment layer when the export is active.
 *
 * IMPORTANT: GA4 API imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// RE-EXPORT TYPES from the API client
// ============================================

export type {
    FunnelDay,
    FunnelSummary,
    ConversionFunnelResponse,
    CampaignFunnelRow,
    LandingPageRow,
    TrafficSourceRow,
    CampaignRow,
    GeoRow,
    DeviceRow,
    GrowthOverview,
    ProductRow,
    ProductPerformanceResponse,
} from '@server/services/ga4ApiClient.js';

// ============================================
// INPUT SCHEMAS
// ============================================

const daysInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
});

const landingPagesInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(200).default(50),
});

const geoInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(200).default(50),
});

const productInputSchema = z.object({
    days: z.number().int().min(1).max(365).default(30),
    limit: z.number().int().min(1).max(200).default(50),
});

// ============================================
// HELPERS
// ============================================

async function getGa4Client() {
    return import('@server/services/ga4ApiClient.js');
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Conversion Funnel — sessions → add_to_cart → checkout → purchase
 */
export const getConversionFunnel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryConversionFunnel } = await getGa4Client();
        return queryConversionFunnel(data.days);
    });

/**
 * Landing Page Performance
 */
export const getLandingPages = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => landingPagesInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryLandingPages } = await getGa4Client();
        return queryLandingPages(data.days, data.limit);
    });

/**
 * Traffic Sources — source/medium breakdown
 */
export const getTrafficSources = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryTrafficSources } = await getGa4Client();
        return queryTrafficSources(data.days);
    });

/**
 * Campaign Performance
 */
export const getCampaigns = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryCampaigns } = await getGa4Client();
        return queryCampaigns(data.days);
    });

/**
 * Geographic Conversion — by city (India only)
 */
export const getGeoConversion = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => geoInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryGeoConversion } = await getGa4Client();
        return queryGeoConversion(data.days, data.limit);
    });

/**
 * Device Breakdown — mobile/desktop/tablet
 */
export const getDeviceBreakdown = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryDeviceBreakdown } = await getGa4Client();
        return queryDeviceBreakdown(data.days);
    });

/**
 * Growth Overview — KPI summary for the overview tab
 */
export const getGrowthOverview = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryGrowthOverview } = await getGa4Client();
        return queryGrowthOverview(data.days);
    });

/**
 * Product Performance — items viewed, added to cart, purchased
 */
export const getProductPerformance = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => productInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryProductPerformance } = await getGa4Client();
        return queryProductPerformance(data.days, data.limit);
    });

/**
 * Campaign Funnel — funnel stages per Google Ads campaign (via GA4 sessionCampaignName)
 */
export const getCampaignFunnel = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }) => {
        const { queryCampaignFunnel } = await getGa4Client();
        return queryCampaignFunnel(data.days);
    });

/**
 * GA4 Health Check — verify API is accessible
 */
export const getGA4Health = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const { checkApiHealth } = await getGa4Client();
        return checkApiHealth();
    });
