/**
 * Order Lock Tests
 *
 * Tests for the order lock logic that prevents race conditions when
 * processing Shopify orders from multiple sources (webhooks vs sync).
 *
 * Tests pure logic without module mocking.
 *
 * Test Coverage:
 * 1. In-memory lock acquisition and release logic
 * 2. Lock expiry handling
 * 3. Lock status reporting
 * 4. Concurrent lock prevention
 */

describe('Order Lock Logic', () => {
    // ============================================
    // SECTION 1: Lock Manager Logic
    // ============================================

    describe('Lock Manager Logic', () => {
        /**
         * Simulates in-memory order lock manager
         */
        class TestLockManager {
            constructor(timeoutMs = 90000) {
                this.locks = new Map();
                this.timeoutMs = timeoutMs;
            }

            acquire(orderId, source = 'unknown') {
                const lockKey = `order:${orderId}`;
                const existing = this.locks.get(lockKey);

                if (existing) {
                    // Check if lock has expired
                    if (Date.now() - existing.acquiredAt > this.timeoutMs) {
                        this.locks.delete(lockKey);
                    } else {
                        return false;
                    }
                }

                this.locks.set(lockKey, {
                    source,
                    acquiredAt: Date.now(),
                });

                return true;
            }

            release(orderId) {
                const lockKey = `order:${orderId}`;
                this.locks.delete(lockKey);
            }

            getStatus() {
                const now = Date.now();
                const status = [];
                for (const [key, value] of this.locks.entries()) {
                    status.push({
                        orderId: key.replace('order:', ''),
                        source: value.source,
                        age: Math.round((now - value.acquiredAt) / 1000),
                        expired: (now - value.acquiredAt) > this.timeoutMs,
                    });
                }
                return status;
            }

            clearAll() {
                this.locks.clear();
            }
        }

        let lockManager;

        beforeEach(() => {
            lockManager = new TestLockManager(1000); // 1 second timeout for tests
        });

        it('should acquire lock for new order', () => {
            const result = lockManager.acquire('order-123', 'webhook');
            expect(result).toBe(true);
        });

        it('should block concurrent lock on same order', () => {
            lockManager.acquire('order-123', 'webhook');
            const result = lockManager.acquire('order-123', 'sync');
            expect(result).toBe(false);
        });

        it('should allow locks on different orders', () => {
            const result1 = lockManager.acquire('order-123', 'webhook');
            const result2 = lockManager.acquire('order-456', 'sync');
            expect(result1).toBe(true);
            expect(result2).toBe(true);
        });

        it('should release lock correctly', () => {
            lockManager.acquire('order-123', 'webhook');
            lockManager.release('order-123');
            const result = lockManager.acquire('order-123', 'sync');
            expect(result).toBe(true);
        });

        it('should handle releasing non-existent lock', () => {
            expect(() => lockManager.release('non-existent')).not.toThrow();
        });

        it('should release expired locks automatically on acquire', async () => {
            lockManager.acquire('order-123', 'webhook');

            // Wait for lock to expire
            await new Promise(resolve => setTimeout(resolve, 1100));

            // Should be able to acquire after expiry
            const result = lockManager.acquire('order-123', 'sync');
            expect(result).toBe(true);
        });

        it('should not release fresh locks', async () => {
            lockManager.acquire('order-123', 'webhook');

            // Wait less than timeout
            await new Promise(resolve => setTimeout(resolve, 500));

            // Should still be blocked
            const result = lockManager.acquire('order-123', 'sync');
            expect(result).toBe(false);
        });
    });

    // ============================================
    // SECTION 2: Lock Status Reporting
    // ============================================

    describe('Lock Status Reporting', () => {
        const getLockStatus = (locks, timeoutMs, now) => {
            return locks.map(lock => ({
                orderId: lock.orderId,
                source: lock.source,
                age: Math.round((now - lock.acquiredAt) / 1000),
                expired: (now - lock.acquiredAt) > timeoutMs,
            }));
        };

        it('should return empty array when no locks', () => {
            expect(getLockStatus([], 90000, Date.now())).toEqual([]);
        });

        it('should calculate age in seconds', () => {
            const now = Date.now();
            const locks = [{ orderId: '123', source: 'webhook', acquiredAt: now - 5000 }];
            const status = getLockStatus(locks, 90000, now);
            expect(status[0].age).toBe(5);
        });

        it('should mark expired locks', () => {
            const now = Date.now();
            const locks = [{ orderId: '123', source: 'webhook', acquiredAt: now - 100000 }];
            const status = getLockStatus(locks, 90000, now);
            expect(status[0].expired).toBe(true);
        });

        it('should mark fresh locks as not expired', () => {
            const now = Date.now();
            const locks = [{ orderId: '123', source: 'webhook', acquiredAt: now - 1000 }];
            const status = getLockStatus(locks, 90000, now);
            expect(status[0].expired).toBe(false);
        });

        it('should preserve source information', () => {
            const now = Date.now();
            const locks = [
                { orderId: '123', source: 'webhook', acquiredAt: now },
                { orderId: '456', source: 'sync', acquiredAt: now },
            ];
            const status = getLockStatus(locks, 90000, now);
            expect(status.find(l => l.orderId === '123').source).toBe('webhook');
            expect(status.find(l => l.orderId === '456').source).toBe('sync');
        });
    });

    // ============================================
    // SECTION 3: Lock Key Generation
    // ============================================

    describe('Lock Key Generation', () => {
        const generateLockKey = (orderId) => `order:${orderId}`;
        const extractOrderId = (lockKey) => lockKey.replace('order:', '');

        it('should generate consistent lock keys', () => {
            expect(generateLockKey('123')).toBe('order:123');
            expect(generateLockKey('shopify-abc')).toBe('order:shopify-abc');
        });

        it('should extract order ID from lock key', () => {
            expect(extractOrderId('order:123')).toBe('123');
            expect(extractOrderId('order:shopify-abc')).toBe('shopify-abc');
        });
    });

    // ============================================
    // SECTION 4: Lock Timeout Calculation
    // ============================================

    describe('Lock Timeout Calculation', () => {
        const isLockExpired = (acquiredAt, timeoutMs, now) => {
            return (now - acquiredAt) > timeoutMs;
        };

        it('should detect expired locks', () => {
            const acquiredAt = Date.now() - 100000;
            expect(isLockExpired(acquiredAt, 90000, Date.now())).toBe(true);
        });

        it('should detect fresh locks', () => {
            const acquiredAt = Date.now() - 1000;
            expect(isLockExpired(acquiredAt, 90000, Date.now())).toBe(false);
        });

        it('should handle edge case at timeout boundary', () => {
            const now = Date.now();
            const acquiredAt = now - 90001;
            expect(isLockExpired(acquiredAt, 90000, now)).toBe(true);
        });

        it('should handle lock acquired at exact timeout', () => {
            const now = Date.now();
            const acquiredAt = now - 90000;
            expect(isLockExpired(acquiredAt, 90000, now)).toBe(false);
        });
    });

    // ============================================
    // SECTION 5: Database Lock Logic
    // ============================================

    describe('Database Lock Logic', () => {
        const shouldAcquireDatabaseLock = (processingLock, timeoutMs, now) => {
            if (!processingLock) return true;
            const lockAge = now - new Date(processingLock).getTime();
            return lockAge >= timeoutMs;
        };

        it('should acquire lock when none exists', () => {
            expect(shouldAcquireDatabaseLock(null, 90000, Date.now())).toBe(true);
        });

        it('should acquire lock when expired', () => {
            const expiredLock = new Date(Date.now() - 100000).toISOString();
            expect(shouldAcquireDatabaseLock(expiredLock, 90000, Date.now())).toBe(true);
        });

        it('should NOT acquire lock when fresh', () => {
            const freshLock = new Date(Date.now() - 1000).toISOString();
            expect(shouldAcquireDatabaseLock(freshLock, 90000, Date.now())).toBe(false);
        });

        it('should handle ISO date strings', () => {
            const isoDate = '2026-01-14T10:00:00.000Z';
            const lockTime = new Date(isoDate).getTime();
            const now = lockTime + 100000;
            expect(shouldAcquireDatabaseLock(isoDate, 90000, now)).toBe(true);
        });
    });

    // ============================================
    // SECTION 6: Two-Tier Locking Strategy
    // ============================================

    describe('Two-Tier Locking Strategy', () => {
        /**
         * Two-tier lock check: in-memory first, then database
         */
        const canAcquireLock = (inMemoryLocked, dbProcessingLock, timeoutMs, now) => {
            // Tier 1: In-memory check (fast path)
            if (inMemoryLocked) {
                return { canAcquire: false, reason: 'in_memory_lock' };
            }

            // Tier 2: Database check (distributed)
            if (dbProcessingLock) {
                const lockAge = now - new Date(dbProcessingLock).getTime();
                if (lockAge < timeoutMs) {
                    return { canAcquire: false, reason: 'database_lock' };
                }
            }

            return { canAcquire: true };
        };

        it('should block on in-memory lock (fast path)', () => {
            const result = canAcquireLock(true, null, 90000, Date.now());
            expect(result.canAcquire).toBe(false);
            expect(result.reason).toBe('in_memory_lock');
        });

        it('should block on fresh database lock', () => {
            const freshDbLock = new Date(Date.now() - 1000).toISOString();
            const result = canAcquireLock(false, freshDbLock, 90000, Date.now());
            expect(result.canAcquire).toBe(false);
            expect(result.reason).toBe('database_lock');
        });

        it('should allow when no locks exist', () => {
            const result = canAcquireLock(false, null, 90000, Date.now());
            expect(result.canAcquire).toBe(true);
        });

        it('should allow when database lock is expired', () => {
            const expiredDbLock = new Date(Date.now() - 100000).toISOString();
            const result = canAcquireLock(false, expiredDbLock, 90000, Date.now());
            expect(result.canAcquire).toBe(true);
        });

        it('should prioritize in-memory over database', () => {
            // Even if DB lock is expired, in-memory lock should take precedence
            const expiredDbLock = new Date(Date.now() - 100000).toISOString();
            const result = canAcquireLock(true, expiredDbLock, 90000, Date.now());
            expect(result.canAcquire).toBe(false);
            expect(result.reason).toBe('in_memory_lock');
        });
    });
});
