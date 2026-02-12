/**
 * Cache Dump Worker
 *
 * Persistent, resumable background worker that dumps ALL Shopify orders to cache.
 * Designed to run until completion, automatically resuming after server restarts.
 *
 * FEATURES:
 * - Persistent progress tracking via SyncJob table
 * - Checkpoints after each batch (survives restarts)
 * - Auto-resumes incomplete jobs on startup
 * - Runs continuously until all orders are cached
 * - Graceful shutdown support
 *
 * FLOW:
 * 1. On startup, check for incomplete cache_dump jobs
 * 2. If found, resume from lastProcessedId
 * 3. If not, can start new job via API
 * 4. Fetch orders in batches, checkpoint after each
 * 5. Continue until Shopify returns no more orders
 */

import type { SyncJob } from '@prisma/client';
import prisma from '../lib/prisma.js';
import shopifyClient from './shopify.js';
import type { ShopifyOrder } from './shopify.js';
import { cacheShopifyOrders } from './shopifyOrderProcessor.js';
import { syncLogger } from '../utils/logger.js';
import shutdownCoordinator from '../utils/shutdownCoordinator.js';
import { trackWorkerRun } from '../utils/workerRunTracker.js';

// ============================================
// CONFIGURATION
// ============================================

/** Batch size for fetching from Shopify */
const BATCH_SIZE = 250;

/** Delay between batches (ms) to avoid rate limiting */
const BATCH_DELAY_MS = 500;

/** Delay between polling for work (ms) */
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

/** Max errors before pausing */
const MAX_CONSECUTIVE_ERRORS = 5;

/** Pause duration after max errors (ms) */
const ERROR_PAUSE_MS = 5 * 60 * 1000; // 5 minutes

/** Job type identifier */
const JOB_TYPE = 'cache_dump';

// ============================================
// STATE
// ============================================

let isRunning = false;
let isPaused = false;
let activeJobId: string | null = null;
let pollTimeout: NodeJS.Timeout | null = null;
let consecutiveErrors = 0;

// ============================================
// CORE DUMP LOGIC
// ============================================

/**
 * Process a single batch of orders from Shopify to cache
 */
async function processBatch(job: SyncJob): Promise<{ fetched: number; cached: number; done: boolean }> {
    const fetchOptions: Record<string, string | number> = {
        status: 'any',
        limit: BATCH_SIZE,
    };

    // Resume from last processed ID if available
    if (job.lastProcessedId) {
        fetchOptions.since_id = job.lastProcessedId;
    }

    // Apply date filter if specified
    if (job.daysBack) {
        const since = new Date();
        since.setDate(since.getDate() - job.daysBack);
        fetchOptions.created_at_min = since.toISOString();
    }

    // Fetch batch from Shopify
    const orders = await shopifyClient.getOrders(fetchOptions);

    if (orders.length === 0) {
        return { fetched: 0, cached: 0, done: true };
    }

    // Cache orders in batch
    const cached = await cacheShopifyOrders(prisma, orders, 'cache_dump');

    // Get last order ID for checkpoint
    const lastId = String(orders[orders.length - 1].id);

    // Update checkpoint
    await prisma.syncJob.update({
        where: { id: job.id },
        data: {
            processed: { increment: orders.length },
            created: { increment: cached },
            lastProcessedId: lastId,
            currentBatch: { increment: 1 },
        }
    });

    // Check if we're done (fetched less than batch size)
    const done = orders.length < BATCH_SIZE;

    return { fetched: orders.length, cached, done };
}

/**
 * Run the dump job until completion
 */
async function runJob(jobId: string): Promise<void> {
    activeJobId = jobId;

    try {
        // Mark as running
        await prisma.syncJob.update({
            where: { id: jobId },
            data: {
                status: 'running',
                startedAt: new Date(),
            }
        });

        // Get total count from Shopify for progress tracking
        let job = await prisma.syncJob.findUnique({ where: { id: jobId } });
        if (!job) return;

        if (!job.totalRecords) {
            try {
                const countOptions: Record<string, string> = { status: 'any' };
                if (job.daysBack) {
                    const since = new Date();
                    since.setDate(since.getDate() - job.daysBack);
                    countOptions.created_at_min = since.toISOString();
                }
                const totalCount = await shopifyClient.getOrderCount(countOptions);
                await prisma.syncJob.update({
                    where: { id: jobId },
                    data: { totalRecords: totalCount }
                });
                job = await prisma.syncJob.findUnique({ where: { id: jobId } });
            } catch (err) {
                syncLogger.warn({ error: (err as Error).message }, 'Failed to get order count');
            }
        }

        syncLogger.info({
            jobId,
            totalRecords: job?.totalRecords,
            resumeFrom: job?.lastProcessedId || 'start',
            daysBack: job?.daysBack || 'all time'
        }, 'Cache dump: starting/resuming');

        // Process batches until done
        while (isRunning && !isPaused) {
            // Check if job was cancelled
            const currentJob = await prisma.syncJob.findUnique({ where: { id: jobId } });
            if (!currentJob || currentJob.status === 'cancelled') {
                syncLogger.info({ jobId }, 'Cache dump: job cancelled');
                return;
            }

            try {
                const result = await processBatch(currentJob);
                consecutiveErrors = 0;

                // Log progress
                const progress = currentJob.totalRecords
                    ? Math.round((currentJob.processed + result.fetched) / currentJob.totalRecords * 100)
                    : null;

                syncLogger.info({
                    jobId,
                    batch: currentJob.currentBatch + 1,
                    fetched: result.fetched,
                    cached: result.cached,
                    totalProcessed: currentJob.processed + result.fetched,
                    progress: progress ? `${progress}%` : 'unknown',
                }, 'Cache dump: batch complete');

                if (result.done) {
                    // Mark as completed
                    await prisma.syncJob.update({
                        where: { id: jobId },
                        data: {
                            status: 'completed',
                            completedAt: new Date(),
                        }
                    });

                    syncLogger.info({
                        jobId,
                        totalProcessed: currentJob.processed + result.fetched,
                    }, 'Cache dump: completed');

                    activeJobId = null;
                    return;
                }

                // Delay before next batch
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));

            } catch (err) {
                consecutiveErrors++;
                const errorMsg = (err as Error).message;

                syncLogger.error({
                    jobId,
                    error: errorMsg,
                    consecutiveErrors,
                }, 'Cache dump: batch error');

                // Update job with error
                await prisma.syncJob.update({
                    where: { id: jobId },
                    data: {
                        lastError: errorMsg,
                        errors: { increment: 1 },
                    }
                });

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    syncLogger.warn({ jobId }, 'Cache dump: too many errors, pausing');
                    isPaused = true;

                    // Auto-resume after pause
                    setTimeout(() => {
                        if (isRunning) {
                            isPaused = false;
                            consecutiveErrors = 0;
                            syncLogger.info({ jobId }, 'Cache dump: resuming after error pause');
                            runJob(jobId);
                        }
                    }, ERROR_PAUSE_MS);

                    return;
                }

                // Backoff before retry
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS * 5));
            }
        }
    } catch (error) {
        syncLogger.error({
            jobId,
            error: (error as Error).message,
        }, 'Cache dump: job failed');

        await prisma.syncJob.update({
            where: { id: jobId },
            data: {
                status: 'failed',
                lastError: (error as Error).message,
                completedAt: new Date(),
            }
        });
    } finally {
        activeJobId = null;
    }
}

/**
 * Check for and resume incomplete jobs
 */
async function checkForIncompleteJobs(): Promise<void> {
    if (!isRunning || isPaused || activeJobId) return;

    try {
        // Find incomplete cache_dump jobs
        const incompleteJob = await prisma.syncJob.findFirst({
            where: {
                jobType: JOB_TYPE,
                status: { in: ['pending', 'running'] }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (incompleteJob) {
            syncLogger.info({
                jobId: incompleteJob.id,
                processed: incompleteJob.processed,
                totalRecords: incompleteJob.totalRecords,
            }, 'Cache dump: found incomplete job, resuming');

            await trackWorkerRun('cache_dump', () => runJob(incompleteJob.id), 'startup');
        }
    } catch (err) {
        syncLogger.error({ error: (err as Error).message }, 'Cache dump: error checking for incomplete jobs');
    }

    // Schedule next check
    if (isRunning && !activeJobId) {
        pollTimeout = setTimeout(checkForIncompleteJobs, POLL_INTERVAL_MS);
    }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Start the cache dump worker
 * Automatically resumes incomplete jobs
 */
function start(): void {
    if (isRunning) {
        syncLogger.debug('Cache dump worker already running');
        return;
    }

    isRunning = true;
    isPaused = false;
    consecutiveErrors = 0;

    syncLogger.info('Cache dump worker: starting');

    // Register shutdown handler
    shutdownCoordinator.register('cacheDumpWorker', async () => {
        syncLogger.info('Cache dump worker: shutting down gracefully');
        stop();
    });

    // Check for incomplete jobs immediately
    checkForIncompleteJobs();
}

/**
 * Stop the cache dump worker
 */
function stop(): void {
    if (!isRunning) return;

    isRunning = false;
    isPaused = false;

    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }

    syncLogger.info('Cache dump worker: stopped');
}

/**
 * Start a new cache dump job
 * @param options.daysBack - Only dump orders from last N days (null = all time)
 */
async function startJob(options: { daysBack?: number } = {}): Promise<SyncJob> {
    // Reload Shopify config
    await shopifyClient.loadFromDatabase();

    if (!shopifyClient.isConfigured()) {
        throw new Error('Shopify is not configured');
    }

    // Check for existing running job
    const existingJob = await prisma.syncJob.findFirst({
        where: {
            jobType: JOB_TYPE,
            status: { in: ['pending', 'running'] }
        }
    });

    if (existingJob) {
        throw new Error(`A cache dump job is already running (ID: ${existingJob.id})`);
    }

    // Build date filter label
    let dateFilter = 'All time';
    if (options.daysBack) {
        dateFilter = `Last ${options.daysBack} days`;
    }

    // Create new job
    const job = await prisma.syncJob.create({
        data: {
            jobType: JOB_TYPE,
            status: 'pending',
            daysBack: options.daysBack || null,
            dateFilter,
        }
    });

    syncLogger.info({
        jobId: job.id,
        daysBack: options.daysBack || 'all time',
    }, 'Cache dump: new job created');

    // Start processing if worker is running
    if (isRunning && !activeJobId) {
        trackWorkerRun('cache_dump', () => runJob(job.id), 'manual').catch(() => {});
    }

    return job;
}

/**
 * Cancel a running job
 */
async function cancelJob(jobId: string): Promise<SyncJob> {
    const job = await prisma.syncJob.findUnique({ where: { id: jobId } });

    if (!job) {
        throw new Error('Job not found');
    }

    if (job.jobType !== JOB_TYPE) {
        throw new Error('Not a cache dump job');
    }

    if (job.status !== 'running' && job.status !== 'pending') {
        throw new Error('Job is not running');
    }

    await prisma.syncJob.update({
        where: { id: jobId },
        data: { status: 'cancelled' }
    });

    if (activeJobId === jobId) {
        activeJobId = null;
    }

    return (await prisma.syncJob.findUnique({ where: { id: jobId } }))!;
}

/**
 * Get status of the cache dump worker
 */
async function getStatus(): Promise<{
    workerRunning: boolean;
    workerPaused: boolean;
    activeJobId: string | null;
    activeJob: SyncJob | null;
    recentJobs: SyncJob[];
    cacheStats: {
        totalCached: number;
        processed: number;
        pending: number;
        failed: number;
    };
    shopifyStats: {
        totalOrders: number | null;
        syncPercentage: number | null;
    };
}> {
    // Get active job details
    const activeJob = activeJobId
        ? await prisma.syncJob.findUnique({ where: { id: activeJobId } })
        : null;

    // Get recent jobs
    const recentJobs = await prisma.syncJob.findMany({
        where: { jobType: JOB_TYPE },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });

    // Get cache stats
    const [totalCached, processed, pending, failed] = await Promise.all([
        prisma.shopifyOrderCache.count(),
        prisma.shopifyOrderCache.count({ where: { processedAt: { not: null } } }),
        prisma.shopifyOrderCache.count({ where: { processedAt: null, processingError: null } }),
        prisma.shopifyOrderCache.count({ where: { processingError: { not: null } } }),
    ]);

    // Get Shopify order count for comparison
    let totalOrders: number | null = null;
    let syncPercentage: number | null = null;

    try {
        await shopifyClient.loadFromDatabase();
        if (shopifyClient.isConfigured()) {
            totalOrders = await shopifyClient.getOrderCount({ status: 'any' });
            syncPercentage = totalOrders > 0
                ? Math.round((totalCached / totalOrders) * 100)
                : 100;
        }
    } catch (err) {
        syncLogger.debug({ error: (err as Error).message }, 'Failed to get Shopify order count');
    }

    return {
        workerRunning: isRunning,
        workerPaused: isPaused,
        activeJobId,
        activeJob,
        recentJobs,
        cacheStats: {
            totalCached,
            processed,
            pending,
            failed,
        },
        shopifyStats: {
            totalOrders,
            syncPercentage,
        },
    };
}

/**
 * Resume a failed job
 */
async function resumeJob(jobId: string): Promise<SyncJob> {
    const job = await prisma.syncJob.findUnique({ where: { id: jobId } });

    if (!job) {
        throw new Error('Job not found');
    }

    if (job.jobType !== JOB_TYPE) {
        throw new Error('Not a cache dump job');
    }

    if (job.status === 'running') {
        throw new Error('Job is already running');
    }

    if (job.status === 'completed') {
        throw new Error('Job is already completed');
    }

    // Reset status to pending
    await prisma.syncJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            lastError: null,
        }
    });

    // Start processing if worker is running
    if (isRunning && !activeJobId) {
        trackWorkerRun('cache_dump', () => runJob(jobId), 'manual').catch(() => {});
    }

    return (await prisma.syncJob.findUnique({ where: { id: jobId } }))!;
}

// ============================================
// EXPORTS
// ============================================

export const cacheDumpWorker = {
    start,
    stop,
    startJob,
    cancelJob,
    resumeJob,
    getStatus,
};

export default cacheDumpWorker;
