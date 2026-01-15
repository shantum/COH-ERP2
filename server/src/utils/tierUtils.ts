/**
 * Customer Tier Utilities
 *
 * SIMPLE MODEL:
 * - Customer.ltv is stored and updated incrementally
 * - Tier is calculated from stored ltv (no expensive aggregation)
 * - adjustCustomerLtv() for incremental changes (fast)
 * - recalculateCustomerLtv() for full recalc (slow, use sparingly)
 */

import type { PrismaClient } from '@prisma/client';

// ============================================
// TYPES
// ============================================

export type CustomerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface TierThresholds {
    platinum: number;
    gold: number;
    silver: number;
}

export interface TierUpdateResult {
    updated: boolean;
    oldTier: CustomerTier | null;
    newTier: CustomerTier | null;
    ltv: number;
}

// ============================================
// CONSTANTS
// ============================================

export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
    platinum: 50000,
    gold: 25000,
    silver: 10000
};

// Cache tier thresholds (they rarely change)
let cachedThresholds: TierThresholds | null = null;

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Get tier thresholds (cached)
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
 * Calculate tier from LTV
 */
export function calculateTier(ltv: number, thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS): CustomerTier {
    if (ltv >= thresholds.platinum) return 'platinum';
    if (ltv >= thresholds.gold) return 'gold';
    if (ltv >= thresholds.silver) return 'silver';
    return 'bronze';
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

    // Full aggregate - exclude cancelled and RTO orders
    const stats = await prisma.order.aggregate({
        where: {
            customerId,
            status: { not: 'cancelled' },
            OR: [
                { trackingStatus: null },
                { trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] } }
            ],
            totalAmount: { gt: 0 }
        },
        _sum: { totalAmount: true }
    });

    const newLtv = stats._sum.totalAmount || 0;
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
// BATCH OPERATIONS
// ============================================

/**
 * Batch recalculate all customer LTVs
 * Run as maintenance job after backfill or corrections
 */
export async function recalculateAllCustomerLtvs(prisma: PrismaClient): Promise<{ total: number; updated: number }> {
    const CHUNK_SIZE = 1000;
    const thresholds = await getTierThresholds(prisma);

    const totalCount = await prisma.customer.count();
    console.log(`[Tier] Recalculating LTV for ${totalCount} customers`);

    let processed = 0;
    let updated = 0;

    while (processed < totalCount) {
        const customers = await prisma.customer.findMany({
            select: { id: true },
            skip: processed,
            take: CHUNK_SIZE
        });

        if (customers.length === 0) break;

        // Get LTV for all customers in chunk
        const customerIds = customers.map(c => c.id);
        const stats = await prisma.order.groupBy({
            by: ['customerId'],
            where: {
                customerId: { in: customerIds },
                status: { not: 'cancelled' },
                OR: [
                    { trackingStatus: null },
                    { trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] } }
                ],
                totalAmount: { gt: 0 }
            },
            _sum: { totalAmount: true }
        });

        // Build update map
        const ltvMap = new Map<string, number>();
        for (const stat of stats) {
            if (stat.customerId) {
                ltvMap.set(stat.customerId, stat._sum.totalAmount || 0);
            }
        }

        // Update all customers in chunk
        const updates = customerIds.map(id => {
            const ltv = ltvMap.get(id) || 0;
            return prisma.customer.update({
                where: { id },
                data: { ltv, tier: calculateTier(ltv, thresholds) }
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
 */
export async function getCustomerStatsMap(
    prisma: PrismaClient,
    customerIds: string[]
): Promise<Record<string, CustomerStats>> {
    if (!customerIds || customerIds.length === 0) return {};

    // Just read stored LTV from customers
    const customers = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, ltv: true, rtoCount: true }
    });

    // Get order counts
    const orderCounts = await prisma.order.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: { not: 'cancelled' } },
        _count: { id: true }
    });

    const countMap = new Map<string, number>();
    for (const stat of orderCounts) {
        if (stat.customerId) countMap.set(stat.customerId, stat._count.id);
    }

    const statsMap: Record<string, CustomerStats> = {};
    for (const c of customers) {
        statsMap[c.id] = {
            ltv: c.ltv || 0,
            orderCount: countMap.get(c.id) || 0,
            rtoCount: c.rtoCount || 0
        };
    }

    // Fill missing with defaults
    for (const id of customerIds) {
        if (!statsMap[id]) {
            statsMap[id] = { ltv: 0, orderCount: 0, rtoCount: 0 };
        }
    }

    return statsMap;
}

// Alias for backward compatibility
export const updateAllCustomerTiers = recalculateAllCustomerLtvs;
