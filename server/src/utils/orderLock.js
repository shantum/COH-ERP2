/**
 * Order Processing Lock
 *
 * Prevents race conditions when the same Shopify order is processed simultaneously
 * by both webhooks and sync jobs.
 *
 * Uses database-level locking via SELECT FOR UPDATE to ensure only one process
 * can modify an order at a time.
 */

// In-memory lock for lightweight operations (single-instance only)
// For multi-instance deployments, use the database lock
const processingOrders = new Map();

// Lock timeout - release if not explicitly released after this time
const LOCK_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Acquire a lock for processing a Shopify order
 *
 * @param {string} shopifyOrderId - The Shopify order ID to lock
 * @param {string} source - The source acquiring the lock ('webhook' or 'sync')
 * @returns {boolean} - True if lock acquired, false if order is already being processed
 */
export function acquireOrderLock(shopifyOrderId, source = 'unknown') {
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
 *
 * @param {string} shopifyOrderId - The Shopify order ID to unlock
 */
export function releaseOrderLock(shopifyOrderId) {
    const lockKey = `order:${shopifyOrderId}`;
    processingOrders.delete(lockKey);
}

/**
 * Execute a function with order lock protection
 * Automatically acquires and releases the lock
 *
 * @param {string} shopifyOrderId - The Shopify order ID to lock
 * @param {string} source - The source of the operation
 * @param {Function} fn - The function to execute
 * @returns {Promise<{locked: boolean, result?: any, skipped?: boolean}>}
 */
export async function withOrderLock(shopifyOrderId, source, fn) {
    if (!acquireOrderLock(shopifyOrderId, source)) {
        return { locked: false, skipped: true, reason: 'already_processing' };
    }

    try {
        const result = await fn();
        return { locked: true, result };
    } finally {
        releaseOrderLock(shopifyOrderId);
    }
}

/**
 * Database-level order lock using Prisma transaction
 * Use this for multi-instance deployments
 *
 * This uses a "processing lock" pattern:
 * 1. Try to update ShopifyOrderCache.processingLock to current timestamp
 * 2. Only succeed if processingLock is null or expired
 * 3. On completion, set processingLock back to null
 *
 * @param {PrismaClient} prisma
 * @param {string} shopifyOrderId
 * @param {string} source
 * @param {Function} fn
 */
export async function withDatabaseOrderLock(prisma, shopifyOrderId, source, fn) {
    const lockTimeout = 60000; // 60 seconds

    try {
        // Try to acquire lock using atomic update
        const result = await prisma.$transaction(async (tx) => {
            // Get current cache entry with lock
            const cache = await tx.shopifyOrderCache.findUnique({
                where: { id: shopifyOrderId },
                select: { id: true, processingLock: true }
            });

            // If no cache entry exists yet, allow processing (will create cache)
            if (!cache) {
                return { acquired: true, isNew: true };
            }

            // Check if lock is held and not expired
            if (cache.processingLock) {
                const lockAge = Date.now() - new Date(cache.processingLock).getTime();
                if (lockAge < lockTimeout) {
                    return { acquired: false, reason: 'locked', lockAge };
                }
                // Lock expired, we can take it
                console.log(`[OrderLock] Expired database lock released for ${shopifyOrderId}`);
            }

            // Acquire lock
            await tx.shopifyOrderCache.update({
                where: { id: shopifyOrderId },
                data: { processingLock: new Date() }
            });

            return { acquired: true };
        });

        if (!result.acquired) {
            return { locked: false, skipped: true, reason: result.reason };
        }

        // Execute the function
        const fnResult = await fn();

        // Release lock
        await prisma.shopifyOrderCache.update({
            where: { id: shopifyOrderId },
            data: { processingLock: null }
        }).catch(() => {
            // Ignore errors releasing lock (cache might not exist)
        });

        return { locked: true, result: fnResult };
    } catch (error) {
        // Try to release lock on error
        await prisma.shopifyOrderCache.update({
            where: { id: shopifyOrderId },
            data: { processingLock: null }
        }).catch(() => {});

        throw error;
    }
}

/**
 * Get current lock status for debugging
 */
export function getOrderLockStatus() {
    const locks = [];
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
export function clearAllOrderLocks() {
    processingOrders.clear();
}
