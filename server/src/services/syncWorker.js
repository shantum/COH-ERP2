import { PrismaClient } from '@prisma/client';
import shopifyClient from './shopify.js';

const prisma = new PrismaClient();

// Active jobs tracker (in-memory, single instance only)
const activeJobs = new Map();

/**
 * Background Sync Worker
 * Processes sync jobs with checkpointing and resume capability
 */
class SyncWorker {
    constructor() {
        this.batchSize = 100; // Smaller batches for more frequent checkpoints
        this.batchDelay = 500; // Delay between batches (ms)
        this.maxErrors = 50; // Max errors to store in log
    }

    /**
     * Start a new sync job
     */
    async startJob(jobType, options = {}) {
        // Check for existing running job of same type
        const existingJob = await prisma.syncJob.findFirst({
            where: {
                jobType,
                status: { in: ['pending', 'running'] }
            }
        });

        if (existingJob) {
            throw new Error(`A ${jobType} sync job is already running (ID: ${existingJob.id})`);
        }

        // Reload Shopify config
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        // Create job record
        const job = await prisma.syncJob.create({
            data: {
                jobType,
                status: 'pending',
                daysBack: options.days || 90,
                dateFilter: options.days ? `Last ${options.days} days` : 'All time',
            }
        });

        // Start processing in background
        this.processJob(job.id).catch(err => {
            console.error(`Job ${job.id} failed:`, err);
        });

        return job;
    }

    /**
     * Resume a failed or cancelled job
     */
    async resumeJob(jobId) {
        const job = await prisma.syncJob.findUnique({ where: { id: jobId } });

        if (!job) {
            throw new Error('Job not found');
        }

        if (job.status === 'running') {
            throw new Error('Job is already running');
        }

        if (job.status === 'completed') {
            throw new Error('Job is already completed');
        }

        // Reset status to running
        await prisma.syncJob.update({
            where: { id: jobId },
            data: { status: 'pending' }
        });

        // Start processing
        this.processJob(jobId).catch(err => {
            console.error(`Job ${jobId} resume failed:`, err);
        });

        return await prisma.syncJob.findUnique({ where: { id: jobId } });
    }

    /**
     * Cancel a running job
     */
    async cancelJob(jobId) {
        const job = await prisma.syncJob.findUnique({ where: { id: jobId } });

        if (!job) {
            throw new Error('Job not found');
        }

        if (job.status !== 'running' && job.status !== 'pending') {
            throw new Error('Job is not running');
        }

        // Mark as cancelled - the worker will pick this up
        await prisma.syncJob.update({
            where: { id: jobId },
            data: { status: 'cancelled' }
        });

        activeJobs.delete(jobId);

        return await prisma.syncJob.findUnique({ where: { id: jobId } });
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        return await prisma.syncJob.findUnique({ where: { id: jobId } });
    }

    /**
     * List recent jobs
     */
    async listJobs(limit = 10) {
        return await prisma.syncJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /**
     * Main job processor
     */
    async processJob(jobId) {
        const job = await prisma.syncJob.findUnique({ where: { id: jobId } });

        if (!job || job.status === 'cancelled') {
            return;
        }

        activeJobs.set(jobId, true);

        try {
            // Mark as running
            await prisma.syncJob.update({
                where: { id: jobId },
                data: {
                    status: 'running',
                    startedAt: job.startedAt || new Date(),
                }
            });

            // Route to appropriate processor
            switch (job.jobType) {
                case 'orders':
                    await this.processOrderSync(jobId);
                    break;
                case 'customers':
                    await this.processCustomerSync(jobId);
                    break;
                case 'products':
                    await this.processProductSync(jobId);
                    break;
                default:
                    throw new Error(`Unknown job type: ${job.jobType}`);
            }
        } catch (error) {
            console.error(`Job ${jobId} error:`, error);
            await prisma.syncJob.update({
                where: { id: jobId },
                data: {
                    status: 'failed',
                    lastError: error.message,
                    completedAt: new Date(),
                }
            });
        } finally {
            activeJobs.delete(jobId);
        }
    }

    /**
     * Process order sync with checkpointing
     */
    async processOrderSync(jobId) {
        let job = await prisma.syncJob.findUnique({ where: { id: jobId } });

        // Calculate date filter
        const dateFilter = job.daysBack ? (() => {
            const d = new Date();
            d.setDate(d.getDate() - job.daysBack);
            return d.toISOString();
        })() : null;

        // Get total count if not set
        if (!job.totalRecords) {
            const totalCount = await shopifyClient.getOrderCount({
                status: 'any',
                created_at_min: dateFilter
            });
            await prisma.syncJob.update({
                where: { id: jobId },
                data: { totalRecords: totalCount }
            });
            job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        }

        console.log(`[Job ${jobId}] Starting order sync: ${job.totalRecords} total, resuming from ID: ${job.lastProcessedId || 'start'}`);

        let sinceId = job.lastProcessedId;
        let batchNumber = job.currentBatch;
        const errorLog = job.errorLog ? JSON.parse(job.errorLog) : [];

        while (true) {
            // Check if cancelled
            const currentJob = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (currentJob?.status === 'cancelled') {
                console.log(`[Job ${jobId}] Cancelled`);
                return;
            }

            batchNumber++;

            // Fetch batch from Shopify
            let shopifyOrders;
            try {
                shopifyOrders = await shopifyClient.getOrders({
                    since_id: sinceId,
                    created_at_min: sinceId ? null : dateFilter, // Don't combine date filter with since_id
                    status: 'any',
                    limit: this.batchSize,
                });
            } catch (fetchError) {
                console.error(`[Job ${jobId}] Shopify API error:`, fetchError.response?.data || fetchError.message);
                throw new Error(`Shopify API: ${fetchError.response?.data?.errors || fetchError.message}`);
            }

            if (shopifyOrders.length === 0) {
                break;
            }

            console.log(`[Job ${jobId}] Batch ${batchNumber}: processing ${shopifyOrders.length} orders`);

            let batchCreated = 0, batchUpdated = 0, batchSkipped = 0, batchErrors = 0;

            for (const shopifyOrder of shopifyOrders) {
                try {
                    const result = await this.syncSingleOrder(shopifyOrder);
                    if (result === 'created') batchCreated++;
                    else if (result === 'updated') batchUpdated++;
                    else batchSkipped++;
                } catch (err) {
                    batchErrors++;
                    if (errorLog.length < this.maxErrors) {
                        errorLog.push(`Order ${shopifyOrder.order_number}: ${err.message}`);
                    }
                }
            }

            // Update checkpoint after each batch
            sinceId = String(shopifyOrders[shopifyOrders.length - 1].id);

            await prisma.syncJob.update({
                where: { id: jobId },
                data: {
                    processed: { increment: shopifyOrders.length },
                    created: { increment: batchCreated },
                    updated: { increment: batchUpdated },
                    skipped: { increment: batchSkipped },
                    errors: { increment: batchErrors },
                    lastProcessedId: sinceId,
                    currentBatch: batchNumber,
                    errorLog: JSON.stringify(errorLog.slice(-this.maxErrors)),
                }
            });

            // Rate limit delay
            await new Promise(resolve => setTimeout(resolve, this.batchDelay));

            // Stop if batch was smaller than limit (no more records)
            if (shopifyOrders.length < this.batchSize) {
                break;
            }
        }

        // Mark complete
        await prisma.syncJob.update({
            where: { id: jobId },
            data: {
                status: 'completed',
                completedAt: new Date(),
            }
        });

        console.log(`[Job ${jobId}] Completed`);
    }

    /**
     * Sync a single order from Shopify
     */
    async syncSingleOrder(shopifyOrder) {
        const shopifyOrderId = String(shopifyOrder.id);

        // Check if exists
        const existingOrder = await prisma.order.findUnique({
            where: { shopifyOrderId }
        });

        if (existingOrder) {
            // Update if status changed
            const newStatus = shopifyClient.mapOrderStatus(shopifyOrder);
            const newFulfillmentStatus = shopifyOrder.fulfillment_status || 'unfulfilled';

            // Extract tracking info
            let newAwbNumber = existingOrder.awbNumber;
            let newCourier = existingOrder.courier;
            let newShippedAt = existingOrder.shippedAt;

            if (shopifyOrder.fulfillments?.length > 0) {
                const f = shopifyOrder.fulfillments.find(x => x.tracking_number) || shopifyOrder.fulfillments[0];
                newAwbNumber = f.tracking_number || newAwbNumber;
                newCourier = f.tracking_company || newCourier;
                if (f.created_at && !existingOrder.shippedAt) {
                    newShippedAt = new Date(f.created_at);
                }
            }

            const needsUpdate = existingOrder.status !== newStatus ||
                existingOrder.shopifyFulfillmentStatus !== newFulfillmentStatus ||
                existingOrder.awbNumber !== newAwbNumber ||
                existingOrder.courier !== newCourier;

            if (needsUpdate) {
                await prisma.order.update({
                    where: { id: existingOrder.id },
                    data: {
                        status: newStatus,
                        shopifyFulfillmentStatus: newFulfillmentStatus,
                        awbNumber: newAwbNumber,
                        courier: newCourier,
                        shippedAt: newShippedAt,
                        syncedAt: new Date(),
                    }
                });
                return 'updated';
            }
            return 'skipped';
        }

        // Find or create customer
        let customerId = null;
        if (shopifyOrder.customer) {
            const customerEmail = shopifyOrder.customer.email?.toLowerCase();
            const shopifyCustomerId = String(shopifyOrder.customer.id);

            if (customerEmail) {
                let customer = await prisma.customer.findFirst({
                    where: {
                        OR: [
                            { shopifyCustomerId },
                            { email: customerEmail },
                        ],
                    },
                });

                if (!customer) {
                    customer = await prisma.customer.create({
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
                }
                customerId = customer.id;

                await prisma.customer.update({
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
                sku = await prisma.sku.findFirst({
                    where: { shopifyVariantId: String(lineItem.variant_id) },
                });
            }

            if (!sku && lineItem.sku) {
                sku = await prisma.sku.findFirst({
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

        if (!hasMatchedSku) {
            throw new Error('No matching SKUs found');
        }

        // Extract tracking info
        let awbNumber = null;
        let courier = null;
        let shippedAt = null;

        if (shopifyOrder.fulfillments?.length > 0) {
            const f = shopifyOrder.fulfillments.find(x => x.tracking_number) || shopifyOrder.fulfillments[0];
            awbNumber = f.tracking_number || null;
            courier = f.tracking_company || null;
            if (f.created_at) shippedAt = new Date(f.created_at);
        }

        const customerName = shopifyOrder.customer
            ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim()
            : shopifyOrder.shipping_address?.name || 'Unknown';

        await prisma.order.create({
            data: {
                orderNumber: String(shopifyOrder.order_number),
                shopifyOrderId,
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

        return 'created';
    }

    /**
     * Process customer sync with checkpointing
     */
    async processCustomerSync(jobId) {
        let job = await prisma.syncJob.findUnique({ where: { id: jobId } });

        if (!job.totalRecords) {
            const totalCount = await shopifyClient.getCustomerCount();
            await prisma.syncJob.update({
                where: { id: jobId },
                data: { totalRecords: totalCount }
            });
            job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        }

        console.log(`[Job ${jobId}] Starting customer sync: ${job.totalRecords} total`);

        let sinceId = job.lastProcessedId;
        let batchNumber = job.currentBatch;
        const errorLog = job.errorLog ? JSON.parse(job.errorLog) : [];

        while (true) {
            const currentJob = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (currentJob?.status === 'cancelled') return;

            batchNumber++;

            const shopifyCustomers = await shopifyClient.getCustomers({
                since_id: sinceId,
                limit: this.batchSize,
            });

            if (shopifyCustomers.length === 0) break;

            let batchCreated = 0, batchUpdated = 0, batchSkipped = 0, batchErrors = 0;

            for (const shopifyCustomer of shopifyCustomers) {
                try {
                    // Skip customers without orders
                    if ((shopifyCustomer.orders_count || 0) === 0) {
                        batchSkipped++;
                        continue;
                    }

                    const shopifyCustomerId = String(shopifyCustomer.id);
                    const email = shopifyCustomer.email?.toLowerCase();

                    if (!email) {
                        batchSkipped++;
                        continue;
                    }

                    const existing = await prisma.customer.findFirst({
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

                    if (existing) {
                        await prisma.customer.update({
                            where: { id: existing.id },
                            data: customerData,
                        });
                        batchUpdated++;
                    } else {
                        await prisma.customer.create({ data: customerData });
                        batchCreated++;
                    }
                } catch (err) {
                    batchErrors++;
                    if (errorLog.length < this.maxErrors) {
                        errorLog.push(`Customer ${shopifyCustomer.id}: ${err.message}`);
                    }
                }
            }

            sinceId = String(shopifyCustomers[shopifyCustomers.length - 1].id);

            await prisma.syncJob.update({
                where: { id: jobId },
                data: {
                    processed: { increment: shopifyCustomers.length },
                    created: { increment: batchCreated },
                    updated: { increment: batchUpdated },
                    skipped: { increment: batchSkipped },
                    errors: { increment: batchErrors },
                    lastProcessedId: sinceId,
                    currentBatch: batchNumber,
                    errorLog: JSON.stringify(errorLog.slice(-this.maxErrors)),
                }
            });

            await new Promise(resolve => setTimeout(resolve, this.batchDelay));

            if (shopifyCustomers.length < this.batchSize) break;
        }

        await prisma.syncJob.update({
            where: { id: jobId },
            data: { status: 'completed', completedAt: new Date() }
        });

        console.log(`[Job ${jobId}] Completed`);
    }

    /**
     * Process product sync (usually fast, but still checkpointed)
     */
    async processProductSync(jobId) {
        console.log(`[Job ${jobId}] Starting product sync`);

        try {
            const totalCount = await shopifyClient.getProductCount();
            await prisma.syncJob.update({
                where: { id: jobId },
                data: { totalRecords: totalCount }
            });

            // Products are usually fewer, fetch all at once
            const shopifyProducts = await shopifyClient.getAllProducts();

            // Get or create default fabric
            let defaultFabric = await prisma.fabric.findFirst();
            if (!defaultFabric) {
                let fabricType = await prisma.fabricType.findFirst();
                if (!fabricType) {
                    fabricType = await prisma.fabricType.create({
                        data: { name: 'Default', composition: 'Unknown', unit: 'meter', avgShrinkagePct: 0 }
                    });
                }
                defaultFabric = await prisma.fabric.create({
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

            let created = 0, updated = 0, skipped = 0, errors = 0;
            const errorLog = [];

            for (const shopifyProduct of shopifyProducts) {
                try {
                    const result = await this.syncSingleProduct(shopifyProduct, defaultFabric.id);
                    if (result.created) created += result.created;
                    if (result.updated) updated += result.updated;
                } catch (err) {
                    errors++;
                    if (errorLog.length < this.maxErrors) {
                        errorLog.push(`Product ${shopifyProduct.title}: ${err.message}`);
                    }
                }

                // Update progress periodically
                await prisma.syncJob.update({
                    where: { id: jobId },
                    data: {
                        processed: created + updated + skipped + errors,
                        created,
                        updated,
                        skipped,
                        errors,
                        errorLog: JSON.stringify(errorLog),
                    }
                });
            }

            await prisma.syncJob.update({
                where: { id: jobId },
                data: { status: 'completed', completedAt: new Date() }
            });

            console.log(`[Job ${jobId}] Completed`);
        } catch (error) {
            throw error;
        }
    }

    /**
     * Sync single product (simplified - reuses existing logic structure)
     */
    async syncSingleProduct(shopifyProduct, defaultFabricId) {
        const result = { created: 0, updated: 0 };

        const mainImageUrl = shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || null;
        const gender = shopifyClient.normalizeGender(shopifyProduct.product_type);

        // Build variant-to-image mapping
        const variantImageMap = {};
        for (const img of shopifyProduct.images || []) {
            for (const variantId of img.variant_ids || []) {
                variantImageMap[variantId] = img.src;
            }
        }

        // Find or create product
        let product = await prisma.product.findFirst({
            where: { name: shopifyProduct.title, gender: gender || 'unisex' },
        });

        if (!product) {
            const existingByName = await prisma.product.findFirst({
                where: { name: shopifyProduct.title },
            });

            if (existingByName && !existingByName.gender) {
                product = await prisma.product.update({
                    where: { id: existingByName.id },
                    data: {
                        gender: gender || 'unisex',
                        imageUrl: mainImageUrl || existingByName.imageUrl,
                        category: shopifyProduct.product_type?.toLowerCase() || existingByName.category,
                    },
                });
                result.updated++;
            } else {
                product = await prisma.product.create({
                    data: {
                        name: shopifyProduct.title,
                        category: shopifyProduct.product_type?.toLowerCase() || 'dress',
                        productType: 'basic',
                        gender: gender || 'unisex',
                        baseProductionTimeMins: 60,
                        imageUrl: mainImageUrl,
                    },
                });
                result.created++;
            }
        } else if (mainImageUrl && product.imageUrl !== mainImageUrl) {
            await prisma.product.update({
                where: { id: product.id },
                data: { imageUrl: mainImageUrl },
            });
            result.updated++;
        }

        // Group variants by color
        const variantsByColor = {};
        for (const variant of shopifyProduct.variants || []) {
            const colorOption = variant.option1 || 'Default';
            if (!variantsByColor[colorOption]) {
                variantsByColor[colorOption] = [];
            }
            variantsByColor[colorOption].push(variant);
        }

        // Create variations and SKUs
        for (const [colorName, variants] of Object.entries(variantsByColor)) {
            const firstVariantId = variants[0]?.id;
            const variationImageUrl = variantImageMap[firstVariantId] || mainImageUrl;

            let variation = await prisma.variation.findFirst({
                where: { productId: product.id, colorName },
            });

            if (!variation) {
                variation = await prisma.variation.create({
                    data: {
                        productId: product.id,
                        colorName,
                        fabricId: defaultFabricId,
                        imageUrl: variationImageUrl,
                    },
                });
                result.created++;
            } else if (variationImageUrl && variation.imageUrl !== variationImageUrl) {
                await prisma.variation.update({
                    where: { id: variation.id },
                    data: { imageUrl: variationImageUrl },
                });
                result.updated++;
            }

            for (const variant of variants) {
                const shopifyVariantId = String(variant.id);
                const skuCode = variant.sku?.trim() ||
                    `${shopifyProduct.handle}-${colorName}-${variant.option2 || 'OS'}`.replace(/\s+/g, '-').toUpperCase();
                const rawSize = variant.option2 || variant.option3 || 'One Size';
                const size = rawSize
                    .replace(/^XXXXL$/i, '4XL')
                    .replace(/^XXXL$/i, '3XL')
                    .replace(/^XXL$/i, '2XL');

                let sku = await prisma.sku.findFirst({
                    where: {
                        OR: [
                            { shopifyVariantId },
                            { skuCode },
                        ],
                    },
                });

                if (sku) {
                    await prisma.sku.update({
                        where: { id: sku.id },
                        data: {
                            shopifyVariantId,
                            shopifyInventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
                            mrp: parseFloat(variant.price) || sku.mrp,
                        },
                    });

                    if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
                        await prisma.shopifyInventoryCache.upsert({
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
                    result.updated++;
                } else {
                    const newSku = await prisma.sku.create({
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

                    if (variant.inventory_item_id && typeof variant.inventory_quantity === 'number') {
                        await prisma.shopifyInventoryCache.create({
                            data: {
                                skuId: newSku.id,
                                shopifyInventoryItemId: String(variant.inventory_item_id),
                                availableQty: variant.inventory_quantity,
                            },
                        });
                    }
                    result.created++;
                }
            }
        }

        return result;
    }
}

// Export singleton
export const syncWorker = new SyncWorker();
export default syncWorker;
