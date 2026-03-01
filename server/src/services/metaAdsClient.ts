/**
 * Meta (Facebook) Ads API Client
 *
 * Read-only client for pulling ad campaign performance data.
 * Uses the Marketing API Insights endpoint.
 *
 * Features:
 * - Rate limiting (200 calls/hr safe limit)
 * - Retry with exponential backoff
 * - In-memory cache with TTL
 * - Long-lived token with refresh capability
 */

import {
    META_BASE_URL,
    META_ACCESS_TOKEN,
    META_AD_ACCOUNT_ID,
    META_APP_ID,
    META_APP_SECRET,
    META_MIN_CALL_DELAY_MS,
    META_MAX_RETRIES,
    META_CACHE_TTL,
} from '../config/meta.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'meta-ads' });

// ============================================
// CACHE
// ============================================

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ============================================
// RATE LIMITER
// ============================================

let lastCallAt = 0;

async function rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastCallAt;
    if (elapsed < META_MIN_CALL_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, META_MIN_CALL_DELAY_MS - elapsed));
    }
    lastCallAt = Date.now();
}

// ============================================
// API CALL WITH RETRY
// ============================================

async function fetchWithRetry<T>(url: string, label: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= META_MAX_RETRIES; attempt++) {
        try {
            await rateLimit();
            const response = await fetch(url);
            const data = await response.json() as Record<string, unknown>;

            if (data.error) {
                const err = data.error as { message?: string; code?: number; error_subcode?: number };
                const error = new Error(err.message ?? 'Meta API error') as Error & { code: number };
                error.code = err.code ?? 0;

                // Rate limited or transient
                const isTransient = err.code === 4 || err.code === 17 || err.code === 32 || err.code === 2;
                if (!isTransient || attempt === META_MAX_RETRIES) throw error;

                const delay = Math.pow(2, attempt) * 1000;
                log.warn({ attempt: attempt + 1, delay, code: err.code, label }, 'Retrying after Meta API error');
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            return data as T;
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt === META_MAX_RETRIES) throw lastError;
        }
    }

    throw lastError ?? new Error(`${label}: exhausted retries`);
}

// ============================================
// DATE HELPERS
// ============================================

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getDateRange(days: number): { since: string; until: string } {
    const today = new Date();
    if (days === 1) {
        // Today only
        const d = formatDate(today);
        return { since: d, until: d };
    }
    if (days === 2) {
        // Yesterday only
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const d = formatDate(yesterday);
        return { since: d, until: d };
    }
    // Last N days
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { since: formatDate(start), until: formatDate(today) };
}

// ============================================
// PUBLIC API
// ============================================

export interface MetaInsightsResponse<T> {
    data: T[];
    paging?: {
        cursors?: { before: string; after: string };
        next?: string;
    };
}

/**
 * Get campaign-level insights from Meta Ads.
 */
export async function getCampaignInsights(days: number): Promise<MetaCampaignRow[]> {
    const cacheKey = `meta:campaigns:${days}`;
    const cached = getCached<MetaCampaignRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = [
        'campaign_name', 'campaign_id', 'objective',
        'spend', 'impressions', 'clicks', 'cpc', 'cpm', 'ctr',
        'actions', 'action_values', 'cost_per_action_type',
    ].join(',');

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&level=campaign`
        + `&limit=100`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawMetaCampaignRow>>(url, 'campaign-insights');

    const rows = (response.data ?? []).map(parseCampaignRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get daily spend/performance for a date range.
 */
export async function getDailyInsights(days: number): Promise<MetaDailyRow[]> {
    const cacheKey = `meta:daily:${days}`;
    const cached = getCached<MetaDailyRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = 'spend,impressions,clicks,actions,action_values';

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&time_increment=1`
        + `&limit=100`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawMetaDailyRow>>(url, 'daily-insights');

    // Handle pagination for large date ranges
    let allData = response.data ?? [];
    let nextUrl = response.paging?.next;
    while (nextUrl) {
        const page = await fetchWithRetry<MetaInsightsResponse<RawMetaDailyRow>>(nextUrl, 'daily-insights-page');
        allData = allData.concat(page.data ?? []);
        nextUrl = page.paging?.next;
    }

    const rows = allData.map(parseDailyRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get account-level summary for a date range.
 */
export async function getAccountSummary(days: number): Promise<MetaAccountSummary> {
    const cacheKey = `meta:summary:${days}`;
    const cached = getCached<MetaAccountSummary>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = 'spend,impressions,reach,frequency,clicks,cpc,cpm,ctr,actions,action_values';

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawSummaryRow>>(url, 'account-summary');
    const raw = response.data?.[0];

    const summary: MetaAccountSummary = {
        spend: Number(raw?.spend ?? 0),
        impressions: Number(raw?.impressions ?? 0),
        reach: Number(raw?.reach ?? 0),
        frequency: Number(raw?.frequency ?? 0),
        clicks: Number(raw?.clicks ?? 0),
        cpc: Number(raw?.cpc ?? 0),
        cpm: Number(raw?.cpm ?? 0),
        ctr: Number(raw?.ctr ?? 0),
        purchases: extractActionValue(raw?.actions, 'purchase'),
        purchaseValue: extractActionValue(raw?.action_values, 'purchase'),
        addToCarts: extractActionValue(raw?.actions, 'add_to_cart'),
        initiateCheckouts: extractActionValue(raw?.actions, 'initiate_checkout'),
        viewContents: extractActionValue(raw?.actions, 'view_content'),
        roas: 0,
    };
    if (summary.spend > 0) {
        summary.roas = Math.round((summary.purchaseValue / summary.spend) * 100) / 100;
    }

    setCache(cacheKey, summary, META_CACHE_TTL);
    return summary;
}

/**
 * Get adset-level insights from Meta Ads.
 */
export async function getAdsetInsights(days: number): Promise<MetaAdsetRow[]> {
    const cacheKey = `meta:adsets:${days}`;
    const cached = getCached<MetaAdsetRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = [
        'campaign_name', 'campaign_id', 'adset_name', 'adset_id',
        'spend', 'impressions', 'reach', 'clicks', 'cpc', 'cpm', 'ctr',
        'actions', 'action_values',
    ].join(',');

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&level=adset`
        + `&limit=200`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawAdsetRow>>(url, 'adset-insights');

    let allData = response.data ?? [];
    let nextUrl = response.paging?.next;
    while (nextUrl) {
        const page = await fetchWithRetry<MetaInsightsResponse<RawAdsetRow>>(nextUrl, 'adset-insights-page');
        allData = allData.concat(page.data ?? []);
        nextUrl = page.paging?.next;
    }

    const rows = allData.map(parseAdsetRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get ad-level insights from Meta Ads.
 */
export async function getAdInsights(days: number): Promise<MetaAdRow[]> {
    const cacheKey = `meta:ads:${days}`;
    const cached = getCached<MetaAdRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = [
        'campaign_name', 'campaign_id', 'adset_name', 'adset_id',
        'ad_name', 'ad_id',
        'spend', 'impressions', 'clicks', 'cpc', 'ctr',
        'actions', 'action_values',
    ].join(',');

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&level=ad`
        + `&limit=200`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawAdRow>>(url, 'ad-insights');

    let allData = response.data ?? [];
    let nextUrl = response.paging?.next;
    while (nextUrl) {
        const page = await fetchWithRetry<MetaInsightsResponse<RawAdRow>>(nextUrl, 'ad-insights-page');
        allData = allData.concat(page.data ?? []);
        nextUrl = page.paging?.next;
    }

    const rows = allData.map(parseAdRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get age + gender breakdown.
 */
export async function getAgeGenderInsights(days: number): Promise<MetaAgeGenderRow[]> {
    const cacheKey = `meta:age-gender:${days}`;
    const cached = getCached<MetaAgeGenderRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = 'spend,impressions,clicks,ctr,actions,action_values';

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&breakdowns=age,gender`
        + `&limit=100`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawAgeGenderRow>>(url, 'age-gender-insights');

    const rows = (response.data ?? []).map(parseAgeGenderRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get placement breakdown (publisher_platform + platform_position).
 */
export async function getPlacementInsights(days: number): Promise<MetaPlacementRow[]> {
    const cacheKey = `meta:placements:${days}`;
    const cached = getCached<MetaPlacementRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = 'spend,impressions,clicks,ctr,cpm,actions,action_values';

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&breakdowns=publisher_platform,platform_position`
        + `&limit=100`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawPlacementRow>>(url, 'placement-insights');

    const rows = (response.data ?? []).map(parsePlacementRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get region/country breakdown.
 */
export async function getRegionInsights(days: number): Promise<MetaRegionRow[]> {
    const cacheKey = `meta:regions:${days}`;
    const cached = getCached<MetaRegionRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = 'spend,impressions,clicks,actions,action_values';

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&breakdowns=region`
        + `&limit=100`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawRegionRow>>(url, 'region-insights');

    let allData = response.data ?? [];
    let nextUrl = response.paging?.next;
    while (nextUrl) {
        const page = await fetchWithRetry<MetaInsightsResponse<RawRegionRow>>(nextUrl, 'region-insights-page');
        allData = allData.concat(page.data ?? []);
        nextUrl = page.paging?.next;
    }

    const rows = allData.map(parseRegionRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Get device platform breakdown.
 */
export async function getDeviceInsights(days: number): Promise<MetaDeviceRow[]> {
    const cacheKey = `meta:devices:${days}`;
    const cached = getCached<MetaDeviceRow[]>(cacheKey);
    if (cached) return cached;

    const { since, until } = getDateRange(days);
    const fields = 'spend,impressions,clicks,actions,action_values';

    const url = `${META_BASE_URL}/${META_AD_ACCOUNT_ID}/insights`
        + `?fields=${fields}`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&breakdowns=device_platform`
        + `&limit=20`
        + `&access_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<MetaInsightsResponse<RawDeviceRow>>(url, 'device-insights');

    const rows = (response.data ?? []).map(parseDeviceRow);
    setCache(cacheKey, rows, META_CACHE_TTL);
    return rows;
}

/**
 * Refresh the long-lived token (call before it expires, ~every 50 days).
 * Returns the new token string.
 */
export async function refreshToken(): Promise<string> {
    const url = `${META_BASE_URL}/oauth/access_token`
        + `?grant_type=fb_exchange_token`
        + `&client_id=${META_APP_ID}`
        + `&client_secret=${META_APP_SECRET}`
        + `&fb_exchange_token=${META_ACCESS_TOKEN}`;

    const response = await fetchWithRetry<{ access_token: string; expires_in: number }>(url, 'refresh-token');
    log.info({ expiresIn: Math.round(response.expires_in / 86400) + ' days' }, 'Meta token refreshed');
    return response.access_token;
}

// ============================================
// TYPES
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
// RAW TYPES & PARSERS
// ============================================

interface MetaAction {
    action_type: string;
    value: string;
}

interface RawMetaCampaignRow {
    campaign_id: string;
    campaign_name: string;
    objective: string;
    spend: string;
    impressions: string;
    clicks: string;
    cpc: string;
    cpm: string;
    ctr: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
    cost_per_action_type?: MetaAction[];
}

interface RawSummaryRow {
    spend: string;
    impressions: string;
    reach?: string;
    frequency?: string;
    clicks: string;
    cpc?: string;
    cpm?: string;
    ctr?: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawMetaDailyRow {
    date_start: string;
    spend: string;
    impressions: string;
    clicks: string;
    cpc?: string;
    cpm?: string;
    ctr?: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawAdsetRow {
    adset_id: string;
    adset_name: string;
    campaign_id: string;
    campaign_name: string;
    spend: string;
    impressions: string;
    reach?: string;
    clicks: string;
    cpc: string;
    cpm: string;
    ctr: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawAdRow {
    ad_id: string;
    ad_name: string;
    adset_name: string;
    campaign_name: string;
    spend: string;
    impressions: string;
    clicks: string;
    cpc: string;
    ctr: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawAgeGenderRow {
    age: string;
    gender: string;
    spend: string;
    impressions: string;
    clicks: string;
    ctr: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawPlacementRow {
    publisher_platform: string;
    platform_position: string;
    spend: string;
    impressions: string;
    clicks: string;
    ctr: string;
    cpm?: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawRegionRow {
    region: string;
    spend: string;
    impressions: string;
    clicks: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

interface RawDeviceRow {
    device_platform: string;
    spend: string;
    impressions: string;
    clicks: string;
    actions?: MetaAction[];
    action_values?: MetaAction[];
}

function extractActionValue(actions: MetaAction[] | undefined, actionType: string): number {
    if (!actions) return 0;
    // Try exact match first, then omni_ prefix (Meta reports both)
    const exact = actions.find(a => a.action_type === actionType);
    if (exact) return Number(exact.value);
    const omni = actions.find(a => a.action_type === `omni_${actionType}`);
    return omni ? Number(omni.value) : 0;
}

function parseCampaignRow(raw: RawMetaCampaignRow): MetaCampaignRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    const costPerPurchase = extractActionValue(raw.cost_per_action_type, 'purchase');

    return {
        campaignId: raw.campaign_id,
        campaignName: raw.campaign_name,
        objective: raw.objective ?? '',
        spend,
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        cpc: Number(raw.cpc ?? 0),
        cpm: Number(raw.cpm ?? 0),
        ctr: Number(raw.ctr ?? 0),
        purchases,
        purchaseValue,
        costPerPurchase: costPerPurchase || (purchases > 0 ? spend / purchases : 0),
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
        addToCarts: extractActionValue(raw.actions, 'add_to_cart'),
    };
}

function parseDailyRow(raw: RawMetaDailyRow): MetaDailyRow {
    return {
        date: raw.date_start,
        spend: Number(raw.spend),
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        purchases: extractActionValue(raw.actions, 'purchase'),
        purchaseValue: extractActionValue(raw.action_values, 'purchase'),
    };
}

function parseAdsetRow(raw: RawAdsetRow): MetaAdsetRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    return {
        adsetId: raw.adset_id,
        adsetName: raw.adset_name,
        campaignId: raw.campaign_id,
        campaignName: raw.campaign_name,
        spend,
        impressions: Number(raw.impressions),
        reach: Number(raw.reach ?? 0),
        clicks: Number(raw.clicks),
        cpc: Number(raw.cpc ?? 0),
        cpm: Number(raw.cpm ?? 0),
        ctr: Number(raw.ctr ?? 0),
        purchases,
        purchaseValue,
        costPerPurchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
}

function parseAdRow(raw: RawAdRow): MetaAdRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    return {
        adId: raw.ad_id,
        adName: raw.ad_name,
        adsetName: raw.adset_name,
        campaignName: raw.campaign_name,
        spend,
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        cpc: Number(raw.cpc ?? 0),
        ctr: Number(raw.ctr ?? 0),
        purchases,
        purchaseValue,
        costPerPurchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
}

function parseAgeGenderRow(raw: RawAgeGenderRow): MetaAgeGenderRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    return {
        age: raw.age,
        gender: raw.gender,
        spend,
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        ctr: Number(raw.ctr ?? 0),
        purchases,
        purchaseValue,
        costPerPurchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
}

const PLACEMENT_LABELS: Record<string, Record<string, string>> = {
    facebook: {
        feed: 'Facebook Feed',
        story: 'Facebook Stories',
        right_hand_column: 'Right Column',
        instant_article: 'Instant Articles',
        marketplace: 'Marketplace',
        video_feeds: 'Facebook Video Feeds',
        search: 'Facebook Search',
        an_classic: 'Audience Network',
    },
    instagram: {
        stream: 'Instagram Feed',
        story: 'Instagram Stories',
        reels: 'Instagram Reels',
        explore: 'Instagram Explore',
        ig_search: 'Instagram Search',
        profile_feed: 'Instagram Profile Feed',
    },
};

function parsePlacementRow(raw: RawPlacementRow): MetaPlacementRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    const platform = raw.publisher_platform?.toLowerCase() ?? 'unknown';
    const position = raw.platform_position?.toLowerCase() ?? 'unknown';
    const label = PLACEMENT_LABELS[platform]?.[position]
        ?? `${platform.charAt(0).toUpperCase() + platform.slice(1)} ${position}`;
    return {
        platform,
        position,
        label,
        spend,
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        ctr: Number(raw.ctr ?? 0),
        cpm: Number(raw.cpm ?? 0),
        purchases,
        purchaseValue,
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
}

function parseRegionRow(raw: RawRegionRow): MetaRegionRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    return {
        region: raw.region ?? 'Unknown',
        spend,
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        purchases,
        purchaseValue,
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
}

function parseDeviceRow(raw: RawDeviceRow): MetaDeviceRow {
    const spend = Number(raw.spend);
    const purchases = extractActionValue(raw.actions, 'purchase');
    const purchaseValue = extractActionValue(raw.action_values, 'purchase');
    return {
        device: raw.device_platform ?? 'unknown',
        spend,
        impressions: Number(raw.impressions),
        clicks: Number(raw.clicks),
        purchases,
        purchaseValue,
        roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
}
