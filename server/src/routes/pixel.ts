import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import prisma from '../lib/prisma.js';

const router = Router();

// ============================================
// Rate limiting (per-IP, in-memory)
// ============================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now >= entry.resetAt) rateLimitMap.delete(ip);
    }
}, 5 * 60_000);

// Allowed event names (whitelist to reject spam payloads)
const VALID_EVENTS = new Set([
    'page_viewed', 'product_viewed', 'collection_viewed',
    'product_added_to_cart', 'product_removed_from_cart', 'cart_viewed',
    'checkout_started', 'checkout_completed',
    'payment_info_submitted', 'search_submitted',
    'checkout_address_info_submitted',
    'checkout_contact_info_submitted',
    'checkout_shipping_info_submitted',
]);

// ============================================
// Zod schemas
// ============================================

const storefrontEventSchema = z.object({
    eventName: z.string().min(1).max(100),
    eventTime: z.string(),
    sessionId: z.string().min(1).max(100),
    visitorId: z.string().min(1).max(100),
    shopifyEventId: z.string().max(100).optional(),
    shopifyClientId: z.string().max(100).optional(),
    shopifyTimestamp: z.string().optional(),
    shopifySeq: z.number().int().optional(),
    pageUrl: z.string().max(2000).optional(),
    referrer: z.string().max(2000).optional(),
    utmSource: z.string().max(200).optional(),
    utmMedium: z.string().max(200).optional(),
    utmCampaign: z.string().max(200).optional(),
    utmContent: z.string().max(200).optional(),
    utmTerm: z.string().max(200).optional(),
    productId: z.string().max(50).optional(),
    productTitle: z.string().max(500).optional(),
    variantId: z.string().max(50).optional(),
    variantTitle: z.string().max(500).optional(),
    collectionId: z.string().max(50).optional(),
    collectionTitle: z.string().max(500).optional(),
    searchQuery: z.string().max(500).optional(),
    cartValue: z.number().optional(),
    orderValue: z.number().optional(),
    userAgent: z.string().max(500).optional(),
    screenWidth: z.number().int().positive().optional(),
    screenHeight: z.number().int().positive().optional(),
    deviceType: z.enum(['mobile', 'tablet', 'desktop']).optional(),
    rawData: z.record(z.string(), z.any()).optional(),
});

const pixelBatchSchema = z.object({
    events: z.array(storefrontEventSchema).min(1).max(50),
});

// ============================================
// POST /api/pixel/events
// ============================================

router.post('/events', asyncHandler(async (req: Request, res: Response) => {
    // Origin validation — only accept from our store in production
    const origin = req.headers.origin || req.headers.referer || '';
    const isAllowedOrigin = /creaturesofhabit\.in|coh\.one/i.test(origin)
        || process.env.NODE_ENV !== 'production';
    if (!isAllowedOrigin) {
        res.status(403).end();
        return;
    }

    // Rate limiting
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (entry && now < entry.resetAt) {
        if (entry.count >= RATE_LIMIT_MAX) {
            res.status(429).end();
            return;
        }
        entry.count++;
    } else {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    }

    // Validate
    const parsed = pixelBatchSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    // Filter to only valid event names (reject spam)
    const validEvents = parsed.data.events.filter(e => VALID_EVENTS.has(e.eventName));
    if (validEvents.length === 0) {
        res.status(204).end();
        return;
    }

    // Geo from reverse proxy headers (Cloudflare / Caddy)
    const country = (req.headers['cf-ipcountry'] as string)
        || (req.headers['x-country'] as string)
        || undefined;
    const region = (req.headers['x-region'] as string) || undefined;

    // Bulk insert
    const rows = validEvents.map(e => ({
        eventName: e.eventName,
        eventTime: new Date(e.shopifyTimestamp || e.eventTime),
        sessionId: e.sessionId,
        visitorId: e.visitorId,
        ...(e.pageUrl ? { pageUrl: e.pageUrl } : {}),
        ...(e.referrer ? { referrer: e.referrer } : {}),
        ...(e.utmSource ? { utmSource: e.utmSource } : {}),
        ...(e.utmMedium ? { utmMedium: e.utmMedium } : {}),
        ...(e.utmCampaign ? { utmCampaign: e.utmCampaign } : {}),
        ...(e.utmContent ? { utmContent: e.utmContent } : {}),
        ...(e.utmTerm ? { utmTerm: e.utmTerm } : {}),
        ...(e.productId ? { productId: e.productId } : {}),
        ...(e.productTitle ? { productTitle: e.productTitle } : {}),
        ...(e.variantId ? { variantId: e.variantId } : {}),
        ...(e.variantTitle ? { variantTitle: e.variantTitle } : {}),
        ...(e.collectionId ? { collectionId: e.collectionId } : {}),
        ...(e.collectionTitle ? { collectionTitle: e.collectionTitle } : {}),
        ...(e.searchQuery ? { searchQuery: e.searchQuery } : {}),
        ...(e.cartValue != null ? { cartValue: e.cartValue } : {}),
        ...(e.orderValue != null ? { orderValue: e.orderValue } : {}),
        ...(e.userAgent ? { userAgent: e.userAgent } : {}),
        ...(e.screenWidth ? { screenWidth: e.screenWidth } : {}),
        ...(e.screenHeight ? { screenHeight: e.screenHeight } : {}),
        ...(e.deviceType ? { deviceType: e.deviceType } : {}),
        ...(country ? { country } : {}),
        ...(region ? { region } : {}),
        // Pack Shopify metadata + any extra data into rawData
        rawData: {
            ...(e.rawData || {}),
            ...(e.shopifyEventId ? { shopifyEventId: e.shopifyEventId } : {}),
            ...(e.shopifyClientId ? { shopifyClientId: e.shopifyClientId } : {}),
            ...(e.shopifyTimestamp ? { shopifyTimestamp: e.shopifyTimestamp } : {}),
            ...(e.shopifySeq != null ? { shopifySeq: e.shopifySeq } : {}),
        },
    }));

    try {
        await prisma.storefrontEvent.createMany({ data: rows });
    } catch (error: unknown) {
        console.error('[Pixel] Failed to insert events:', error instanceof Error ? error.message : error);
        res.status(500).end();
        return;
    }

    res.status(204).end();
}));

export default router;
