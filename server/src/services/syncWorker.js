import prisma from '../lib/prisma.js';
import shopifyClient from './shopify.js';
import { cacheAndProcessOrder } from './shopifyOrderProcessor.js';
import { syncSingleProduct, ensureDefaultFabric } from './productSyncService.js';
import { syncSingleCustomer } from './customerSyncService.js';

// Active jobs tracker (in-memory, single instance only)
const activeJobs = new Map();

/**
 * Background Sync Worker
 * Processes sync jobs with checkpointing and resume capability
 *
 * Supports three sync modes for orders:
 * - DEEP: Full import with aggressive memory management (initial setup, recovery)
 * - QUICK: Missing orders only, fetches after latest DB order date (daily catch-up)
 * - UPDATE: Recently changed orders only via updated_at_min (hourly refresh)
 */
class SyncWorker {
    constructor() {
        // Default settings (overridden per sync mode)
        this.batchSize = 50;
        this.batchDelay = 1000;
        this.maxErrors = 20;
        this.gcInterval = 5;
        this.disconnectInterval = 10;
    }

    /**
     * Configure settings based on sync mode
     */
    configureModeSettings(syncMode) {
        switch (syncMode) {
            case 'deep':
                // DEEP: Maximum batch size, aggressive memory management
                this.batchSize = 250;
                this.batchDelay = 1500;
                this.gcInterval = 3;
                this.disconnectInterval = 5;
                break;
            case 'quick':
            case 'update':
                // QUICK/UPDATE: Fast, smaller batches
                this.batchSize = 250;
                this.batchDelay = 500;
                this.gcInterval = 10;
                this.disconnectInterval = 20;
                break;
            default:
                // Legacy mode: conservative settings
                this.batchSize = 50;
                this.batchDelay = 1000;
                this.gcInterval = 5;
                this.disconnectInterval = 10;
        }
    }

    /**
     * Start a new sync job
     * @param {string} jobType - 'orders', 'customers', 'products'
     * @param {Object} options - Job options
     * @param {number} options.days - Number of days to sync (for created_at filter, used by DEEP mode)
     * @param {string} options.syncMode - 'deep' | 'quick' | 'update' | null (legacy)
     *   - 'deep': Full import with aggressive memory management (initial setup, recovery)
     *   - 'quick': Missing orders only, fetches after latest DB order date (daily catch-up)
     *   - 'update': Recently changed orders via updated_at_min (hourly refresh)
     * @param {number} options.staleAfterMins - For update mode: re-sync orders updated in last X mins
     */
    async startJob(jobType, options = {}) {
        // Reload Shopify config first (outside transaction)
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        // Validate syncMode
        const validModes = ['deep', 'quick', 'update', null, undefined];
        if (!validModes.includes(options.syncMode)) {
            throw new Error(`Invalid syncMode: ${options.syncMode}. Must be 'deep', 'quick', 'update', or omitted for legacy mode.`);
        }

        // Build date filter label
        let dateFilter = 'All time';
        if (options.syncMode === 'update' && options.staleAfterMins) {
            dateFilter = `Updated in last ${options.staleAfterMins} mins`;
        } else if (options.syncMode === 'quick') {
            dateFilter = 'Since last order';
        } else if (options.days) {
            dateFilter = `Last ${options.days} days`;
        }

        // Use transaction to atomically check for existing job and create new one
        // This prevents race condition where two requests could both see no running job
        const job = await prisma.$transaction(async (tx) => {
            // Check for existing running job of same type (within transaction)
            const existingJob = await tx.syncJob.findFirst({
                where: {
                    jobType,
                    status: { in: ['pending', 'running'] }
                }
            });

            if (existingJob) {
                throw new Error(`A ${jobType} sync job is already running (ID: ${existingJob.id})`);
            }

            // Create job record (atomically with the check above)
            return await tx.syncJob.create({
                data: {
                    jobType,
                    status: 'pending',
                    daysBack: options.days || null,
                    dateFilter,
                    syncMode: options.syncMode || null,
                    staleAfterMins: options.staleAfterMins || null,
                }
            });
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
     * Supports three modes:
     * - DEEP: Full import, upsert all orders (initial setup, data recovery)
     * - QUICK: Missing orders only, skip existing (daily catch-up)
     * - UPDATE: Only fetch orders updated in Shopify since staleAfterMins (hourly refresh)
     * - LEGACY (null): Upsert all orders with conservative settings
     */
    async processOrderSync(jobId) {
        let job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        const syncMode = job.syncMode;

        // Configure batch settings based on sync mode
        this.configureModeSettings(syncMode);

        // Calculate date filters based on sync mode
        let createdAtMin = null;
        let updatedAtMin = null;

        if (syncMode === 'update' && job.staleAfterMins) {
            // UPDATE mode: Use updated_at_min to only fetch recently modified orders
            const threshold = new Date();
            threshold.setMinutes(threshold.getMinutes() - job.staleAfterMins);
            updatedAtMin = threshold.toISOString();
            console.log(`[Job ${jobId}] UPDATE mode: fetching orders updated since ${updatedAtMin}`);
        } else if (syncMode === 'quick') {
            // QUICK mode: Find most recent order date in DB and fetch newer orders
            const latestOrder = await prisma.order.findFirst({
                where: { shopifyOrderId: { not: null } },
                orderBy: { orderDate: 'desc' },
                select: { orderDate: true }
            });
            if (latestOrder?.orderDate) {
                createdAtMin = latestOrder.orderDate.toISOString();
                console.log(`[Job ${jobId}] QUICK mode: fetching orders created after ${createdAtMin}`);
            } else {
                console.log(`[Job ${jobId}] QUICK mode: no existing orders, fetching all`);
            }
        } else if (job.daysBack) {
            // DEEP or LEGACY mode: Use created_at_min with days filter
            const d = new Date();
            d.setDate(d.getDate() - job.daysBack);
            createdAtMin = d.toISOString();
        }

        // For QUICK mode, load existing order IDs upfront for skip logic
        let existingOrderIds = new Set();
        if (syncMode === 'quick') {
            console.log(`[Job ${jobId}] QUICK mode: loading existing Shopify order IDs...`);
            const existingOrders = await prisma.order.findMany({
                where: { shopifyOrderId: { not: null } },
                select: { shopifyOrderId: true }
            });
            existingOrderIds = new Set(existingOrders.map(o => o.shopifyOrderId));
            console.log(`[Job ${jobId}] Found ${existingOrderIds.size} existing orders to skip`);
        }

        // Get total count if not set (only for DEEP/LEGACY modes; QUICK/UPDATE are unpredictable)
        if (!job.totalRecords && syncMode !== 'update' && syncMode !== 'quick') {
            const totalCount = await shopifyClient.getOrderCount({
                status: 'any',
                created_at_min: createdAtMin
            });
            await prisma.syncJob.update({
                where: { id: jobId },
                data: { totalRecords: totalCount }
            });
            job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        }

        console.log(`[Job ${jobId}] Starting order sync (${syncMode || 'legacy'} mode): ${job.totalRecords || '?'} total, resuming from ID: ${job.lastProcessedId || 'start'}`);

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
                const fetchOptions = {
                    since_id: sinceId,
                    status: 'any',
                    limit: this.batchSize,
                };

                // Apply date filters (don't combine with since_id for pagination)
                if (!sinceId) {
                    if (updatedAtMin) {
                        fetchOptions.updated_at_min = updatedAtMin;
                    } else if (createdAtMin) {
                        fetchOptions.created_at_min = createdAtMin;
                    }
                }

                shopifyOrders = await shopifyClient.getOrders(fetchOptions);
            } catch (fetchError) {
                console.error(`[Job ${jobId}] Shopify API error:`, fetchError.response?.data || fetchError.message);
                throw new Error(`Shopify API: ${fetchError.response?.data?.errors || fetchError.message}`);
            }

            if (shopifyOrders.length === 0) {
                break;
            }

            console.log(`[Job ${jobId}] Batch ${batchNumber}: processing ${shopifyOrders.length} orders (${syncMode || 'legacy'} mode)`);

            let batchCreated = 0, batchUpdated = 0, batchSkipped = 0, batchErrors = 0;

            for (const shopifyOrder of shopifyOrders) {
                try {
                    // QUICK mode: Skip if order already exists
                    if (syncMode === 'quick' && existingOrderIds.has(String(shopifyOrder.id))) {
                        batchSkipped++;
                        continue;
                    }

                    const result = await this.syncSingleOrder(shopifyOrder);
                    if (result === 'created') {
                        batchCreated++;
                        // Add to existing set for subsequent batches (in case of duplicates)
                        if (syncMode === 'quick') {
                            existingOrderIds.add(String(shopifyOrder.id));
                        }
                    } else if (result === 'updated') {
                        batchUpdated++;
                    } else {
                        batchSkipped++;
                    }
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

            // Memory cleanup: Request GC periodically
            if (batchNumber % this.gcInterval === 0) {
                if (global.gc) {
                    global.gc();
                    console.log(`[Job ${jobId}] GC triggered after batch ${batchNumber}`);
                }
            }

            // Prisma connection cleanup: Disconnect periodically to release memory
            if (batchNumber % this.disconnectInterval === 0) {
                await prisma.$disconnect();
                console.log(`[Job ${jobId}] Prisma disconnected after batch ${batchNumber}`);
                await new Promise(r => setTimeout(r, 500));
            }

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

        console.log(`[Job ${jobId}] Completed (${syncMode || 'legacy'} mode)`);
    }

    /**
     * Sync a single order from Shopify
     * Uses shared processor with cache-first approach
     */
    async syncSingleOrder(shopifyOrder) {
        // Use shared processor - caches first, then processes to ERP
        const result = await cacheAndProcessOrder(prisma, shopifyOrder, 'api_sync', {
            skipNoSku: true // Bulk sync should skip orders with no matching SKUs
        });

        // Map result.action to legacy return values for job tracking
        if (result.action === 'created') return 'created';
        if (result.action === 'updated' || result.action === 'cancelled' || result.action === 'fulfilled') return 'updated';
        if (result.action === 'skipped') {
            if (result.reason === 'no_matching_skus') {
                throw new Error('No matching SKUs found');
            }
            return 'skipped';
        }
        if (result.action === 'cache_only') {
            throw new Error(result.error || 'Processing failed');
        }

        return 'skipped';
    }

    /**
     * Process customer sync with checkpointing
     * Uses shared customerSyncService for single customer processing
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
                    // Use shared service for customer sync
                    const result = await syncSingleCustomer(prisma, shopifyCustomer, {
                        skipNoOrders: true,
                        skipNoEmail: true,
                    });

                    if (result.action === 'created') batchCreated++;
                    else if (result.action === 'updated') batchUpdated++;
                    else batchSkipped++;
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

            // Memory cleanup: Request GC periodically
            if (batchNumber % this.gcInterval === 0 && global.gc) {
                global.gc();
            }

            // Prisma connection cleanup
            if (batchNumber % this.disconnectInterval === 0) {
                await prisma.$disconnect();
                await new Promise(r => setTimeout(r, 500));
            }

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
     * Uses shared productSyncService for single product processing
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

            // Get or create default fabric using shared helper
            const defaultFabric = await ensureDefaultFabric(prisma);

            let created = 0, updated = 0, skipped = 0, errors = 0;
            const errorLog = [];

            for (const shopifyProduct of shopifyProducts) {
                try {
                    // Use shared service for product sync
                    const result = await syncSingleProduct(prisma, shopifyProduct, defaultFabric.id);
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
}

// Export singleton
export const syncWorker = new SyncWorker();
export default syncWorker;
