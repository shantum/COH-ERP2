/**
 * Return Prime Inbound Sync Service
 *
 * Fetches Return Prime requests from their API and stores them locally in the database.
 * Supports full sync (12 months) and incremental sync (recent changes).
 *
 * Benefits of local storage:
 * - Faster dashboard loading (no API calls on every page view)
 * - Historical analytics (analyze trends without API rate limits)
 * - Offline resilience (data available even if RP API is down)
 * - Efficient pagination (local queries vs API pagination)
 */

import { getPrisma } from '@coh/shared/services/db';
import { Prisma } from '@prisma/client';
import { ReturnPrimeListResponseSchema, type ReturnPrimeRequest } from '@coh/shared';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'returnprime-inbound-sync' });

const API_BASE = 'https://admin.returnprime.com/return-exchange/v2';
const MAX_PAGES = 500; // Safety limit to prevent infinite loops

// ============================================
// TYPES
// ============================================

interface SyncOptions {
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;
    fullSync?: boolean; // If true, fetches 12 months of history
}

interface SyncResult {
    success: boolean;
    partialSuccess: boolean;
    totalFetched: number;
    created: number;
    updated: number;
    errors: string[];
    durationMs: number;
}

interface SyncStatus {
    totalRecords: number;
    lastSyncedAt: Date | null;
    oldestRecord: Date | null;
    newestRecord: Date | null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Type for creating a ReturnPrimeRequest record
type ReturnPrimeRequestCreateData = {
    rpRequestId: string;
    rpRequestNumber: string;
    requestType: string;
    shopifyOrderId: string | null;
    shopifyOrderName: string | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    customerAddress: Prisma.InputJsonValue | typeof Prisma.DbNull;
    customerBank: Prisma.InputJsonValue | typeof Prisma.DbNull;
    isApproved: boolean;
    approvedAt: Date | null;
    approvedComment: string | null;
    isReceived: boolean;
    receivedAt: Date | null;
    receivedComment: string | null;
    isInspected: boolean;
    inspectedAt: Date | null;
    inspectedComment: string | null;
    isRefunded: boolean;
    refundedAt: Date | null;
    isRejected: boolean;
    rejectedAt: Date | null;
    rejectedComment: string | null;
    isArchived: boolean;
    archivedAt: Date | null;
    lineItems: Prisma.InputJsonValue;
    lineItemCount: number;
    totalValue: number;
    primaryReason: string | null;
    rpCreatedAt: Date;
    rpUpdatedAt: Date | null;
    syncedAt: Date;
    rawData: Prisma.InputJsonValue | typeof Prisma.DbNull;
};

/**
 * Transform Zod-validated API response to database record format.
 */
function transformRequest(apiRequest: ReturnPrimeRequest): ReturnPrimeRequestCreateData {
    const lineItems = apiRequest.line_items || [];

    // Calculate total value
    let totalValue = 0;
    lineItems.forEach((li) => {
        totalValue += li.shop_price?.actual_amount || 0;
    });

    // Get primary reason
    const primaryReason = lineItems[0]?.reason || null;

    // Check if any line is refunded
    const isRefunded = lineItems.some((li) => li.refund?.status === 'refunded');
    const refundedItem = lineItems.find((li) => li.refund?.refunded_at);
    const refundedAt = refundedItem?.refund?.refunded_at;

    // Safely serialize JSON fields via JSON round-trip to ensure JSON-safe values
    const customerAddress = apiRequest.customer?.address
        ? (JSON.parse(JSON.stringify(apiRequest.customer.address)) as Prisma.InputJsonValue)
        : Prisma.DbNull;
    const customerBank = apiRequest.customer?.bank
        ? (JSON.parse(JSON.stringify(apiRequest.customer.bank)) as Prisma.InputJsonValue)
        : Prisma.DbNull;
    const rawData = JSON.parse(JSON.stringify(apiRequest)) as Prisma.InputJsonValue;

    return {
        rpRequestId: apiRequest.id,
        rpRequestNumber: apiRequest.request_number,
        requestType: apiRequest.request_type,

        shopifyOrderId: apiRequest.order?.id ? String(apiRequest.order.id) : null,
        shopifyOrderName: apiRequest.order?.name || null,

        customerName: apiRequest.customer?.name || null,
        customerEmail: apiRequest.customer?.email || null,
        customerPhone: apiRequest.customer?.phone || null,
        customerAddress,
        customerBank,

        isApproved: apiRequest.approved?.status || false,
        approvedAt: apiRequest.approved?.created_at ? new Date(apiRequest.approved.created_at) : null,
        approvedComment: apiRequest.approved?.comment || null,

        isReceived: apiRequest.received?.status || false,
        receivedAt: apiRequest.received?.created_at ? new Date(apiRequest.received.created_at) : null,
        receivedComment: apiRequest.received?.comment || null,

        isInspected: apiRequest.inspected?.status || false,
        inspectedAt: apiRequest.inspected?.created_at ? new Date(apiRequest.inspected.created_at) : null,
        inspectedComment: apiRequest.inspected?.comment || null,

        isRefunded,
        refundedAt: refundedAt ? new Date(refundedAt) : null,

        isRejected: apiRequest.rejected?.status || false,
        rejectedAt: apiRequest.rejected?.created_at ? new Date(apiRequest.rejected.created_at) : null,
        rejectedComment: apiRequest.rejected?.comment || null,

        isArchived: apiRequest.archived?.status || false,
        archivedAt: apiRequest.archived?.created_at ? new Date(apiRequest.archived.created_at) : null,

        lineItems: JSON.parse(JSON.stringify(lineItems)) as Prisma.InputJsonValue,
        lineItemCount: lineItems.length,
        totalValue,
        primaryReason,

        rpCreatedAt: new Date(apiRequest.created_at),
        rpUpdatedAt: null,

        syncedAt: new Date(),
        rawData,
    };
}

/**
 * Fetch a single page from Return Prime API.
 * Validates the response against ReturnPrimeListResponseSchema before returning.
 */
async function fetchPage(
    token: string,
    page: number,
    dateFrom?: string,
    dateTo?: string
): Promise<{ requests: ReturnPrimeRequestCreateData[]; hasNextPage: boolean }> {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (dateFrom) params.set('created_at_min', dateFrom);
    if (dateTo) params.set('created_at_max', dateTo);

    const response = await fetch(`${API_BASE}?${params}`, {
        headers: {
            'x-rp-token': token,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const rawData = await response.json();

    // Validate API response with Zod schema
    const parsed = ReturnPrimeListResponseSchema.safeParse(rawData);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`Invalid API response shape: ${issues}`);
    }

    return {
        requests: parsed.data.data.list.map(transformRequest),
        hasNextPage: parsed.data.data.hasNextPage,
    };
}

// ============================================
// MAIN SYNC FUNCTION
// ============================================

/**
 * Main sync function - fetches all pages and upserts locally
 */
export async function syncReturnPrimeRequests(options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
        success: false,
        partialSuccess: false,
        totalFetched: 0,
        created: 0,
        updated: 0,
        errors: [],
        durationMs: 0,
    };

    try {
        const token = env.RETURNPRIME_API_TOKEN;
        if (!token) {
            result.errors.push('Return Prime API token not configured');
            return result;
        }

        const prisma = await getPrisma();

        // Set date range
        let dateFrom = options.dateFrom;
        const dateTo = options.dateTo || new Date().toISOString().split('T')[0];

        if (options.fullSync) {
            const yearAgo = new Date();
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);
            dateFrom = yearAgo.toISOString().split('T')[0];
        } else if (!dateFrom) {
            // Default: last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
        }

        log.info({ dateFrom, dateTo }, 'Starting sync');

        let page = 1;
        let hasMore = true;

        while (hasMore && page <= MAX_PAGES) {
            const { requests, hasNextPage } = await fetchPage(token, page, dateFrom, dateTo);

            // Batch-lookup ERP Orders for this page so we can link orderId
            const shopifyIds = requests
                .map((r) => r.shopifyOrderId)
                .filter((id): id is string => id !== null);
            const orderMap = new Map<string, string>();
            if (shopifyIds.length > 0) {
                const orders = await prisma.order.findMany({
                    where: { shopifyOrderId: { in: shopifyIds } },
                    select: { id: true, shopifyOrderId: true },
                });
                for (const o of orders) {
                    if (o.shopifyOrderId) orderMap.set(o.shopifyOrderId, o.id);
                }
            }

            for (const data of requests) {
                try {
                    // Link to ERP Order if we found a match
                    const matchedOrderId = data.shopifyOrderId ? orderMap.get(data.shopifyOrderId) : undefined;
                    const dataWithOrder = {
                        ...data,
                        ...(matchedOrderId ? { orderId: matchedOrderId } : {}),
                    };

                    // Check if exists for created/updated tracking
                    const existing = await prisma.returnPrimeRequest.findUnique({
                        where: { rpRequestId: data.rpRequestId },
                        select: { id: true },
                    });

                    // Upsert for atomicity
                    await prisma.returnPrimeRequest.upsert({
                        where: { rpRequestId: data.rpRequestId },
                        create: dataWithOrder as Prisma.ReturnPrimeRequestCreateInput,
                        update: { ...dataWithOrder, syncedAt: new Date() } as Prisma.ReturnPrimeRequestUpdateInput,
                    });

                    if (existing) {
                        result.updated++;
                    } else {
                        result.created++;
                    }

                    result.totalFetched++;
                } catch (error: unknown) {
                    const msg = error instanceof Error ? error.message : 'Unknown';
                    result.errors.push(`${data.rpRequestNumber}: ${msg}`);
                }
            }

            log.info({ page, totalFetched: result.totalFetched, pageSize: requests.length }, 'Page synced');

            hasMore = hasNextPage;
            page++;

            // Small delay to avoid rate limiting
            if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        // Backfill: link any ReturnPrimeRequests that still have orderId=NULL
        try {
            await prisma.$executeRawUnsafe(`
                UPDATE "ReturnPrimeRequest" rpr
                SET "orderId" = o.id
                FROM "Order" o
                WHERE rpr."shopifyOrderId" = o."shopifyOrderId"
                  AND rpr."orderId" IS NULL
            `);
        } catch (backfillError: unknown) {
            const msg = backfillError instanceof Error ? backfillError.message : 'Unknown';
            log.error({ error: msg }, 'Backfill error (non-fatal)');
        }

        // Full success only when all records synced without errors; partial if some succeeded
        result.success = result.errors.length === 0 && result.totalFetched > 0;
        result.partialSuccess = result.errors.length > 0 && result.totalFetched > 0;
        result.durationMs = Date.now() - startTime;

        log.info({ created: result.created, updated: result.updated, errors: result.errors.length, durationMs: result.durationMs }, 'Sync complete');

        return result;
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error: msg }, 'Fatal error');
        result.errors.push(msg);
        result.durationMs = Date.now() - startTime;
        return result;
    }
}

// ============================================
// STATUS FUNCTIONS
// ============================================

/**
 * Get sync status - total records, last synced, date range
 */
export async function getSyncStatus(): Promise<SyncStatus> {
    const prisma = await getPrisma();

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
        lastSyncedAt: lastSynced?.syncedAt || null,
        oldestRecord: oldest?.rpCreatedAt || null,
        newestRecord: newest?.rpCreatedAt || null,
    };
}

/**
 * Get detailed sync status with breakdown by type and status.
 * Lets Prisma groupBy types flow through without manual casts.
 */
export async function getDetailedSyncStatus() {
    const prisma = await getPrisma();

    const [status, byType, byStatus] = await Promise.all([
        getSyncStatus(),
        prisma.returnPrimeRequest.groupBy({
            by: ['requestType'],
            _count: true,
        }),
        prisma.returnPrimeRequest.groupBy({
            by: ['isApproved', 'isReceived', 'isRefunded', 'isRejected'],
            _count: true,
        }),
    ]);

    return {
        ...status,
        byType: byType.reduce(
            (acc, item) => {
                acc[item.requestType] = item._count;
                return acc;
            },
            {} as Record<string, number>
        ),
        statusCounts: {
            approved: byStatus.filter((s) => s.isApproved).reduce((sum, s) => sum + s._count, 0),
            received: byStatus.filter((s) => s.isReceived).reduce((sum, s) => sum + s._count, 0),
            refunded: byStatus.filter((s) => s.isRefunded).reduce((sum, s) => sum + s._count, 0),
            rejected: byStatus.filter((s) => s.isRejected).reduce((sum, s) => sum + s._count, 0),
        },
    };
}
