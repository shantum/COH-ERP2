import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError, ExternalServiceError } from '../utils/errors.js';
import shopifyClient from '../services/shopify.js';
import syncWorker from '../services/syncWorker.js';
import { syncAllProducts } from '../services/productSyncService.js';
import { syncCustomers, syncAllCustomers } from '../services/customerSyncService.js';
import { findOrCreateCustomer } from '../utils/customerUtils.js';
import { processFromCache, markCacheProcessed, markCacheError, cacheShopifyOrder } from '../services/shopifyOrderProcessor.js';
import scheduledSync from '../services/scheduledSync.js';
import { runAllCleanup, getCacheStats } from '../utils/cacheCleanup.js';
import { detectPaymentMethod } from '../utils/shopifyHelpers.js';


const router = Router();

// ============================================
// CONFIGURATION
// ============================================

router.get('/config', authenticateToken, asyncHandler(async (req, res) => {
    // Reload from database to get latest
    await shopifyClient.loadFromDatabase();
    const config = shopifyClient.getConfig();

    res.json({
        shopDomain: config.shopDomain || '',
        apiVersion: config.apiVersion,
        hasAccessToken: !!shopifyClient.accessToken,
    });
}));

router.put('/config', authenticateToken, asyncHandler(async (req, res) => {
    const { shopDomain, accessToken } = req.body;

    if (!shopDomain || !accessToken) {
        throw new ValidationError('Shop domain and access token are required');
    }

    // Validate the domain format
    const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    await shopifyClient.updateConfig(cleanDomain, accessToken);

    res.json({
        message: 'Shopify configuration updated',
        shopDomain: cleanDomain,
    });
}));

router.post('/test-connection', authenticateToken, asyncHandler(async (req, res) => {
    // Reload config from database
    await shopifyClient.loadFromDatabase();

    console.log('Testing Shopify connection...');
    console.log('Shop domain:', shopifyClient.shopDomain);
    console.log('Token configured:', !!shopifyClient.accessToken);

    if (!shopifyClient.isConfigured()) {
        return res.json({
            success: false,
            message: 'Shopify credentials not configured',
        });
    }

    try {
        // Try to fetch order count to verify connection
        const orderCount = await shopifyClient.getOrderCount();
        const customerCount = await shopifyClient.getCustomerCount();

        res.json({
            success: true,
            message: 'Connection successful',
            stats: {
                totalOrders: orderCount,
                totalCustomers: customerCount,
            },
        });
    } catch (error) {
        console.error('Shopify test connection error:', error.response?.data || error.message);

        let errorMessage = error.message;
        const status = error.response?.status;

        if (status === 401) {
            errorMessage = 'Invalid access token. Please check your Admin API access token.';
        } else if (status === 403) {
            errorMessage = 'Access forbidden. Your access token may be missing required API scopes. Required scopes: read_orders, read_customers. Go to Shopify Admin → Settings → Apps → Develop apps → Your app → API scopes.';
        } else if (status === 404) {
            errorMessage = 'Shop not found. Please check the shop domain format (e.g., yourstore.myshopify.com)';
        } else if (error.response?.data?.errors) {
            errorMessage = typeof error.response.data.errors === 'string'
                ? error.response.data.errors
                : JSON.stringify(error.response.data.errors);
        }

        res.json({
            success: false,
            message: errorMessage,
            statusCode: status,
        });
    }
}));

// ============================================
// STATUS CHECK
// ============================================

router.get('/status', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();
    const config = shopifyClient.getConfig();

    if (!config.configured) {
        return res.json({
            connected: false,
            message: 'Shopify credentials not configured',
            config: {
                shopDomain: null,
                apiVersion: config.apiVersion,
            },
        });
    }

    try {
        // Try to fetch order count to verify connection
        const orderCount = await shopifyClient.getOrderCount();
        const customerCount = await shopifyClient.getCustomerCount();

        res.json({
            connected: true,
            shopDomain: config.shopDomain,
            apiVersion: config.apiVersion,
            stats: {
                totalOrders: orderCount,
                totalCustomers: customerCount,
            },
        });
    } catch (error) {
        console.error('Shopify status check error:', error);
        res.json({
            connected: false,
            message: error.response?.data?.errors || error.message,
            config: shopifyClient.getConfig(),
        });
    }
}));

// ============================================
// PRODUCT SYNC
// ============================================

router.post('/sync/products', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const { limit = 50, syncAll = false } = req.body;

    try {
        // Use shared service for product sync
        const { shopifyProducts, results } = await syncAllProducts(req.prisma, {
            limit,
            syncAll,
        });

        res.json({
            message: 'Product sync completed',
            fetched: shopifyProducts.length,
            syncAll,
            results,
        });
    } catch (error) {
        console.error('Shopify product sync error:', error);
        throw new ExternalServiceError(
            error.response?.data?.errors || error.message,
            'Shopify'
        );
    }
}));

router.post('/preview/products', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const { limit = 10, includeMetafields = false, fetchAll = false, search = '' } = req.body;

    try {
        let shopifyProducts;
        if (fetchAll) {
            // Fetch ALL products for debugging
            console.log('Fetching ALL products from Shopify for preview...');
            shopifyProducts = await shopifyClient.getAllProducts();
            console.log(`Fetched ${shopifyProducts.length} products`);
        } else {
            shopifyProducts = await shopifyClient.getProducts({ limit: Math.min(limit, 250) });
        }

        // Filter by search term if provided
        if (search) {
            const searchLower = search.toLowerCase();
            shopifyProducts = shopifyProducts.filter(p =>
                p.title?.toLowerCase().includes(searchLower) ||
                p.handle?.toLowerCase().includes(searchLower) ||
                p.product_type?.toLowerCase().includes(searchLower)
            );
        }

        // Get total count
        let totalCount = 0;
        try {
            totalCount = await shopifyClient.getProductCount();
        } catch (e) {
            totalCount = shopifyProducts.length;
        }

        // Optionally fetch metafields for each product (only for small sets)
        let productsWithMetafields = shopifyProducts;
        if (includeMetafields && shopifyProducts.length <= 20) {
            const CONCURRENCY_LIMIT = 5;
            productsWithMetafields = [];

            for (let i = 0; i < shopifyProducts.length; i += CONCURRENCY_LIMIT) {
                const batch = shopifyProducts.slice(i, i + CONCURRENCY_LIMIT);
                const batchResults = await Promise.all(
                    batch.map(async (product) => {
                        const metafields = await shopifyClient.getProductMetafields(product.id);
                        return { ...product, metafields };
                    })
                );
                productsWithMetafields.push(...batchResults);
            }
        }

        res.json({
            totalAvailable: totalCount,
            previewCount: productsWithMetafields.length,
            fetchedAll: fetchAll,
            searchTerm: search || null,
            products: productsWithMetafields,
        });
    } catch (error) {
        console.error('Shopify product preview error:', error);
        throw new ExternalServiceError(
            error.response?.data?.errors || error.message,
            'Shopify'
        );
    }
}));

// ============================================
// PREVIEW (fetch data without importing)
// ============================================

router.post('/preview/orders', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const { limit = 10 } = req.body;

    try {
        const shopifyOrders = await shopifyClient.getOrders({ limit: Math.min(limit, 50) });

        // Get total count
        let totalCount = 0;
        try {
            totalCount = await shopifyClient.getOrderCount();
        } catch (e) {
            totalCount = shopifyOrders.length;
        }

        res.json({
            totalAvailable: totalCount,
            previewCount: shopifyOrders.length,
            orders: shopifyOrders,
        });
    } catch (error) {
        console.error('Shopify order preview error:', error);
        throw new ExternalServiceError(
            error.response?.data?.errors || error.message,
            'Shopify'
        );
    }
}));

router.post('/preview/customers', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const { limit = 10 } = req.body;

    try {
        const shopifyCustomers = await shopifyClient.getCustomers({ limit: Math.min(limit, 50) });

        // Get total count
        let totalCount = 0;
        try {
            totalCount = await shopifyClient.getCustomerCount();
        } catch (e) {
            totalCount = shopifyCustomers.length;
        }

        res.json({
            totalAvailable: totalCount,
            previewCount: shopifyCustomers.length,
            customers: shopifyCustomers,
        });
    } catch (error) {
        console.error('Shopify customer preview error:', error);
        throw new ExternalServiceError(
            error.response?.data?.errors || error.message,
            'Shopify'
        );
    }
}));

// ============================================
// CUSTOMER SYNC
// ============================================

router.post('/sync/customers', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    const { since_id, created_at_min, limit = 50 } = req.body;

    try {
        // Use shared service for customer sync
        const results = await syncCustomers(req.prisma, {
            since_id,
            created_at_min,
            limit,
            skipNoOrders: true,
        });

        res.json({
            message: 'Customer sync completed',
            fetched: results.totalFetched,
            withOrders: results.totalFetched - results.skippedNoOrders,
            results: {
                created: results.created,
                updated: results.updated,
                skipped: results.skipped,
                skippedNoOrders: results.skippedNoOrders,
                errors: results.errors,
            },
            lastSyncedId: results.lastSyncedId,
        });
    } catch (error) {
        console.error('Shopify customer sync error:', error);
        throw new ExternalServiceError(
            error.response?.data?.errors || error.message,
            'Shopify'
        );
    }
}));

// Sync ALL customers (paginated bulk sync)
router.post('/sync/customers/all', authenticateToken, asyncHandler(async (req, res) => {
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    try {
        // Use shared service for bulk customer sync
        const { totalCount, results } = await syncAllCustomers(req.prisma);

        res.json({
            message: 'Bulk customer sync completed',
            totalInShopify: totalCount,
            results,
        });
    } catch (error) {
        console.error('Bulk customer sync error:', error);
        throw new ExternalServiceError(
            error.response?.data?.errors || error.message,
            'Shopify'
        );
    }
}));

// ============================================
// ORDER SYNC
// ============================================
// NOTE: Legacy sync endpoints have been removed.
// Use the background sync jobs API instead:
//   POST /sync/jobs/start { jobType: 'orders', days: 90 }
//   GET /sync/jobs - List all jobs
//   GET /sync/jobs/:id - Get job status
//   POST /sync/jobs/:id/resume - Resume failed job
//   POST /sync/jobs/:id/cancel - Cancel running job
//
// For backfilling, use:
//   POST /sync/backfill { fields: ['all'] } - Unified backfill endpoint (RECOMMENDED)
//   POST /sync/backfill-from-cache - DEPRECATED: Use /sync/backfill with fields: ['paymentMethod']
//   POST /sync/backfill-cache-fields - DEPRECATED: Use /sync/backfill with fields: ['cacheFields']
//   POST /sync/backfill-tracking-fields - DEPRECATED: Use /sync/backfill with fields: ['trackingFields']
//   POST /sync/reprocess-cache - Retry failed cache entries

// ============================================
// BACKFILL HELPER FUNCTIONS
// ============================================

/**
 * Backfill payment method for orders from ShopifyOrderCache
 * @param {Object} prisma - Prisma client
 * @param {number} batchSize - Maximum number of orders to process
 * @returns {Object} Results summary
 */
async function backfillPaymentMethod(prisma, batchSize = 5000) {
    // Find orders missing payment method that have cached Shopify data
    const ordersToBackfill = await prisma.order.findMany({
        where: {
            shopifyOrderId: { not: null },
            OR: [
                { paymentMethod: null },
                { paymentMethod: '' },
            ],
        },
        select: { id: true, shopifyOrderId: true, orderNumber: true },
        take: batchSize
    });

    console.log(`[Backfill PaymentMethod] Found ${ordersToBackfill.length} orders to process`);

    const results = {
        updated: 0,
        skipped: 0,
        errors: [],
        total: ordersToBackfill.length,
        noCache: 0,
    };

    for (const order of ordersToBackfill) {
        try {
            // Get data from ShopifyOrderCache
            const cachedOrder = await prisma.shopifyOrderCache.findUnique({
                where: { id: order.shopifyOrderId },
            });

            if (!cachedOrder?.rawData) {
                console.log(`No cached data for order ${order.orderNumber}`);
                results.noCache++;
                continue;
            }

            const shopifyOrder = JSON.parse(cachedOrder.rawData);

            // Calculate payment method using shared utility
            const paymentMethod = detectPaymentMethod(shopifyOrder);

            console.log(`  Order ${order.orderNumber}: Financial=${shopifyOrder.financial_status} => ${paymentMethod}`);

            // Update order (ERP-owned fields only)
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    paymentMethod,
                    // customerNotes removed - now in ShopifyOrderCache
                },
            });
            results.updated++;
        } catch (orderError) {
            console.error(`Error processing ${order.orderNumber}: ${orderError.message}`);
            results.errors.push(`Order ${order.orderNumber}: ${orderError.message}`);
        }
    }

    return results;
}

/**
 * Backfill extracted fields in ShopifyOrderCache from rawData
 * Extracts discountCodes, paymentMethod, tags, etc. for existing cache entries
 * @param {Object} prisma - Prisma client
 * @param {number} batchSize - Maximum number of cache entries to process
 * @returns {Object} Results summary
 */
async function backfillCacheFields(prisma, batchSize = 5000) {
    // Find cache entries missing the extracted fields
    const cacheEntries = await prisma.shopifyOrderCache.findMany({
        where: {
            // Find entries where extracted fields are null (not yet populated)
            discountCodes: null,
        },
        orderBy: { createdAt: 'desc' }, // Start with newest orders first
        take: batchSize
    });

    console.log(`[Backfill CacheFields] Found ${cacheEntries.length} cache entries to process`);

    if (cacheEntries.length === 0) {
        return { updated: 0, errors: [], total: 0, remaining: 0 };
    }

    const results = {
        updated: 0,
        errors: [],
        total: cacheEntries.length,
    };

    // Process in parallel batches of 10 to prevent connection pool exhaustion
    const parallelBatchSize = 10;
    for (let i = 0; i < cacheEntries.length; i += parallelBatchSize) {
        const batch = cacheEntries.slice(i, i + parallelBatchSize);

        await Promise.all(batch.map(async (entry) => {
            try {
                const shopifyOrder = JSON.parse(entry.rawData);

                // Extract discount codes (use empty string if none, not null)
                const discountCodes = (shopifyOrder.discount_codes || [])
                    .map(d => d.code).join(', ') || '';

                // Detect payment method using shared utility
                const paymentMethod = detectPaymentMethod(shopifyOrder);

                // Extract tracking from fulfillments
                const fulfillment = shopifyOrder.fulfillments?.find(f => f.tracking_number)
                    || shopifyOrder.fulfillments?.[0];

                // Extract shipping address
                const addr = shopifyOrder.shipping_address;

                await prisma.shopifyOrderCache.update({
                    where: { id: entry.id },
                    data: {
                        discountCodes,
                        customerNotes: shopifyOrder.note || null,
                        tags: shopifyOrder.tags || null,
                        // Removed duplicate fields (owned by Order table):
                        // paymentMethod, trackingNumber, trackingCompany, shippedAt
                        shippingCity: addr?.city || null,
                        shippingState: addr?.province || null,
                        shippingCountry: addr?.country || null,
                    },
                });
                results.updated++;
            } catch (entryError) {
                console.error(`Error processing cache ${entry.id}: ${entryError.message}`);
                results.errors.push(`Cache ${entry.id}: ${entryError.message}`);
            }
        }));

        // Log progress
        console.log(`Backfill progress: ${Math.min(i + parallelBatchSize, cacheEntries.length)}/${cacheEntries.length}`);
    }

    // Check remaining
    const remainingCount = await prisma.shopifyOrderCache.count({
        where: { discountCodes: null }
    });

    results.remaining = remainingCount;
    return results;
}

/**
 * Backfill tracking fields from existing rawData (for newly added schema fields)
 * DEPRECATED: trackingNumber, shipmentStatus, deliveredAt removed from ShopifyOrderCache
 * These fields are now owned by Order table (awbNumber, trackingStatus, deliveredAt)
 * @param {Object} prisma - Prisma client
 * @param {number} batchSize - Maximum number of cache entries to process
 * @returns {Object} Results summary
 */
async function backfillTrackingFields(prisma, batchSize = 5000) {
    console.log('[Backfill TrackingFields] DEPRECATED - Tracking fields removed from cache schema');
    console.log('Tracking data is now managed in Order table (awbNumber, trackingStatus, deliveredAt)');
    return { updated: 0, errors: [], total: 0, remaining: 0, deprecated: true };
}

/**
 * Backfill order fields (totalAmount, etc.) from ShopifyOrderCache rawData
 * @param {Object} prisma - Prisma client
 * @param {number} batchSize - Maximum number of orders to process
 * @returns {Object} Results summary
 */
async function backfillOrderFields(prisma, batchSize = 5000) {
    // Find orders with low/zero totalAmount that have cached Shopify data
    // Use raw query to handle null values (schema says Float but DB may have nulls)
    const ordersToBackfill = await prisma.$queryRaw`
        SELECT o.id, o."shopifyOrderId", o."orderNumber"
        FROM "Order" o
        WHERE o."shopifyOrderId" IS NOT NULL
        AND (o."totalAmount" IS NULL OR o."totalAmount" = 0)
        LIMIT ${batchSize}
    `;

    if (ordersToBackfill.length === 0) {
        return { updated: 0, errors: [], total: 0, remaining: 0 };
    }

    console.log(`[Backfill OrderFields] Found ${ordersToBackfill.length} orders with null totalAmount`);

    // Convert BigInt to String for cache lookup (raw query returns BigInt, cache uses String IDs)
    const shopifyIds = ordersToBackfill.map((o) => String(o.shopifyOrderId));
    const cacheEntries = await prisma.shopifyOrderCache.findMany({
        where: { id: { in: shopifyIds } },
        select: { id: true, rawData: true },
    });

    console.log(`[Backfill OrderFields] Found ${cacheEntries.length} cache entries for ${shopifyIds.length} orders`);

    const cacheMap = new Map(cacheEntries.map((c) => [c.id, c]));

    let updated = 0;
    const errors = [];

    let noCache = 0;
    let noRawData = 0;
    let noTotalPrice = 0;

    for (const order of ordersToBackfill) {
        const cache = cacheMap.get(String(order.shopifyOrderId));
        if (!cache) {
            noCache++;
            continue;
        }
        if (!cache.rawData) {
            noRawData++;
            continue;
        }

        try {
            const rawData = typeof cache.rawData === 'string' ? JSON.parse(cache.rawData) : cache.rawData;
            const totalAmount = parseFloat(rawData.total_price) || null;

            if (totalAmount === null) {
                noTotalPrice++;
                continue;
            }

            await prisma.order.update({
                where: { id: order.id },
                data: { totalAmount },
            });
            updated++;
        } catch (error) {
            errors.push({ orderId: order.id, orderNumber: order.orderNumber, error: error.message });
        }
    }

    console.log(`[Backfill OrderFields] Debug: noCache=${noCache}, noRawData=${noRawData}, noTotalPrice=${noTotalPrice}`);

    // Count remaining using raw query to handle null values
    const [{ count: remaining }] = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM "Order"
        WHERE "shopifyOrderId" IS NOT NULL
        AND ("totalAmount" IS NULL OR "totalAmount" = 0)
    `;

    console.log(`[Backfill OrderFields] Updated ${updated} orders, ${remaining} remaining`);
    return { updated, errors, total: ordersToBackfill.length, remaining };
}

// ============================================
// UNIFIED BACKFILL ENDPOINT
// ============================================

/**
 * Unified backfill endpoint
 *
 * POST /api/shopify/sync/backfill
 *
 * Body:
 * - fields: string[] - Array of field types to backfill. Options: 'all', 'paymentMethod', 'cacheFields', 'trackingFields', 'orderFields'
 *   Default: ['all']
 * - batchSize: number - Maximum records to process per field type. Default: 5000
 *
 * Examples:
 *   { "fields": ["all"] }  // Backfill everything
 *   { "fields": ["paymentMethod"] }  // Only backfill payment method in Order table
 *   { "fields": ["cacheFields", "trackingFields"], "batchSize": 1000 }  // Cache fields only
 */
router.post('/sync/backfill', authenticateToken, asyncHandler(async (req, res) => {
    const { fields = ['all'], batchSize = 5000 } = req.body;

    console.log(`[Unified Backfill] Starting with fields: ${fields.join(', ')}, batchSize: ${batchSize}`);

    const results = {};
    const shouldBackfillAll = fields.includes('all');

    // Backfill payment method in Order table
    if (shouldBackfillAll || fields.includes('paymentMethod')) {
        console.log('[Unified Backfill] Running paymentMethod backfill...');
        results.paymentMethod = await backfillPaymentMethod(req.prisma, batchSize);
    }

    // Backfill extracted fields in ShopifyOrderCache
    if (shouldBackfillAll || fields.includes('cacheFields')) {
        console.log('[Unified Backfill] Running cacheFields backfill...');
        results.cacheFields = await backfillCacheFields(req.prisma, batchSize);
    }

    // Backfill tracking fields in ShopifyOrderCache
    if (shouldBackfillAll || fields.includes('trackingFields')) {
        console.log('[Unified Backfill] Running trackingFields backfill...');
        results.trackingFields = await backfillTrackingFields(req.prisma, batchSize);
    }

    // Backfill order fields (totalAmount) from ShopifyOrderCache.rawData
    if (shouldBackfillAll || fields.includes('orderFields')) {
        console.log('[Unified Backfill] Running orderFields backfill (totalAmount)...');
        results.orderFields = await backfillOrderFields(req.prisma, batchSize);
    }

    const totalUpdated = Object.values(results).reduce((sum, r) => sum + (r.updated || 0), 0);

    console.log(`[Unified Backfill] Complete. Total updated: ${totalUpdated}`);

    res.json({
        success: true,
        message: `Backfilled ${totalUpdated} total records`,
        results,
    });
}));

// ============================================
// LEGACY BACKFILL ENDPOINTS (DEPRECATED)
// ============================================

// DEPRECATED: Use POST /sync/backfill with { fields: ['paymentMethod'] }
// Backfill payment method from ShopifyOrderCache (no API calls!)
router.post('/sync/backfill-from-cache', authenticateToken, asyncHandler(async (req, res) => {
    console.warn('[DEPRECATED] /sync/backfill-from-cache is deprecated. Use /sync/backfill with { fields: ["paymentMethod"] }');

    const results = await backfillPaymentMethod(req.prisma, 5000);

    res.json({
        success: true,
        message: `Backfilled ${results.updated} orders from cache`,
        results,
        deprecated: true,
        migration: 'Use POST /sync/backfill with { fields: ["paymentMethod"] }',
    });
}));

// DEPRECATED: Use POST /sync/backfill with { fields: ['cacheFields'] }
// Backfill extracted fields in ShopifyOrderCache from rawData
router.post('/sync/backfill-cache-fields', authenticateToken, asyncHandler(async (req, res) => {
    console.warn('[DEPRECATED] /sync/backfill-cache-fields is deprecated. Use /sync/backfill with { fields: ["cacheFields"] }');

    const batchSize = parseInt(req.query.batchSize) || 5000;
    const results = await backfillCacheFields(req.prisma, batchSize);

    res.json({
        success: true,
        message: `Backfilled ${results.updated} cache entries`,
        results,
        deprecated: true,
        migration: 'Use POST /sync/backfill with { fields: ["cacheFields"] }',
    });
}));

// DEPRECATED: Use POST /sync/backfill with { fields: ['trackingFields'] }
// Backfill tracking fields from existing rawData (for newly added schema fields)
router.post('/sync/backfill-tracking-fields', authenticateToken, asyncHandler(async (req, res) => {
    console.warn('[DEPRECATED] /sync/backfill-tracking-fields is deprecated. Use /sync/backfill with { fields: ["trackingFields"] }');

    const batchSize = parseInt(req.query.batchSize) || 5000;
    const results = await backfillTrackingFields(req.prisma, batchSize);

    res.json({
        success: true,
        message: `Backfilled tracking fields for ${results.updated} cache entries`,
        results,
        deprecated: true,
        migration: 'Use POST /sync/backfill with { fields: ["trackingFields"] }',
    });
}));

// Reprocess failed cache entries
router.post('/sync/reprocess-cache', authenticateToken, asyncHandler(async (req, res) => {
    // Find cache entries that haven't been processed or have errors
    const failedEntries = await req.prisma.shopifyOrderCache.findMany({
        where: {
            OR: [
                { processedAt: null },
                { processingError: { not: null } }
            ]
        },
        orderBy: { lastWebhookAt: 'asc' },
        take: 100 // Process in batches
    });

    if (failedEntries.length === 0) {
        return res.json({
            message: 'No failed cache entries to reprocess',
            processed: 0,
            succeeded: 0,
            failed: 0
        });
    }

    console.log(`Reprocessing ${failedEntries.length} cached orders...`);

    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const entry of failedEntries) {
        try {
            // Use shared processor instead of duplicated inline logic
            const result = await processFromCache(req.prisma, entry);

            // Mark as successfully processed
            await markCacheProcessed(req.prisma, entry.id);
            succeeded++;
            console.log(`Reprocessed: ${entry.orderNumber} -> ${result.action}`);
        } catch (error) {
            // Update error in cache
            await markCacheError(req.prisma, entry.id, error.message);
            failed++;
            errors.push({ orderId: entry.id, orderNumber: entry.orderNumber, error: error.message });
            console.error(`Reprocess failed for ${entry.orderNumber}: ${error.message}`);
        }
    }

    res.json({
        message: `Reprocessed ${failedEntries.length} cached orders`,
        processed: failedEntries.length,
        succeeded,
        failed,
        errors: errors.slice(0, 10) // Limit error details returned
    });
}));

// Get cache status
router.get('/sync/cache-status', authenticateToken, asyncHandler(async (req, res) => {
    const totalCached = await req.prisma.shopifyOrderCache.count();
    const processed = await req.prisma.shopifyOrderCache.count({
        where: { processedAt: { not: null } }
    });
    const failed = await req.prisma.shopifyOrderCache.count({
        where: { processingError: { not: null } }
    });
    const pending = await req.prisma.shopifyOrderCache.count({
        where: { processedAt: null, processingError: null }
    });

    // Get recent failures
    const recentFailures = await req.prisma.shopifyOrderCache.findMany({
        where: { processingError: { not: null } },
        select: {
            id: true,
            orderNumber: true,
            processingError: true,
            lastWebhookAt: true,
        },
        orderBy: { lastWebhookAt: 'desc' },
        take: 5
    });

    res.json({
        totalCached,
        processed,
        failed,
        pending,
        recentFailures
    });
}));

// Get product cache status
router.get('/sync/product-cache-status', authenticateToken, asyncHandler(async (req, res) => {
    const totalCached = await req.prisma.shopifyProductCache.count();
    const processed = await req.prisma.shopifyProductCache.count({
        where: { processedAt: { not: null } }
    });
    const failed = await req.prisma.shopifyProductCache.count({
        where: { processingError: { not: null } }
    });
    const pending = await req.prisma.shopifyProductCache.count({
        where: { processedAt: null, processingError: null }
    });

    // Get Shopify status distribution from cached rawData
    const allCache = await req.prisma.shopifyProductCache.findMany({
        select: { rawData: true }
    });

    const statusCounts = { active: 0, draft: 0, archived: 0, unknown: 0 };
    for (const cache of allCache) {
        try {
            const data = JSON.parse(cache.rawData);
            const status = data.status || 'unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        } catch {
            statusCounts.unknown++;
        }
    }

    // Get product link stats
    const totalProducts = await req.prisma.product.count();
    const linkedProducts = await req.prisma.product.count({
        where: { shopifyProductId: { not: null } }
    });

    // Get last sync time
    const lastSync = await req.prisma.shopifyProductCache.findFirst({
        where: { webhookTopic: 'manual_sync' },
        orderBy: { lastWebhookAt: 'desc' },
        select: { lastWebhookAt: true }
    });

    res.json({
        totalCached,
        processed,
        failed,
        pending,
        shopifyStatus: statusCounts,
        erpProducts: {
            total: totalProducts,
            linked: linkedProducts,
            notLinked: totalProducts - linkedProducts
        },
        lastSyncAt: lastSync?.lastWebhookAt || null
    });
}));

// ============================================
// SIMPLE SYNC OPERATIONS
// ============================================

/**
 * Full dump: Fetch ALL orders from Shopify and store in cache
 * Use this once to populate the cache, then rely on webhooks for real-time updates
 */
router.post('/sync/full-dump', authenticateToken, asyncHandler(async (req, res) => {
    const { daysBack } = req.body;

    // Reload Shopify client config
    await shopifyClient.loadFromDatabase();
    if (!shopifyClient.isConfigured()) {
        throw new ValidationError('Shopify is not configured');
    }

    // Build options
    const options = { status: 'any' };
    if (daysBack) {
        const d = new Date();
        d.setDate(d.getDate() - daysBack);
        options.created_at_min = d.toISOString();
    }

    console.log('[Full Dump] Starting full order dump from Shopify...');
    let cached = 0;
    let skipped = 0;
    const startTime = Date.now();

    try {
        // Fetch all orders with progress callback
        const allOrders = await shopifyClient.getAllOrders(
            (fetched, total) => {
                console.log(`[Full Dump] Fetched ${fetched}/${total} orders...`);
            },
            options
        );

        console.log(`[Full Dump] Fetched ${allOrders.length} orders, caching...`);

        // Cache each order
        for (const order of allOrders) {
            try {
                await cacheShopifyOrder(req.prisma, String(order.id), order, 'full_dump');
                cached++;
            } catch (err) {
                console.error(`[Full Dump] Error caching order ${order.name}:`, err.message);
                skipped++;
            }
        }

        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`[Full Dump] Complete: ${cached} cached, ${skipped} skipped in ${duration}s`);

        res.json({
            message: 'Full dump complete',
            fetched: allOrders.length,
            cached,
            skipped,
            durationSeconds: duration
        });
    } catch (error) {
        console.error('Full dump error:', error);
        throw new ExternalServiceError(error.message, 'Shopify');
    }
}));

/**
 * Fast lookup: Get raw Shopify order data from cache by order number
 */
router.get('/orders/:orderNumber', authenticateToken, asyncHandler(async (req, res) => {
    const { orderNumber } = req.params;

    // Normalize order number (remove # if present)
    const normalizedNumber = orderNumber.replace(/^#/, '');

    // Try to find by order number
    const cached = await req.prisma.shopifyOrderCache.findFirst({
        where: {
            OR: [
                { orderNumber: orderNumber },
                { orderNumber: `#${normalizedNumber}` },
                { orderNumber: normalizedNumber }
            ]
        }
    });

    if (!cached) {
        throw new NotFoundError('Order not found in cache', 'ShopifyOrder', orderNumber);
    }

    // Parse raw data
    const rawData = typeof cached.rawData === 'string'
        ? JSON.parse(cached.rawData)
        : cached.rawData;

    res.json({
        cacheId: cached.id,
        orderNumber: cached.orderNumber,
        financialStatus: cached.financialStatus,
        fulfillmentStatus: cached.fulfillmentStatus,
        processedAt: cached.processedAt,
        processingError: cached.processingError,
        rawData
    });
}));

/**
 * Process cache: Convert unprocessed cache entries to ERP tables
 */
router.post('/sync/process-cache', authenticateToken, asyncHandler(async (req, res) => {
    const { limit = 100 } = req.body;

    // Find unprocessed cache entries
    const unprocessed = await req.prisma.shopifyOrderCache.findMany({
        where: { processedAt: null },
        orderBy: { lastWebhookAt: 'asc' },
        take: limit
    });

    if (unprocessed.length === 0) {
        return res.json({
            message: 'No unprocessed orders in cache',
            processed: 0,
            failed: 0
        });
    }

    console.log(`[Process Cache] Processing ${unprocessed.length} cached orders...`);

    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const entry of unprocessed) {
        try {
            await processFromCache(req.prisma, entry);
            await markCacheProcessed(req.prisma, entry.id);
            processed++;
        } catch (err) {
            await markCacheError(req.prisma, entry.id, err.message);
            failed++;
            if (errors.length < 10) {
                errors.push({ orderNumber: entry.orderNumber, error: err.message });
            }
        }
    }

    console.log(`[Process Cache] Complete: ${processed} processed, ${failed} failed`);

    res.json({
        message: 'Processing complete',
        processed,
        failed,
        errors: errors.length > 0 ? errors : undefined
    });
}));

// ============================================
// SYNC HISTORY
// ============================================

router.get('/sync/history', authenticateToken, asyncHandler(async (req, res) => {
    // Get last synced orders
    const lastSyncedOrder = await req.prisma.order.findFirst({
        where: { shopifyOrderId: { not: null } },
        orderBy: { syncedAt: 'desc' },
        select: {
            shopifyOrderId: true,
            orderNumber: true,
            syncedAt: true,
        },
    });

    // Count synced entities
    const syncedOrders = await req.prisma.order.count({
        where: { shopifyOrderId: { not: null } },
    });

    const syncedCustomers = await req.prisma.customer.count({
        where: { shopifyCustomerId: { not: null } },
    });

    res.json({
        lastSync: lastSyncedOrder?.syncedAt || null,
        lastOrderNumber: lastSyncedOrder?.orderNumber || null,
        counts: {
            syncedOrders,
            syncedCustomers,
        },
    });
}));

// ============================================
// BACKGROUND SYNC JOBS
// ============================================

// Start a new background sync job
/**
 * Start a new sync job
 *
 * POST /api/shopify/sync/jobs/start
 *
 * Body:
 * - jobType: 'orders' | 'customers' | 'products' (required)
 * - syncMode: 'deep' | 'quick' | 'update' (optional for orders)
 *   - 'deep': Full import with aggressive memory management (initial setup, recovery)
 *   - 'quick': Missing orders only, fetches after latest DB order date (daily catch-up)
 *   - 'update': Recently changed orders via updated_at_min (hourly refresh)
 *   - null/omitted: Legacy upsert behavior
 * - days: number (optional, for deep mode) - For created_at filter
 * - staleAfterMins: number (required for update mode) - Fetch orders updated within last X mins
 *
 * Examples:
 *   { "jobType": "orders", "syncMode": "deep" }  // Full import, all time
 *   { "jobType": "orders", "syncMode": "deep", "days": 365 }  // Full import, last 365 days
 *   { "jobType": "orders", "syncMode": "quick" }  // Missing orders only
 *   { "jobType": "orders", "syncMode": "update", "staleAfterMins": 60 }  // Refresh recently changed
 */
router.post('/sync/jobs/start', authenticateToken, asyncHandler(async (req, res) => {
    const { jobType, days, syncMode, staleAfterMins } = req.body;

    if (!['orders', 'customers', 'products'].includes(jobType)) {
        throw new ValidationError('Invalid job type. Must be: orders, customers, or products');
    }

    // Validate syncMode
    if (syncMode && !['deep', 'quick', 'update'].includes(syncMode)) {
        throw new ValidationError(`Invalid syncMode: ${syncMode}. Must be 'deep', 'quick', or 'update'.`);
    }

    // Validate syncMode-specific requirements
    if (syncMode === 'update' && !staleAfterMins) {
        throw new ValidationError(
            'staleAfterMins is required when syncMode is "update". Example: { "jobType": "orders", "syncMode": "update", "staleAfterMins": 60 }'
        );
    }

    const job = await syncWorker.startJob(jobType, {
        days: days || null, // Only used for deep mode
        syncMode,
        staleAfterMins
    });

    res.json({
        message: `Sync job started (${syncMode || 'legacy'} mode)`,
        job
    });
}));

// List all sync jobs
router.get('/sync/jobs', authenticateToken, asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const jobs = await syncWorker.listJobs(limit);
    res.json(jobs);
}));

// Get sync job status
router.get('/sync/jobs/:id', authenticateToken, asyncHandler(async (req, res) => {
    const job = await syncWorker.getJobStatus(req.params.id);
    if (!job) {
        throw new NotFoundError('Job not found', 'SyncJob', req.params.id);
    }
    res.json(job);
}));

// Resume a failed/cancelled job
router.post('/sync/jobs/:id/resume', authenticateToken, asyncHandler(async (req, res) => {
    const job = await syncWorker.resumeJob(req.params.id);
    res.json({ message: 'Job resumed', job });
}));

// Cancel a running job
router.post('/sync/jobs/:id/cancel', authenticateToken, asyncHandler(async (req, res) => {
    const job = await syncWorker.cancelJob(req.params.id);
    res.json({ message: 'Job cancelled', job });
}));

// ============================================
// SCHEDULED SYNC
// ============================================

// Get scheduler status
router.get('/sync/scheduler/status', authenticateToken, asyncHandler(async (req, res) => {
    const status = scheduledSync.getStatus();
    res.json(status);
}));

// Manually trigger a sync
router.post('/sync/scheduler/trigger', authenticateToken, asyncHandler(async (req, res) => {
    const result = await scheduledSync.triggerSync();
    res.json({ message: 'Sync triggered', result });
}));

// Start the scheduler
router.post('/sync/scheduler/start', authenticateToken, asyncHandler(async (req, res) => {
    scheduledSync.start();
    res.json({ message: 'Scheduler started', status: scheduledSync.getStatus() });
}));

// Stop the scheduler
router.post('/sync/scheduler/stop', authenticateToken, asyncHandler(async (req, res) => {
    scheduledSync.stop();
    res.json({ message: 'Scheduler stopped', status: scheduledSync.getStatus() });
}));

// ============================================
// WEBHOOK ACTIVITY
// ============================================

// Get recent webhook activity
router.get('/webhooks/activity', authenticateToken, asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const hours = parseInt(req.query.hours) || 24;

    const since = new Date();
    since.setHours(since.getHours() - hours);

    // Get recent webhook logs
    const logs = await req.prisma.webhookLog.findMany({
        where: {
            receivedAt: { gte: since }
        },
        orderBy: { receivedAt: 'desc' },
        take: limit
    });

    // Get summary stats
    const stats = await req.prisma.webhookLog.groupBy({
        by: ['status'],
        where: {
            receivedAt: { gte: since }
        },
        _count: true
    });

    const statsMap = {};
    for (const s of stats) {
        statsMap[s.status] = s._count;
    }

    // Get webhook counts by topic
    const byTopic = await req.prisma.webhookLog.groupBy({
        by: ['topic'],
        where: {
            receivedAt: { gte: since }
        },
        _count: true
    });

    const topicMap = {};
    for (const t of byTopic) {
        topicMap[t.topic || 'unknown'] = t._count;
    }

    res.json({
        timeRange: {
            hours,
            since: since.toISOString()
        },
        summary: {
            total: logs.length,
            processed: statsMap.processed || 0,
            failed: statsMap.failed || 0,
            pending: statsMap.pending || 0,
            received: statsMap.received || 0
        },
        byTopic: topicMap,
        recentLogs: logs.map(l => ({
            id: l.id,
            webhookId: l.webhookId,
            topic: l.topic,
            resourceId: l.resourceId,
            status: l.status,
            error: l.error,
            processingTimeMs: l.processingTime,
            receivedAt: l.receivedAt,
            processedAt: l.processedAt
        }))
    });
}));

// ============================================
// CACHE MAINTENANCE
// ============================================

/**
 * Get cache statistics
 */
router.get('/cache/stats', authenticateToken, asyncHandler(async (req, res) => {
    const stats = await getCacheStats();
    res.json(stats);
}));

/**
 * Run cache cleanup
 * Removes old processed cache entries, webhook logs, etc.
 */
router.post('/cache/cleanup', authenticateToken, asyncHandler(async (req, res) => {
    const {
        orderCacheRetentionDays,
        productCacheRetentionDays,
        webhookLogRetentionDays,
        failedSyncRetentionDays,
        syncJobRetentionDays,
    } = req.body;

    const results = await runAllCleanup({
        orderCacheRetentionDays,
        productCacheRetentionDays,
        webhookLogRetentionDays,
        failedSyncRetentionDays,
        syncJobRetentionDays,
    });

    res.json({
        message: 'Cache cleanup completed',
        ...results,
    });
}));

export default router;
