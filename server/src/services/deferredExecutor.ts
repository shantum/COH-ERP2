/**
 * Deferred Executor Service
 *
 * Executes non-critical tasks after the main response is sent.
 * This allows mutations to return immediately while deferring:
 * - Cache invalidation
 * - SSE broadcasts
 * - Customer tier updates
 * - Analytics/logging
 *
 * Tasks are executed via setImmediate to avoid blocking the event loop.
 * Errors are logged but don't affect the calling code.
 *
 * Usage:
 * ```typescript
 * import { deferredExecutor } from './deferredExecutor';
 *
 * // After transaction completes, defer non-critical work
 * const result = await prisma.$transaction([...]);
 *
 * deferredExecutor.enqueue(async () => {
 *   inventoryBalanceCache.invalidate([skuId]);
 *   broadcastOrderUpdate({ type: 'line_status', lineId }, userId);
 * });
 *
 * return result; // Response sent immediately
 * ```
 */

type DeferredTask = () => Promise<void>;

interface TaskStats {
    queued: number;
    completed: number;
    failed: number;
}

class DeferredExecutor {
    private queue: DeferredTask[] = [];
    private processing = false;
    private stats: TaskStats = { queued: 0, completed: 0, failed: 0 };

    /**
     * Add a task to the deferred execution queue
     * Task will run after current synchronous code completes
     */
    enqueue(task: DeferredTask): void {
        this.queue.push(task);
        this.stats.queued++;

        // Start processing if not already running
        if (!this.processing) {
            setImmediate(() => this.process());
        }
    }

    /**
     * Add multiple tasks to execute in sequence
     */
    enqueueAll(tasks: DeferredTask[]): void {
        for (const task of tasks) {
            this.enqueue(task);
        }
    }

    /**
     * Process queued tasks
     * Runs each task in order, catching errors to prevent cascade failures
     */
    private async process(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task) continue;

            try {
                await task();
                this.stats.completed++;
            } catch (err) {
                this.stats.failed++;
                console.error('[DeferredExecutor] Task failed:', err);
            }
        }

        this.processing = false;
    }

    /**
     * Get execution statistics
     */
    getStats(): TaskStats & { pending: number; isProcessing: boolean } {
        return {
            ...this.stats,
            pending: this.queue.length,
            isProcessing: this.processing,
        };
    }

    /**
     * Reset statistics (for testing)
     */
    resetStats(): void {
        this.stats = { queued: 0, completed: 0, failed: 0 };
    }
}

// Export singleton instance
export const deferredExecutor = new DeferredExecutor();

// Export class for testing
export { DeferredExecutor };
