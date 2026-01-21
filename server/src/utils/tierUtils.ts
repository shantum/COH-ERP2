/**
 * Customer Tier Utilities
 *
 * SIMPLE MODEL:
 * - Customer.ltv is stored and updated incrementally
 * - Tier is calculated from stored ltv (no expensive aggregation)
 * - adjustCustomerLtv() for incremental changes (fast)
 * - recalculateCustomerLtv() for full recalc (slow, use sparingly)
 *
 * ARCHITECTURE:
 * - Pure tier calculation logic lives in @coh/shared/domain (shared layer)
 * - This file contains Prisma-dependent database operations
 * - Types and pure functions are re-exported for backward compatibility
 */

import type { PrismaClient } from '@prisma/client';
import { customerStatsCache } from '../services/customerStatsCache.js';

// Import pure functions and types from shared domain layer
import {
    calculateTierFromLtv,
    DEFAULT_TIER_THRESHOLDS,
    type CustomerTier,
    type TierThresholds,
} from '@coh/shared/domain';

// ============================================
// RE-EXPORTS FROM SHARED (for backward compatibility)
// ============================================

export type { CustomerTier, TierThresholds };
export { DEFAULT_TIER_THRESHOLDS };

/**
 * Calculate tier from LTV (alias for backward compatibility)
 * @deprecated Use calculateTierFromLtv from @coh/shared/domain directly
 */
export const calculateTier = calculateTierFromLtv;

// ============================================
// TYPES (server-specific)
// ============================================

export interface TierUpdateResult {
    updated: boolean;
    oldTier: CustomerTier | null;
    newTier: CustomerTier | null;
    ltv: number;
}

// ============================================
// THRESHOLD CACHE (server-specific)
// ============================================

// Cache tier thresholds (they rarely change)
let cachedThresholds: TierThresholds | null = null;

/**
 * Get tier thresholds from database (cached)
 * Falls back to DEFAULT_TIER_THRESHOLDS if not configured
 */
export async function getTierThresholds(prisma: PrismaClient): Promise<TierThresholds> {
    if (cachedThresholds) return cachedThresholds;

    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'tier_thresholds' }
        });
        if (setting?.value) {
            cachedThresholds = JSON.parse(setting.value) as TierThresholds;
            return cachedThresholds;
        }
    } catch (error) {
        console.error('Error fetching tier thresholds:', error);
    }
    cachedThresholds = DEFAULT_TIER_THRESHOLDS;
    return cachedThresholds;
}

/**
 * FAST: Adjust customer LTV by delta and update tier
 * Use for cancel/uncancel line operations
 *
 * @param delta - Amount to add (positive) or subtract (negative)
 */
export async function adjustCustomerLtv(
    prisma: PrismaClient,
    customerId: string,
    delta: number
): Promise<TierUpdateResult> {
    if (!customerId || delta === 0) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const thresholds = await getTierThresholds(prisma);

    // Single query: get current state
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { tier: true, ltv: true }
    });

    if (!customer) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const oldTier = (customer.tier || 'bronze') as CustomerTier;
    const newLtv = Math.max(0, (customer.ltv || 0) + delta); // Never go negative
    const newTier = calculateTier(newLtv, thresholds);

    // Single update with both ltv and tier
    await prisma.customer.update({
        where: { id: customerId },
        data: {
            ltv: newLtv,
            tier: newTier
        }
    });

    if (newTier !== oldTier) {
        console.log(`[Tier] Customer ${customerId}: ${oldTier} → ${newTier} (LTV: ₹${newLtv.toLocaleString()})`);
    }

    return { updated: newTier !== oldTier, oldTier, newTier, ltv: newLtv };
}

/**
 * FAST: Update tier from stored LTV (no recalculation)
 * Use when you know LTV is already correct
 */
export async function updateCustomerTier(
    prisma: PrismaClient,
    customerId: string
): Promise<TierUpdateResult> {
    if (!customerId) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const thresholds = await getTierThresholds(prisma);

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { tier: true, ltv: true }
    });

    if (!customer) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const oldTier = (customer.tier || 'bronze') as CustomerTier;
    const ltv = customer.ltv || 0;
    const newTier = calculateTier(ltv, thresholds);

    if (newTier !== oldTier) {
        await prisma.customer.update({
            where: { id: customerId },
            data: { tier: newTier }
        });
        console.log(`[Tier] Customer ${customerId}: ${oldTier} → ${newTier} (LTV: ₹${ltv.toLocaleString()})`);
        return { updated: true, oldTier, newTier, ltv };
    }

    return { updated: false, oldTier, newTier, ltv };
}

/**
 * SLOW: Full recalculation of customer LTV from orders
 * Use for: backfill, corrections, RTO adjustments
 */
export async function recalculateCustomerLtv(
    prisma: PrismaClient,
    customerId: string
): Promise<TierUpdateResult> {
    if (!customerId) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const thresholds = await getTierThresholds(prisma);

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { tier: true, ltv: true }
    });

    if (!customer) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const oldTier = (customer.tier || 'bronze') as CustomerTier;

    // Full aggregate - exclude cancelled orders and orders where ALL lines are RTO
    // RTO status is now on OrderLine, not Order
    const stats = await prisma.order.aggregate({
        where: {
            customerId,
            status: { not: 'cancelled' },
            // Exclude orders where ALL lines are RTO
            NOT: {
                orderLines: {
                    every: {
                        trackingStatus: { in: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] }
                    }
                }
            },
            totalAmount: { gt: 0 }
        },
        _sum: { totalAmount: true }
    });

    const newLtv = stats._sum?.totalAmount || 0;
    const newTier = calculateTier(newLtv, thresholds);

    await prisma.customer.update({
        where: { id: customerId },
        data: { ltv: newLtv, tier: newTier }
    });

    if (newTier !== oldTier) {
        console.log(`[Tier] Customer ${customerId} recalc: ${oldTier} → ${newTier} (LTV: ₹${newLtv.toLocaleString()})`);
    }

    return { updated: newTier !== oldTier, oldTier, newTier, ltv: newLtv };
}

// ============================================
// ORDER COUNT MAINTENANCE
// ============================================

/**
 * Increment customer's orderCount (call when creating non-cancelled order)
 */
export async function incrementCustomerOrderCount(
    prisma: PrismaClient,
    customerId: string
): Promise<void> {
    if (!customerId) return;
    await prisma.customer.update({
        where: { id: customerId },
        data: { orderCount: { increment: 1 } }
    });
}

/**
 * Decrement customer's orderCount (call when cancelling order)
 */
export async function decrementCustomerOrderCount(
    prisma: PrismaClient,
    customerId: string
): Promise<void> {
    if (!customerId) return;
    // Use raw SQL to prevent going below 0
    await prisma.$executeRaw`
        UPDATE "Customer"
        SET "orderCount" = GREATEST(0, "orderCount" - 1)
        WHERE id = ${customerId}::uuid
    `;
}

/**
 * Adjust orderCount by delta (positive or negative)
 * Safe: will not go below 0
 */
export async function adjustCustomerOrderCount(
    prisma: PrismaClient,
    customerId: string,
    delta: number
): Promise<void> {
    if (!customerId || delta === 0) return;

    if (delta > 0) {
        await prisma.customer.update({
            where: { id: customerId },
            data: { orderCount: { increment: delta } }
        });
    } else {
        // Decrement but don't go below 0
        await prisma.$executeRaw`
            UPDATE "Customer"
            SET "orderCount" = GREATEST(0, "orderCount" + ${delta})
            WHERE id = ${customerId}::uuid
        `;
    }
}

// ============================================
// BATCH OPERATIONS
// ============================================

/**
 * Batch recalculate all customer LTVs and orderCounts
 * Run as maintenance job after backfill or corrections
 */
export async function recalculateAllCustomerLtvs(prisma: PrismaClient): Promise<{ total: number; updated: number }> {
    const CHUNK_SIZE = 1000;
    const thresholds = await getTierThresholds(prisma);

    const totalCount = await prisma.customer.count();
    console.log(`[Tier] Recalculating LTV and orderCount for ${totalCount} customers`);

    let processed = 0;
    let updated = 0;

    while (processed < totalCount) {
        const customers = await prisma.customer.findMany({
            select: { id: true },
            skip: processed,
            take: CHUNK_SIZE
        });

        if (customers.length === 0) break;

        const customerIds = customers.map(c => c.id);

        // Get LTV and order counts in parallel
        const [ltvStats, countStats] = await Promise.all([
            // LTV: sum of non-cancelled, non-RTO orders
            // RTO status is now on OrderLine, not Order
            prisma.order.groupBy({
                by: ['customerId'],
                where: {
                    customerId: { in: customerIds },
                    status: { not: 'cancelled' },
                    // Exclude orders where ALL lines are RTO
                    NOT: {
                        orderLines: {
                            every: {
                                trackingStatus: { in: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] }
                            }
                        }
                    },
                    totalAmount: { gt: 0 }
                },
                _sum: { totalAmount: true }
            }),
            // Order count: count of non-cancelled orders
            prisma.order.groupBy({
                by: ['customerId'],
                where: {
                    customerId: { in: customerIds },
                    status: { not: 'cancelled' }
                },
                _count: { id: true }
            })
        ]);

        // Build maps
        const ltvMap = new Map<string, number>();
        for (const stat of ltvStats) {
            if (stat.customerId) {
                ltvMap.set(stat.customerId, stat._sum?.totalAmount || 0);
            }
        }

        const countMap = new Map<string, number>();
        for (const stat of countStats) {
            if (stat.customerId) {
                countMap.set(stat.customerId, stat._count.id || 0);
            }
        }

        // Update all customers in chunk
        const updates = customerIds.map(id => {
            const ltv = ltvMap.get(id) || 0;
            const orderCount = countMap.get(id) || 0;
            return prisma.customer.update({
                where: { id },
                data: { ltv, orderCount, tier: calculateTier(ltv, thresholds) }
            });
        });

        await prisma.$transaction(updates);

        processed += customers.length;
        updated += updates.length;
        console.log(`[Tier] Processed ${processed}/${totalCount}`);
    }

    console.log(`[Tier] Batch complete: ${updated} customers updated`);
    return { total: totalCount, updated };
}

// ============================================
// LEGACY EXPORTS (for compatibility)
// ============================================

export interface CustomerStats {
    ltv: number;
    orderCount: number;
    rtoCount: number;
}

export interface OrderForLTV {
    status: string;
    totalAmount: number | null;
}

export function calculateLTV(orders: OrderForLTV[]): number {
    if (!orders || orders.length === 0) return 0;
    const validOrders = orders.filter(o => o.status !== 'cancelled');
    return validOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
}

/**
 * Get stats for multiple customers (used by order list enrichment)
 * Uses in-memory cache (2 min TTL) to avoid repeated DB queries
 */
export async function getCustomerStatsMap(
    prisma: PrismaClient,
    customerIds: string[]
): Promise<Record<string, CustomerStats>> {
    if (!customerIds || customerIds.length === 0) return {};

    // Use cache - handles batch fetch for uncached IDs internally
    const cachedStats = await customerStatsCache.get(prisma, customerIds);

    // Convert to CustomerStats format (without cachedAt)
    const statsMap: Record<string, CustomerStats> = {};
    for (const [id, stats] of Object.entries(cachedStats)) {
        statsMap[id] = {
            ltv: stats.ltv,
            orderCount: stats.orderCount,
            rtoCount: stats.rtoCount,
        };
    }

    // Fill missing with defaults (cache already handles this, but be safe)
    for (const id of customerIds) {
        if (!statsMap[id]) {
            statsMap[id] = { ltv: 0, orderCount: 0, rtoCount: 0 };
        }
    }

    return statsMap;
}

// Alias for backward compatibility
export const updateAllCustomerTiers = recalculateAllCustomerLtvs;

/**
 * Startup check: backfill LTVs if needed
 * Runs once on server start, checks if any customers with orders have ltv=0
 */
export async function backfillLtvsIfNeeded(prisma: PrismaClient): Promise<void> {
    // Check if any customers with orders still have ltv=0
    const needsBackfill = await prisma.customer.findFirst({
        where: {
            ltv: 0,
            orders: { some: { status: { not: 'cancelled' }, totalAmount: { gt: 0 } } }
        },
        select: { id: true }
    });

    if (needsBackfill) {
        console.log('[Tier] Found customers with orders but ltv=0, starting background backfill...');
        // Run in background (don't await) so server starts immediately
        recalculateAllCustomerLtvs(prisma).catch(err => {
            console.error('[Tier] Backfill error:', err);
        });
    } else {
        console.log('[Tier] Customer LTVs are up to date');
    }
}
