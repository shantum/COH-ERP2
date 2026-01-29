/**
 * @module dashboardCache
 * Server-side cache for dashboard analytics data.
 *
 * ⚠️  SERVER-ONLY CODE ⚠️
 * Uses globalThis singleton pattern matching balanceCache.ts.
 * 60-second TTL to balance freshness with performance.
 *
 * Key features:
 * - 60-second max staleness (sufficient for dashboard, prevents DB hammering)
 * - Single cached entry for main dashboard data
 * - Selective keys for different dashboard views
 * - Thread-safe with globalThis singleton
 *
 * Usage:
 * - Get cached data: `const data = dashboardCache.get('main')`
 * - Set data: `dashboardCache.set('main', data)`
 * - Invalidate: `dashboardCache.invalidate('main')` or `dashboardCache.invalidateAll()`
 *
 * Cache keys:
 * - 'main': Core dashboard analytics (pipeline, revenue, top products)
 * - 'topProducts:{days}:{level}': Top products by time period and level
 * - 'topCustomers:{period}': Top customers by period
 * - 'topMaterials:{days}:{level}': Top materials by time period and level
 */

/**
 * Cached dashboard entry with timestamp
 */
export interface CachedDashboardEntry<T = unknown> {
    data: T;
    cachedAt: number;
}

/**
 * Cache configuration
 */
const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Global key for singleton storage
 */
const GLOBAL_CACHE_KEY = '__dashboardCache__';

/**
 * In-memory dashboard cache
 * Optimizes repeated dashboard queries within the staleness window
 */
class DashboardCache {
    private cache: Map<string, CachedDashboardEntry>;
    private ttlMs: number;

    constructor(ttlMs: number = DEFAULT_TTL_MS) {
        this.cache = new Map();
        this.ttlMs = ttlMs;
    }

    /**
     * Get cached dashboard data by key
     * Returns null if not cached or stale
     *
     * @param key - Cache key (e.g., 'main', 'topProducts:30:product')
     * @returns Cached data or null if not found/stale
     */
    get<T>(key: string): T | null {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        const now = Date.now();
        if (now - entry.cachedAt > this.ttlMs) {
            // Stale - remove and return null
            this.cache.delete(key);
            return null;
        }

        return entry.data as T;
    }

    /**
     * Set dashboard data in cache
     *
     * @param key - Cache key
     * @param data - Data to cache
     */
    set<T>(key: string, data: T): void {
        this.cache.set(key, {
            data,
            cachedAt: Date.now(),
        });
    }

    /**
     * Check if key exists and is fresh
     *
     * @param key - Cache key
     * @returns true if cached and fresh
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        const now = Date.now();
        if (now - entry.cachedAt > this.ttlMs) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Invalidate specific cache key
     *
     * @param key - Cache key to invalidate
     */
    invalidate(key: string): void {
        this.cache.delete(key);
    }

    /**
     * Invalidate all cache entries matching a pattern
     *
     * @param prefix - Key prefix to match (e.g., 'topProducts' to clear all top products)
     */
    invalidateByPrefix(prefix: string): void {
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Invalidate all cached data
     * Use after bulk operations that affect dashboard metrics
     */
    invalidateAll(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics for debugging
     *
     * @returns Cache statistics
     */
    getStats(): { size: number; ttlMs: number; keys: string[] } {
        return {
            size: this.cache.size,
            ttlMs: this.ttlMs,
            keys: Array.from(this.cache.keys()),
        };
    }

    /**
     * Get age of cached entry in milliseconds
     *
     * @param key - Cache key
     * @returns Age in ms, or null if not cached
     */
    getAge(key: string): number | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        return Date.now() - entry.cachedAt;
    }
}

/**
 * Get or create singleton cache instance
 * Uses globalThis to persist across hot reloads in development
 */
function getDashboardCache(): DashboardCache {
    const globalForCache = globalThis as unknown as {
        [GLOBAL_CACHE_KEY]: DashboardCache | undefined;
    };

    if (!globalForCache[GLOBAL_CACHE_KEY]) {
        globalForCache[GLOBAL_CACHE_KEY] = new DashboardCache();
    }

    return globalForCache[GLOBAL_CACHE_KEY];
}

/**
 * Singleton dashboard cache instance
 */
export const dashboardCache = getDashboardCache();

/**
 * Helper to build cache key for top products
 */
export function topProductsCacheKey(days: number, level: string): string {
    return `topProducts:${days}:${level}`;
}

/**
 * Helper to build cache key for top customers
 */
export function topCustomersCacheKey(period: string): string {
    return `topCustomers:${period}`;
}

/**
 * Helper to build cache key for top materials
 */
export function topMaterialsCacheKey(days: number, level: string): string {
    return `topMaterials:${days}:${level}`;
}
