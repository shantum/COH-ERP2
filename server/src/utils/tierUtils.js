/**
 * Customer Tier Utilities
 * Centralized tier calculation logic with configurable thresholds
 */

// Default thresholds (used if not configured in SystemSettings)
export const DEFAULT_TIER_THRESHOLDS = {
    platinum: 50000,
    gold: 25000,
    silver: 10000
};

/**
 * Get tier thresholds from SystemSettings or use defaults
 * @param {object} prisma - Prisma client instance
 * @returns {Promise<{platinum: number, gold: number, silver: number}>}
 */
export async function getTierThresholds(prisma) {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'tier_thresholds' }
        });
        if (setting?.value) {
            return JSON.parse(setting.value);
        }
    } catch (error) {
        console.error('Error fetching tier thresholds:', error);
    }
    return DEFAULT_TIER_THRESHOLDS;
}

/**
 * Calculate customer tier based on LTV and thresholds
 * @param {number} ltv - Customer lifetime value
 * @param {{platinum: number, gold: number, silver: number}} thresholds - Tier thresholds
 * @returns {'platinum' | 'gold' | 'silver' | 'bronze'}
 */
export function calculateTier(ltv, thresholds = DEFAULT_TIER_THRESHOLDS) {
    if (ltv >= thresholds.platinum) return 'platinum';
    if (ltv >= thresholds.gold) return 'gold';
    if (ltv >= thresholds.silver) return 'silver';
    return 'bronze';
}

/**
 * Calculate LTV for a customer from their orders
 * @param {Array} orders - Customer orders
 * @returns {number} - Lifetime value
 */
export function calculateLTV(orders) {
    if (!orders || orders.length === 0) return 0;

    // Only include non-cancelled orders
    const validOrders = orders.filter(o => o.status !== 'cancelled');
    return validOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
}

/**
 * Get LTV and order count map for multiple customers
 * Uses aggregate query for performance - avoids loading all orders
 * @param {object} prisma - Prisma client instance
 * @param {string[]} customerIds - Array of customer IDs
 * @returns {Promise<Record<string, {ltv: number, orderCount: number}>>} - Map of customerId to stats
 */
export async function getCustomerStatsMap(prisma, customerIds) {
    if (!customerIds || customerIds.length === 0) return {};

    // Use aggregate query - much faster than loading all orders
    // Exclude cancelled orders and zero-value orders (exchanges, giveaways)
    const stats = await prisma.order.groupBy({
        by: ['customerId'],
        where: {
            customerId: { in: customerIds },
            status: { not: 'cancelled' },
            totalAmount: { gt: 0 }
        },
        _sum: { totalAmount: true },
        _count: { id: true }
    });

    const statsMap = {};

    // Initialize all customerIds with defaults (in case some have no orders)
    for (const id of customerIds) {
        statsMap[id] = { ltv: 0, orderCount: 0 };
    }

    // Populate from aggregate results
    for (const stat of stats) {
        if (stat.customerId) {
            statsMap[stat.customerId] = {
                ltv: stat._sum.totalAmount || 0,
                orderCount: stat._count.id || 0
            };
        }
    }

    return statsMap;
}
