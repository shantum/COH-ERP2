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
 * @param {object} prisma - Prisma client instance
 * @param {string[]} customerIds - Array of customer IDs
 * @returns {Promise<Record<string, {ltv: number, orderCount: number}>>} - Map of customerId to stats
 */
export async function getCustomerStatsMap(prisma, customerIds) {
    if (!customerIds || customerIds.length === 0) return {};

    const customers = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        include: {
            orders: {
                select: { totalAmount: true, status: true }
            }
        }
    });

    const statsMap = {};
    for (const customer of customers) {
        const validOrders = customer.orders.filter(o => o.status !== 'cancelled');
        statsMap[customer.id] = {
            ltv: calculateLTV(customer.orders),
            orderCount: validOrders.length
        };
    }

    return statsMap;
}

// Backwards compatible alias
export async function getCustomerLtvMap(prisma, customerIds) {
    const statsMap = await getCustomerStatsMap(prisma, customerIds);
    const ltvMap = {};
    for (const [id, stats] of Object.entries(statsMap)) {
        ltvMap[id] = stats.ltv;
    }
    return ltvMap;
}
