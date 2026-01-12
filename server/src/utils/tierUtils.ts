/**
 * Customer Tier Utilities
 * Centralized tier calculation logic with configurable thresholds
 */

import type { PrismaClient } from '@prisma/client';

// ============================================
// TYPES
// ============================================

/** Customer tier levels (lowest to highest) */
export type CustomerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/** Tier thresholds configuration */
export interface TierThresholds {
    platinum: number;
    gold: number;
    silver: number;
}

/** Customer statistics for tier calculation */
export interface CustomerStats {
    ltv: number;
    orderCount: number;
    rtoCount: number;
}

/** Result of a tier update operation */
export interface TierUpdateResult {
    updated: boolean;
    oldTier: CustomerTier | null;
    newTier: CustomerTier | null;
    ltv: number;
}

/** Individual upgrade record for batch operations */
export interface TierUpgrade {
    customerId: string;
    oldTier: CustomerTier;
    newTier: CustomerTier;
    ltv: number;
}

/** Result of batch tier update */
export interface BatchTierUpdateResult {
    total: number;
    updated: number;
    upgrades: TierUpgrade[];
}

/** Order data for LTV calculation */
export interface OrderForLTV {
    status: string;
    totalAmount: number | null;
}

// ============================================
// CONSTANTS
// ============================================

/** Default thresholds (used if not configured in SystemSettings) */
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
    platinum: 50000,
    gold: 25000,
    silver: 10000
};

// ============================================
// FUNCTIONS
// ============================================

/**
 * Get tier thresholds from SystemSettings or use defaults
 */
export async function getTierThresholds(prisma: PrismaClient): Promise<TierThresholds> {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'tier_thresholds' }
        });
        if (setting?.value) {
            return JSON.parse(setting.value) as TierThresholds;
        }
    } catch (error) {
        console.error('Error fetching tier thresholds:', error);
    }
    return DEFAULT_TIER_THRESHOLDS;
}

/**
 * Calculate customer tier based on LTV and thresholds
 */
export function calculateTier(
    ltv: number,
    thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): CustomerTier {
    if (ltv >= thresholds.platinum) return 'platinum';
    if (ltv >= thresholds.gold) return 'gold';
    if (ltv >= thresholds.silver) return 'silver';
    return 'bronze';
}

/**
 * Calculate LTV for a customer from their orders
 */
export function calculateLTV(orders: OrderForLTV[]): number {
    if (!orders || orders.length === 0) return 0;

    // Only include non-cancelled orders
    const validOrders = orders.filter(o => o.status !== 'cancelled');
    return validOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
}

/**
 * Get LTV, order count, and RTO count map for multiple customers
 * Uses aggregate query for performance - avoids loading all orders
 */
export async function getCustomerStatsMap(
    prisma: PrismaClient,
    customerIds: string[]
): Promise<Record<string, CustomerStats>> {
    if (!customerIds || customerIds.length === 0) return {};

    // Run both queries in parallel for performance
    const [stats, rtoStats] = await Promise.all([
        // LTV and order count query
        // Exclude cancelled orders, RTO orders, and zero-value orders (exchanges, giveaways)
        // Note: trackingStatus can be null for unshipped orders (which should count)
        prisma.order.groupBy({
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
            _sum: { totalAmount: true },
            _count: { id: true }
        }),
        // RTO count query (COD orders only - prepaid RTOs are refunded)
        prisma.order.groupBy({
            by: ['customerId'],
            where: {
                customerId: { in: customerIds },
                paymentMethod: 'COD',
                trackingStatus: { in: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] }
            },
            _count: { id: true }
        })
    ]);

    const statsMap: Record<string, CustomerStats> = {};

    // Initialize all customerIds with defaults (in case some have no orders)
    for (const id of customerIds) {
        statsMap[id] = { ltv: 0, orderCount: 0, rtoCount: 0 };
    }

    // Populate LTV and order count from aggregate results
    for (const stat of stats) {
        if (stat.customerId) {
            statsMap[stat.customerId] = {
                ltv: stat._sum.totalAmount || 0,
                orderCount: stat._count.id || 0,
                rtoCount: 0
            };
        }
    }

    // Add RTO counts
    for (const stat of rtoStats) {
        if (stat.customerId && statsMap[stat.customerId]) {
            statsMap[stat.customerId].rtoCount = stat._count.id || 0;
        }
    }

    return statsMap;
}

/**
 * Update a single customer's tier based on their LTV
 * Call this after order delivery or status changes
 */
export async function updateCustomerTier(
    prisma: PrismaClient,
    customerId: string
): Promise<TierUpdateResult> {
    if (!customerId) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const thresholds = await getTierThresholds(prisma);

    // Get customer's current tier
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { tier: true }
    });

    if (!customer) return { updated: false, oldTier: null, newTier: null, ltv: 0 };

    const oldTier = (customer.tier || 'bronze') as CustomerTier;

    // Calculate LTV from orders
    // Exclude cancelled orders and RTO orders (returned orders shouldn't count toward LTV)
    // Note: trackingStatus can be null for unshipped orders (which should count)
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

    const ltv = stats._sum.totalAmount || 0;
    const newTier = calculateTier(ltv, thresholds);

    // Only update if tier changed
    if (newTier !== oldTier) {
        await prisma.customer.update({
            where: { id: customerId },
            data: { tier: newTier }
        });
        console.log(`[Tier] Customer ${customerId} upgraded: ${oldTier} → ${newTier} (LTV: ₹${ltv.toLocaleString()})`);
        return { updated: true, oldTier, newTier, ltv };
    }

    return { updated: false, oldTier, newTier, ltv };
}

/**
 * Batch update tiers for all customers
 * Run this as a maintenance job or after bulk imports
 * Processes in chunks to avoid PostgreSQL bind variable limits
 */
export async function updateAllCustomerTiers(prisma: PrismaClient): Promise<BatchTierUpdateResult> {
    const thresholds = await getTierThresholds(prisma);
    const CHUNK_SIZE = 5000; // Process 5000 customers at a time

    // Get total count
    const totalCount = await prisma.customer.count();
    console.log(`[Tier] Processing ${totalCount} customers in chunks of ${CHUNK_SIZE}`);

    let processed = 0;
    let totalUpdated = 0;
    const allUpgrades: TierUpgrade[] = [];

    while (processed < totalCount) {
        // Get chunk of customers
        const customers = await prisma.customer.findMany({
            select: { id: true, tier: true },
            skip: processed,
            take: CHUNK_SIZE
        });

        if (customers.length === 0) break;

        const customerIds = customers.map(c => c.id);
        const statsMap = await getCustomerStatsMap(prisma, customerIds);

        const updates: Array<{ where: { id: string }; data: { tier: CustomerTier } }> = [];
        const upgrades: TierUpgrade[] = [];

        for (const customer of customers) {
            const stats = statsMap[customer.id] || { ltv: 0 };
            const newTier = calculateTier(stats.ltv, thresholds);
            const oldTier = (customer.tier || 'bronze') as CustomerTier;

            if (newTier !== oldTier) {
                updates.push({
                    where: { id: customer.id },
                    data: { tier: newTier }
                });
                upgrades.push({
                    customerId: customer.id,
                    oldTier,
                    newTier,
                    ltv: stats.ltv
                });
            }
        }

        // Batch update this chunk
        if (updates.length > 0) {
            await prisma.$transaction(
                updates.map(u => prisma.customer.update(u))
            );
        }

        processed += customers.length;
        totalUpdated += updates.length;
        allUpgrades.push(...upgrades);

        console.log(`[Tier] Processed ${processed}/${totalCount}, updated ${updates.length} in this chunk`);
    }

    console.log(`[Tier] Batch complete: ${totalUpdated} of ${totalCount} tiers updated`);

    return {
        total: totalCount,
        updated: totalUpdated,
        upgrades: allUpgrades.slice(0, 100) // Return first 100 upgrades to avoid huge response
    };
}
