/**
 * Sync Services Tests
 * 
 * Tests for:
 * - Sync job logic
 * - Error recovery
 * - Rate limit handling
 * - Idempotency
 */

// ============================================
// SECTION 1: SYNC JOB SCHEDULING
// ============================================

describe('Sync Scheduling - Interval Calculation', () => {
    const calculateNextSyncTime = (lastSync, intervalMinutes) => {
        if (!lastSync) return new Date(); // Immediate
        const lastSyncTime = new Date(lastSync);
        return new Date(lastSyncTime.getTime() + intervalMinutes * 60 * 1000);
    };

    it('should calculate next sync time', () => {
        const lastSync = new Date('2026-01-08T10:00:00Z');
        const next = calculateNextSyncTime(lastSync, 15);
        expect(next.getTime()).toBe(new Date('2026-01-08T10:15:00Z').getTime());
    });

    it('should return now for first sync', () => {
        const now = Date.now();
        const next = calculateNextSyncTime(null, 15);
        expect(next.getTime()).toBeGreaterThanOrEqual(now - 1000);
    });
});

describe('Sync Scheduling - Should Sync Check', () => {
    const shouldSync = (lastSync, intervalMinutes, now = new Date()) => {
        if (!lastSync) return true;
        const elapsed = now.getTime() - new Date(lastSync).getTime();
        return elapsed >= intervalMinutes * 60 * 1000;
    };

    it('should sync if never synced', () => {
        expect(shouldSync(null, 15)).toBe(true);
    });

    it('should sync if interval passed', () => {
        const lastSync = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago
        expect(shouldSync(lastSync, 15)).toBe(true);
    });

    it('should NOT sync if too soon', () => {
        const lastSync = new Date(Date.now() - 5 * 60 * 1000); // 5 mins ago
        expect(shouldSync(lastSync, 15)).toBe(false);
    });
});

// ============================================
// SECTION 2: RATE LIMIT HANDLING
// ============================================

describe('Rate Limit - Detection', () => {
    const isRateLimited = (response) => {
        if (response.status === 429) return true;
        const remaining = response.headers?.['x-shopify-shop-api-call-limit'];
        if (remaining) {
            const [used, total] = remaining.split('/').map(Number);
            return used >= total - 2; // Buffer of 2
        }
        return false;
    };

    it('should detect 429 status', () => {
        expect(isRateLimited({ status: 429 })).toBe(true);
    });

    it('should detect near-limit from header', () => {
        const response = {
            status: 200,
            headers: { 'x-shopify-shop-api-call-limit': '38/40' }
        };
        expect(isRateLimited(response)).toBe(true);
    });

    it('should NOT flag when under limit', () => {
        const response = {
            status: 200,
            headers: { 'x-shopify-shop-api-call-limit': '20/40' }
        };
        expect(isRateLimited(response)).toBe(false);
    });
});

describe('Rate Limit - Backoff Calculation', () => {
    const calculateBackoff = (attempt, baseDelayMs = 1000) => {
        // Exponential backoff with jitter
        const delay = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 0.3 * delay;
        return Math.min(delay + jitter, 30000); // Max 30 seconds
    };

    it('should increase delay exponentially', () => {
        const delay1 = calculateBackoff(0, 1000);
        const delay2 = calculateBackoff(1, 1000);
        const delay3 = calculateBackoff(2, 1000);

        expect(delay1).toBeLessThan(delay2);
        expect(delay2).toBeLessThan(delay3);
    });

    it('should cap at 30 seconds', () => {
        const delay = calculateBackoff(10, 1000);
        expect(delay).toBeLessThanOrEqual(30000);
    });
});

// ============================================
// SECTION 3: ERROR RECOVERY
// ============================================

describe('Error Recovery - Retry Logic', () => {
    const shouldRetry = (error, attempt, maxRetries = 3) => {
        if (attempt >= maxRetries) return false;

        const retryableErrors = [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'EAI_AGAIN'
        ];

        if (error.code && retryableErrors.includes(error.code)) return true;
        if (error.status === 429) return true;
        if (error.status >= 500) return true;

        return false;
    };

    it('should retry on connection reset', () => {
        const error = { code: 'ECONNRESET' };
        expect(shouldRetry(error, 0)).toBe(true);
    });

    it('should retry on 429', () => {
        const error = { status: 429 };
        expect(shouldRetry(error, 0)).toBe(true);
    });

    it('should retry on 5xx', () => {
        const error = { status: 503 };
        expect(shouldRetry(error, 0)).toBe(true);
    });

    it('should NOT retry on 4xx (except 429)', () => {
        const error = { status: 400 };
        expect(shouldRetry(error, 0)).toBe(false);
    });

    it('should NOT retry after max attempts', () => {
        const error = { code: 'ECONNRESET' };
        expect(shouldRetry(error, 3, 3)).toBe(false);
    });
});

describe('Error Recovery - Circuit Breaker', () => {
    const createCircuitBreaker = () => ({
        failures: 0,
        lastFailure: null,
        state: 'closed', // closed, open, half-open
        threshold: 5,
        resetTimeoutMs: 60000
    });

    const recordFailure = (breaker) => {
        breaker.failures++;
        breaker.lastFailure = Date.now();
        if (breaker.failures >= breaker.threshold) {
            breaker.state = 'open';
        }
        return breaker;
    };

    const canRequest = (breaker, now = Date.now()) => {
        if (breaker.state === 'closed') return true;
        if (breaker.state === 'open') {
            if (now - breaker.lastFailure >= breaker.resetTimeoutMs) {
                breaker.state = 'half-open';
                return true;
            }
            return false;
        }
        return true; // half-open allows one request
    };

    it('should allow requests when closed', () => {
        const breaker = createCircuitBreaker();
        expect(canRequest(breaker)).toBe(true);
    });

    it('should open after threshold failures', () => {
        const breaker = createCircuitBreaker();
        for (let i = 0; i < 5; i++) {
            recordFailure(breaker);
        }
        expect(breaker.state).toBe('open');
    });

    it('should block requests when open', () => {
        const breaker = createCircuitBreaker();
        breaker.state = 'open';
        breaker.lastFailure = Date.now();
        expect(canRequest(breaker)).toBe(false);
    });

    it('should allow after reset timeout', () => {
        const breaker = createCircuitBreaker();
        breaker.state = 'open';
        breaker.lastFailure = Date.now() - 70000; // 70 seconds ago
        expect(canRequest(breaker)).toBe(true);
        expect(breaker.state).toBe('half-open');
    });
});

// ============================================
// SECTION 4: SYNC STATE MANAGEMENT
// ============================================

describe('Sync State - Progress Tracking', () => {
    const createSyncProgress = () => ({
        started: new Date(),
        processed: 0,
        total: null,
        failed: 0,
        status: 'running'
    });

    const updateProgress = (progress, result) => {
        if (result.success) {
            progress.processed++;
        } else {
            progress.failed++;
        }
        return progress;
    };

    it('should initialize sync progress', () => {
        const progress = createSyncProgress();
        expect(progress.status).toBe('running');
        expect(progress.processed).toBe(0);
    });

    it('should track successful items', () => {
        const progress = createSyncProgress();
        updateProgress(progress, { success: true });
        updateProgress(progress, { success: true });
        expect(progress.processed).toBe(2);
    });

    it('should track failed items', () => {
        const progress = createSyncProgress();
        updateProgress(progress, { success: false });
        expect(progress.failed).toBe(1);
    });
});

describe('Sync State - Checkpoint', () => {
    const createCheckpoint = (entityType, lastId, lastUpdatedAt) => ({
        entityType,
        lastProcessedId: lastId,
        lastProcessedAt: lastUpdatedAt,
        createdAt: new Date()
    });

    const getResumePoint = (checkpoint) => {
        if (!checkpoint) return { since_id: null, updated_at_min: null };
        return {
            since_id: checkpoint.lastProcessedId,
            updated_at_min: checkpoint.lastProcessedAt
        };
    };

    it('should create checkpoint', () => {
        const checkpoint = createCheckpoint('orders', '12345', new Date());
        expect(checkpoint.entityType).toBe('orders');
        expect(checkpoint.lastProcessedId).toBe('12345');
    });

    it('should get resume point from checkpoint', () => {
        const checkpoint = createCheckpoint('orders', '12345', '2026-01-08T10:00:00Z');
        const resume = getResumePoint(checkpoint);
        expect(resume.since_id).toBe('12345');
    });

    it('should return null for missing checkpoint', () => {
        const resume = getResumePoint(null);
        expect(resume.since_id).toBeNull();
    });
});

// ============================================
// SECTION 5: IDEMPOTENCY
// ============================================

describe('Idempotency - Duplicate Detection', () => {
    const isDuplicate = (entityId, processedSet) => {
        return processedSet.has(entityId);
    };

    const markProcessed = (entityId, processedSet) => {
        processedSet.add(entityId);
    };

    it('should detect duplicate', () => {
        const processed = new Set(['order-1', 'order-2']);
        expect(isDuplicate('order-1', processed)).toBe(true);
    });

    it('should allow new entity', () => {
        const processed = new Set(['order-1']);
        expect(isDuplicate('order-3', processed)).toBe(false);
    });

    it('should mark entity as processed', () => {
        const processed = new Set();
        markProcessed('order-1', processed);
        expect(isDuplicate('order-1', processed)).toBe(true);
    });
});

describe('Idempotency - Order Lock', () => {
    const createLockManager = () => {
        const locks = new Map();
        return {
            acquire: (key, ttlMs = 30000) => {
                if (locks.has(key)) {
                    const lock = locks.get(key);
                    if (Date.now() < lock.expiresAt) {
                        return false; // Lock held
                    }
                }
                locks.set(key, { expiresAt: Date.now() + ttlMs });
                return true;
            },
            release: (key) => {
                locks.delete(key);
            },
            isLocked: (key) => {
                if (!locks.has(key)) return false;
                return Date.now() < locks.get(key).expiresAt;
            }
        };
    };

    it('should acquire lock', () => {
        const manager = createLockManager();
        expect(manager.acquire('order-123')).toBe(true);
    });

    it('should NOT acquire held lock', () => {
        const manager = createLockManager();
        manager.acquire('order-123');
        expect(manager.acquire('order-123')).toBe(false);
    });

    it('should release lock', () => {
        const manager = createLockManager();
        manager.acquire('order-123');
        manager.release('order-123');
        expect(manager.acquire('order-123')).toBe(true);
    });
});

// ============================================
// SECTION 6: BATCH PROCESSING
// ============================================

describe('Batch Processing - Chunking', () => {
    const chunk = (array, size) => {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    };

    it('should split array into chunks', () => {
        const items = [1, 2, 3, 4, 5, 6, 7];
        const chunks = chunk(items, 3);
        expect(chunks.length).toBe(3);
        expect(chunks[0]).toEqual([1, 2, 3]);
        expect(chunks[2]).toEqual([7]);
    });

    it('should handle empty array', () => {
        expect(chunk([], 3)).toEqual([]);
    });
});

describe('Batch Processing - Parallel Execution', () => {
    const processBatch = async (items, processor, concurrency = 5) => {
        const results = [];
        for (let i = 0; i < items.length; i += concurrency) {
            const batch = items.slice(i, i + concurrency);
            const batchResults = await Promise.allSettled(
                batch.map(item => processor(item))
            );
            results.push(...batchResults);
        }
        return results;
    };

    it('should process items in batches', async () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const processor = async (x) => x * 2;
        const results = await processBatch(items, processor, 3);
        expect(results.length).toBe(10);
        expect(results[0].status).toBe('fulfilled');
        expect(results[0].value).toBe(2);
    });

    it('should handle errors gracefully', async () => {
        const items = [1, 2, 3];
        const processor = async (x) => {
            if (x === 2) throw new Error('Failed');
            return x;
        };
        const results = await processBatch(items, processor, 2);
        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
    });
});

// ============================================
// SECTION 7: SYNC METRICS
// ============================================

describe('Sync Metrics - Summary Calculation', () => {
    const calculateSyncSummary = (progress) => {
        const duration = Date.now() - new Date(progress.started).getTime();
        const successRate = progress.processed > 0
            ? ((progress.processed - progress.failed) / progress.processed * 100).toFixed(1)
            : '0.0';

        return {
            duration,
            successRate,
            avgTimePerItem: progress.processed > 0
                ? Math.round(duration / progress.processed)
                : 0
        };
    };

    it('should calculate success rate', () => {
        const progress = {
            started: new Date(Date.now() - 5000),
            processed: 100,
            failed: 5
        };
        const summary = calculateSyncSummary(progress);
        expect(summary.successRate).toBe('95.0');
    });

    it('should calculate average time per item', () => {
        const progress = {
            started: new Date(Date.now() - 10000),
            processed: 100,
            failed: 0
        };
        const summary = calculateSyncSummary(progress);
        expect(summary.avgTimePerItem).toBe(100);
    });
});
