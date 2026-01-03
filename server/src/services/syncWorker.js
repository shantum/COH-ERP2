import { PrismaClient } from '@prisma/client';
import shopifyClient from './shopify.js';
import { cacheAndProcessOrder } from './shopifyOrderProcessor.js';
import { syncSingleProduct, ensureDefaultFabric } from './productSyncService.js';
import { syncSingleCustomer } from './customerSyncService.js';

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
