/**
 * @module inventoryBalanceCache
 * In-memory cache for inventory balances to optimize Server Function balance queries.
 *
 * ⚠️  SERVER-ONLY CODE ⚠️
 * This module depends on Prisma types and inventory queries that use dynamic imports.
 * Do not add static imports of kysely/pg/@prisma/client. See services/index.ts for details.
 *
 * Key features:
 * - 5-minute max staleness (auto-expires stale entries on read)
 * - Batch fetch for uncached SKUs using calculateAllInventoryBalances
 * - Selective invalidation for mutations (inventory transactions, shipping, RTO)
 * - Full cache clear for bulk operations
 *
 * Usage:
 * - Import singleton: `import { inventoryBalanceCache } from '@coh/shared/services/inventory'`
 * - Get balances: `const balances = await inventoryBalanceCache.get(prisma, skuIds)`
 * - Invalidate after mutations: `inventoryBalanceCache.invalidate(affectedSkuIds)`
 * - Clear all (bulk imports): `inventoryBalanceCache.invalidateAll()`
 *
 * IMPORTANT: Always invalidate after inventory transactions to prevent stale reads.
 */

import type { PrismaInstance, PrismaTransaction } from '../db/prisma.js';
import { calculateAllInventoryBalances } from '../db/queries/inventory.js';

/**
 * Cached balance entry with timestamp
 * NOTE: totalReserved removed - allocation now creates OUTWARD directly
 */
export interface CachedBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    availableBalance: number; // Same as currentBalance (kept for backward compatibility)
    hasDataIntegrityIssue: boolean;
    cachedAt: number;
}

/**
 * Cache configuration
 */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Global key for singleton storage
 */
const GLOBAL_CACHE_KEY = '__inventoryBalanceCache__';

/**
 * In-memory inventory balance cache
 * Optimizes repeated balance lookups within the staleness window
 */
class InventoryBalanceCache {
    private cache: Map<string, CachedBalance>;
    private maxAgeMs: number;

    constructor(maxAgeMs: number = DEFAULT_MAX_AGE_MS) {
        this.cache = new Map();
        this.maxAgeMs = maxAgeMs;
    }

    /**
     * Get inventory balances for a list of SKU IDs
     * Returns cached values for fresh entries, fetches uncached/stale ones from DB
     *
     * @param prisma - Prisma client instance
     * @param skuIds - Array of SKU IDs to get balances for
     * @returns Map of skuId -> balance (includes all requested SKUs)
     */
    async get(
        prisma: PrismaInstance | PrismaTransaction,
        skuIds: string[]
    ): Promise<Map<string, CachedBalance>> {
        const now = Date.now();
        const result = new Map<string, CachedBalance>();
        const uncachedIds: string[] = [];

        // Check cache for each SKU
        for (const skuId of skuIds) {
            const cached = this.cache.get(skuId);
            if (cached && now - cached.cachedAt < this.maxAgeMs) {
                // Fresh cache hit
                result.set(skuId, cached);
            } else {
                // Cache miss or stale - need to fetch
                uncachedIds.push(skuId);
                // Remove stale entry if exists
                if (cached) {
                    this.cache.delete(skuId);
                }
            }
        }

        // Fetch uncached/stale balances from DB
        if (uncachedIds.length > 0) {
            const freshBalances = await calculateAllInventoryBalances(
                prisma,
                uncachedIds
            );

            // Update cache and result with fresh data
            for (const skuId of uncachedIds) {
                const balance = freshBalances.get(skuId);
                const cachedBalance: CachedBalance = balance
                    ? {
                          totalInward: balance.totalInward,
                          totalOutward: balance.totalOutward,
                          currentBalance: balance.currentBalance,
                          availableBalance: balance.availableBalance,
                          hasDataIntegrityIssue: balance.currentBalance < 0,
                          cachedAt: now,
                      }
                    : {
                          // SKU has no transactions - zero balance
                          totalInward: 0,
                          totalOutward: 0,
                          currentBalance: 0,
                          availableBalance: 0,
                          hasDataIntegrityIssue: false,
                          cachedAt: now,
                      };

                this.cache.set(skuId, cachedBalance);
                result.set(skuId, cachedBalance);
            }
        }

        return result;
    }

    /**
     * Invalidate specific SKUs from cache
     * Call this after inventory transactions affecting these SKUs
     *
     * @param skuIds - Array of SKU IDs to invalidate
     */
    invalidate(skuIds: string[]): void {
        for (const skuId of skuIds) {
            this.cache.delete(skuId);
        }
    }

    /**
     * Clear entire cache
     * Call this after bulk operations (imports, reconciliation)
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

/**
 * Get or create the singleton inventory balance cache instance.
 * Uses globalThis for singleton storage to survive hot reloads.
 */
function getInventoryBalanceCache(): InventoryBalanceCache {
    const globalForCache = globalThis as unknown as {
        [GLOBAL_CACHE_KEY]: InventoryBalanceCache | undefined;
    };

    if (!globalForCache[GLOBAL_CACHE_KEY]) {
        globalForCache[GLOBAL_CACHE_KEY] = new InventoryBalanceCache();
    }

    return globalForCache[GLOBAL_CACHE_KEY];
}

// Export singleton instance via getter
export const inventoryBalanceCache = getInventoryBalanceCache();

// Export class for testing with custom maxAge
export { InventoryBalanceCache };

// ============================================
// FABRIC COLOUR BALANCE CACHE
// ============================================

/**
 * Cached fabric colour balance entry
 */
export interface CachedFabricColourBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    cachedAt: number;
}

const FABRIC_COLOUR_CACHE_KEY = '__fabricColourBalanceCache__';

/**
 * In-memory fabric colour balance cache
 * Optimizes repeated balance lookups for fabric colours
 */
class FabricColourBalanceCache {
    private cache: Map<string, CachedFabricColourBalance>;
    private maxAgeMs: number;

    constructor(maxAgeMs: number = DEFAULT_MAX_AGE_MS) {
        this.cache = new Map();
        this.maxAgeMs = maxAgeMs;
    }

    /**
     * Get fabric colour balances for a list of fabric colour IDs
     * Returns cached values for fresh entries, fetches uncached/stale ones from DB
     * Now reads directly from FabricColour.currentBalance (maintained by DB trigger)
     */
    async get(
        prisma: PrismaInstance | PrismaTransaction,
        fabricColourIds: string[]
    ): Promise<Map<string, CachedFabricColourBalance>> {
        if (fabricColourIds.length === 0) {
            return new Map();
        }

        const now = Date.now();
        const result = new Map<string, CachedFabricColourBalance>();
        const uncachedIds: string[] = [];

        // Check cache for each fabric colour
        for (const id of fabricColourIds) {
            const cached = this.cache.get(id);
            if (cached && now - cached.cachedAt < this.maxAgeMs) {
                result.set(id, cached);
            } else {
                uncachedIds.push(id);
                if (cached) {
                    this.cache.delete(id);
                }
            }
        }

        // Fetch uncached/stale balances from DB - reads materialized column directly
        if (uncachedIds.length > 0) {
            const freshBalances = await prisma.fabricColour.findMany({
                where: { id: { in: uncachedIds } },
                select: { id: true, currentBalance: true },
            });

            // Update cache and result with fresh data
            const freshMap = new Map<string, number>(
                freshBalances.map((b: { id: string; currentBalance: number }) => [b.id, b.currentBalance])
            );

            for (const id of uncachedIds) {
                const balance = freshMap.get(id);
                const cachedBalance: CachedFabricColourBalance = {
                    totalInward: 0, // Not tracked - use aggregation query if needed
                    totalOutward: 0, // Not tracked - use aggregation query if needed
                    currentBalance: balance ?? 0,
                    cachedAt: now,
                };

                this.cache.set(id, cachedBalance);
                result.set(id, cachedBalance);
            }
        }

        return result;
    }

    /**
     * Invalidate specific fabric colours from cache
     */
    invalidate(fabricColourIds: string[]): void {
        for (const id of fabricColourIds) {
            this.cache.delete(id);
        }
    }

    /**
     * Clear entire cache
     */
    invalidateAll(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

/**
 * Get or create the singleton fabric colour balance cache instance
 */
function getFabricColourBalanceCache(): FabricColourBalanceCache {
    const globalForCache = globalThis as unknown as {
        [FABRIC_COLOUR_CACHE_KEY]: FabricColourBalanceCache | undefined;
    };

    if (!globalForCache[FABRIC_COLOUR_CACHE_KEY]) {
        globalForCache[FABRIC_COLOUR_CACHE_KEY] = new FabricColourBalanceCache();
    }

    return globalForCache[FABRIC_COLOUR_CACHE_KEY];
}

export const fabricColourBalanceCache = getFabricColourBalanceCache();
export { FabricColourBalanceCache };
