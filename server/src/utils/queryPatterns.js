/**
 * Shared Prisma query include patterns
 * These reduce duplication across route files
 */

// ============================================
// TRANSACTION CONSTANTS
// ============================================

/**
 * Inventory transaction types
 */
export const TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
    RESERVED: 'reserved',
};

/**
 * Inventory transaction reasons
 */
export const TXN_REASON = {
    ORDER_ALLOCATION: 'order_allocation',
    PRODUCTION: 'production',
    SALE: 'sale',
    RETURN_RECEIPT: 'return_receipt',
    DAMAGE: 'damage',
    ADJUSTMENT: 'adjustment',
    TRANSFER: 'transfer',
};

/**
 * Fabric transaction types
 */
export const FABRIC_TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
};

// ============================================
// ORDER INCLUDES
// ============================================

/**
 * Full order include with all related data
 * Used for order detail views
 */
export const ORDER_FULL_INCLUDE = {
    customer: true,
    orderLines: {
        include: {
            sku: {
                include: {
                    variation: {
                        include: {
                            product: true,
                            fabric: true,
                        },
                    },
                },
            },
            productionBatch: true,
        },
    },
};

/**
 * Minimal order include (just lines with SKU info)
 * Used for list views where full data isn't needed
 */
export const ORDER_MINIMAL_INCLUDE = {
    orderLines: {
        include: {
            sku: {
                include: {
                    variation: {
                        include: { product: true },
                    },
                },
            },
        },
    },
};

/**
 * Order include for fulfillment operations
 */
export const ORDER_FULFILLMENT_INCLUDE = {
    orderLines: {
        include: {
            sku: true,
            productionBatch: true,
        },
    },
};

// ============================================
// PRODUCT/SKU INCLUDES
// ============================================

/**
 * Full SKU include with product hierarchy
 */
export const SKU_FULL_INCLUDE = {
    variation: {
        include: {
            product: true,
            fabric: {
                include: { fabricType: true },
            },
        },
    },
    skuCosting: true,
};

/**
 * SKU include for inventory views
 */
export const SKU_INVENTORY_INCLUDE = {
    variation: {
        include: {
            product: true,
            fabric: true,
        },
    },
};

/**
 * Product with variations and SKUs
 */
export const PRODUCT_FULL_INCLUDE = {
    fabricType: true,
    variations: {
        include: {
            fabric: true,
            skus: {
                include: { skuCosting: true },
            },
        },
    },
};

// ============================================
// FABRIC INCLUDES
// ============================================

/**
 * Fabric with type and supplier
 */
export const FABRIC_FULL_INCLUDE = {
    fabricType: true,
    supplier: true,
};

// ============================================
// RETURN INCLUDES
// ============================================

/**
 * Return request with all related data
 */
export const RETURN_FULL_INCLUDE = {
    originalOrder: {
        include: {
            orderLines: {
                include: {
                    sku: {
                        include: {
                            variation: { include: { product: true } },
                        },
                    },
                },
            },
        },
    },
    customer: true,
    lines: {
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
            exchangeSku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    },
    shipping: true,
    statusHistory: {
        include: { changedBy: true },
        orderBy: { createdAt: 'desc' },
    },
};

// ============================================
// PRODUCTION INCLUDES
// ============================================

/**
 * Production batch with SKU and tailor info
 */
export const BATCH_FULL_INCLUDE = {
    tailor: true,
    sku: {
        include: {
            variation: {
                include: {
                    product: true,
                    fabric: true,
                },
            },
        },
    },
    orderLines: {
        include: {
            order: true,
        },
    },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate inventory balance for a SKU
 * Uses aggregation to avoid N+1 queries
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string} skuId - SKU ID
 * @returns {Object} Balance information
 */
export async function calculateInventoryBalance(prisma, skuId) {
    const result = await prisma.inventoryTransaction.groupBy({
        by: ['txnType'],
        where: { skuId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;
    let totalReserved = 0;

    result.forEach((r) => {
        if (r.txnType === 'inward') totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') totalOutward = r._sum.qty || 0;
        else if (r.txnType === 'reserved') totalReserved = r._sum.qty || 0;
    });

    const currentBalance = totalInward - totalOutward;
    const availableBalance = currentBalance - totalReserved;

    return { totalInward, totalOutward, totalReserved, currentBalance, availableBalance };
}

/**
 * Calculate inventory balances for all SKUs efficiently
 * Uses a single aggregation query instead of N+1
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string[]} skuIds - Optional array of SKU IDs to filter
 * @returns {Map} Map of skuId -> balance info
 */
export async function calculateAllInventoryBalances(prisma, skuIds = null) {
    const where = skuIds ? { skuId: { in: skuIds } } : {};

    const result = await prisma.inventoryTransaction.groupBy({
        by: ['skuId', 'txnType'],
        where,
        _sum: { qty: true },
    });

    // Build a map of balances
    const balanceMap = new Map();

    result.forEach((r) => {
        if (!balanceMap.has(r.skuId)) {
            balanceMap.set(r.skuId, {
                totalInward: 0,
                totalOutward: 0,
                totalReserved: 0,
            });
        }

        const balance = balanceMap.get(r.skuId);
        if (r.txnType === 'inward') balance.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') balance.totalOutward = r._sum.qty || 0;
        else if (r.txnType === 'reserved') balance.totalReserved = r._sum.qty || 0;
    });

    // Calculate derived fields
    for (const [skuId, balance] of balanceMap) {
        balance.currentBalance = balance.totalInward - balance.totalOutward;
        balance.availableBalance = balance.currentBalance - balance.totalReserved;
        balance.skuId = skuId;
    }

    return balanceMap;
}

/**
 * Calculate fabric balance for a fabric
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string} fabricId - Fabric ID
 * @returns {Object} Balance information
 */
export async function calculateFabricBalance(prisma, fabricId) {
    const result = await prisma.fabricTransaction.groupBy({
        by: ['txnType'],
        where: { fabricId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;

    result.forEach((r) => {
        if (r.txnType === 'inward') totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') totalOutward = r._sum.qty || 0;
    });

    const currentBalance = totalInward - totalOutward;

    return { totalInward, totalOutward, currentBalance };
}

/**
 * Calculate fabric balances for all fabrics efficiently
 * @param {PrismaClient} prisma - Prisma client instance
 * @returns {Map} Map of fabricId -> balance info
 */
export async function calculateAllFabricBalances(prisma) {
    const result = await prisma.fabricTransaction.groupBy({
        by: ['fabricId', 'txnType'],
        _sum: { qty: true },
    });

    const balanceMap = new Map();

    result.forEach((r) => {
        if (!balanceMap.has(r.fabricId)) {
            balanceMap.set(r.fabricId, {
                fabricId: r.fabricId,
                totalInward: 0,
                totalOutward: 0,
            });
        }

        const balance = balanceMap.get(r.fabricId);
        if (r.txnType === 'inward') balance.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') balance.totalOutward = r._sum.qty || 0;
    });

    // Calculate current balance
    for (const [, balance] of balanceMap) {
        balance.currentBalance = balance.totalInward - balance.totalOutward;
    }

    return balanceMap;
}

/**
 * Get effective fabric consumption for a SKU
 * Falls back to product default if SKU-level not set
 * @param {Object} sku - SKU object with variation.product relation
 * @returns {number} Fabric consumption value
 */
export function getEffectiveFabricConsumption(sku) {
    // Use SKU-specific consumption if set and reasonable
    if (sku.fabricConsumption && sku.fabricConsumption > 0) {
        return sku.fabricConsumption;
    }

    // Fall back to product default
    const productDefault = sku.variation?.product?.defaultFabricConsumption;
    if (productDefault && productDefault > 0) {
        return productDefault;
    }

    // Final fallback
    return 1.5;
}

/**
 * Find or create a customer by email or phone
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} customerData - Customer data
 * @returns {Object} Customer record
 */
export async function findOrCreateCustomer(prisma, { email, phone, firstName, lastName, defaultAddress }) {
    let customer = null;

    // Try to find by email first
    if (email) {
        customer = await prisma.customer.findUnique({ where: { email } });
    }

    // If no email or not found, try by phone
    if (!customer && phone) {
        customer = await prisma.customer.findFirst({ where: { phone } });
    }

    // Create new customer if not found
    if (!customer) {
        const customerEmail = email || `${phone.replace(/\D/g, '')}@phone.local`;
        customer = await prisma.customer.create({
            data: {
                email: customerEmail,
                firstName,
                lastName,
                phone,
                defaultAddress,
            },
        });
    } else if (phone && !customer.phone) {
        // Update phone if customer exists but doesn't have phone
        customer = await prisma.customer.update({
            where: { id: customer.id },
            data: { phone },
        });
    }

    return customer;
}

// ============================================
// INVENTORY TRANSACTION HELPERS
// ============================================

/**
 * Release reserved inventory for an order line
 * Used when unallocating, shipping, or cancelling an order line
 * @param {PrismaClient} prisma - Prisma client (or transaction)
 * @param {string} orderLineId - Order line ID
 * @returns {number} Number of transactions deleted
 */
export async function releaseReservedInventory(prisma, orderLineId) {
    const result = await prisma.inventoryTransaction.deleteMany({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.RESERVED,
            reason: TXN_REASON.ORDER_ALLOCATION,
        },
    });
    return result.count;
}

/**
 * Release reserved inventory for multiple order lines
 * @param {PrismaClient} prisma - Prisma client (or transaction)
 * @param {string[]} orderLineIds - Array of order line IDs
 * @returns {number} Number of transactions deleted
 */
export async function releaseReservedInventoryBatch(prisma, orderLineIds) {
    const result = await prisma.inventoryTransaction.deleteMany({
        where: {
            referenceId: { in: orderLineIds },
            txnType: TXN_TYPE.RESERVED,
            reason: TXN_REASON.ORDER_ALLOCATION,
        },
    });
    return result.count;
}

/**
 * Create a reserved inventory transaction for order allocation
 * @param {PrismaClient} prisma - Prisma client (or transaction)
 * @param {Object} params - Transaction parameters
 * @returns {Object} Created transaction
 */
export async function createReservedTransaction(prisma, { skuId, qty, orderLineId, userId }) {
    return prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: TXN_TYPE.RESERVED,
            qty,
            reason: TXN_REASON.ORDER_ALLOCATION,
            referenceId: orderLineId,
            createdById: userId,
        },
    });
}

/**
 * Create a sale (outward) transaction when shipping
 * @param {PrismaClient} prisma - Prisma client (or transaction)
 * @param {Object} params - Transaction parameters
 * @returns {Object} Created transaction
 */
export async function createSaleTransaction(prisma, { skuId, qty, orderLineId, userId }) {
    return prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: TXN_TYPE.OUTWARD,
            qty,
            reason: TXN_REASON.SALE,
            referenceId: orderLineId,
            createdById: userId,
        },
    });
}

/**
 * Delete sale transactions for an order line (used when unshipping)
 * @param {PrismaClient} prisma - Prisma client (or transaction)
 * @param {string} orderLineId - Order line ID
 * @returns {number} Number of transactions deleted
 */
export async function deleteSaleTransactions(prisma, orderLineId) {
    const result = await prisma.inventoryTransaction.deleteMany({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.SALE,
        },
    });
    return result.count;
}
