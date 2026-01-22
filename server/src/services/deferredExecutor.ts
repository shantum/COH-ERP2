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

/**
 * Optional metadata for task identification in error logs
 * Helps debugging by providing context about which entity caused a failure
 */
export interface TaskMetadata {
    orderId?: string;
    lineId?: string;
    skuId?: string;
    action?: string;
}

interface QueuedTask {
    task: DeferredTask;
    metadata?: TaskMetadata;
}

interface TaskStats {
    queued: number;
    completed: number;
    failed: number;
}

class DeferredExecutor {
    private queue: QueuedTask[] = [];
    private processing = false;
    private stats: TaskStats = { queued: 0, completed: 0, failed: 0 };

    /**
     * Add a task to the deferred execution queue
     * Task will run after current synchronous code completes
     *
     * @param task - The async task to execute
     * @param metadata - Optional metadata for error logging (orderId, lineId, skuId, action)
     */
    enqueue(task: DeferredTask, metadata?: TaskMetadata): void {
        this.queue.push({ task, metadata });
        this.stats.queued++;

        // Start processing if not already running
        if (!this.processing) {
            setImmediate(() => this.process());
        }
    }

    /**
     * Add multiple tasks to execute in sequence
     *
     * @param tasks - Array of tasks with optional metadata
     */
    enqueueAll(tasks: Array<{ task: DeferredTask; metadata?: TaskMetadata }>): void {
        for (const { task, metadata } of tasks) {
            this.enqueue(task, metadata);
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
            const queuedTask = this.queue.shift();
            if (!queuedTask) continue;

            const { task, metadata } = queuedTask;

            try {
                await task();
                this.stats.completed++;
            } catch (err) {
                this.stats.failed++;
                if (metadata && Object.keys(metadata).length > 0) {
                    console.error('[DeferredExecutor] Task failed:', { ...metadata, error: err });
                } else {
                    console.error('[DeferredExecutor] Task failed:', err);
                }
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
