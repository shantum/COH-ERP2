/**
 * Shutdown Coordinator
 *
 * Manages graceful shutdown for background services.
 * Ensures all registered tasks complete before the process exits.
 */

import { syncLogger } from './logger.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Registered shutdown handler
 */
interface ShutdownHandler {
    name: string;
    handler: () => Promise<void> | void;
    timeout: number;
}

/**
 * Status of a shutdown handler
 */
interface HandlerStatus {
    name: string;
    registered: boolean;
    timeout: number;
}

// ============================================
// SHUTDOWN COORDINATOR CLASS
// ============================================

class ShutdownCoordinator {
    private handlers: Map<string, ShutdownHandler>;
    private isShuttingDown: boolean;

    constructor() {
        this.handlers = new Map();
        this.isShuttingDown = false;
    }

    /**
     * Register a shutdown handler
     * @param name - Unique identifier for the handler
     * @param handler - Async function to call on shutdown
     * @param timeout - Max time to wait for handler (ms), default 10s
     */
    register(name: string, handler: () => Promise<void> | void, timeout = 10000): void {
        if (this.handlers.has(name)) {
            syncLogger.warn({ name }, 'Shutdown handler already registered, replacing');
        }

        this.handlers.set(name, { name, handler, timeout });
        syncLogger.debug({ name, timeout }, 'Shutdown handler registered');
    }

    /**
     * Unregister a shutdown handler
     */
    unregister(name: string): void {
        if (this.handlers.delete(name)) {
            syncLogger.debug({ name }, 'Shutdown handler unregistered');
        }
    }

    /**
     * Check if shutdown is in progress
     */
    isInProgress(): boolean {
        return this.isShuttingDown;
    }

    /**
     * Get status of all registered handlers
     */
    getStatus(): HandlerStatus[] {
        return Array.from(this.handlers.values()).map(h => ({
            name: h.name,
            registered: true,
            timeout: h.timeout,
        }));
    }

    /**
     * Execute all shutdown handlers
     * Waits for all handlers to complete (with timeout)
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            syncLogger.warn('Shutdown already in progress');
            return;
        }

        this.isShuttingDown = true;
        syncLogger.info({ handlerCount: this.handlers.size }, 'Starting graceful shutdown');

        const results: Array<{ name: string; success: boolean; error?: string; duration: number }> = [];

        // Execute all handlers in parallel with individual timeouts
        const promises = Array.from(this.handlers.values()).map(async ({ name, handler, timeout }) => {
            const start = Date.now();

            try {
                // Wrap handler in timeout
                const result = await Promise.race([
                    (async () => {
                        await handler();
                        return { timedOut: false };
                    })(),
                    new Promise<{ timedOut: boolean }>((resolve) =>
                        setTimeout(() => resolve({ timedOut: true }), timeout)
                    ),
                ]);

                if (result.timedOut) {
                    const duration = Date.now() - start;
                    syncLogger.warn({ name, timeout, duration }, 'Shutdown handler timed out');
                    results.push({ name, success: false, error: 'Timeout', duration });
                } else {
                    const duration = Date.now() - start;
                    syncLogger.debug({ name, duration }, 'Shutdown handler completed');
                    results.push({ name, success: true, duration });
                }
            } catch (error: unknown) {
                const duration = Date.now() - start;
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                syncLogger.error({ name, error: errorMsg, duration }, 'Shutdown handler failed');
                results.push({ name, success: false, error: errorMsg, duration });
            }
        });

        await Promise.all(promises);

        // Log summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        syncLogger.info({ successful, failed, total: results.length }, 'Shutdown complete');
    }
}

// ============================================
// EXPORTS
// ============================================

// Export singleton instance
export const shutdownCoordinator = new ShutdownCoordinator();
export default shutdownCoordinator;
