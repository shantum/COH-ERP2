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
    linkClicks: number;
    landingPageViews: number;
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
    linkClicks: number;
    landingPageViews: number;
    outboundClicks: number;
    uniqueClicks: number;
    addPaymentInfo: number;
    addToWishlist: number;
    searches: number;
    metaRoas: number;
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
    imageUrl: string | null;
    linkClicks: number;
    landingPageViews: number;
    qualityRanking: string | null;
    engagementRanking: string | null;
    conversionRanking: string | null;
    outboundClicks: number;
    uniqueClicks: number;
}

export interface MetaProductRow {
    productId: string;
    spend: number;
    impressions: number;
    clicks: number;
    cpc: number;
    ctr: number;
}

export interface MetaProductEnrichedRow extends MetaProductRow {
    productName: string | null;
    colorName: string | null;
    imageUrl: string | null;
    orders: number;
    unitsSold: number;
    revenue: number;
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

export interface MetaVideoRow {
    adId: string;
    adName: string;
    campaignName: string;
    spend: number;
    impressions: number;
    plays: number;
    thruPlays: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    p100: number;
    avgWatchTimeSec: number;
    purchases: number;
    purchaseValue: number;
    roas: number;
    imageUrl: string | null;
}

export interface MetaHourlyRow {
    hour: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchaseValue: number;
    roas: number;
}

/** Ad-level attribution: Meta ad matched to actual orders */
export interface MetaAdAttributionRow {
    adId: string;
    adName: string;
    adsetId: string;
    adsetName: string;
    campaignId: string;
    campaignName: string;
    spend: number;
    impressions: number;
    clicks: number;
    metaPurchases: number;
    metaPurchaseValue: number;
    metaRoas: number;
    /** Actual orders matched via UTM */
    orders: number;
    revenue: number;
    actualRoas: number;
    matchMethod: 'ad_id' | 'ad_name' | 'adset_proportional' | 'unmatched';
    imageUrl: string | null;
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

/**
 * Product-level breakdown (catalog/DPA ads) — impressions, clicks, spend per product
 * Enriched with Shopify sales data from DB (orders, revenue, units sold)
 */
export const getMetaProducts = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<MetaProductEnrichedRow[]> => {
        const { getProductInsights } = await getMetaClient();
        const metaRows = await getProductInsights(data.days);
        if (metaRows.length === 0) return [];

        // Meta catalog product_ids come in two formats:
        //   1. "shopify_IN_7895448256709_43530472063173" (region_productId_variantId)
        //   2. Raw numeric like "41448969928901" (usually a Shopify VARIANT ID, not product ID)
        // We need to resolve all of these to shopifyProductId for DB joins.

        const extractFromFormat = (metaProductId: string): { productId: string | null; variantId: string | null } => {
            // shopify_{REGION}_{productId}_{variantId}
            const full = metaProductId.match(/^shopify_[A-Za-z]+_(\d+)_(\d+)$/);
            if (full) return { productId: full[1], variantId: full[2] };
            // shopify_{REGION}_{productId} (no variant)
            const partial = metaProductId.match(/^shopify_[A-Za-z]+_(\d+)$/);
            if (partial) return { productId: partial[1], variantId: null };
            // Raw numeric — could be variant ID or product ID, resolve via DB
            if (/^\d+$/.test(metaProductId)) return { productId: null, variantId: metaProductId };
            return { productId: null, variantId: null };
        };

        // Separate IDs that we know are product IDs vs ones we need to resolve
        const metaToProductId = new Map<string, string>(); // metaProductId → shopifyProductId
        const unresolvedVariantIds: string[] = [];

        for (const r of metaRows) {
            const { productId, variantId } = extractFromFormat(r.productId);
            if (productId) {
                metaToProductId.set(r.productId, productId);
            } else if (variantId) {
                if (!unresolvedVariantIds.includes(variantId)) unresolvedVariantIds.push(variantId);
            }
        }

        // Resolve variant IDs → product IDs via DB
        const { sql } = await import('kysely');
        const { getKysely } = await import('@coh/shared/services/db');
        const db = await getKysely();

        if (unresolvedVariantIds.length > 0) {
            const variantLookup = await db
                .selectFrom('Sku as s')
                .innerJoin('Variation as v', 'v.id', 's.variationId')
                .innerJoin('Product as p', 'p.id', 'v.productId')
                .select(['s.shopifyVariantId', 'p.shopifyProductId'])
                .where('s.shopifyVariantId', 'in', unresolvedVariantIds)
                .execute() as Array<{ shopifyVariantId: string; shopifyProductId: string }>;

            const variantMap = new Map<string, string>();
            for (const row of variantLookup) {
                variantMap.set(row.shopifyVariantId, row.shopifyProductId);
            }

            // Map raw numeric Meta IDs to resolved product IDs
            for (const r of metaRows) {
                if (!metaToProductId.has(r.productId)) {
                    const { variantId } = extractFromFormat(r.productId);
                    if (variantId) {
                        const resolved = variantMap.get(variantId);
                        if (resolved) metaToProductId.set(r.productId, resolved);
                    }
                }
            }
        }

        // Collect unique shopifyProductIds
        const shopifyIds = [...new Set(metaToProductId.values())];

        if (shopifyIds.length === 0) return metaRows.map(r => ({
            ...r, productName: null, colorName: null, imageUrl: null,
            orders: 0, unitsSold: 0, revenue: 0, roas: 0,
        }));

        const startDate = new Date();
        if (data.days === 1) {
            startDate.setHours(0, 0, 0, 0);
        } else if (data.days === 2) {
            startDate.setDate(startDate.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
        } else {
            startDate.setDate(startDate.getDate() - data.days);
        }

        // Fetch product names, colors, images by shopifyProductId
        const productInfo = await db
            .selectFrom('Product as p')
            .innerJoin('Variation as v', 'v.productId', 'p.id')
            .select([
                'p.shopifyProductId',
                'p.name as productName',
                'v.colorName',
                'v.imageUrl',
            ])
            .where('p.shopifyProductId', 'in', shopifyIds)
            .execute() as Array<{
                shopifyProductId: string;
                productName: string;
                colorName: string;
                imageUrl: string | null;
            }>;

        // Fetch sales data by shopifyProductId for the date range
        const salesData = await db
            .selectFrom('OrderLine as ol')
            .innerJoin('Order as o', 'o.id', 'ol.orderId')
            .innerJoin('Sku as s', 's.id', 'ol.skuId')
            .innerJoin('Variation as v', 'v.id', 's.variationId')
            .innerJoin('Product as p', 'p.id', 'v.productId')
            .select([
                'p.shopifyProductId',
                sql<number>`COUNT(DISTINCT o.id)`.as('orders'),
                sql<number>`SUM(ol.qty)`.as('unitsSold'),
                sql<number>`ROUND(SUM(ol."unitPrice" * ol.qty)::numeric, 2)`.as('revenue'),
            ])
            .where('p.shopifyProductId', 'in', shopifyIds)
            .where('o.orderDate', '>=', startDate)
            .where('o.status', '!=', 'cancelled')
            .where('ol.lineStatus', 'not in', ['cancelled', 'returned'])
            .groupBy('p.shopifyProductId')
            .execute() as Array<{
                shopifyProductId: string;
                orders: number;
                unitsSold: number;
                revenue: number;
            }>;

        // Build lookup maps
        const infoMap = new Map<string, { productName: string; colorName: string; imageUrl: string | null }>();
        for (const row of productInfo) {
            if (!infoMap.has(row.shopifyProductId)) {
                infoMap.set(row.shopifyProductId, {
                    productName: row.productName,
                    colorName: row.colorName,
                    imageUrl: row.imageUrl,
                });
            }
        }

        const salesMap = new Map<string, { orders: number; unitsSold: number; revenue: number }>();
        for (const row of salesData) {
            salesMap.set(row.shopifyProductId, {
                orders: Number(row.orders),
                unitsSold: Number(row.unitsSold),
                revenue: Number(row.revenue),
            });
        }

        // Merge: multiple Meta variant rows may map to the same shopifyProductId,
        // so aggregate ad metrics per product and combine with DB data
        const productAgg = new Map<string, {
            metaIds: string[]; spend: number; impressions: number;
            clicks: number; cpc: number; ctr: number;
        }>();

        for (const r of metaRows) {
            const shopifyId = metaToProductId.get(r.productId);
            if (!shopifyId) continue;
            const existing = productAgg.get(shopifyId);
            if (existing) {
                existing.metaIds.push(r.productId);
                existing.spend += r.spend;
                existing.impressions += r.impressions;
                existing.clicks += r.clicks;
            } else {
                productAgg.set(shopifyId, {
                    metaIds: [r.productId],
                    spend: r.spend,
                    impressions: r.impressions,
                    clicks: r.clicks,
                    cpc: 0, ctr: 0,
                });
            }
        }

        // Build final enriched rows — one per product (not per variant)
        const result: MetaProductEnrichedRow[] = [];
        for (const [shopifyId, agg] of productAgg) {
            const info = infoMap.get(shopifyId);
            const sales = salesMap.get(shopifyId);
            const revenue = sales?.revenue ?? 0;
            const spend = agg.spend;
            result.push({
                productId: shopifyId,
                spend,
                impressions: agg.impressions,
                clicks: agg.clicks,
                cpc: agg.clicks > 0 ? Math.round((spend / agg.clicks) * 100) / 100 : 0,
                ctr: agg.impressions > 0 ? Math.round((agg.clicks / agg.impressions) * 10000) / 100 : 0,
                productName: info?.productName ?? null,
                colorName: info?.colorName ?? null,
                imageUrl: info?.imageUrl ?? null,
                orders: sales?.orders ?? 0,
                unitsSold: sales?.unitsSold ?? 0,
                revenue,
                roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
            });
        }

        // Include unresolved Meta rows (no DB match) at the end
        for (const r of metaRows) {
            if (!metaToProductId.has(r.productId)) {
                result.push({
                    ...r,
                    productName: null, colorName: null, imageUrl: null,
                    orders: 0, unitsSold: 0, revenue: 0, roas: 0,
                });
            }
        }

        return result;
    });

/**
 * Video ad performance — completion rates, watch time, dropoff
 */
export const getMetaVideo = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<MetaVideoRow[]> => {
        const { getVideoInsights } = await getMetaClient();
        return getVideoInsights(data.days);
    });

/**
 * Hourly performance breakdown — which hours perform best
 */
export const getMetaHourly = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<MetaHourlyRow[]> => {
        const { getHourlyInsights } = await getMetaClient();
        return getHourlyInsights(data.days);
    });

/**
 * Ad-level attribution — match Meta ads to actual orders via UTM fields.
 *
 * Three matching conventions:
 * 1. "facebook/paid" (BL campaigns): utmCampaign=campaign_id, utmTerm=adset_id, utmContent=ad_id
 * 2. "facebook/cpc" (newer TVC): utmCampaign=campaign_name, utmContent=adset_id, utmTerm=ad_id
 * 3. "COH_fb" (old TVC): utmCampaign=campaign_name, utmTerm=label, utmContent=ad_descriptor
 */
export const getMetaAdAttribution = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => daysInputSchema.parse(input))
    .handler(async ({ data }): Promise<MetaAdAttributionRow[]> => {
        const { getAdInsights, getAllCampaigns, getAllAdsets } = await getMetaClient();
        const { getKysely } = await import('@coh/shared/services/db');
        const db = await getKysely();

        // 1. Fetch Meta ad insights for the period
        const adRows = await getAdInsights(data.days);
        const campaigns = await getAllCampaigns();
        const adsets = await getAllAdsets();

        // Build lookup maps
        const campaignByName = new Map(campaigns.map(c => [c.campaignName, c.campaignId]));

        // 2. Query orders with Meta UTMs in the date range
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - data.days);

        const META_SOURCES = ['facebook', 'fb', 'COH_fb', 'etmedialabs-fb', 'Facebook_Ads', 'ig', 'meta'];

        const orders = await db
            .selectFrom('Order')
            .select([
                'id',
                'utmSource',
                'utmMedium',
                'utmCampaign',
                'utmTerm',
                'utmContent',
                'totalAmount',
            ])
            .where('orderDate', '>=', daysAgo)
            .where('utmSource', 'in', META_SOURCES)
            .where('orderStatus', '!=', 'cancelled')
            .execute();

        // 3. Match each order to a Meta ad
        // Build ad lookup by ID and by name
        const adById = new Map(adRows.map(a => [a.adId, a]));

        // Track order counts and revenue per ad
        const adOrderCount = new Map<string, number>();
        const adRevenue = new Map<string, number>();
        const adMatchMethod = new Map<string, 'ad_id' | 'ad_name' | 'adset_proportional'>();

        for (const order of orders) {
            const amount = Number(order.totalAmount ?? 0);
            let matchedAdId: string | null = null;
            let method: 'ad_id' | 'ad_name' | 'adset_proportional' = 'ad_id';

            // Convention 1: "facebook/paid" — utmContent is ad_id (numeric)
            if (order.utmContent && /^\d+$/.test(order.utmContent) && adById.has(order.utmContent)) {
                matchedAdId = order.utmContent;
                method = 'ad_id';
            }
            // Convention 2: "facebook/cpc" newer — utmTerm is ad_id (numeric)
            else if (order.utmTerm && /^\d+$/.test(order.utmTerm) && adById.has(order.utmTerm)) {
                matchedAdId = order.utmTerm;
                method = 'ad_id';
            }
            // Convention 3: "COH_fb" — utmContent is ad descriptor, match against ad names
            else if (order.utmContent && !/^\d+$/.test(order.utmContent)) {
                const descriptor = order.utmContent.toLowerCase();
                for (const ad of adRows) {
                    if (ad.adName.toLowerCase().includes(descriptor) ||
                        descriptor.includes(ad.adName.toLowerCase().replace(/\s+/g, '_'))) {
                        matchedAdId = ad.adId;
                        method = 'ad_name';
                        break;
                    }
                }
            }

            // Fallback: proportional attribution within adset
            if (!matchedAdId && order.utmTerm) {
                // utmTerm might be adset_id (for convention 1) or utmContent might be adset_id (convention 2)
                const possibleAdsetId = /^\d+$/.test(order.utmTerm) ? order.utmTerm
                    : (order.utmContent && /^\d+$/.test(order.utmContent) ? order.utmContent : null);

                if (possibleAdsetId) {
                    // Check if this is actually a known adset
                    const knownAdset = adsets.find(as => as.adsetId === possibleAdsetId);
                    // Find ads in this adset by matching adsetName from insights
                    const adsetAds = knownAdset
                        ? adRows.filter(ad => ad.adsetName === knownAdset.adsetName)
                        : [];

                    if (adsetAds.length > 0) {
                        // Assign to highest-spend ad in adset as proxy
                        adsetAds.sort((a, b) => b.spend - a.spend);
                        matchedAdId = adsetAds[0].adId;
                        method = 'adset_proportional';
                    }
                }
            }

            if (matchedAdId) {
                adOrderCount.set(matchedAdId, (adOrderCount.get(matchedAdId) ?? 0) + 1);
                adRevenue.set(matchedAdId, (adRevenue.get(matchedAdId) ?? 0) + amount);
                if (!adMatchMethod.has(matchedAdId)) adMatchMethod.set(matchedAdId, method);
            }
        }

        // 4. Build result rows — one per Meta ad, enriched with order data
        const result: MetaAdAttributionRow[] = adRows.map(ad => {
            const orderCount = adOrderCount.get(ad.adId) ?? 0;
            const revenue = adRevenue.get(ad.adId) ?? 0;
            const method = adMatchMethod.get(ad.adId) ?? 'unmatched';

            // Look up adset info
            // adRows already have adsetName and campaignName from insights
            // But we need IDs — find them from lookup
            const campaignId = campaignByName.get(ad.campaignName) ?? '';
            const adsetMatch = adsets.find(a => a.adsetName === ad.adsetName && a.campaignId === campaignId);

            return {
                adId: ad.adId,
                adName: ad.adName,
                adsetId: adsetMatch?.adsetId ?? '',
                adsetName: ad.adsetName,
                campaignId,
                campaignName: ad.campaignName,
                spend: ad.spend,
                impressions: ad.impressions,
                clicks: ad.clicks,
                metaPurchases: ad.purchases,
                metaPurchaseValue: ad.purchaseValue,
                metaRoas: ad.roas,
                orders: orderCount,
                revenue: Math.round(revenue * 100) / 100,
                actualRoas: ad.spend > 0 ? Math.round((revenue / ad.spend) * 100) / 100 : 0,
                matchMethod: orderCount > 0 ? method : 'unmatched',
                imageUrl: ad.imageUrl,
            };
        });

        // Sort by spend descending
        result.sort((a, b) => b.spend - a.spend);
        return result;
    });
