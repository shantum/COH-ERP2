/**
 * @module customerStatsCache
 * In-memory cache for customer stats (LTV, orderCount, rtoCount) to optimize order list enrichment.
 *
 * Key features:
 * - 2-minute max staleness (customer stats change infrequently during order operations)
 * - Batch fetch for uncached customers from DB
 * - Selective invalidation for mutations (order creation, cancellation, RTO)
 * - Full cache clear for bulk operations
 *
 * Usage:
 * - Import singleton: `import { customerStatsCache } from './customerStatsCache'`
 * - Get stats: `const stats = await customerStatsCache.get(prisma, customerIds)`
 * - Invalidate after mutations: `customerStatsCache.invalidate(affectedCustomerIds)`
 * - Clear all (bulk imports): `customerStatsCache.invalidateAll()`
 *
 * IMPORTANT: Invalidate after order create/cancel/RTO to prevent stale reads.
 */

import type { PrismaClient } from '@prisma/client';

/**
 * Cached customer stats entry with timestamp
 */
export interface CachedCustomerStats {
    ltv: number;
    orderCount: number;
    rtoCount: number;
    cachedAt: number;
}

/**
 * Cache configuration - 2 minutes (customer stats change less frequently than inventory)
 */
const DEFAULT_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * In-memory customer stats cache
 * Optimizes repeated stats lookups within the staleness window
 */
class CustomerStatsCache {
    private cache: Map<string, CachedCustomerStats>;
    private maxAgeMs: number;

    constructor(maxAgeMs: number = DEFAULT_MAX_AGE_MS) {
        this.cache = new Map();
        this.maxAgeMs = maxAgeMs;
    }

    /**
     * Get customer stats for a list of customer IDs
     * Returns cached values for fresh entries, fetches uncached/stale ones from DB
     *
     * @param prisma - Prisma client instance
     * @param customerIds - Array of customer IDs to get stats for
     * @returns Record of customerId -> stats (includes all requested customers)
     */
    async get(
        prisma: PrismaClient,
        customerIds: string[]
    ): Promise<Record<string, CachedCustomerStats>> {
        if (!customerIds || customerIds.length === 0) return {};

        const now = Date.now();
        const result: Record<string, CachedCustomerStats> = {};
        const uncachedIds: string[] = [];

        // Check cache for each customer
        for (const customerId of customerIds) {
            const cached = this.cache.get(customerId);
            if (cached && now - cached.cachedAt < this.maxAgeMs) {
                // Fresh cache hit
                result[customerId] = cached;
            } else {
                // Cache miss or stale - need to fetch
                uncachedIds.push(customerId);
                // Remove stale entry if exists
                if (cached) {
                    this.cache.delete(customerId);
                }
            }
        }

        // Fetch uncached/stale stats from DB
        if (uncachedIds.length > 0) {
            const freshStats = await this.fetchFromDb(prisma, uncachedIds);

            // Update cache and result with fresh data
            for (const customerId of uncachedIds) {
                const stats = freshStats.get(customerId);
                const cachedStats: CachedCustomerStats = stats
                    ? { ...stats, cachedAt: now }
                    : { ltv: 0, orderCount: 0, rtoCount: 0, cachedAt: now };

                this.cache.set(customerId, cachedStats);
                result[customerId] = cachedStats;
            }
        }

        return result;
    }

    /**
     * Fetch customer stats from database
     * Runs two queries in parallel: customer data + order counts
     */
    private async fetchFromDb(
        prisma: PrismaClient,
        customerIds: string[]
    ): Promise<Map<string, Omit<CachedCustomerStats, 'cachedAt'>>> {
        // Run both queries in parallel
        const [customers, orderCounts] = await Promise.all([
            // Query 1: Get stored LTV and rtoCount from customers
            prisma.customer.findMany({
                where: { id: { in: customerIds } },
                select: { id: true, ltv: true, rtoCount: true },
            }),
            // Query 2: Get order counts (non-cancelled)
            prisma.order.groupBy({
                by: ['customerId'],
                where: { customerId: { in: customerIds }, status: { not: 'cancelled' } },
                _count: { id: true },
            }),
        ]);

        // Build count map
        const countMap = new Map<string, number>();
        for (const stat of orderCounts) {
            if (stat.customerId) countMap.set(stat.customerId, stat._count.id);
        }

        // Build result map
        const result = new Map<string, Omit<CachedCustomerStats, 'cachedAt'>>();
        for (const c of customers) {
            result.set(c.id, {
                ltv: c.ltv || 0,
                orderCount: countMap.get(c.id) || 0,
                rtoCount: c.rtoCount || 0,
            });
        }

        return result;
    }

    /**
     * Invalidate specific customers from cache
     * Call this after order create/cancel/RTO affecting these customers
     *
     * @param customerIds - Array of customer IDs to invalidate
     */
    invalidate(customerIds: string[]): void {
        for (const customerId of customerIds) {
            this.cache.delete(customerId);
        }
    }

    /**
     * Clear entire cache
     * Call this after bulk operations (imports, LTV recalculation)
     */
    invalidateAll(): void {
        this.cache.clear();
    }

    /**
     * Get current cache size (for debugging/monitoring)
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Get cache stats (for debugging/monitoring)
     */
    getStats(): { size: number; maxAgeMs: number } {
        return {
            size: this.cache.size,
            maxAgeMs: this.maxAgeMs,
        };
    }
}

// Export singleton instance
export const customerStatsCache = new CustomerStatsCache();

// Export class for testing with custom maxAge
export { CustomerStatsCache };
