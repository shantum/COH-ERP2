/**
 * Google Ads REST API Client
 *
 * Complements BigQuery Data Transfer with data only available via the API:
 * - Image asset URLs (thumbnails)
 * - YouTube video IDs
 * - Asset group ad strength (POOR/AVERAGE/GOOD/EXCELLENT)
 *
 * Uses OAuth2 refresh token flow. Credentials in .env:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
 *   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN,
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID
 */

import { GOOGLE_ADS_CUSTOMER_ID, GADS_CACHE_TTL } from '../config/googleAds.js';

const API_VERSION = 'v23';
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

// ============================================
// AUTH
// ============================================

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
        return _cachedToken.token;
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Google Ads API credentials (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN)');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!data.access_token) {
        throw new Error(`Google Ads token refresh failed: ${data.error} - ${data.error_description}`);
    }

    _cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
}

// ============================================
// GAQL QUERY
// ============================================

interface SearchStreamBatch {
    results?: Array<Record<string, unknown>>;
}

async function gaqlQuery<T = Record<string, unknown>>(query: string): Promise<T[]> {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

    if (!developerToken) throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN');

    const accessToken = await getAccessToken();
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    const res = await fetch(
        `${BASE_URL}/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:searchStream`,
        { method: 'POST', headers, body: JSON.stringify({ query }) },
    );

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google Ads API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const batches = await res.json() as SearchStreamBatch[];
    return batches.flatMap(b => (b.results ?? []) as T[]);
}

// ============================================
// CACHE
// ============================================

const cache = new Map<string, { data: unknown; expiresAt: number }>();

function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.data as T);
    return fn().then(data => {
        cache.set(key, { data, expiresAt: Date.now() + ttl });
        return data;
    });
}

// ============================================
// PUBLIC TYPES
// ============================================

export interface GAdsPMaxAssetMedia {
    assetId: string;
    assetName: string;
    assetType: string;
    fieldType: string;
    assetGroupName: string;
    campaignId: string;
    campaignName: string;
    imageUrl: string | null;
    imageWidth: number | null;
    imageHeight: number | null;
    youtubeVideoId: string | null;
    youtubeVideoTitle: string | null;
}

export interface GAdsPMaxAssetGroupStrength {
    assetGroupId: string;
    assetGroupName: string;
    adStrength: string;
    status: string;
    campaignId: string;
    campaignName: string;
}

// ============================================
// QUERIES
// ============================================

/**
 * Fetch all PMax asset media (images + videos) with URLs.
 * Joins asset_group_asset → asset to get image URLs and YouTube IDs.
 */
export async function getPMaxAssetMedia(): Promise<GAdsPMaxAssetMedia[]> {
    return cached('gads-api:pmax-asset-media', GADS_CACHE_TTL, async () => {
        interface ApiRow {
            campaign: { resourceName: string; name: string };
            assetGroup: { resourceName: string; name: string };
            asset: {
                id: string; name?: string; type: string;
                imageAsset?: { fullSize?: { url?: string; widthPixels?: string; heightPixels?: string } };
                youtubeVideoAsset?: { youtubeVideoId?: string; youtubeVideoTitle?: string };
            };
            assetGroupAsset: { fieldType: string };
        }

        const rows = await gaqlQuery<ApiRow>(`
            SELECT asset_group_asset.field_type,
                   asset.id, asset.name, asset.type,
                   asset.image_asset.full_size.url,
                   asset.image_asset.full_size.width_pixels,
                   asset.image_asset.full_size.height_pixels,
                   asset.youtube_video_asset.youtube_video_id,
                   asset.youtube_video_asset.youtube_video_title,
                   asset_group.name, campaign.id, campaign.name
            FROM asset_group_asset
            WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
                AND asset.type IN ('IMAGE', 'YOUTUBE_VIDEO')
        `);

        return rows.map(r => {
            const campaignId = r.campaign.resourceName.split('/').pop() ?? '';
            return {
                assetId: r.asset.id,
                assetName: r.asset.name ?? '',
                assetType: r.asset.type,
                fieldType: r.assetGroupAsset.fieldType,
                assetGroupName: r.assetGroup.name,
                campaignId,
                campaignName: r.campaign.name,
                imageUrl: r.asset.imageAsset?.fullSize?.url ?? null,
                imageWidth: r.asset.imageAsset?.fullSize?.widthPixels ? Number(r.asset.imageAsset.fullSize.widthPixels) : null,
                imageHeight: r.asset.imageAsset?.fullSize?.heightPixels ? Number(r.asset.imageAsset.fullSize.heightPixels) : null,
                youtubeVideoId: r.asset.youtubeVideoAsset?.youtubeVideoId ?? null,
                youtubeVideoTitle: r.asset.youtubeVideoAsset?.youtubeVideoTitle ?? null,
            };
        });
    });
}

/**
 * Fetch asset group ad strength for all PMax campaigns.
 */
export async function getPMaxAssetGroupStrength(): Promise<GAdsPMaxAssetGroupStrength[]> {
    return cached('gads-api:pmax-ag-strength', GADS_CACHE_TTL, async () => {
        interface ApiRow {
            campaign: { resourceName: string; name: string };
            assetGroup: { id: string; name: string; adStrength: string; status: string };
        }

        const rows = await gaqlQuery<ApiRow>(`
            SELECT asset_group.id, asset_group.name, asset_group.ad_strength, asset_group.status,
                   campaign.id, campaign.name
            FROM asset_group
            WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
        `);

        return rows.map(r => ({
            assetGroupId: r.assetGroup.id,
            assetGroupName: r.assetGroup.name,
            adStrength: r.assetGroup.adStrength,
            status: r.assetGroup.status,
            campaignId: r.campaign.resourceName.split('/').pop() ?? '',
            campaignName: r.campaign.name,
        }));
    });
}
