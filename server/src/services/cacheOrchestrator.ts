/**
 * @module cacheOrchestrator
 * Centralized cache invalidation orchestrator.
 *
 * This module provides a unified interface for cache invalidation, ensuring
 * consistency across all cache layers when mutations occur.
 *
 * Key features:
 * - Single entry point for all cache invalidations
 * - InvalidationCollector for gathering targets during transactions
 * - Context-based invalidation (skuIds, customerIds, orderIds)
 *
 * Usage:
 * ```typescript
 * import { InvalidationCollector } from '../services/cacheOrchestrator.js';
 *
 * const collector = new InvalidationCollector();
 *
 * await prisma.$transaction(async (tx) => {
 *     // Do mutations...
 *     collector.addSku(skuId);
 *     collector.addCustomer(customerId);
 * });
 *
 * // After transaction succeeds
 * collector.commit();
 * ```
 *
 * IMPORTANT: Always call commit() AFTER the transaction completes successfully.
 * Do NOT call it inside the transaction - if the transaction rolls back,
 * you don't want caches invalidated for changes that didn't persist.
 */

import { inventoryBalanceCache } from './inventoryBalanceCache.js';
import { customerStatsCache } from './customerStatsCache.js';

/**
 * Context for cache invalidation.
 * Each field represents a set of entity IDs that need cache refresh.
 */
export interface InvalidationContext {
    /** SKU IDs that had inventory changes */
    skuIds?: string[];
    /** Customer IDs that had order/stats changes */
    customerIds?: string[];
    /** Order IDs (reserved for future order cache) */
    orderIds?: string[];
}

/**
 * Invalidate all relevant caches based on context.
 * Call this AFTER a mutation transaction completes.
 *
 * @param ctx - Context containing IDs of entities to invalidate
 *
 * @example
 * // After a simple mutation
 * invalidateCaches({ skuIds: ['sku-1', 'sku-2'] });
 *
 * @example
 * // After an order mutation affecting inventory and customer stats
 * invalidateCaches({
 *     skuIds: orderLines.map(l => l.skuId),
 *     customerIds: [order.customerId],
 *     orderIds: [order.id],
 * });
 */
export function invalidateCaches(ctx: InvalidationContext): void {
    if (ctx.skuIds?.length) {
        inventoryBalanceCache.invalidate(ctx.skuIds);
    }
    if (ctx.customerIds?.length) {
        customerStatsCache.invalidate(ctx.customerIds);
    }
    // orderIds reserved for future order cache implementation
    // When an order cache is added, invalidate it here
}

/**
 * Invalidate all caches completely.
 * Use sparingly - typically for bulk operations or cache reset.
 */
export function invalidateAllCaches(): void {
    inventoryBalanceCache.invalidateAll();
    customerStatsCache.invalidateAll();
}

/**
 * Collector class for gathering cache invalidation targets during a transaction.
 *
 * Create at the start of a mutation, add targets as you go, commit after transaction.
 * This pattern ensures:
 * 1. All affected entities are tracked in one place
 * 2. Deduplication happens automatically (uses Sets internally)
 * 3. Invalidation is deferred until after transaction success
 *
 * @example
 * const collector = new InvalidationCollector();
 *
 * await prisma.$transaction(async (tx) => {
 *     // Create inventory transaction
 *     await tx.inventoryTransaction.create({ data: { skuId, ... } });
 *     collector.addSku(skuId);
 *
 *     // Update customer order count
 *     await tx.customer.update({ where: { id: customerId }, ... });
 *     collector.addCustomer(customerId);
 * });
 *
 * // Transaction succeeded - now invalidate caches
 * collector.commit();
 */
export class InvalidationCollector {
    private skuIds = new Set<string>();
    private customerIds = new Set<string>();
    private orderIds = new Set<string>();

    /**
     * Add a single SKU ID to invalidate
     * @returns this for chaining
     */
    addSku(id: string): this {
        this.skuIds.add(id);
        return this;
    }

    /**
     * Add multiple SKU IDs to invalidate
     * @returns this for chaining
     */
    addSkus(ids: string[]): this {
        for (const id of ids) {
            this.skuIds.add(id);
        }
        return this;
    }

    /**
     * Add a single customer ID to invalidate
     * @returns this for chaining
     */
    addCustomer(id: string): this {
        this.customerIds.add(id);
        return this;
    }

    /**
     * Add multiple customer IDs to invalidate
     * @returns this for chaining
     */
    addCustomers(ids: string[]): this {
        for (const id of ids) {
            this.customerIds.add(id);
        }
        return this;
    }

    /**
     * Add a single order ID to invalidate (reserved for future order cache)
     * @returns this for chaining
     */
    addOrder(id: string): this {
        this.orderIds.add(id);
        return this;
    }

    /**
     * Add multiple order IDs to invalidate (reserved for future order cache)
     * @returns this for chaining
     */
    addOrders(ids: string[]): this {
        for (const id of ids) {
            this.orderIds.add(id);
        }
        return this;
    }

    /**
     * Check if any invalidations are pending
     */
    hasInvalidations(): boolean {
        return this.skuIds.size > 0 || this.customerIds.size > 0 || this.orderIds.size > 0;
    }

    /**
     * Execute all cache invalidations.
     * Call this AFTER the transaction commits.
     *
     * Safe to call multiple times (idempotent) but each call will
     * re-invalidate all collected IDs.
     */
    commit(): void {
        invalidateCaches({
            skuIds: Array.from(this.skuIds),
            customerIds: Array.from(this.customerIds),
            orderIds: Array.from(this.orderIds),
        });
    }

    /**
     * Execute invalidations and clear the collector for reuse.
     * Useful if you want to reuse the same collector instance.
     */
    commitAndReset(): void {
        this.commit();
        this.reset();
    }

    /**
     * Clear all collected IDs without committing.
     * Use this if the transaction was rolled back.
     */
    reset(): void {
        this.skuIds.clear();
        this.customerIds.clear();
        this.orderIds.clear();
    }

    /**
     * Get the context without committing.
     * Useful for debugging or logging.
     */
    getContext(): InvalidationContext {
        return {
            skuIds: Array.from(this.skuIds),
            customerIds: Array.from(this.customerIds),
            orderIds: Array.from(this.orderIds),
        };
    }

    /**
     * Get a summary of collected invalidations.
     * Useful for logging.
     */
    getSummary(): string {
        const parts: string[] = [];
        if (this.skuIds.size > 0) {
            parts.push(`${this.skuIds.size} SKUs`);
        }
        if (this.customerIds.size > 0) {
            parts.push(`${this.customerIds.size} customers`);
        }
        if (this.orderIds.size > 0) {
            parts.push(`${this.orderIds.size} orders`);
        }
        return parts.length > 0 ? parts.join(', ') : 'none';
    }
}
