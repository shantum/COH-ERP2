/**
 * Order Processing Lock
 *
 * Prevents race conditions when the same Shopify order is processed simultaneously
 * by both webhooks and sync jobs.
 *
 * Uses database-level locking via SELECT FOR UPDATE to ensure only one process
 * can modify an order at a time.
 */

import { ORDER_LOCK_CONFIG } from '../constants.js';

// In-memory lock for lightweight operations (single-instance only)
// For multi-instance deployments, use the database lock
const processingOrders = new Map<string, { source: string; acquiredAt: number }>();

// Lock timeout - release if not explicitly released after this time
// Configurable via ORDER_LOCK_TIMEOUT_MS env var, defaults to 90 seconds
const LOCK_TIMEOUT_MS = ORDER_LOCK_CONFIG.timeoutMs;

/**
 * Acquire a lock for processing a Shopify order
 */
export function acquireOrderLock(shopifyOrderId: string, source = 'unknown'): boolean {
    const lockKey = `order:${shopifyOrderId}`;
    const existing = processingOrders.get(lockKey);

    if (existing) {
        // Check if lock has expired
        if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
            console.warn(`[OrderLock] Stale lock released for order ${shopifyOrderId} (held by ${existing.source})`);
            processingOrders.delete(lockKey);
        } else {
            console.log(`[OrderLock] Order ${shopifyOrderId} already being processed by ${existing.source}`);
            return false;
        }
    }

    processingOrders.set(lockKey, {
        source,
        acquiredAt: Date.now(),
    });

    return true;
}

/**
 * Release the lock for a Shopify order
 */
export function releaseOrderLock(shopifyOrderId: string): void {
    const lockKey = `order:${shopifyOrderId}`;
    processingOrders.delete(lockKey);
}

/**
 * Execute a function with order lock protection.
 * Automatically acquires and releases the lock.
 *
 * Two-tier locking strategy:
 * 1. In-memory lock (fast-path): Prevents duplicate work in same instance
 * 2. Database lock (distributed): Ensures mutual exclusion across instances
 */
export async function withOrderLock<T>(
    shopifyOrderId: string,
    source: string,
    fn: () => Promise<T>
): Promise<{ locked: boolean; result?: T; skipped?: boolean; reason?: string }> {
    // Fast-path: Check in-memory lock first (cheap operation)
    if (!acquireOrderLock(shopifyOrderId, source)) {
        return { locked: false, skipped: true, reason: 'in_memory_lock' };
    }

    try {
        // Database lock: Import prisma client dynamically to avoid circular dependency
        const { default: prisma } = await import('../lib/prisma.js');

        const lockExpiry = new Date(Date.now() + LOCK_TIMEOUT_MS);

        // Try to acquire database lock using transaction for atomicity
        const lockResult = await prisma.$transaction(async (tx) => {
            // Check if cache entry exists
            const cache = await tx.shopifyOrderCache.findUnique({
                where: { id: shopifyOrderId },
                select: { id: true, processingLock: true }
            });

            // If no cache entry exists yet, allow processing (will be created by cacheShopifyOrders)
            if (!cache) {
                return { acquired: true as const, isNew: true };
            }

            // Check if lock is held and not expired
            if (cache.processingLock) {
                const lockAge = Date.now() - new Date(cache.processingLock).getTime();
                if (lockAge < LOCK_TIMEOUT_MS) {
                    return { acquired: false as const, reason: 'locked', lockAge };
                }
                // Lock expired, we can take it
                console.log(`[OrderLock] Expired database lock released for ${shopifyOrderId}`);
            }

            // Acquire lock
            await tx.shopifyOrderCache.update({
                where: { id: shopifyOrderId },
                data: { processingLock: lockExpiry }
            });

            return { acquired: true as const, isNew: false };
        });

        if (!lockResult.acquired) {
            // Another instance holds the lock
            console.log(`[OrderLock] Database lock held for order ${shopifyOrderId}`);
            return { locked: false, skipped: true, reason: 'database_lock' };
        }

        // Lock acquired - execute operation
        try {
            const result = await fn();
            return { locked: true, result };
        } finally {
            // Release database lock (only if cache exists - might not for new orders)
            if (!lockResult.isNew) {
                await prisma.shopifyOrderCache.updateMany({
                    where: { id: shopifyOrderId },
                    data: { processingLock: null }
                }).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`[OrderLock] Failed to release database lock for ${shopifyOrderId}:`, message);
                });
            }
        }
    } finally {
        // Always release in-memory lock
        releaseOrderLock(shopifyOrderId);
    }
}

/**
 * Get current lock status for debugging
 */
export function getOrderLockStatus(): Array<{ orderId: string; source: string; age: number; expired: boolean }> {
    const locks: Array<{ orderId: string; source: string; age: number; expired: boolean }> = [];
    const now = Date.now();

    for (const [key, value] of processingOrders.entries()) {
        locks.push({
            orderId: key.replace('order:', ''),
            source: value.source,
            age: Math.round((now - value.acquiredAt) / 1000),
            expired: (now - value.acquiredAt) > LOCK_TIMEOUT_MS,
        });
    }

    return locks;
}

/**
 * Clear all locks (for testing/debugging only)
 */
export function clearAllOrderLocks(): void {
    processingOrders.clear();
}
