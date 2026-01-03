import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import shopifyClient from '../services/shopify.js';
import syncWorker from '../services/syncWorker.js';

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

        const results = {
            created: { products: 0, variations: 0, skus: 0 },
            updated: { products: 0, variations: 0, skus: 0 },
            skipped: 0,
            errors: [],
        };

        // Fetch products from Shopify - all or limited
        let shopifyProducts;
        if (syncAll) {
            console.log('Fetching ALL products from Shopify...');
            shopifyProducts = await shopifyClient.getAllProducts();
            console.log(`Fetched ${shopifyProducts.length} products total`);
        } else {
            shopifyProducts = await shopifyClient.getProducts({ limit });
        }

        // Need a default fabric for variations
        let defaultFabric = await req.prisma.fabric.findFirst();
        if (!defaultFabric) {
            // Create a placeholder fabric if none exists
            let fabricType = await req.prisma.fabricType.findFirst();
            if (!fabricType) {
                fabricType = await req.prisma.fabricType.create({
                    data: { name: 'Default', composition: 'Unknown', unit: 'meter', avgShrinkagePct: 0 }
                });
            }
            defaultFabric = await req.prisma.fabric.create({
                data: {
                    fabricTypeId: fabricType.id,
                    name: 'Default Fabric',
                    colorName: 'Default',
                    costPerUnit: 0,
                    leadTimeDays: 14,
                    minOrderQty: 1
                }
            });
        }

        for (const shopifyProduct of shopifyProducts) {
            try {
                // Get main product image URL
                const mainImageUrl = shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null;

                // Extract gender from product_type (e.g., "Women Co-ord Set" -> "women")
                const gender = shopifyClient.normalizeGender(shopifyProduct.product_type);

                // Build variant-to-image mapping
                const variantImageMap = {};
                for (const img of shopifyProduct.images || []) {
                    for (const variantId of img.variant_ids || []) {
                        variantImageMap[variantId] = img.src;
                    }
                }

                // Find or create product by name AND gender (to keep Men/Women variants separate)
                let product = await req.prisma.product.findFirst({
                    where: {
                        name: shopifyProduct.title,
                        gender: gender || 'unisex',
                    },
                });

                if (!product) {
                    // Also check if there's a product with same name but no/different gender
                    // that should be updated instead of creating a duplicate
                    const existingByName = await req.prisma.product.findFirst({
                        where: { name: shopifyProduct.title },
                    });

                    if (existingByName && !existingByName.gender) {
                        // Update existing product that has no gender set
                        product = await req.prisma.product.update({
                            where: { id: existingByName.id },
                            data: {
                                gender: gender || 'unisex',
                                imageUrl: mainImageUrl || existingByName.imageUrl,
                                category: shopifyProduct.product_type?.toLowerCase() || existingByName.category,
                            },
                        });
                        results.updated.products++;
                    } else {
                        // Create new product (different gender or no existing product)
                        product = await req.prisma.product.create({
                            data: {
                                name: shopifyProduct.title,
                                category: shopifyProduct.product_type?.toLowerCase() || 'dress',
                                productType: 'basic',
                                gender: gender || 'unisex',
                                baseProductionTimeMins: 60,
                                imageUrl: mainImageUrl,
                            },
                        });
                        results.created.products++;
                    }
                } else {
                    // Update existing product with image if changed
                    if (mainImageUrl && product.imageUrl !== mainImageUrl) {
                        await req.prisma.product.update({
                            where: { id: product.id },
                            data: { imageUrl: mainImageUrl },
                        });
                        results.updated.products++;
                    }
                }

                // Get option names from product (e.g., "Color", "Size")
                const option1Name = shopifyProduct.options?.[0]?.name || 'Color';
                const option2Name = shopifyProduct.options?.[1]?.name || 'Size';

                // Group variants by first option (usually color/style)
                const variantsByOption = {};
                for (const variant of shopifyProduct.variants || []) {
                    const colorOption = variant.option1 || 'Default';
                    if (!variantsByOption[colorOption]) {
                        variantsByOption[colorOption] = [];
                    }
                    variantsByOption[colorOption].push(variant);
                }

                // Create variations and SKUs
                for (const [colorName, variants] of Object.entries(variantsByOption)) {
                    // Get image for this color variant
                    const firstVariantId = variants[0]?.id;
                    const variationImageUrl = variantImageMap[firstVariantId] || mainImageUrl;

                    // Find or create variation
                    let variation = await req.prisma.variation.findFirst({
                        where: {
                            productId: product.id,
                            colorName: colorName,
                        },
                    });

                    if (!variation) {
                        variation = await req.prisma.variation.create({
                            data: {
                                productId: product.id,
                                colorName: colorName,
                                fabricId: defaultFabric.id,
                                imageUrl: variationImageUrl,
                            },
                        });
                        results.created.variations++;
                    } else {
                        // Update variation with image if changed
                        if (variationImageUrl && variation.imageUrl !== variationImageUrl) {
                            await req.prisma.variation.update({
                                where: { id: variation.id },
                                data: { imageUrl: variationImageUrl },
                            });
                            results.updated.variations++;
                        }
                    }

                    // Create SKUs for each variant
                    for (const variant of variants) {
                        const shopifyVariantId = String(variant.id);

                        // Use Shopify SKU if available, otherwise generate one
                        const skuCode = variant.sku && variant.sku.trim()
                            ? variant.sku.trim()
                            : `${shopifyProduct.handle}-${colorName}-${variant.option2 || 'OS'}`.replace(/\s+/g, '-').toUpperCase();

                        // Determine size from option2 or variant title and normalize
                        const rawSize = variant.option2 || variant.option3 || 'One Size';
                        // Normalize sizes: XXL -> 2XL, XXXL -> 3XL, XXXXL -> 4XL
                        const size = rawSize
                            .replace(/^XXXXL$/i, '4XL')
                            .replace(/^XXXL$/i, '3XL')
                            .replace(/^XXL$/i, '2XL');

                        // Check if SKU exists by shopifyVariantId or skuCode
                        let sku = await req.prisma.sku.findFirst({
                            where: {
                                OR: [
                                    { shopifyVariantId },
                                    { skuCode },
                                ],
                            },
                        });

                        // Note: Duplicate barcodes are allowed - they will be flagged in the UI

                        if (sku) {
                            // Update existing SKU with Shopify data
                            const updateData = {
                                shopifyVariantId,
                                shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                                mrp: parseFloat(variant.price) || sku.mrp,
                            };

                            await req.prisma.sku.update({
                                where: { id: sku.id },
                                data: updateData,
                            });

                            // Update Shopify inventory cache
                            if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
                                await req.prisma.shopifyInventoryCache.upsert({
                                    where: { skuId: sku.id },
                                    update: {
                                        shopifyInventoryItemId: String(variant.inventory_item_id),
                                        availableQty: variant.inventory_quantity,
                                        lastSynced: new Date(),
                                    },
                                    create: {
                                        skuId: sku.id,
                                        shopifyInventoryItemId: String(variant.inventory_item_id),
                                        availableQty: variant.inventory_quantity,
                                    },
                                });
                            }

                            results.updated.skus++;
                        } else {
                            // Create new SKU
                            const newSku = await req.prisma.sku.create({
                                data: {
                                    variationId: variation.id,
                                    skuCode,
                                    size,
                                    mrp: parseFloat(variant.price) || 0,
                                    fabricConsumption: 1.5,
                                    targetStockQty: 10,
                                    shopifyVariantId,
                                    shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                                },
                            });

                            // Create Shopify inventory cache for new SKU
                            if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
                                await req.prisma.shopifyInventoryCache.create({
                                    data: {
                                        skuId: newSku.id,
                                        shopifyInventoryItemId: String(variant.inventory_item_id),
                                        availableQty: variant.inventory_quantity,
                                    },
                                });
                            }

                            results.created.skus++;
                        }
                    }
                }
            } catch (productError) {
                results.errors.push(`Product ${shopifyProduct.title}: ${productError.message}`);
                results.skipped++;
            }
        }

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
        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { since_id, created_at_min, limit = 50 } = req.body;

        const results = {
            created: 0,
            updated: 0,
            skipped: 0,
            skippedNoOrders: 0,
            errors: [],
        };

        // Fetch customers from Shopify
        const allShopifyCustomers = await shopifyClient.getCustomers({
            since_id,
            created_at_min,
            limit,
        });

        // Only sync customers who have placed at least 1 order
        const shopifyCustomers = allShopifyCustomers.filter(c => (c.orders_count || 0) > 0);
        results.skippedNoOrders = allShopifyCustomers.length - shopifyCustomers.length;

        for (const shopifyCustomer of shopifyCustomers) {
            try {
                const shopifyCustomerId = String(shopifyCustomer.id);
                const email = shopifyCustomer.email?.toLowerCase();

                if (!email) {
                    results.skipped++;
                    results.errors.push(`Customer ${shopifyCustomerId}: No email address`);
                    continue;
                }

                // Check if customer exists by shopifyCustomerId or email
                let existingCustomer = await req.prisma.customer.findFirst({
                    where: {
                        OR: [
                            { shopifyCustomerId },
                            { email },
                        ],
                    },
                });

                const customerData = {
                    shopifyCustomerId,
                    email,
                    phone: shopifyCustomer.phone || null,
                    firstName: shopifyCustomer.first_name || null,
                    lastName: shopifyCustomer.last_name || null,
                    defaultAddress: shopifyCustomer.default_address
                        ? JSON.stringify(shopifyClient.formatAddress(shopifyCustomer.default_address))
                        : null,
                    tags: shopifyCustomer.tags || null,
                    acceptsMarketing: shopifyCustomer.accepts_marketing || false,
                };

                if (existingCustomer) {
                    // Update existing customer
                    await req.prisma.customer.update({
                        where: { id: existingCustomer.id },
                        data: customerData,
                    });
                    results.updated++;
                } else {
                    // Create new customer
                    await req.prisma.customer.create({
                        data: customerData,
                    });
                    results.created++;
                }
            } catch (customerError) {
                results.errors.push(`Customer ${shopifyCustomer.id}: ${customerError.message}`);
                results.skipped++;
            }
        }

        res.json({
            message: 'Customer sync completed',
            fetched: allShopifyCustomers.length,
            withOrders: shopifyCustomers.length,
            results,
            lastSyncedId: allShopifyCustomers.length > 0
                ? String(allShopifyCustomers[allShopifyCustomers.length - 1].id)
                : null,
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
        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const results = {
            created: 0,
            updated: 0,
            skipped: 0,
            skippedNoOrders: 0,
            errors: [],
            totalFetched: 0,
        };

        // Get total count first
        const totalCount = await shopifyClient.getCustomerCount();
        console.log(`Starting bulk customer sync: ${totalCount} total customers in Shopify`);

        // Process in batches using pagination
        let sinceId = null;
        const limit = 250;
        let batchNumber = 0;

        while (true) {
            batchNumber++;
            const shopifyCustomers = await shopifyClient.getCustomers({
                since_id: sinceId,
                limit,
            });

            if (shopifyCustomers.length === 0) break;

            results.totalFetched += shopifyCustomers.length;
            console.log(`Processing batch ${batchNumber}: ${shopifyCustomers.length} customers (${results.totalFetched}/${totalCount})`);

            // Filter to only customers with orders
            const customersWithOrders = shopifyCustomers.filter(c => (c.orders_count || 0) > 0);
            results.skippedNoOrders += shopifyCustomers.length - customersWithOrders.length;

            for (const shopifyCustomer of customersWithOrders) {
                try {
                    const shopifyCustomerId = String(shopifyCustomer.id);
                    const email = shopifyCustomer.email?.toLowerCase();

                    if (!email) {
                        results.skipped++;
                        continue;
                    }

                    let existingCustomer = await req.prisma.customer.findFirst({
                        where: {
                            OR: [
                                { shopifyCustomerId },
                                { email },
                            ],
                        },
                    });

                    const customerData = {
                        shopifyCustomerId,
                        email,
                        phone: shopifyCustomer.phone || null,
                        firstName: shopifyCustomer.first_name || null,
                        lastName: shopifyCustomer.last_name || null,
                        defaultAddress: shopifyCustomer.default_address
                            ? JSON.stringify(shopifyClient.formatAddress(shopifyCustomer.default_address))
                            : null,
                        tags: shopifyCustomer.tags || null,
                        acceptsMarketing: shopifyCustomer.accepts_marketing || false,
                    };

                    if (existingCustomer) {
                        await req.prisma.customer.update({
                            where: { id: existingCustomer.id },
                            data: customerData,
                        });
                        results.updated++;
                    } else {
                        await req.prisma.customer.create({
                            data: customerData,
                        });
                        results.created++;
                    }
                } catch (customerError) {
                    results.errors.push(`Customer ${shopifyCustomer.id}: ${customerError.message}`);
                    results.skipped++;
                }
            }

            sinceId = shopifyCustomers[shopifyCustomers.length - 1].id;

            // Rate limit delay
            await new Promise(resolve => setTimeout(resolve, 300));

            if (shopifyCustomers.length < limit) break;
        }

        console.log(`Bulk customer sync completed:`, results);

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

router.post('/sync/orders', authenticateToken, async (req, res) => {
    try {
        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { since_id, created_at_min, status = 'any', limit = 50, continueFromLast = true } = req.body;

        const results = {
            created: { orders: 0, customers: 0 },
            updated: 0,
            skipped: 0,
            errors: [],
        };

        // Auto-continue from last synced order if no since_id provided
        let effectiveSinceId = since_id;
        if (!effectiveSinceId && continueFromLast) {
            const lastOrder = await req.prisma.order.findFirst({
                where: { shopifyOrderId: { not: null } },
                orderBy: { shopifyOrderId: 'desc' },
                select: { shopifyOrderId: true },
            });
            if (lastOrder) {
                effectiveSinceId = lastOrder.shopifyOrderId;
                console.log(`Continuing from last synced order: ${effectiveSinceId}`);
            }
        }

        // Fetch orders from Shopify
        const shopifyOrders = await shopifyClient.getOrders({
            since_id: effectiveSinceId,
            created_at_min,
            status,
            limit,
        });

        for (const shopifyOrder of shopifyOrders) {
            try {
                const shopifyOrderId = String(shopifyOrder.id);

                // Check if order already exists
                const existingOrder = await req.prisma.order.findUnique({
                    where: { shopifyOrderId },
                });

                if (existingOrder) {
                    // Update status, fulfillment status, and tracking info if changed
                    const newStatus = shopifyClient.mapOrderStatus(shopifyOrder);
                    const newFulfillmentStatus = shopifyOrder.fulfillment_status || 'unfulfilled';

                    // Extract tracking info from fulfillments
                    let newAwbNumber = existingOrder.awbNumber;
                    let newCourier = existingOrder.courier;
                    let newShippedAt = existingOrder.shippedAt;
                    if (shopifyOrder.fulfillments && shopifyOrder.fulfillments.length > 0) {
                        const fulfillmentWithTracking = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
                        newAwbNumber = fulfillmentWithTracking.tracking_number || newAwbNumber;
                        newCourier = fulfillmentWithTracking.tracking_company || newCourier;
                        if (fulfillmentWithTracking.created_at && !existingOrder.shippedAt) {
                            newShippedAt = new Date(fulfillmentWithTracking.created_at);
                        }
                    }

                    // Calculate payment method for update
                    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
                    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
                    const newPaymentMethod = isPrepaidGateway ? 'Prepaid' :
                        (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');
                    const newCustomerNotes = shopifyOrder.note || null;

                    const needsUpdate = existingOrder.status !== newStatus ||
                        existingOrder.shopifyFulfillmentStatus !== newFulfillmentStatus ||
                        existingOrder.awbNumber !== newAwbNumber ||
                        existingOrder.courier !== newCourier ||
                        existingOrder.paymentMethod !== newPaymentMethod ||
                        existingOrder.customerNotes !== newCustomerNotes;

                    if (needsUpdate) {
                        await req.prisma.order.update({
                            where: { id: existingOrder.id },
                            data: {
                                status: newStatus,
                                shopifyFulfillmentStatus: newFulfillmentStatus,
                                awbNumber: newAwbNumber,
                                courier: newCourier,
                                shippedAt: newShippedAt,
                                paymentMethod: newPaymentMethod,
                                customerNotes: newCustomerNotes,
                                shopifyData: JSON.stringify(shopifyOrder), // Store raw Shopify data
                                syncedAt: new Date(),
                            },
                        });
                        results.updated++;
                    } else {
                        results.skipped++;
                    }
                    continue;
                }

                // Find or create customer
                let customerId = null;
                if (shopifyOrder.customer) {
                    const customerEmail = shopifyOrder.customer.email?.toLowerCase();
                    const shopifyCustomerId = String(shopifyOrder.customer.id);

                    if (customerEmail) {
                        let customer = await req.prisma.customer.findFirst({
                            where: {
                                OR: [
                                    { shopifyCustomerId },
                                    { email: customerEmail },
                                ],
                            },
                        });

                        if (!customer) {
                            customer = await req.prisma.customer.create({
                                data: {
                                    shopifyCustomerId,
                                    email: customerEmail,
                                    phone: shopifyOrder.customer.phone || null,
                                    firstName: shopifyOrder.customer.first_name || null,
                                    lastName: shopifyOrder.customer.last_name || null,
                                    defaultAddress: shopifyOrder.shipping_address
                                        ? JSON.stringify(shopifyClient.formatAddress(shopifyOrder.shipping_address))
                                        : null,
                                    firstOrderDate: new Date(shopifyOrder.created_at),
                                },
                            });
                            results.created.customers++;
                        }
                        customerId = customer.id;

                        // Update customer's last order date
                        await req.prisma.customer.update({
                            where: { id: customer.id },
                            data: { lastOrderDate: new Date(shopifyOrder.created_at) },
                        });
                    }
                }

                // Build order lines
                const orderLines = [];
                let hasMatchedSku = false;

                for (const lineItem of shopifyOrder.line_items || []) {
                    // Try to match SKU by variant_id or sku
                    let sku = null;

                    if (lineItem.variant_id) {
                        sku = await req.prisma.sku.findFirst({
                            where: { shopifyVariantId: String(lineItem.variant_id) },
                        });
                    }

                    if (!sku && lineItem.sku) {
                        sku = await req.prisma.sku.findFirst({
                            where: { skuCode: lineItem.sku },
                        });
                    }

                    if (sku) {
                        hasMatchedSku = true;
                        orderLines.push({
                            shopifyLineId: String(lineItem.id),
                            skuId: sku.id,
                            qty: lineItem.quantity,
                            unitPrice: parseFloat(lineItem.price) || 0,
                        });
                    }
                }

                // Skip orders with no matched SKUs
                if (!hasMatchedSku) {
                    results.skipped++;
                    results.errors.push(
                        `Order ${shopifyOrder.order_number}: No matching SKUs found`
                    );
                    continue;
                }

                // Create order
                const customerName = shopifyOrder.customer
                    ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
                    : shopifyOrder.shipping_address?.name || 'Unknown';

                // Extract tracking info from fulfillments
                let awbNumber = null;
                let courier = null;
                let shippedAt = null;
                if (shopifyOrder.fulfillments && shopifyOrder.fulfillments.length > 0) {
                    // Get the most recent fulfillment with tracking info
                    const fulfillmentWithTracking = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
                    awbNumber = fulfillmentWithTracking.tracking_number || null;
                    courier = fulfillmentWithTracking.tracking_company || null;
                    if (fulfillmentWithTracking.created_at) {
                        shippedAt = new Date(fulfillmentWithTracking.created_at);
                    }
                }

                // Determine payment method (COD vs Prepaid)
                const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
                const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
                const paymentMethod = isPrepaidGateway ? 'Prepaid' :
                    (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');

                await req.prisma.order.create({
                    data: {
                        orderNumber: String(shopifyOrder.order_number),
                        shopifyOrderId,
                        shopifyData: JSON.stringify(shopifyOrder), // Store raw Shopify data
                        channel: shopifyClient.mapOrderChannel(shopifyOrder),
                        ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
                        customerName: customerName || 'Unknown',
                        customerEmail: shopifyOrder.email || null,
                        customerPhone: shopifyOrder.phone || shopifyOrder.shipping_address?.phone || null,
                        shippingAddress: shopifyOrder.shipping_address
                            ? JSON.stringify(shopifyClient.formatAddress(shopifyOrder.shipping_address))
                            : null,
                        orderDate: new Date(shopifyOrder.created_at),
                        customerNotes: shopifyOrder.note || null,
                        paymentMethod,
                        status: shopifyClient.mapOrderStatus(shopifyOrder),
                        shopifyFulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
                        awbNumber,
                        courier,
                        shippedAt,
                        totalAmount: parseFloat(shopifyOrder.total_price) || 0,
                        syncedAt: new Date(),
                        orderLines: {
                            create: orderLines,
                        },
                    },
                });

                results.created.orders++;
            } catch (orderError) {
                results.errors.push(`Order ${shopifyOrder.order_number}: ${orderError.message}`);
                results.skipped++;
            }
        }

        res.json({
            message: shopifyOrders.length === 0 && effectiveSinceId
                ? 'No new orders since last sync'
                : 'Order sync completed',
            fetched: shopifyOrders.length,
            results,
            continuedFromId: effectiveSinceId || null,
            lastSyncedId: shopifyOrders.length > 0
                ? String(shopifyOrders[shopifyOrders.length - 1].id)
                : null,
        });
    } catch (error) {
        console.error('Shopify order sync error:', error);
        res.status(500).json({
            error: 'Failed to sync orders',
            details: error.response?.data?.errors || error.message,
        });
    }
});

// Sync ALL orders (paginated bulk sync)
router.post('/sync/orders/all', authenticateToken, async (req, res) => {
    try {
        if (!shopifyClient.isConfigured()) {
            return res.status(400).json({ error: 'Shopify is not configured' });
        }

        const { status = 'any', days = 90 } = req.body;

        // Calculate date filter (default: last 90 days)
        const created_at_min = new Date();
        created_at_min.setDate(created_at_min.getDate() - days);
        const dateFilter = created_at_min.toISOString();

        const results = {
            created: { orders: 0, customers: 0 },
            updated: 0,
            skipped: 0,
            skippedExisting: 0,
            skippedNoSku: 0,
            errors: [],
            totalFetched: 0,
            dateFilter: `Last ${days} days`,
        };

        // Get total count first (with date filter)
        const totalCount = await shopifyClient.getOrderCount({ status, created_at_min: dateFilter });
        console.log(`Starting bulk order sync: ${totalCount} orders in last ${days} days`);

        // Use since_id pagination (start from beginning, not from last synced)
        let sinceId = null;
        const limit = 250;
        let batchNumber = 0;
        const processedIds = new Set(); // Track to avoid duplicates

        while (true) {
            batchNumber++;
            const shopifyOrders = await shopifyClient.getOrders({
                since_id: sinceId,
                created_at_min: dateFilter,
                status,
                limit,
            });

            if (shopifyOrders.length === 0) break;

            // Filter out any duplicates (shouldn't happen but just in case)
            const uniqueOrders = shopifyOrders.filter(o => !processedIds.has(String(o.id)));
            uniqueOrders.forEach(o => processedIds.add(String(o.id)));

            results.totalFetched += uniqueOrders.length;
            console.log(`Processing batch ${batchNumber}: ${shopifyOrders.length} fetched, ${uniqueOrders.length} unique (${results.totalFetched}/${totalCount})`);

            for (const shopifyOrder of uniqueOrders) {
                try {
                    const shopifyOrderId = String(shopifyOrder.id);

                    // Check if order already exists
                    const existingOrder = await req.prisma.order.findUnique({
                        where: { shopifyOrderId },
                    });

                    if (existingOrder) {
                        // Update status if changed
                        const newStatus = shopifyClient.mapOrderStatus(shopifyOrder);
                        const newFulfillmentStatus = shopifyOrder.fulfillment_status || 'unfulfilled';

                        // Extract tracking info
                        let newAwbNumber = existingOrder.awbNumber;
                        let newCourier = existingOrder.courier;
                        let newShippedAt = existingOrder.shippedAt;
                        if (shopifyOrder.fulfillments && shopifyOrder.fulfillments.length > 0) {
                            const fulfillmentWithTracking = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
                            newAwbNumber = fulfillmentWithTracking.tracking_number || newAwbNumber;
                            newCourier = fulfillmentWithTracking.tracking_company || newCourier;
                            if (fulfillmentWithTracking.created_at && !existingOrder.shippedAt) {
                                newShippedAt = new Date(fulfillmentWithTracking.created_at);
                            }
                        }

                        // Calculate payment method for update
                        const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
                        const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
                        const newPaymentMethod = isPrepaidGateway ? 'Prepaid' :
                            (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');
                        const newCustomerNotes = shopifyOrder.note || null;

                        const needsUpdate = existingOrder.status !== newStatus ||
                            existingOrder.shopifyFulfillmentStatus !== newFulfillmentStatus ||
                            existingOrder.awbNumber !== newAwbNumber ||
                            existingOrder.courier !== newCourier ||
                            existingOrder.paymentMethod !== newPaymentMethod ||
                            existingOrder.customerNotes !== newCustomerNotes;

                        if (needsUpdate) {
                            await req.prisma.order.update({
                                where: { id: existingOrder.id },
                                data: {
                                    status: newStatus,
                                    shopifyFulfillmentStatus: newFulfillmentStatus,
                                    awbNumber: newAwbNumber,
                                    courier: newCourier,
                                    shippedAt: newShippedAt,
                                    paymentMethod: newPaymentMethod,
                                    customerNotes: newCustomerNotes,
                                    shopifyData: JSON.stringify(shopifyOrder), // Store raw Shopify data
                                    syncedAt: new Date(),
                                },
                            });
                            results.updated++;
                        } else {
                            results.skipped++;
                            results.skippedExisting++;
                        }
                        continue;
                    }

                    // Find or create customer
                    let customerId = null;
                    if (shopifyOrder.customer) {
                        const customerEmail = shopifyOrder.customer.email?.toLowerCase();
                        const shopifyCustomerId = String(shopifyOrder.customer.id);

                        if (customerEmail) {
                            let customer = await req.prisma.customer.findFirst({
                                where: {
                                    OR: [
                                        { shopifyCustomerId },
                                        { email: customerEmail },
                                    ],
                                },
                            });

                            if (!customer) {
                                customer = await req.prisma.customer.create({
                                    data: {
                                        shopifyCustomerId,
                                        email: customerEmail,
                                        phone: shopifyOrder.customer.phone || null,
                                        firstName: shopifyOrder.customer.first_name || null,
                                        lastName: shopifyOrder.customer.last_name || null,
                                        defaultAddress: shopifyOrder.shipping_address
                                            ? JSON.stringify(shopifyClient.formatAddress(shopifyOrder.shipping_address))
                                            : null,
                                        firstOrderDate: new Date(shopifyOrder.created_at),
                                    },
                                });
                                results.created.customers++;
                            }
                            customerId = customer.id;

                            // Update customer's last order date
                            await req.prisma.customer.update({
                                where: { id: customer.id },
                                data: { lastOrderDate: new Date(shopifyOrder.created_at) },
                            });
                        }
                    }

                    // Build order lines
                    const orderLines = [];
                    let hasMatchedSku = false;

                    for (const lineItem of shopifyOrder.line_items || []) {
                        let sku = null;

                        if (lineItem.variant_id) {
                            sku = await req.prisma.sku.findFirst({
                                where: { shopifyVariantId: String(lineItem.variant_id) },
                            });
                        }

                        if (!sku && lineItem.sku) {
                            sku = await req.prisma.sku.findFirst({
                                where: { skuCode: lineItem.sku },
                            });
                        }

                        if (sku) {
                            hasMatchedSku = true;
                            orderLines.push({
                                shopifyLineId: String(lineItem.id),
                                skuId: sku.id,
                                qty: lineItem.quantity,
                                unitPrice: parseFloat(lineItem.price) || 0,
                            });
                        }
                    }

                    // Skip orders with no matched SKUs
                    if (!hasMatchedSku) {
                        results.skipped++;
                        results.skippedNoSku++;
                        continue;
                    }

                    // Create order
                    const customerName = shopifyOrder.customer
                        ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
                        : shopifyOrder.shipping_address?.name || 'Unknown';

                    // Extract tracking info
                    let awbNumber = null;
                    let courier = null;
                    let shippedAt = null;
                    if (shopifyOrder.fulfillments && shopifyOrder.fulfillments.length > 0) {
                        const fulfillmentWithTracking = shopifyOrder.fulfillments.find(f => f.tracking_number) || shopifyOrder.fulfillments[0];
                        awbNumber = fulfillmentWithTracking.tracking_number || null;
                        courier = fulfillmentWithTracking.tracking_company || null;
                        if (fulfillmentWithTracking.created_at) {
                            shippedAt = new Date(fulfillmentWithTracking.created_at);
                        }
                    }

                    // Determine payment method (COD vs Prepaid)
                    const gatewayNames = (shopifyOrder.payment_gateway_names || []).join(', ').toLowerCase();
                    const isPrepaidGateway = gatewayNames.includes('shopflo') || gatewayNames.includes('razorpay');
                    const paymentMethod = isPrepaidGateway ? 'Prepaid' :
                        (shopifyOrder.financial_status === 'pending' ? 'COD' : 'Prepaid');

                    await req.prisma.order.create({
                        data: {
                            orderNumber: String(shopifyOrder.order_number),
                            shopifyOrderId,
                            shopifyData: JSON.stringify(shopifyOrder), // Store raw Shopify data
                            channel: shopifyClient.mapOrderChannel(shopifyOrder),
                            ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
                            customerName: customerName || 'Unknown',
                            customerEmail: shopifyOrder.email || null,
                            customerPhone: shopifyOrder.phone || shopifyOrder.shipping_address?.phone || null,
                            shippingAddress: shopifyOrder.shipping_address
                                ? JSON.stringify(shopifyClient.formatAddress(shopifyOrder.shipping_address))
                                : null,
                            orderDate: new Date(shopifyOrder.created_at),
                            customerNotes: shopifyOrder.note || null,
                            paymentMethod,
                            status: shopifyClient.mapOrderStatus(shopifyOrder),
                            shopifyFulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
                            awbNumber,
                            courier,
                            shippedAt,
                            totalAmount: parseFloat(shopifyOrder.total_price) || 0,
                            syncedAt: new Date(),
                            orderLines: {
                                create: orderLines,
                            },
                        },
                    });

                    results.created.orders++;
                } catch (orderError) {
                    results.errors.push(`Order ${shopifyOrder.order_number}: ${orderError.message}`);
                    results.skipped++;
                }
            }

            // Stop if we got no new unique orders (all duplicates)
            if (uniqueOrders.length === 0) {
                console.log('All orders in batch were duplicates, stopping');
                break;
            }

            sinceId = shopifyOrders[shopifyOrders.length - 1].id;

            // Rate limit delay
            await new Promise(resolve => setTimeout(resolve, 300));

            if (shopifyOrders.length < limit) break;
        }

        console.log(`Bulk order sync completed:`, results);

        res.json({
            message: 'Bulk order sync completed',
            totalInShopify: totalCount,
            results,
        });
    } catch (error) {
        console.error('Bulk order sync error:', error);
        res.status(500).json({
            error: 'Failed to sync all orders',
            details: error.response?.data?.errors || error.message,
        });
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
router.post('/sync/jobs/start', authenticateToken, async (req, res) => {
    try {
        const { jobType, days = 90 } = req.body;

        if (!['orders', 'customers', 'products'].includes(jobType)) {
            return res.status(400).json({ error: 'Invalid job type. Must be: orders, customers, or products' });
        }

        const job = await syncWorker.startJob(jobType, { days });
        res.json({ message: 'Sync job started', job });
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
