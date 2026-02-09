/**
 * Background Sync Worker
 * Processes sync jobs with checkpointing and resume capability
 *
 * SIMPLIFIED SYNC MODES (2 modes only):
 * - DEEP: Full import, upserts all orders (initial setup, recovery)
 * - INCREMENTAL: Catch-up sync using updated_at_min or created_at_min
 *
 * Legacy modes (quick, update) are mapped to INCREMENTAL for backward compatibility.
 */

import type { SyncJob } from '@prisma/client';
import prisma from '../lib/prisma.js';
import type { ShopifyOrder } from './shopify.js';
import shopifyClient from './shopify.js';
import { cacheAndProcessOrder } from './shopifyOrderProcessor.js';
import { syncSingleProduct, ensureDefaultFabric } from './productSyncService.js';
import { syncSingleCustomer } from './customerSyncService.js';
import { syncLogger } from '../utils/logger.js';
import { SYNC_WORKER_CONFIG } from '../constants.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Supported sync modes for orders
 * - deep: Full import of all orders (initial setup, recovery)
 * - incremental: Catch-up sync using date filters (hourly/daily refresh)
 * Legacy: 'quick' and 'update' are treated as 'incremental'
 */
type SyncMode = 'deep' | 'incremental' | 'quick' | 'update' | null;

/**
 * Valid sync job types
 */
type JobType = 'orders' | 'customers' | 'products';

/**
 * Options for starting a sync job
 */
interface StartJobOptions {
    days?: number;
    syncMode?: SyncMode;
    staleAfterMins?: number;
}

/**
 * Error log entry
 */
type ErrorLogEntry = string;

/**
 * Result of syncing a single order
 */
type SyncOrderResult = 'created' | 'updated' | 'skipped';

// ============================================
// SYNC WORKER CLASS
// ============================================

/**
 * Background Sync Worker
 * Processes sync jobs with checkpointing and resume capability
 *
 * SIMPLIFIED SYNC MODES:
 * - DEEP: Full import, aggressive memory management (initial setup, recovery)
 * - INCREMENTAL: Fast catch-up using date filters (hourly/daily refresh)
 */
class SyncWorker {
    // Active jobs tracker (in-memory, single instance only)
    private activeJobs: Map<string, boolean>;

    // Default settings (overridden per sync mode)
    private batchSize: number;
    private batchDelay: number;
    private maxErrors: number;
    private gcInterval: number;
    private disconnectInterval: number;

    constructor() {
        this.activeJobs = new Map();
        // Initialize with incremental defaults from config
        this.batchSize = SYNC_WORKER_CONFIG.incremental.batchSize;
        this.batchDelay = SYNC_WORKER_CONFIG.incremental.batchDelay;
        this.maxErrors = SYNC_WORKER_CONFIG.maxErrors;
        this.gcInterval = SYNC_WORKER_CONFIG.incremental.gcInterval;
        this.disconnectInterval = SYNC_WORKER_CONFIG.incremental.disconnectInterval;
    }

    /**
     * Normalize sync mode (map legacy modes to simplified modes)
     */
    private normalizeMode(syncMode: SyncMode): 'deep' | 'incremental' {
        if (syncMode === 'deep') return 'deep';
        // quick, update, null all map to incremental
        return 'incremental';
    }

    /**
     * Configure settings based on sync mode
     */
    private configureModeSettings(syncMode: SyncMode): void {
        const mode = this.normalizeMode(syncMode);
        const config = mode === 'deep' ? SYNC_WORKER_CONFIG.deep : SYNC_WORKER_CONFIG.incremental;

        this.batchSize = config.batchSize;
        this.batchDelay = config.batchDelay;
        this.gcInterval = config.gcInterval;
        this.disconnectInterval = config.disconnectInterval;
    }

    /**
     * Start a new sync job
     * @param jobType - 'orders', 'customers', 'products'
     * @param options - Job options
     * @param options.days - Number of days to sync (for created_at filter)
     * @param options.syncMode - 'deep' | 'incremental' (or legacy: 'quick' | 'update')
     *   - 'deep': Full import of all orders (initial setup, recovery)
     *   - 'incremental': Catch-up sync using date filters (hourly/daily refresh)
     * @param options.staleAfterMins - For incremental mode: re-sync orders updated in last X mins
     */
    async startJob(jobType: JobType, options: StartJobOptions = {}): Promise<SyncJob> {
        // Reload Shopify config first (outside transaction)
        await shopifyClient.loadFromDatabase();

        if (!shopifyClient.isConfigured()) {
            throw new Error('Shopify is not configured');
        }

        // Validate syncMode (accept both new and legacy modes)
        const validModes: SyncMode[] = ['deep', 'incremental', 'quick', 'update', null];
        if (options.syncMode !== undefined && !validModes.includes(options.syncMode)) {
            throw new Error(`Invalid syncMode: ${options.syncMode}. Must be 'deep', 'incremental', or omitted.`);
        }

        // Normalize mode for storage
        const effectiveMode = this.normalizeMode(options.syncMode ?? null);

        // Build date filter label
        let dateFilter = 'All time';
        if (options.staleAfterMins) {
            dateFilter = `Updated in last ${options.staleAfterMins} mins`;
        } else if (options.days) {
            dateFilter = `Last ${options.days} days`;
        } else if (effectiveMode === 'incremental') {
            dateFilter = 'Since last order';
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
            syncLogger.error({ jobId: job.id, error: (err as Error).message }, 'Job failed');
        });

        return job;
    }

    /**
     * Resume a failed or cancelled job
     */
    async resumeJob(jobId: string): Promise<SyncJob> {
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
            syncLogger.error({ jobId, error: (err as Error).message }, 'Job resume failed');
        });

        return (await prisma.syncJob.findUnique({ where: { id: jobId } }))!;
    }

    /**
     * Cancel a running job
     */
    async cancelJob(jobId: string): Promise<SyncJob> {
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

        this.activeJobs.delete(jobId);

        return (await prisma.syncJob.findUnique({ where: { id: jobId } }))!;
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId: string): Promise<SyncJob | null> {
        return await prisma.syncJob.findUnique({ where: { id: jobId } });
    }

    /**
     * List recent jobs
     */
    async listJobs(limit = 10): Promise<SyncJob[]> {
        return await prisma.syncJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /**
     * Main job processor
     */
    private async processJob(jobId: string): Promise<void> {
        const job = await prisma.syncJob.findUnique({ where: { id: jobId } });

        if (!job || job.status === 'cancelled') {
            return;
        }

        this.activeJobs.set(jobId, true);

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
            syncLogger.error({ jobId, error: (error as Error).message }, 'Job error');
            await prisma.syncJob.update({
                where: { id: jobId },
                data: {
                    status: 'failed',
                    lastError: (error as Error).message,
                    completedAt: new Date(),
                }
            });
        } finally {
            this.activeJobs.delete(jobId);
        }
    }

    /**
     * Process order sync with checkpointing
     * SIMPLIFIED MODES:
     * - DEEP: Full import, upsert all orders (initial setup, data recovery)
     * - INCREMENTAL: Catch-up sync using date filters (hourly/daily refresh)
     */
    private async processOrderSync(jobId: string): Promise<void> {
        let job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        if (!job) return;

        const rawSyncMode = job.syncMode as SyncMode;
        const effectiveMode = this.normalizeMode(rawSyncMode);

        // Configure batch settings based on sync mode
        this.configureModeSettings(rawSyncMode);

        // Calculate date filters based on sync mode
        let createdAtMin: string | null = null;
        let updatedAtMin: string | null = null;

        if (job.staleAfterMins) {
            // Use updated_at_min to only fetch recently modified orders
            const threshold = new Date();
            threshold.setMinutes(threshold.getMinutes() - job.staleAfterMins);
            updatedAtMin = threshold.toISOString();
            syncLogger.info({ jobId, updatedAtMin }, 'INCREMENTAL mode: fetching recently updated orders');
        } else if (effectiveMode === 'incremental' && !job.daysBack) {
            // Find most recent order date in DB and fetch newer orders
            const latestOrder = await prisma.order.findFirst({
                where: { shopifyOrderId: { not: null } },
                orderBy: { orderDate: 'desc' },
                select: { orderDate: true }
            });
            if (latestOrder?.orderDate) {
                createdAtMin = latestOrder.orderDate.toISOString();
                syncLogger.info({ jobId, createdAtMin }, 'INCREMENTAL mode: fetching orders since last sync');
            } else {
                syncLogger.info({ jobId }, 'INCREMENTAL mode: no existing orders, fetching all');
            }
        } else if (job.daysBack) {
            // Use created_at_min with days filter
            const d = new Date();
            d.setDate(d.getDate() - job.daysBack);
            createdAtMin = d.toISOString();
        }

        // Get total count if not set (only for DEEP mode where we know scope)
        if (!job.totalRecords && effectiveMode === 'deep') {
            const totalCount = await shopifyClient.getOrderCount({
                status: 'any',
                created_at_min: createdAtMin || undefined
            });
            await prisma.syncJob.update({
                where: { id: jobId },
                data: { totalRecords: totalCount }
            });
            job = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (!job) return;
        }

        syncLogger.info({ jobId, syncMode: effectiveMode, totalRecords: job.totalRecords, resumeFrom: job.lastProcessedId || 'start' }, 'Starting order sync');

        let sinceId = job.lastProcessedId;

        let batchNumber = job.currentBatch;
        const errorLog: ErrorLogEntry[] = job.errorLog ? JSON.parse(job.errorLog) : [];

        while (true) {
            // Check if cancelled
            const currentJob = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (currentJob?.status === 'cancelled') {
                syncLogger.info({ jobId }, 'Job cancelled');
                return;
            }

            batchNumber++;

            // Fetch batch from Shopify
            let shopifyOrders: ShopifyOrder[];
            try {
                const fetchOptions: Record<string, any> = {
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
            } catch (fetchError: unknown) {
                const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
                // Axios errors have response.data with API error details
                const axiosData = (fetchError as { response?: { data?: { errors?: string } } })?.response?.data;
                syncLogger.error({ jobId, error: axiosData || errMsg }, 'Shopify API error');
                throw new Error(`Shopify API: ${axiosData?.errors || errMsg}`);
            }

            if (shopifyOrders.length === 0) {
                break;
            }

            syncLogger.debug({ jobId, batchNumber, orderCount: shopifyOrders.length, syncMode: effectiveMode }, 'Processing batch');

            let batchCreated = 0, batchUpdated = 0, batchSkipped = 0, batchErrors = 0;

            for (const shopifyOrder of shopifyOrders) {
                try {
                    const result = await this.syncSingleOrder(shopifyOrder);
                    if (result === 'created') {
                        batchCreated++;
                    } else if (result === 'updated') {
                        batchUpdated++;
                    } else {
                        batchSkipped++;
                    }
                } catch (err) {
                    batchErrors++;
                    if (errorLog.length < this.maxErrors) {
                        errorLog.push(`Order ${shopifyOrder.order_number}: ${(err as Error).message}`);
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
                    syncLogger.debug({ jobId, batchNumber }, 'GC triggered');
                }
            }

            // Prisma connection cleanup: Disconnect periodically to release memory
            if (batchNumber % this.disconnectInterval === 0) {
                await prisma.$disconnect();
                syncLogger.debug({ jobId, batchNumber }, 'Prisma disconnected');
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

        syncLogger.info({ jobId, syncMode: effectiveMode }, 'Order sync completed');
    }

    /**
     * Sync a single order from Shopify
     * Uses shared processor with cache-first approach
     */
    private async syncSingleOrder(shopifyOrder: ShopifyOrder): Promise<SyncOrderResult> {
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
    private async processCustomerSync(jobId: string): Promise<void> {
        let job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        if (!job) return;

        if (!job.totalRecords) {
            const totalCount = await shopifyClient.getCustomerCount();
            await prisma.syncJob.update({
                where: { id: jobId },
                data: { totalRecords: totalCount }
            });
            job = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (!job) return;
        }

        syncLogger.info({ jobId, totalRecords: job.totalRecords }, 'Starting customer sync');

        let sinceId = job.lastProcessedId;
        let batchNumber = job.currentBatch;
        const errorLog: ErrorLogEntry[] = job.errorLog ? JSON.parse(job.errorLog) : [];

        while (true) {
            const currentJob = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (currentJob?.status === 'cancelled') return;

            batchNumber++;

            const shopifyCustomers = await shopifyClient.getCustomers({
                since_id: sinceId || undefined,
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
                        errorLog.push(`Customer ${shopifyCustomer.id}: ${(err as Error).message}`);
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

        syncLogger.info({ jobId }, 'Customer sync completed');
    }

    /**
     * Process product sync (usually fast, but still checkpointed)
     * Uses shared productSyncService for single product processing
     */
    private async processProductSync(jobId: string): Promise<void> {
        syncLogger.info({ jobId }, 'Starting product sync');

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
            const errorLog: ErrorLogEntry[] = [];

            for (const shopifyProduct of shopifyProducts) {
                try {
                    // Use shared service for product sync
                    const result = await syncSingleProduct(prisma, shopifyProduct, defaultFabric.id);
                    if (result.created) created += result.created;
                    if (result.updated) updated += result.updated;
                } catch (err) {
                    errors++;
                    if (errorLog.length < this.maxErrors) {
                        errorLog.push(`Product ${shopifyProduct.title}: ${(err as Error).message}`);
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

            syncLogger.info({ jobId }, 'Product sync completed');
        } catch (error) {
            throw error;
        }
    }
}

// ============================================
// EXPORTS
// ============================================

// Export singleton
export const syncWorker = new SyncWorker();
export default syncWorker;
