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

// Simple counters for observability (logged periodically)
let insertedCount = 0;
let droppedCount = 0;
let dedupedCount = 0;

setInterval(() => {
    if (insertedCount > 0 || droppedCount > 0 || dedupedCount > 0) {
        console.log(`[Pixel] inserted=${insertedCount} dropped=${droppedCount} deduped=${dedupedCount}`);
        insertedCount = 0;
        droppedCount = 0;
        dedupedCount = 0;
    }
}, 5 * 60_000);

// ============================================
// Zod schemas
// ============================================

const storefrontEventSchema = z.object({
    v: z.number().int().optional(),
    eventName: z.string().min(1).max(100),
    eventTime: z.string(),
    sessionId: z.string().min(1).max(100),
    visitorId: z.string().min(1).max(100),
    shopifyEventId: z.string().max(100).optional(),
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
    screenWidth: z.number().int().positive().optional(),
    deviceType: z.enum(['mobile', 'tablet', 'desktop']).optional(),
    // Geo fields injected by Cloudflare Worker
    country: z.string().max(100).optional(),
    region: z.string().max(200).optional(),
    city: z.string().max(200).optional(),
    latitude: z.string().max(20).optional(),
    longitude: z.string().max(20).optional(),
    clientIp: z.string().max(50).optional(),
    rawData: z.record(z.string(), z.any()).optional(),
});

const pixelBatchSchema = z.object({
    events: z.array(storefrontEventSchema).min(1).max(50),
});

// ============================================
// Dedupe cache (shopifyEventId → true, TTL 5 min)
// ============================================

const recentEventIds = new Map<string, number>();

setInterval(() => {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [id, ts] of recentEventIds) {
        if (ts < cutoff) recentEventIds.delete(id);
    }
}, 60_000);

// ============================================
// POST /api/pixel/events
// ============================================

router.post('/events', asyncHandler(async (req: Request, res: Response) => {
    // Origin validation
    // Shopify custom pixels run in a sandboxed iframe that sends Origin: null.
    // We allow null + our own domains. Rate limiting + event whitelist + Zod are the real guards.
    const origin = (req.headers.origin || '') as string;
    const isAllowedOrigin = origin === 'null' || origin === ''
        || /creaturesofhabit\.in|coh\.one|shopify\.com|shopifycdn\.com/i.test(origin)
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
        droppedCount++;
        console.error('[Pixel] Zod validation failed:', JSON.stringify(parsed.error.issues));
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    // Filter valid events + dedupe by shopifyEventId
    const validEvents = parsed.data.events.filter(e => {
        if (!VALID_EVENTS.has(e.eventName)) return false;
        if (e.shopifyEventId) {
            if (recentEventIds.has(e.shopifyEventId)) {
                dedupedCount++;
                return false;
            }
            recentEventIds.set(e.shopifyEventId, Date.now());
        }
        return true;
    });

    if (validEvents.length === 0) {
        res.status(204).end();
        return;
    }

    // Geo is injected into the payload by the Cloudflare Worker — no server-side lookup needed

    // Bulk insert
    const rows = validEvents.map(e => ({
        eventName: e.eventName,
        eventTime: new Date(e.eventTime),
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
        ...(e.screenWidth ? { screenWidth: e.screenWidth } : {}),
        ...(e.deviceType ? { deviceType: e.deviceType } : {}),
        ...(e.country ? { country: e.country } : {}),
        ...(e.region ? { region: e.region } : {}),
        ...(e.city ? { city: e.city } : {}),
        ...(e.latitude ? { latitude: e.latitude } : {}),
        ...(e.longitude ? { longitude: e.longitude } : {}),
        ...(e.clientIp ? { clientIp: e.clientIp } : {}),
        rawData: {
            ...(e.rawData || {}),
            ...(e.shopifyEventId ? { shopifyEventId: e.shopifyEventId } : {}),
            ...(e.shopifySeq != null ? { shopifySeq: e.shopifySeq } : {}),
            ...(e.v != null ? { pixelVersion: e.v } : {}),
        },
    }));

    try {
        await prisma.storefrontEvent.createMany({ data: rows });
        insertedCount += rows.length;
    } catch (error: unknown) {
        droppedCount += rows.length;
        console.error('[Pixel] Failed to insert events:', error instanceof Error ? error.message : error);
        res.status(500).end();
        return;
    }

    res.status(204).end();
}));

export default router;
