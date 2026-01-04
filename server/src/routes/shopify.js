import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import shopifyClient from '../services/shopify.js';
import syncWorker from '../services/syncWorker.js';
import { syncAllProducts } from '../services/productSyncService.js';
import { syncCustomers, syncAllCustomers } from '../services/customerSyncService.js';

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

router.get('/config', authenticateToken, async (req, res) => {
    try {
        // Reload from database to get latest
        await shopifyClient.loadFromDatabase();
        const config = shopifyClient.getConfig();

        res.json({
            shopDomain: config.shopDomain || '',
            apiVersion: config.apiVersion,
            hasAccessToken: !!shopifyClient.accessToken,
        });
    } catch (error) {
        console.error('Get Shopify config error:', error);
        res.status(500).json({ error: 'Failed to get configuration' });
    }
});

router.put('/config', authenticateToken, async (req, res) => {
    try {
        const { shopDomain, accessToken } = req.body;

        if (!shopDomain || !accessToken) {
            return res.status(400).json({ error: 'Shop domain and access token are required' });
        }

        // Validate the domain format
        const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

        await shopifyClient.updateConfig(cleanDomain, accessToken);

        res.json({
            message: 'Shopify configuration updated',
            shopDomain: cleanDomain,
        });
    } catch (error) {
        console.error('Update Shopify config error:', error);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

router.post('/test-connection', authenticateToken, async (req, res) => {
    try {
        // Reload config from database
        await shopifyClient.loadFromDatabase();

        console.log('Testing Shopify connection...');
        console.log('Shop domain:', shopifyClient.shopDomain);
        console.log('Token exists:', !!shopifyClient.accessToken);
        console.log('Token length:', shopifyClient.accessToken?.length);

        if (!shopifyClient.isConfigured()) {
            return res.json({
                success: false,
                message: 'Shopify credentials not configured',
            });
        }

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
});

// ============================================
// STATUS CHECK
// ============================================

router.get('/status', authenticateToken, async (req, res) => {
    try {
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
});

// ============================================
// PRODUCT SYNC
// ============================================

router.post('/sync/products', authenticateToken, async (req, res) => {
    try {
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { limit = 50, syncAll = false } = req.body;

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
        res.status(500).json({
            error: 'Failed to sync products',
            details: error.response?.data?.errors || error.message,
        });
    }
});

router.post('/preview/products', authenticateToken, async (req, res) => {
    try {
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { limit = 10, includeMetafields = false, fetchAll = false, search = '' } = req.body;

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
        res.status(500).json({
            error: 'Failed to preview products',
            details: error.response?.data?.errors || error.message,
        });
    }
});

// ============================================
// PREVIEW (fetch data without importing)
// ============================================

router.post('/preview/orders', authenticateToken, async (req, res) => {
    try {
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { limit = 10 } = req.body;

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
        res.status(500).json({
            error: 'Failed to preview orders',
            details: error.response?.data?.errors || error.message,
        });
    }
});

router.post('/preview/customers', authenticateToken, async (req, res) => {
    try {
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { limit = 10 } = req.body;

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
        res.status(500).json({
            error: 'Failed to preview customers',
            details: error.response?.data?.errors || error.message,
        });
    }
});

// ============================================
// CUSTOMER SYNC
// ============================================

router.post('/sync/customers', authenticateToken, async (req, res) => {
    try {
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { since_id, created_at_min, limit = 50 } = req.body;

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
        res.status(500).json({
            error: 'Failed to sync customers',
            details: error.response?.data?.errors || error.message,
        });
    }
});

// Sync ALL customers (paginated bulk sync)
router.post('/sync/customers/all', authenticateToken, async (req, res) => {
    try {
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        // Use shared service for bulk customer sync
        const { totalCount, results } = await syncAllCustomers(req.prisma);

        res.json({
            message: 'Bulk customer sync completed',
            totalInShopify: totalCount,
            results,
        });
    } catch (error) {
        console.error('Bulk customer sync error:', error);
        res.status(500).json({
            error: 'Failed to sync all customers',
            details: error.response?.data?.errors || error.message,
        });
    }
});

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
//   POST /sync/backfill-from-cache - Uses cached Shopify data (no API calls)
//   POST /sync/reprocess-cache - Retry failed cache entries

// Backfill payment method from ShopifyOrderCache (no API calls!)
router.post('/sync/backfill-from-cache', authenticateToken, async (req, res) => {
    try {
        // Find orders missing payment method that have cached Shopify data
        const ordersToBackfill = await req.prisma.order.findMany({
            where: {
                shopifyOrderId: { not: null },
                OR: [
                    { paymentMethod: null },
                    { paymentMethod: '' },
                ],
            },
            select: { id: true, shopifyOrderId: true, orderNumber: true },
        });

        console.log(`Found ${ordersToBackfill.length} orders missing payment method`);

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
                const cachedOrder = await req.prisma.shopifyOrderCache.findUnique({
                    where: { id: order.shopifyOrderId },
                });

                if (!cachedOrder?.rawData) {
                    console.log(`No cached data for order ${order.orderNumber}`);
                    results.noCache++;
                    continue;
                }

                const shopifyOrder = JSON.parse(cachedOrder.rawData);

                // Calculate payment method
                const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
                const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
                const paymentMethod = isPrepaidGateway ? 'Prepaid' :
                    (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');

                console.log(`  Order ${order.orderNumber}: Gateway="${gatewayNames}", Financial=${shopifyOrder.financial_status} => ${paymentMethod}`);

                // Update order
                await req.prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentMethod,
                        customerNotes: shopifyOrder.note || null,
                    },
                });
                results.updated++;
            } catch (orderError) {
                console.error(`Error processing ${order.orderNumber}: ${orderError.message}`);
                results.errors.push(`Order ${order.orderNumber}: ${orderError.message}`);
            }
        }

        res.json({
            success: true,
            message: `Backfilled ${results.updated} orders from cache`,
            results,
        });
    } catch (error) {
        console.error('Backfill from cache error:', error);
        res.status(500).json({ error: 'Failed to backfill from cache', details: error.message });
    }
});

// Reprocess failed cache entries
router.post('/sync/reprocess-cache', authenticateToken, async (req, res) => {
    try {
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
                const shopifyOrder = JSON.parse(entry.rawData);

                // Import the processShopifyOrderToERP function logic inline
                const shopifyOrderId = String(shopifyOrder.id);
                const orderName = shopifyOrder.name || shopifyOrder.order_number || shopifyOrderId;

                // Check if order exists
                let existingOrder = await req.prisma.order.findFirst({
                    where: { shopifyOrderId },
                    include: { orderLines: true }
                });

                // Extract customer info
                const customer = shopifyOrder.customer;
                const shippingAddress = shopifyOrder.shipping_address;

                // Find or create customer
                let customerId = null;
                if (customer) {
                    const shopifyCustomerId = String(customer.id);
                    let dbCustomer = await req.prisma.customer.findFirst({
                        where: {
                            OR: [
                                { shopifyCustomerId },
                                { email: customer.email }
                            ].filter(Boolean)
                        }
                    });

                    if (!dbCustomer && customer.email) {
                        dbCustomer = await req.prisma.customer.create({
                            data: {
                                email: customer.email,
                                firstName: customer.first_name,
                                lastName: customer.last_name,
                                phone: customer.phone,
                                shopifyCustomerId,
                                defaultAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                            }
                        });
                    }
                    customerId = dbCustomer?.id;
                }

                // Determine order status
                let status = 'open';
                if (shopifyOrder.cancelled_at) {
                    status = 'cancelled';
                } else if (shopifyOrder.fulfillment_status === 'fulfilled') {
                    if (existingOrder?.status === 'shipped') {
                        status = 'shipped';
                    }
                }

                // Determine payment method
                const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
                const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
                const paymentMethod = isPrepaidGateway ? 'Prepaid' :
                    (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');

                // Build order data
                const orderData = {
                    shopifyOrderId,
                    orderNumber: shopifyOrder.name || `SHOP-${shopifyOrderId.slice(-8)}`,
                    channel: 'shopify',
                    status,
                    customerId,
                    customerName: shippingAddress
                        ? `${shippingAddress.first_name || ''} ${shippingAddress.last_name || ''}`.trim()
                        : customer?.first_name ? `${customer.first_name} ${customer.last_name || ''}`.trim() : 'Unknown',
                    customerEmail: customer?.email || shopifyOrder.email,
                    customerPhone: shippingAddress?.phone || customer?.phone,
                    shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                    totalAmount: parseFloat(shopifyOrder.total_price) || 0,
                    shopifyFulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
                    orderDate: shopifyOrder.created_at ? new Date(shopifyOrder.created_at) : new Date(),
                    customerNotes: shopifyOrder.note || null,
                    paymentMethod,
                };

                if (existingOrder) {
                    await req.prisma.order.update({
                        where: { id: existingOrder.id },
                        data: orderData
                    });
                } else {
                    // Create new order with lines
                    const lineItems = shopifyOrder.line_items || [];
                    const orderLines = [];

                    for (const item of lineItems) {
                        const shopifyVariantId = item.variant_id ? String(item.variant_id) : null;
                        let sku = null;
                        if (shopifyVariantId) {
                            sku = await req.prisma.sku.findFirst({ where: { shopifyVariantId } });
                        }
                        if (!sku && item.sku) {
                            sku = await req.prisma.sku.findFirst({ where: { skuCode: item.sku } });
                        }
                        if (sku) {
                            orderLines.push({
                                skuId: sku.id,
                                qty: item.quantity,
                                unitPrice: parseFloat(item.price) || 0,
                                lineStatus: 'pending',
                            });
                        }
                    }

                    await req.prisma.order.create({
                        data: {
                            ...orderData,
                            orderLines: { create: orderLines }
                        }
                    });
                }

                // Mark as successfully processed
                await req.prisma.shopifyOrderCache.update({
                    where: { id: entry.id },
                    data: { processedAt: new Date(), processingError: null }
                });
                succeeded++;
                console.log(`Reprocessed: ${orderName}`);
            } catch (error) {
                // Update error in cache
                await req.prisma.shopifyOrderCache.update({
                    where: { id: entry.id },
                    data: { processingError: error.message }
                });
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
    } catch (error) {
        console.error('Reprocess cache error:', error);
        res.status(500).json({ error: 'Failed to reprocess cache', details: error.message });
    }
});

// Get cache status
router.get('/sync/cache-status', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Cache status error:', error);
        res.status(500).json({ error: 'Failed to get cache status' });
    }
});

// ============================================
// SYNC HISTORY
// ============================================

router.get('/sync/history', authenticateToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Get sync history error:', error);
        res.status(500).json({ error: 'Failed to get sync history' });
    }
});

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
 * - days: number (optional, default 90) - For created_at filter
 * - syncMode: 'populate' | 'update' (optional)
 *   - 'populate': Skip orders that already exist (fast initial import)
 *   - 'update': Only fetch orders updated in Shopify recently (incremental refresh)
 *   - null/omitted: Legacy upsert behavior
 * - staleAfterMins: number (optional, for update mode) - Fetch orders updated within last X mins
 *
 * Examples:
 *   { "jobType": "orders", "syncMode": "populate", "days": 365 }  // Import new orders only
 *   { "jobType": "orders", "syncMode": "update", "staleAfterMins": 60 }  // Refresh recently changed
 *   { "jobType": "orders", "days": 30 }  // Legacy: upsert all orders from last 30 days
 */
router.post('/sync/jobs/start', authenticateToken, async (req, res) => {
    try {
        const { jobType, days, syncMode, staleAfterMins } = req.body;

        if (!['orders', 'customers', 'products'].includes(jobType)) {
            return res.status(400).json({ error: 'Invalid job type. Must be: orders, customers, or products' });
        }

        // Validate syncMode-specific requirements
        if (syncMode === 'update' && !staleAfterMins) {
            return res.status(400).json({
                error: 'staleAfterMins is required when syncMode is "update"',
                hint: 'Example: { "jobType": "orders", "syncMode": "update", "staleAfterMins": 60 }'
            });
        }

        const job = await syncWorker.startJob(jobType, {
            days: days || (syncMode === 'update' ? null : 90), // Default 90 days unless update mode
            syncMode,
            staleAfterMins
        });

        res.json({
            message: `Sync job started (${syncMode || 'legacy'} mode)`,
            job
        });
    } catch (error) {
        console.error('Start sync job error:', error);
        res.status(400).json({ error: error.message });
    }
});

// List all sync jobs
router.get('/sync/jobs', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const jobs = await syncWorker.listJobs(limit);
        res.json(jobs);
    } catch (error) {
        console.error('List sync jobs error:', error);
        res.status(500).json({ error: 'Failed to list sync jobs' });
    }
});

// Get sync job status
router.get('/sync/jobs/:id', authenticateToken, async (req, res) => {
    try {
        const job = await syncWorker.getJobStatus(req.params.id);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json(job);
    } catch (error) {
        console.error('Get sync job error:', error);
        res.status(500).json({ error: 'Failed to get sync job' });
    }
});

// Resume a failed/cancelled job
router.post('/sync/jobs/:id/resume', authenticateToken, async (req, res) => {
    try {
        const job = await syncWorker.resumeJob(req.params.id);
        res.json({ message: 'Job resumed', job });
    } catch (error) {
        console.error('Resume sync job error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Cancel a running job
router.post('/sync/jobs/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const job = await syncWorker.cancelJob(req.params.id);
        res.json({ message: 'Job cancelled', job });
    } catch (error) {
        console.error('Cancel sync job error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;
