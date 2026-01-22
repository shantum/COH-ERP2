/**
 * Shopify Server Functions
 *
 * TanStack Start Server Functions for Shopify integration management.
 * Provides configuration, sync jobs, and cache status endpoints.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

const updateShopifyConfigSchema = z.object({
    shopDomain: z.string().min(1, 'Shop domain is required'),
    accessToken: z.string().min(1, 'Access token is required'),
});

const startSyncJobSchema = z.object({
    jobType: z.enum(['orders', 'customers', 'products']),
    syncMode: z.enum(['deep', 'incremental', 'quick', 'update']).optional(),
    days: z.number().int().positive().optional(),
    staleAfterMins: z.number().int().positive().optional(),
});

const getSyncJobsSchema = z.object({
    limit: z.number().int().positive().optional().default(20),
});

const getSyncJobStatusSchema = z.object({
    jobId: z.string().uuid('Invalid job ID'),
});

const cancelSyncJobSchema = z.object({
    jobId: z.string().uuid('Invalid job ID'),
});

const getSyncHistorySchema = z.object({
    limit: z.number().int().positive().optional(),
});

const triggerSyncSchema = z.object({
    daysBack: z.number().int().positive().optional(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'EXTERNAL_ERROR';
        message: string;
    };
}

export interface ShopifyConfigResult {
    shopDomain: string;
    apiVersion: string;
    hasAccessToken: boolean;
    fromEnvVars: boolean;
    info?: string;
}

export interface UpdateConfigResult {
    shopDomain: string;
    updated: boolean;
}

export interface TestConnectionResult {
    success: boolean;
    message: string;
    stats?: {
        totalOrders: number;
        totalCustomers: number;
    };
    statusCode?: number;
}

export interface SyncHistoryResult {
    lastSync: string | null;
    lastOrderNumber: string | null;
    counts: {
        syncedOrders: number;
        syncedCustomers: number;
    };
}

export interface SyncJobResult {
    id: string;
    jobType: string;
    status: string;
    progress?: number;
    startedAt?: string;
    completedAt?: string;
    errorMessage?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stats?: Record<string, any>;
}

export interface CacheStatusResult {
    totalCached: number;
    processed: number;
    failed: number;
    pending: number;
    recentFailures: Array<{
        id: string;
        orderNumber: string | null;
        processingError: string | null;
        lastWebhookAt: Date | null;
    }>;
}

export interface TriggerSyncResult {
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result?: Record<string, any>;
}

// ============================================
// PRISMA HELPER
// ============================================

async function getPrisma() {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as {
        prisma: InstanceType<typeof PrismaClient> | undefined;
    };
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// ============================================
// SHOPIFY CLIENT HELPER
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShopifyClientType = any;

async function getShopifyClient(): Promise<ShopifyClientType> {
    const { default: shopifyClient } = await import('@server/services/shopify.js');
    return shopifyClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSyncWorker(): Promise<any> {
    const { default: syncWorker } = await import('@server/services/syncWorker.js');
    return syncWorker;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getScheduledSync(): Promise<any> {
    const { default: scheduledSync } = await import('@server/services/scheduledSync.js');
    return scheduledSync;
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get Shopify configuration
 */
export const getShopifyConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<ShopifyConfigResult>> => {
        try {
            const shopifyClient = await getShopifyClient();
            await shopifyClient.loadFromDatabase();

            const config = shopifyClient.getConfig();
            const hasAccessToken = !!(shopifyClient as unknown as { accessToken: string | undefined }).accessToken;
            const fromEnvVars = !!(process.env.SHOPIFY_ACCESS_TOKEN && process.env.SHOPIFY_SHOP_DOMAIN);

            return {
                success: true,
                data: {
                    shopDomain: config.shopDomain || '',
                    apiVersion: config.apiVersion,
                    hasAccessToken,
                    fromEnvVars,
                    ...(fromEnvVars && {
                        info: 'Credentials loaded from environment variables. Changes made here will not persist after server restart.',
                    }),
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Update Shopify configuration
 */
export const updateShopifyConfig = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateShopifyConfigSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UpdateConfigResult>> => {
        const { shopDomain, accessToken } = data;

        try {
            const shopifyClient = await getShopifyClient();
            const cleanDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
            await shopifyClient.updateConfig(cleanDomain, accessToken);

            return {
                success: true,
                data: {
                    shopDomain: cleanDomain,
                    updated: true,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Test Shopify connection
 */
export const testShopifyConnection = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<TestConnectionResult>> => {
        try {
            const shopifyClient = await getShopifyClient();
            await shopifyClient.loadFromDatabase();

            if (!shopifyClient.isConfigured()) {
                return {
                    success: true,
                    data: {
                        success: false,
                        message: 'Shopify credentials not configured',
                    },
                };
            }

            try {
                const orderCount = await shopifyClient.getOrderCount();
                const customerCount = await shopifyClient.getCustomerCount();

                return {
                    success: true,
                    data: {
                        success: true,
                        message: 'Connection successful',
                        stats: { totalOrders: orderCount, totalCustomers: customerCount },
                    },
                };
            } catch (error: unknown) {
                // Type guard for axios-like errors
                const axiosError = error as {
                    message?: string;
                    response?: { status?: number; data?: { errors?: string | unknown } };
                };

                let errorMessage = axiosError.message ?? 'Unknown error';
                const status = axiosError.response?.status;

                if (status === 401) {
                    errorMessage = 'Invalid access token. Please check your Admin API access token.';
                } else if (status === 403) {
                    errorMessage = 'Access forbidden. Your access token may be missing required API scopes.';
                } else if (status === 404) {
                    errorMessage = 'Shop not found. Please check the shop domain format (e.g., yourstore.myshopify.com)';
                } else if (axiosError.response?.data?.errors) {
                    errorMessage = typeof axiosError.response.data.errors === 'string'
                        ? axiosError.response.data.errors
                        : JSON.stringify(axiosError.response.data.errors);
                }

                return {
                    success: true,
                    data: {
                        success: false,
                        message: errorMessage,
                        statusCode: status,
                    },
                };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Get Shopify sync history
 */
export const getShopifySyncHistory = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => {
        if (input === undefined || input === null) return {};
        return getSyncHistorySchema.parse(input);
    })
    .handler(async (): Promise<MutationResult<SyncHistoryResult>> => {
        try {
            const prisma = await getPrisma();

            const lastSyncedOrder = await prisma.order.findFirst({
                where: { shopifyOrderId: { not: null } },
                orderBy: { syncedAt: 'desc' },
                select: { shopifyOrderId: true, orderNumber: true, syncedAt: true },
            });

            const syncedOrders = await prisma.order.count({ where: { shopifyOrderId: { not: null } } });
            const syncedCustomers = await prisma.customer.count({ where: { shopifyCustomerId: { not: null } } });

            return {
                success: true,
                data: {
                    lastSync: lastSyncedOrder?.syncedAt?.toISOString() || null,
                    lastOrderNumber: lastSyncedOrder?.orderNumber || null,
                    counts: { syncedOrders, syncedCustomers },
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Get sync jobs list
 */
export const getSyncJobs = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => {
        if (input === undefined || input === null) return { limit: 20 };
        return getSyncJobsSchema.parse(input);
    })
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult[]>> => {
        try {
            const syncWorker = await getSyncWorker();
            const jobs = await syncWorker.listJobs(data.limit);

            return {
                success: true,
                data: jobs.map((job: {
                    id: string;
                    jobType: string;
                    status: string;
                    progress?: number;
                    startedAt?: Date;
                    completedAt?: Date;
                    errorMessage?: string;
                    stats?: Record<string, unknown>;
                }) => ({
                    id: job.id,
                    jobType: job.jobType,
                    status: job.status,
                    progress: job.progress,
                    startedAt: job.startedAt?.toISOString(),
                    completedAt: job.completedAt?.toISOString(),
                    errorMessage: job.errorMessage,
                    stats: job.stats,
                })),
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Get sync job status
 */
export const getSyncJobStatus = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getSyncJobStatusSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult>> => {
        try {
            const syncWorker = await getSyncWorker();
            const job = await syncWorker.getJobStatus(data.jobId);

            if (!job) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Job not found' },
                };
            }

            return {
                success: true,
                data: {
                    id: job.id,
                    jobType: job.jobType,
                    status: job.status,
                    progress: job.progress,
                    startedAt: job.startedAt?.toISOString(),
                    completedAt: job.completedAt?.toISOString(),
                    errorMessage: job.errorMessage,
                    stats: job.stats,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Start sync job
 */
export const startSyncJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startSyncJobSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult>> => {
        const { jobType, syncMode, days, staleAfterMins } = data;

        try {
            const syncWorker = await getSyncWorker();
            const job = await syncWorker.startJob(jobType, {
                days: days || undefined,
                syncMode: syncMode || undefined,
                staleAfterMins,
            });

            const effectiveMode = syncMode === 'deep' ? 'deep' : 'incremental';

            return {
                success: true,
                data: {
                    id: job.id,
                    jobType: job.jobType,
                    status: job.status,
                    progress: job.progress,
                    startedAt: job.startedAt?.toISOString(),
                    completedAt: job.completedAt?.toISOString(),
                    errorMessage: job.errorMessage,
                    stats: { effectiveMode },
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Cancel sync job
 */
export const cancelSyncJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelSyncJobSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult>> => {
        try {
            const syncWorker = await getSyncWorker();
            const job = await syncWorker.cancelJob(data.jobId);

            return {
                success: true,
                data: {
                    id: job.id,
                    jobType: job.jobType,
                    status: job.status,
                    progress: job.progress,
                    startedAt: job.startedAt?.toISOString(),
                    completedAt: job.completedAt?.toISOString(),
                    errorMessage: job.errorMessage,
                    stats: job.stats,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message },
            };
        }
    });

/**
 * Get cache status
 */
export const getCacheStatus = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<CacheStatusResult>> => {
        try {
            const prisma = await getPrisma();

            const totalCached = await prisma.shopifyOrderCache.count();
            const processed = await prisma.shopifyOrderCache.count({ where: { processedAt: { not: null } } });
            const failed = await prisma.shopifyOrderCache.count({ where: { processingError: { not: null } } });
            const pending = await prisma.shopifyOrderCache.count({ where: { processedAt: null, processingError: null } });

            const recentFailures = await prisma.shopifyOrderCache.findMany({
                where: { processingError: { not: null } },
                select: { id: true, orderNumber: true, processingError: true, lastWebhookAt: true },
                orderBy: { lastWebhookAt: 'desc' },
                take: 5,
            });

            return {
                success: true,
                data: {
                    totalCached,
                    processed,
                    failed,
                    pending,
                    recentFailures,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Trigger manual sync (via scheduler)
 */
export const triggerSync = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => {
        if (input === undefined || input === null) return {};
        return triggerSyncSchema.parse(input);
    })
    .handler(async (): Promise<MutationResult<TriggerSyncResult>> => {
        try {
            const scheduledSync = await getScheduledSync();
            const result = await scheduledSync.triggerSync();

            return {
                success: true,
                data: {
                    message: 'Sync triggered',
                    result,
                },
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });
