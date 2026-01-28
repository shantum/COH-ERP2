/**
 * Shopify Server Functions
 *
 * TanStack Start Server Functions for Shopify integration management.
 * Provides configuration, sync jobs, and cache status endpoints.
 *
 * IMPORTANT: Uses Express API calls for Shopify service interactions.
 * This avoids bundling server-only code into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

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
// EXPRESS API HELPER
// ============================================

/**
 * Helper to call Express API endpoints from Server Functions.
 * Handles auth token forwarding and environment-aware URL construction.
 *
 * See CLAUDE.md gotcha #27 for production URL handling.
 */
async function callExpressApi<T>(
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const port = process.env.PORT || '3001';
    const apiUrl =
        process.env.NODE_ENV === 'production'
            ? `http://127.0.0.1:${port}` // Same server on Railway
            : 'http://localhost:3001'; // Separate dev server

    const authToken = getCookie('auth_token');

    console.log(`[callExpressApi] Calling ${apiUrl}${path}`);
    console.log(`[callExpressApi] Auth token present: ${!!authToken}`);

    try {
        const response = await fetch(`${apiUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Cookie: `auth_token=${authToken}` } : {}),
                ...options.headers,
            },
        });

        console.log(`[callExpressApi] Response status: ${response.status}`);

        if (!response.ok) {
            const errorBody = await response.text();
            console.log(`[callExpressApi] Error body: ${errorBody}`);
            let errorMessage: string;
            try {
                const errorJson = JSON.parse(errorBody) as { error?: string; message?: string };
                errorMessage = errorJson.error || errorJson.message || `API call failed: ${response.status}`;
            } catch {
                errorMessage = `API call failed: ${response.status} - ${errorBody}`;
            }
            throw new Error(errorMessage);
        }

        return response.json() as Promise<T>;
    } catch (error) {
        console.log(`[callExpressApi] Fetch error: ${error instanceof Error ? error.message : error}`);
        throw error;
    }
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get Shopify configuration
 * Calls: GET /api/shopify/config
 */
export const getShopifyConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<ShopifyConfigResult>> => {
        try {
            const config = await callExpressApi<ShopifyConfigResult>('/api/shopify/config');
            return {
                success: true,
                data: config,
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
 * Calls: PUT /api/shopify/config
 */
export const updateShopifyConfig = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateShopifyConfigSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UpdateConfigResult>> => {
        const { shopDomain, accessToken } = data;

        try {
            const response = await callExpressApi<{ message: string; shopDomain: string }>(
                '/api/shopify/config',
                {
                    method: 'PUT',
                    body: JSON.stringify({ shopDomain, accessToken }),
                }
            );

            return {
                success: true,
                data: {
                    shopDomain: response.shopDomain,
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
 * Calls: POST /api/shopify/test-connection
 */
export const testShopifyConnection = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .handler(async (): Promise<MutationResult<TestConnectionResult>> => {
        try {
            const result = await callExpressApi<TestConnectionResult>(
                '/api/shopify/test-connection',
                { method: 'POST' }
            );
            return {
                success: true,
                data: result,
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
 * Calls: GET /api/shopify/sync/jobs
 */
export const getSyncJobs = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => {
        if (input === undefined || input === null) return { limit: 20 };
        return getSyncJobsSchema.parse(input);
    })
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult[]>> => {
        try {
            const jobs = await callExpressApi<SyncJobResult[]>(
                `/api/shopify/sync/jobs?limit=${data.limit}`
            );
            return {
                success: true,
                data: jobs,
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
 * Calls: GET /api/shopify/sync/jobs/:id
 */
export const getSyncJobStatus = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getSyncJobStatusSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult>> => {
        try {
            const job = await callExpressApi<SyncJobResult>(
                `/api/shopify/sync/jobs/${data.jobId}`
            );
            return {
                success: true,
                data: job,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            // Check for NOT_FOUND in the error message
            if (message.includes('not found') || message.includes('404')) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Job not found' },
                };
            }
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });

/**
 * Start sync job
 * Calls: POST /api/shopify/sync/jobs/start
 */
export const startSyncJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startSyncJobSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult>> => {
        const { jobType, syncMode, days, staleAfterMins } = data;

        try {
            const response = await callExpressApi<{ message: string; job: SyncJobResult }>(
                '/api/shopify/sync/jobs/start',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        jobType,
                        ...(syncMode ? { syncMode } : {}),
                        ...(days ? { days } : {}),
                        ...(staleAfterMins ? { staleAfterMins } : {}),
                    }),
                }
            );

            return {
                success: true,
                data: response.job,
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
 * Calls: POST /api/shopify/sync/jobs/:id/cancel
 */
export const cancelSyncJob = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => cancelSyncJobSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<SyncJobResult>> => {
        try {
            const response = await callExpressApi<{ message: string; job: SyncJobResult }>(
                `/api/shopify/sync/jobs/${data.jobId}/cancel`,
                { method: 'POST' }
            );

            return {
                success: true,
                data: response.job,
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
 * Calls: POST /api/shopify/sync/jobs/scheduler/trigger
 */
export const triggerSync = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => {
        if (input === undefined || input === null) return {};
        return triggerSyncSchema.parse(input);
    })
    .handler(async (): Promise<MutationResult<TriggerSyncResult>> => {
        try {
            const response = await callExpressApi<{ message: string; result: Record<string, unknown> }>(
                '/api/shopify/sync/jobs/scheduler/trigger',
                { method: 'POST' }
            );

            return {
                success: true,
                data: {
                    message: response.message,
                    result: response.result,
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

// ============================================
// PRODUCT STATUS TYPES
// ============================================

export type ShopifyProductStatus = 'active' | 'archived' | 'draft' | 'not_linked' | 'not_cached' | 'unknown';

export interface ProductShopifyStatus {
    productId: string;
    shopifyProductId: string | null;
    status: ShopifyProductStatus;
}

const getProductShopifyStatusesSchema = z.object({
    productIds: z.array(z.string()),
});

/**
 * Get Shopify product statuses for given product IDs
 * Fetches from ShopifyProductCache and returns status for each product
 */
export const getProductShopifyStatuses = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getProductShopifyStatusesSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<ProductShopifyStatus[]>> => {
        try {
            const prisma = await getPrisma();
            const { productIds } = data;

            if (productIds.length === 0) {
                return { success: true, data: [] };
            }

            // Fetch products with their Shopify IDs
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } },
                select: { id: true, shopifyProductId: true },
            });

            // Get Shopify product IDs that exist
            const shopifyProductIds = products
                .map((p: { id: string; shopifyProductId: string | null }) => p.shopifyProductId)
                .filter((id: string | null): id is string => Boolean(id));

            // Fetch status from ShopifyProductCache
            const shopifyStatusMap = new Map<string, ShopifyProductStatus>();
            if (shopifyProductIds.length > 0) {
                const shopifyCache = await prisma.shopifyProductCache.findMany({
                    where: { id: { in: shopifyProductIds } },
                    select: { id: true, rawData: true },
                });
                shopifyCache.forEach((cache: { id: string; rawData: string }) => {
                    try {
                        const cacheData = JSON.parse(cache.rawData as string) as { status?: string };
                        const status = cacheData.status || 'unknown';
                        shopifyStatusMap.set(cache.id, status as ShopifyProductStatus);
                    } catch {
                        shopifyStatusMap.set(cache.id, 'unknown');
                    }
                });
            }

            // Map products to their statuses
            const result: ProductShopifyStatus[] = products.map((product: { id: string; shopifyProductId: string | null }) => {
                if (!product.shopifyProductId) {
                    return {
                        productId: product.id,
                        shopifyProductId: null,
                        status: 'not_linked' as ShopifyProductStatus,
                    };
                }

                const cachedStatus = shopifyStatusMap.get(product.shopifyProductId);
                return {
                    productId: product.id,
                    shopifyProductId: product.shopifyProductId,
                    status: cachedStatus || 'not_cached',
                };
            });

            return { success: true, data: result };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'EXTERNAL_ERROR', message },
            };
        }
    });
