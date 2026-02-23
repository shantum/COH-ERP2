/**
 * @module balanceCache
 * Generic in-memory TTL cache for inventory balances.
 *
 * SERVER-ONLY CODE — depends on Prisma types and inventory queries (dynamic imports).
 * Do not add static imports of kysely/pg/@prisma/client. See services/index.ts for details.
 *
 * Key features:
 * - Configurable max staleness (auto-expires stale entries on read)
 * - Batch fetch for uncached IDs via pluggable fetch function
 * - Selective invalidation for mutations (inventory transactions, shipping, RTO)
 * - Full cache clear for bulk operations
 *
 * Two singleton instances:
 * - `inventoryBalanceCache` — SKU balances via calculateAllInventoryBalances
 * - `fabricColourBalanceCache` — fabric colour balances via FabricColour.currentBalance
 *
 * IMPORTANT: Always invalidate after mutations to prevent stale reads.
 */

import type { PrismaInstance, PrismaTransaction } from '../db/prisma.js';
import { calculateAllInventoryBalances } from '../db/queries/inventory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cached SKU balance entry (NOTE: totalReserved removed — allocation now creates OUTWARD directly) */
export interface CachedBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    availableBalance: number; // Same as currentBalance (kept for backward compatibility)
    hasDataIntegrityIssue: boolean;
    cachedAt: number;
}

/** Cached fabric colour balance entry */
export interface CachedFabricColourBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
    cachedAt: number;
}

/** Internal cache wrapper that attaches a timestamp to any value */
interface CacheEntry<V> {
    value: V;
    cachedAt: number;
}

// ---------------------------------------------------------------------------
// Generic BalanceCache
// ---------------------------------------------------------------------------

/** Fetch function signature — takes prisma + IDs, returns a Map of id -> value (without cachedAt) */
type FetchFn<V> = (
    prisma: PrismaInstance | PrismaTransaction,
    ids: string[],
) => Promise<Map<string, V>>;

/** Strips `cachedAt` from a type so the fetch function doesn't need to provide it */
type WithoutCachedAt<V> = Omit<V, 'cachedAt'>;

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generic TTL-based balance cache.
 * - `V` is the full cached value type (must include `cachedAt: number`)
 * - The fetch function returns values WITHOUT `cachedAt` — the cache adds it.
 */
class BalanceCache<V extends { cachedAt: number }> {
    private cache = new Map<string, CacheEntry<WithoutCachedAt<V>>>();
    private fetchFn: FetchFn<WithoutCachedAt<V>>;
    private defaultValue: WithoutCachedAt<V>;
    private maxAgeMs: number;
    private label: string;

    constructor(
        fetchFn: FetchFn<WithoutCachedAt<V>>,
        defaultValue: WithoutCachedAt<V>,
        maxAgeMs: number = DEFAULT_MAX_AGE_MS,
        label: string = 'balance',
    ) {
        this.fetchFn = fetchFn;
        this.defaultValue = defaultValue;
        this.maxAgeMs = maxAgeMs;
        this.label = label;
    }

    /**
     * Get balances for a list of IDs.
     * Returns cached values for fresh entries, fetches uncached/stale ones from DB.
     */
    async get(
        prisma: PrismaInstance | PrismaTransaction,
        ids: string[],
    ): Promise<Map<string, V>> {
        if (ids.length === 0) return new Map();

        const now = Date.now();
        const result = new Map<string, V>();
        const uncachedIds: string[] = [];

        for (const id of ids) {
            const entry = this.cache.get(id);
            if (entry && now - entry.cachedAt < this.maxAgeMs) {
                result.set(id, { ...entry.value, cachedAt: entry.cachedAt } as V);
            } else {
                uncachedIds.push(id);
                if (entry) this.cache.delete(id);
            }
        }

        if (uncachedIds.length > 0) {
            const freshMap = await this.fetchFn(prisma, uncachedIds);

            for (const id of uncachedIds) {
                const value = freshMap.get(id) ?? this.defaultValue;
                this.cache.set(id, { value, cachedAt: now });
                result.set(id, { ...value, cachedAt: now } as V);
            }
        }

        return result;
    }

    /** Invalidate specific IDs from cache */
    invalidate(ids: string[]): void {
        for (const id of ids) this.cache.delete(id);
    }

    /** Clear entire cache */
    invalidateAll(): void {
        this.cache.clear();
    }

    /** Current cache size */
    get size(): number {
        return this.cache.size;
    }

    /** Cache stats for debugging/monitoring */
    getStats(): { size: number; maxAgeMs: number; label: string } {
        return { size: this.cache.size, maxAgeMs: this.maxAgeMs, label: this.label };
    }
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/** Fetch SKU balances via calculateAllInventoryBalances */
async function fetchSkuBalances(
    prisma: PrismaInstance | PrismaTransaction,
    skuIds: string[],
): Promise<Map<string, WithoutCachedAt<CachedBalance>>> {
    const raw = await calculateAllInventoryBalances(prisma, skuIds);
    const result = new Map<string, WithoutCachedAt<CachedBalance>>();

    for (const [skuId, balance] of raw) {
        result.set(skuId, {
            totalInward: balance.totalInward,
            totalOutward: balance.totalOutward,
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
            hasDataIntegrityIssue: balance.currentBalance < 0,
        });
    }

    return result;
}

/** Fetch fabric colour balances from the materialized FabricColour.currentBalance column */
async function fetchFabricColourBalances(
    prisma: PrismaInstance | PrismaTransaction,
    fabricColourIds: string[],
): Promise<Map<string, WithoutCachedAt<CachedFabricColourBalance>>> {
    const rows = await prisma.fabricColour.findMany({
        where: { id: { in: fabricColourIds } },
        select: { id: true, currentBalance: true },
    });

    const result = new Map<string, WithoutCachedAt<CachedFabricColourBalance>>();
    for (const row of rows) {
        result.set(row.id, {
            totalInward: 0,
            totalOutward: 0,
            currentBalance: (row as { id: string; currentBalance: number }).currentBalance,
        });
    }

    return result;
}

// ---------------------------------------------------------------------------
// Default values (zero balance)
// ---------------------------------------------------------------------------

const ZERO_SKU_BALANCE: WithoutCachedAt<CachedBalance> = {
    totalInward: 0,
    totalOutward: 0,
    currentBalance: 0,
    availableBalance: 0,
    hasDataIntegrityIssue: false,
};

const ZERO_FABRIC_BALANCE: WithoutCachedAt<CachedFabricColourBalance> = {
    totalInward: 0,
    totalOutward: 0,
    currentBalance: 0,
};

// ---------------------------------------------------------------------------
// Singleton instances (survive hot reloads via globalThis)
// ---------------------------------------------------------------------------

const INV_CACHE_KEY = '__inventoryBalanceCache__';
const FAB_CACHE_KEY = '__fabricColourBalanceCache__';

function getSingleton<V extends { cachedAt: number }>(
    key: string,
    factory: () => BalanceCache<V>,
): BalanceCache<V> {
    const g = globalThis as unknown as Record<string, BalanceCache<V> | undefined>;
    if (!g[key]) g[key] = factory();
    return g[key];
}

export const inventoryBalanceCache = getSingleton<CachedBalance>(
    INV_CACHE_KEY,
    () => new BalanceCache<CachedBalance>(fetchSkuBalances, ZERO_SKU_BALANCE, DEFAULT_MAX_AGE_MS, 'inventory'),
);

export const fabricColourBalanceCache = getSingleton<CachedFabricColourBalance>(
    FAB_CACHE_KEY,
    () => new BalanceCache<CachedFabricColourBalance>(fetchFabricColourBalances, ZERO_FABRIC_BALANCE, DEFAULT_MAX_AGE_MS, 'fabricColour'),
);

// Export class names for backward compatibility (testing)
export { BalanceCache, BalanceCache as InventoryBalanceCache, BalanceCache as FabricColourBalanceCache };
