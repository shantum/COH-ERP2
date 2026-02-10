/**
 * Facebook Feed Health Monitor
 *
 * Fetches the OneCommerce/Socialshop XML feed, parses every item,
 * and compares price / stock / availability against ERP + Shopify cache.
 * Returns a list of discrepancies so the team can spot issues fast.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { XMLParser } from 'fast-xml-parser';
import { authenticateToken } from '../../middleware/auth.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { shopifyLogger } from '../../utils/logger.js';
import prisma from '../../lib/prisma.js';
import {
    FACEBOOK_FEED_URL,
    FEED_HEALTH_CACHE_DURATION_MS,
    PRICE_TOLERANCE,
    DB_CHUNK_SIZE,
} from '../../config/sync/index.js';

const router = Router();
const log = shopifyLogger.child({ module: 'facebook-feed-health' });

// ============================================
// TYPES
// ============================================

interface FeedItem {
    /** g:id — typically the Shopify variant ID */
    id: string;
    /** g:title */
    title: string;
    /** g:price — e.g. "1299.00 INR" */
    price: string;
    /** g:availability — "in stock" or "out of stock" */
    availability: string;
    /** g:item_group_id — the Shopify product ID */
    itemGroupId: string;
    /** g:product_type */
    productType: string;
    /** g:link */
    link: string;
    /** g:image_link */
    imageLink: string;
    /** g:color (from g:color or g:custom_label_0) */
    color: string;
    /** g:size */
    size: string;
    /** g:inventory — stock quantity if present */
    inventory: number | null;
}

type IssueSeverity = 'critical' | 'warning' | 'info';
type IssueType =
    | 'price_mismatch'
    | 'stock_mismatch'
    | 'availability_wrong'
    | 'not_in_erp'
    | 'not_in_shopify_cache'
    | 'metadata_mismatch';

interface FeedIssue {
    severity: IssueSeverity;
    type: IssueType;
    variantId: string;
    productId: string;
    title: string;
    color: string;
    size: string;
    message: string;
    feedValue: string;
    erpValue: string;
    shopifyValue: string;
}

interface FeedHealthStats {
    totalFeedItems: number;
    matchedToErp: number;
    matchedToShopify: number;
    criticalIssues: number;
    warnings: number;
    infoIssues: number;
}

interface FeedHealthResult {
    stats: FeedHealthStats;
    issues: FeedIssue[];
    lastFetched: string;
    feedUrl: string;
}

// ============================================
// IN-MEMORY CACHE
// ============================================

let cache: { data: FeedHealthResult; fetchedAt: number } | null = null;

// ============================================
// XML PARSING HELPERS
// ============================================

function parsePrice(priceStr: string): number {
    // "1299.00 INR" → 1299
    const match = String(priceStr ?? '').match(/([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
}

function parseXmlFeed(xml: string): FeedItem[] {
    const parser = new XMLParser({
        ignoreAttributes: false,
        // The g: namespace prefix shows up in tag names
        removeNSPrefix: true,
    });

    const parsed = parser.parse(xml) as Record<string, unknown>;

    // Navigate: rss > channel > item (or feed > entry)
    let items: Record<string, unknown>[] = [];

    const rss = parsed['rss'] as Record<string, unknown> | undefined;
    if (rss) {
        const channel = rss['channel'] as Record<string, unknown> | undefined;
        if (channel) {
            const rawItems = channel['item'];
            items = Array.isArray(rawItems) ? rawItems as Record<string, unknown>[] : rawItems ? [rawItems as Record<string, unknown>] : [];
        }
    }

    // Fallback: Atom feed
    if (items.length === 0) {
        const feed = parsed['feed'] as Record<string, unknown> | undefined;
        if (feed) {
            const rawEntries = feed['entry'];
            items = Array.isArray(rawEntries) ? rawEntries as Record<string, unknown>[] : rawEntries ? [rawEntries as Record<string, unknown>] : [];
        }
    }

    return items.map(item => ({
        id: String(item['id'] ?? ''),
        title: String(item['title'] ?? ''),
        price: String(item['sale_price'] ?? item['price'] ?? ''),
        availability: String(item['availability'] ?? ''),
        itemGroupId: String(item['item_group_id'] ?? ''),
        productType: String(item['product_type'] ?? ''),
        link: String(item['link'] ?? ''),
        imageLink: String(item['image_link'] ?? ''),
        color: String(item['color'] ?? ''),
        size: String(item['size'] ?? ''),
        inventory: item['inventory'] != null ? Number(item['inventory']) : null,
    }));
}

// ============================================
// FEED FETCH
// ============================================

async function fetchFeedXml(url: string): Promise<string> {
    log.info({ url }, 'Fetching Facebook feed XML');
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Feed fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
}

// ============================================
// CHUNK HELPER
// ============================================

function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// ============================================
// MAIN COMPARISON LOGIC
// ============================================

async function buildFeedHealth(): Promise<FeedHealthResult> {
    const startTime = Date.now();

    // 1. Fetch XML (uses custom https to handle broken TLS on feed server)
    log.info({ url: FACEBOOK_FEED_URL }, 'Fetching Facebook feed XML');
    const xml = await fetchFeedXml(FACEBOOK_FEED_URL);
    log.info({ bytes: xml.length }, 'Feed XML downloaded');

    // 2. Parse XML
    const feedItems = parseXmlFeed(xml);
    log.info({ items: feedItems.length }, 'Feed items parsed');

    // 3. Collect variant IDs and product IDs
    const variantIds = feedItems.map(item => item.id).filter(Boolean);
    const productIds = [...new Set(feedItems.map(item => item.itemGroupId).filter(Boolean))];

    // 4. Query ERP SKUs by shopifyVariantId — chunked
    // prisma is the module-level default import
    const erpSkuMap = new Map<string, {
        skuCode: string;
        mrp: number;
        currentBalance: number;
        size: string;
        colorName: string;
        productName: string;
    }>();

    const variantChunks = chunk(variantIds, DB_CHUNK_SIZE);
    for (const variantChunk of variantChunks) {
        const skus = await prisma.sku.findMany({
            where: { shopifyVariantId: { in: variantChunk } },
            select: {
                shopifyVariantId: true,
                skuCode: true,
                mrp: true,
                currentBalance: true,
                size: true,
                variation: {
                    select: {
                        colorName: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });
        for (const sku of skus) {
            if (sku.shopifyVariantId) {
                erpSkuMap.set(sku.shopifyVariantId, {
                    skuCode: sku.skuCode,
                    mrp: sku.mrp,
                    currentBalance: sku.currentBalance,
                    size: sku.size,
                    colorName: sku.variation.colorName,
                    productName: sku.variation.product.name,
                });
            }
        }
    }
    log.info({ erpMatches: erpSkuMap.size }, 'ERP SKUs loaded');

    // 5. Query ShopifyProductCache by product IDs — chunked
    interface RawShopifyVariant {
        id: number;
        price?: string;
        inventory_quantity?: number;
    }
    interface RawShopifyCacheProduct {
        variants?: RawShopifyVariant[];
    }

    const shopifyVariantMap = new Map<string, {
        price: number;
        inventoryQuantity: number;
    }>();

    const productChunks = chunk(productIds, DB_CHUNK_SIZE);
    for (const productChunk of productChunks) {
        const cacheEntries = await prisma.shopifyProductCache.findMany({
            where: { id: { in: productChunk } },
            select: { id: true, rawData: true },
        });
        for (const entry of cacheEntries) {
            try {
                const raw = JSON.parse(entry.rawData) as RawShopifyCacheProduct;
                for (const v of raw.variants ?? []) {
                    shopifyVariantMap.set(String(v.id), {
                        price: parseFloat(v.price ?? '0'),
                        inventoryQuantity: v.inventory_quantity ?? 0,
                    });
                }
            } catch {
                // Skip corrupt cache entries
            }
        }
    }
    log.info({ shopifyMatches: shopifyVariantMap.size }, 'Shopify cache loaded');

    // 6. Compare each feed item
    const issues: FeedIssue[] = [];
    let matchedToErp = 0;
    let matchedToShopify = 0;

    for (const item of feedItems) {
        const erp = erpSkuMap.get(item.id);
        const shopify = shopifyVariantMap.get(item.id);
        const feedPrice = parsePrice(item.price);

        if (erp) matchedToErp++;
        if (shopify) matchedToShopify++;

        // Not in ERP
        if (!erp) {
            issues.push({
                severity: 'warning',
                type: 'not_in_erp',
                variantId: item.id,
                productId: item.itemGroupId,
                title: item.title,
                color: item.color,
                size: item.size,
                message: 'Feed variant not found in ERP',
                feedValue: item.id,
                erpValue: '-',
                shopifyValue: shopify ? 'found' : '-',
            });
        }

        // Not in Shopify cache
        if (!shopify) {
            issues.push({
                severity: 'warning',
                type: 'not_in_shopify_cache',
                variantId: item.id,
                productId: item.itemGroupId,
                title: item.title,
                color: item.color,
                size: item.size,
                message: 'Feed product not in Shopify cache',
                feedValue: item.itemGroupId,
                erpValue: erp ? 'found' : '-',
                shopifyValue: '-',
            });
        }

        // Price mismatch vs ERP
        if (erp && Math.abs(feedPrice - erp.mrp) > PRICE_TOLERANCE) {
            issues.push({
                severity: 'critical',
                type: 'price_mismatch',
                variantId: item.id,
                productId: item.itemGroupId,
                title: item.title,
                color: item.color,
                size: item.size,
                message: `Price mismatch: feed ${feedPrice} vs ERP ${erp.mrp}`,
                feedValue: String(feedPrice),
                erpValue: String(erp.mrp),
                shopifyValue: shopify ? String(shopify.price) : '-',
            });
        }

        // Price mismatch vs Shopify
        if (shopify && Math.abs(feedPrice - shopify.price) > PRICE_TOLERANCE) {
            // Only add if we haven't already flagged ERP price mismatch
            const alreadyFlagged = erp && Math.abs(feedPrice - erp.mrp) > PRICE_TOLERANCE;
            if (!alreadyFlagged) {
                issues.push({
                    severity: 'critical',
                    type: 'price_mismatch',
                    variantId: item.id,
                    productId: item.itemGroupId,
                    title: item.title,
                    color: item.color,
                    size: item.size,
                    message: `Price mismatch: feed ${feedPrice} vs Shopify ${shopify.price}`,
                    feedValue: String(feedPrice),
                    erpValue: erp ? String(erp.mrp) : '-',
                    shopifyValue: String(shopify.price),
                });
            }
        }

        // Stock mismatch skipped — feed stock lags behind ERP/Shopify by design

        // Availability wrong — feed says "in stock" but both sources say 0
        const feedInStock = item.availability.toLowerCase().includes('in stock');
        const erpZero = erp ? erp.currentBalance <= 0 : false;
        const shopifyZero = shopify ? shopify.inventoryQuantity <= 0 : false;

        if (feedInStock && erpZero && shopifyZero && (erp || shopify)) {
            issues.push({
                severity: 'critical',
                type: 'availability_wrong',
                variantId: item.id,
                productId: item.itemGroupId,
                title: item.title,
                color: item.color,
                size: item.size,
                message: 'Feed says "in stock" but ERP & Shopify both show 0',
                feedValue: item.availability,
                erpValue: erp ? String(erp.currentBalance) : '-',
                shopifyValue: shopify ? String(shopify.inventoryQuantity) : '-',
            });
        }

        // Availability wrong — feed says "out of stock" but ERP shows stock
        const feedOutOfStock = item.availability.toLowerCase().includes('out of stock');
        if (feedOutOfStock && erp && erp.currentBalance > 0) {
            issues.push({
                severity: 'warning',
                type: 'availability_wrong',
                variantId: item.id,
                productId: item.itemGroupId,
                title: item.title,
                color: item.color,
                size: item.size,
                message: `Feed says "out of stock" but ERP has ${erp.currentBalance}`,
                feedValue: item.availability,
                erpValue: String(erp.currentBalance),
                shopifyValue: shopify ? String(shopify.inventoryQuantity) : '-',
            });
        }
    }

    // Sort: critical first, then warning, then info
    const severityOrder: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const stats: FeedHealthStats = {
        totalFeedItems: feedItems.length,
        matchedToErp,
        matchedToShopify,
        criticalIssues: issues.filter(i => i.severity === 'critical').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        infoIssues: issues.filter(i => i.severity === 'info').length,
    };

    const elapsed = Date.now() - startTime;
    log.info({ stats, elapsed }, 'Feed health check complete');

    return {
        stats,
        issues,
        lastFetched: new Date().toISOString(),
        feedUrl: FACEBOOK_FEED_URL,
    };
}

// ============================================
// ENDPOINT
// ============================================

router.get('/facebook-feed-health', authenticateToken, asyncHandler(async (_req: Request, res: Response) => {
    // Return cached result if fresh enough
    if (cache && Date.now() - cache.fetchedAt < FEED_HEALTH_CACHE_DURATION_MS) {
        log.debug('Returning cached feed health result');
        res.json(cache.data);
        return;
    }

    const result = await buildFeedHealth();
    cache = { data: result, fetchedAt: Date.now() };
    res.json(result);
}));

// Force refresh (bypasses cache)
router.post('/facebook-feed-health/refresh', authenticateToken, asyncHandler(async (_req: Request, res: Response) => {
    log.info('Force-refreshing feed health');
    cache = null;
    const result = await buildFeedHealth();
    cache = { data: result, fetchedAt: Date.now() };
    res.json(result);
}));

export default router;
