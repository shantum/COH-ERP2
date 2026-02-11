/**
 * Return Prime Server Functions
 *
 * TanStack Start Server Functions for Return Prime dashboard data.
 * Reads from local database (ReturnPrimeRequest table) for fast dashboard loading.
 *
 * IMPORTANT: Uses method: 'POST' to avoid HTTP 431 header size errors.
 *
 * Data is synced from Return Prime API via the inbound sync service.
 * See: server/src/services/returnPrimeInboundSync.ts
 */

import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import type {
    ReturnPrimeRequest,
    ReturnPrimeStats,
    ReturnPrimeDashboardData,
} from '@coh/shared/schemas/returnPrime';
import {
    ReturnPrimeApiLineItemSchema,
    CustomerAddressSchema,
    CustomerBankSchema,
} from '@coh/shared/schemas/returnPrime';

// ============================================
// INPUT SCHEMAS
// ============================================

const ReturnPrimeFiltersSchema = z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    requestType: z.enum(['return', 'exchange', 'all']).optional(),
    search: z.string().optional(),
});

const ReturnPrimeRequestIdSchema = z.object({
    requestId: z.string(),
});

// ============================================
// TYPES
// ============================================

/** Prisma-derived type for ReturnPrimeRequest rows */
type LocalRequest = Prisma.ReturnPrimeRequestGetPayload<{}>;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Transform local database record to API response format for UI compatibility
 */
function transformLocalToApiFormat(local: LocalRequest): ReturnPrimeRequest {
    // Validate lineItems JSON through Zod instead of blind cast
    const parsedLineItems = z.array(ReturnPrimeApiLineItemSchema).safeParse(local.lineItems);
    const lineItems = parsedLineItems.success ? parsedLineItems.data : [];

    // Validate requestType at runtime
    const requestType = local.requestType === 'return' || local.requestType === 'exchange'
        ? local.requestType
        : 'return';

    // Parse customerAddress and customerBank through Zod schemas
    const parsedAddress = CustomerAddressSchema.safeParse(local.customerAddress);
    const parsedBank = CustomerBankSchema.safeParse(local.customerBank);

    return {
        id: local.rpRequestId,
        request_number: local.rpRequestNumber,
        request_type: requestType,
        status: local.isRejected
            ? 'rejected'
            : local.isRefunded
              ? 'refunded'
              : local.isInspected
                ? 'inspected'
                : local.isReceived
                  ? 'received'
                  : local.isApproved
                    ? 'approved'
                    : 'pending',
        created_at: local.rpCreatedAt.toISOString(),
        order: {
            id: local.shopifyOrderId ? Number(local.shopifyOrderId) : 0,
            name: local.shopifyOrderName || '',
        },
        customer: {
            name: local.customerName || undefined,
            email: local.customerEmail || undefined,
            phone: local.customerPhone || undefined,
            address: parsedAddress.success ? parsedAddress.data : undefined,
            bank: parsedBank.success ? parsedBank.data : undefined,
        },
        approved: {
            status: local.isApproved,
            created_at: local.approvedAt?.toISOString() || null,
            comment: local.approvedComment,
        },
        received: {
            status: local.isReceived,
            created_at: local.receivedAt?.toISOString() || null,
            comment: local.receivedComment,
        },
        inspected: {
            status: local.isInspected,
            created_at: local.inspectedAt?.toISOString() || null,
            comment: local.inspectedComment,
        },
        rejected: {
            status: local.isRejected,
            created_at: local.rejectedAt?.toISOString() || null,
            comment: local.rejectedComment,
        },
        archived: {
            status: local.isArchived,
            created_at: local.archivedAt?.toISOString() || null,
            comment: null,
        },
        line_items: lineItems,
    };
}

/**
 * Compute stats from transformed requests
 */
function computeStats(requests: ReturnPrimeRequest[]): ReturnPrimeStats {
    return {
        total: requests.length,
        returns: requests.filter((r) => r.request_type === 'return').length,
        exchanges: requests.filter((r) => r.request_type === 'exchange').length,
        pending: requests.filter((r) => !r.approved?.status && !r.rejected?.status).length,
        approved: requests.filter((r) => r.approved?.status).length,
        received: requests.filter((r) => r.received?.status).length,
        refunded: requests.filter((r) => r.line_items?.some((li) => li.refund?.status === 'refunded')).length,
        totalValue: requests.reduce((sum, r) => {
            return (
                sum +
                (r.line_items?.reduce((lineSum, li) => {
                    return lineSum + (li.shop_price?.actual_amount || 0);
                }, 0) || 0)
            );
        }, 0),
    };
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Fetch Return Prime dashboard data from local database
 */
export const getReturnPrimeDashboard = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => ReturnPrimeFiltersSchema.parse(input))
    .handler(async ({ data: filters }): Promise<ReturnPrimeDashboardData> => {
        const prisma = await getPrisma();

        try {
            // Build where clause
            const where: Prisma.ReturnPrimeRequestWhereInput = {};

            if (filters.dateFrom) {
                where.rpCreatedAt = { gte: new Date(filters.dateFrom) };
            }
            if (filters.dateTo) {
                where.rpCreatedAt = {
                    ...(typeof where.rpCreatedAt === 'object' && where.rpCreatedAt !== null ? where.rpCreatedAt : {}),
                    lte: new Date(filters.dateTo + 'T23:59:59'),
                };
            }
            if (filters.requestType && filters.requestType !== 'all') {
                where.requestType = filters.requestType;
            }
            if (filters.search) {
                const search = filters.search.trim();
                if (search.includes('@')) {
                    where.customerEmail = { contains: search, mode: 'insensitive' };
                } else if (search.toUpperCase().startsWith('RET') || search.toUpperCase().startsWith('EXC')) {
                    where.rpRequestNumber = { contains: search.toUpperCase(), mode: 'insensitive' };
                } else if (/^\d+$/.test(search)) {
                    where.shopifyOrderName = { contains: search };
                } else {
                    // Search in multiple fields
                    where.OR = [
                        { rpRequestNumber: { contains: search, mode: 'insensitive' } },
                        { shopifyOrderName: { contains: search } },
                        { customerName: { contains: search, mode: 'insensitive' } },
                        { customerEmail: { contains: search, mode: 'insensitive' } },
                    ];
                }
            }

            // Fetch from local DB
            const localRequests = await prisma.returnPrimeRequest.findMany({
                where,
                orderBy: { rpCreatedAt: 'desc' },
                take: 500,
            });

            // Transform to API response format for UI compatibility
            const requests = localRequests.map(transformLocalToApiFormat);
            const stats = computeStats(requests);

            return {
                requests,
                stats,
                hasNextPage: false,
                hasPreviousPage: false,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[Server Function] Error in getReturnPrimeDashboard:', message);
            throw error;
        }
    });

/**
 * Fetch a single Return Prime request by ID from local database
 */
export const getReturnPrimeRequest = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => ReturnPrimeRequestIdSchema.parse(input))
    .handler(async ({ data }): Promise<ReturnPrimeRequest | null> => {
        const prisma = await getPrisma();

        try {
            const local = await prisma.returnPrimeRequest.findUnique({
                where: { rpRequestId: data.requestId },
            });

            if (!local) {
                return null;
            }

            return transformLocalToApiFormat(local);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[Server Function] Error in getReturnPrimeRequest:', message);
            throw error;
        }
    });

/**
 * Get analytics data computed from local database
 */
export const getReturnPrimeAnalytics = createServerFn({ method: 'POST' })
    .inputValidator((input: unknown) => ReturnPrimeFiltersSchema.parse(input))
    .handler(async ({ data: filters }) => {
        try {
            // Reuse dashboard fetch
            const dashboardData = await getReturnPrimeDashboard({ data: filters });
            const { requests } = dashboardData;

            // Compute analytics
            const reasonBreakdown: Record<string, number> = {};
            const refundModeBreakdown: Record<string, number> = {};
            const productReturns: Record<string, { name: string; sku: string; count: number; value: number }> = {};
            const dailyTrend: Record<string, { returns: number; exchanges: number }> = {};

            for (const req of requests) {
                // Daily trend
                const date = req.created_at.split('T')[0];
                if (!dailyTrend[date]) {
                    dailyTrend[date] = { returns: 0, exchanges: 0 };
                }
                if (req.request_type === 'return') {
                    dailyTrend[date].returns++;
                } else {
                    dailyTrend[date].exchanges++;
                }

                // Line item analysis
                for (const li of req.line_items || []) {
                    // Reason breakdown
                    const reason = li.reason || 'Unknown';
                    reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + 1;

                    // Refund mode breakdown
                    const refundMode = li.refund?.requested_mode || 'Unknown';
                    refundModeBreakdown[refundMode] = (refundModeBreakdown[refundMode] || 0) + 1;

                    // Product returns
                    const sku = li.original_product?.sku || 'Unknown';
                    const productName = li.original_product?.title || 'Unknown Product';
                    const value = li.shop_price?.actual_amount || 0;

                    if (!productReturns[sku]) {
                        productReturns[sku] = { name: productName, sku, count: 0, value: 0 };
                    }
                    productReturns[sku].count += li.quantity;
                    productReturns[sku].value += value;
                }
            }

            // Sort and format
            const topProducts = Object.values(productReturns)
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            const dailyTrendArray = Object.entries(dailyTrend)
                .map(([date, data]) => ({ date, ...data }))
                .sort((a, b) => a.date.localeCompare(b.date));

            return {
                stats: dashboardData.stats,
                reasonBreakdown,
                refundModeBreakdown,
                topProducts,
                dailyTrend: dailyTrendArray,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[Server Function] Error in getReturnPrimeAnalytics:', message);
            throw error;
        }
    });

/**
 * Get sync status from local database
 */
export const getReturnPrimeSyncStatus = createServerFn({ method: 'POST' }).handler(async () => {
    const prisma = await getPrisma();

    try {
        const [count, lastSynced, oldest, newest] = await Promise.all([
            prisma.returnPrimeRequest.count(),
            prisma.returnPrimeRequest.findFirst({
                orderBy: { syncedAt: 'desc' },
                select: { syncedAt: true },
            }),
            prisma.returnPrimeRequest.findFirst({
                orderBy: { rpCreatedAt: 'asc' },
                select: { rpCreatedAt: true },
            }),
            prisma.returnPrimeRequest.findFirst({
                orderBy: { rpCreatedAt: 'desc' },
                select: { rpCreatedAt: true },
            }),
        ]);

        return {
            totalRecords: count,
            lastSyncedAt: lastSynced?.syncedAt?.toISOString() || null,
            oldestRecord: oldest?.rpCreatedAt?.toISOString() || null,
            newestRecord: newest?.rpCreatedAt?.toISOString() || null,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Server Function] Error in getReturnPrimeSyncStatus:', message);
        throw error;
    }
});

/**
 * Trigger a manual Return Prime inbound sync via the Express admin route.
 */
export const triggerReturnPrimeSync = createServerFn({ method: 'POST' }).handler(
    async (): Promise<{ success: boolean; message: string }> => {
        const port = process.env.PORT || '3001';
        const apiUrl =
            process.env.NODE_ENV === 'production'
                ? `http://127.0.0.1:${port}`
                : 'http://localhost:3001';

        const authToken = getCookie('auth_token');

        try {
            const response = await fetch(`${apiUrl}/api/returnprime/admin/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Cookie: `auth_token=${authToken}` } : {}),
                },
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                const text = await response.text();
                return { success: false, message: `Sync failed: ${text}` };
            }

            const data = await response.json();
            return {
                success: true,
                message: `Synced ${data.result?.created ?? 0} new, ${data.result?.updated ?? 0} updated`,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, message };
        }
    }
);
