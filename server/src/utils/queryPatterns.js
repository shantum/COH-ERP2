/**
 * Shared Prisma query include patterns
 * These reduce duplication across route files
 */

import { getCustomerStatsMap, getTierThresholds, calculateTier } from './tierUtils.js';

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
    RTO_RECEIVED: 'rto_received',
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
 * Order lines include pattern with SKU details
 * Used in ORDER_LIST_SELECT patterns below
 */
export const ORDER_LINES_INCLUDE = {
    include: {
        sku: {
            include: {
                variation: { include: { product: true, fabric: true } },
            },
        },
        productionBatch: true,
    },
};

/**
 * Base select for order list views - common fields across all list endpoints
 * Used by /open, /shipped, /rto, /cod-pending
 */
export const ORDER_LIST_SELECT = {
    id: true,
    orderNumber: true,
    shopifyOrderId: true,
    channel: true,
    customerId: true,
    customerName: true,
    customerEmail: true,
    customerPhone: true,
    shippingAddress: true,
    orderDate: true,
    customerNotes: true,
    internalNotes: true,
    status: true,
    awbNumber: true,
    courier: true,
    shippedAt: true,
    deliveredAt: true,
    totalAmount: true,
    createdAt: true,
    shopifyFulfillmentStatus: true,
    paymentMethod: true,
    // iThink tracking fields
    trackingStatus: true,
    expectedDeliveryDate: true,
    deliveryAttempts: true,
    lastScanStatus: true,
    lastScanLocation: true,
    lastScanAt: true,
    lastTrackingUpdate: true,
    courierStatusCode: true,
    // Relations
    customer: true,
    orderLines: ORDER_LINES_INCLUDE,
};

/**
 * Shopify cache select for open orders (compact version)
 */
export const SHOPIFY_CACHE_SELECT_COMPACT = {
    select: {
        discountCodes: true,
        customerNotes: true,
        paymentMethod: true,
        tags: true,
        trackingNumber: true,
        trackingCompany: true,
        shippedAt: true,
        fulfillmentStatus: true,
    },
};

/**
 * Shopify cache select for shipped orders (includes rawData for extraction)
 */
export const SHOPIFY_CACHE_SELECT_FULL = {
    select: {
        rawData: true,
        discountCodes: true,
        paymentMethod: true,
        tags: true,
        fulfillmentStatus: true,
        financialStatus: true,
    },
};

/**
 * Extended select for open orders
 * Adds shopifyCache for discount/tag display
 */
export const ORDER_LIST_SELECT_OPEN = {
    ...ORDER_LIST_SELECT,
    shopifyCache: SHOPIFY_CACHE_SELECT_COMPACT,
};

/**
 * Extended select for shipped orders
 * Adds RTO fields, COD remittance fields, and full shopifyCache
 */
export const ORDER_LIST_SELECT_SHIPPED = {
    ...ORDER_LIST_SELECT,
    // RTO fields
    rtoInitiatedAt: true,
    rtoReceivedAt: true,
    // COD Remittance fields
    codRemittedAt: true,
    codRemittanceUtr: true,
    codRemittedAmount: true,
    // Full cache for tracking extraction
    shopifyCache: SHOPIFY_CACHE_SELECT_FULL,
};

/**
 * Extended select for RTO orders
 * Adds RTO-specific fields
 */
export const ORDER_LIST_SELECT_RTO = {
    ...ORDER_LIST_SELECT,
    rtoInitiatedAt: true,
    rtoReceivedAt: true,
};

/**
 * Select for COD pending orders
 * Base fields, no RTO or COD remittance needed
 */
export const ORDER_LIST_SELECT_COD_PENDING = ORDER_LIST_SELECT;

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

// Re-export tier utilities for convenience
export { getCustomerStatsMap, getTierThresholds, calculateTier };

/**
 * Calculate fulfillment stage based on order line statuses
 * @param {Array} orderLines - Order lines with lineStatus field
 * @returns {'pending' | 'allocated' | 'in_progress' | 'ready_to_ship'}
 */
export function calculateFulfillmentStage(orderLines) {
    if (!orderLines || orderLines.length === 0) return 'pending';

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    if (lineStatuses.every((s) => s === 'packed')) {
        return 'ready_to_ship';
    }
    if (lineStatuses.some((s) => ['picked', 'packed'].includes(s))) {
        return 'in_progress';
    }
    if (lineStatuses.every((s) => s === 'allocated')) {
        return 'allocated';
    }
    return 'pending';
}

/**
 * Calculate line status counts for an order
 * @param {Array} orderLines - Order lines with lineStatus field
 * @returns {Object} Counts by status
 */
export function calculateLineStatusCounts(orderLines) {
    if (!orderLines || orderLines.length === 0) {
        return { totalLines: 0, pendingLines: 0, allocatedLines: 0, pickedLines: 0, packedLines: 0 };
    }

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    return {
        totalLines: orderLines.length,
        pendingLines: lineStatuses.filter((s) => s === 'pending').length,
        allocatedLines: lineStatuses.filter((s) => s === 'allocated').length,
        pickedLines: lineStatuses.filter((s) => s === 'picked').length,
        packedLines: lineStatuses.filter((s) => s === 'packed').length,
    };
}

/**
 * Enrich orders with customer LTV, tier, and order count
 * Consolidates the duplicate customer enrichment pattern from list endpoints
 *
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Array} orders - Array of orders to enrich
 * @param {Object} options - Enrichment options
 * @param {boolean} options.includeFulfillmentStage - Add fulfillmentStage and line counts
 * @param {boolean} options.includeLineStatusCounts - Add line status breakdowns
 * @returns {Promise<Array>} Enriched orders
 */
export async function enrichOrdersWithCustomerStats(prisma, orders, options = {}) {
    if (!orders || orders.length === 0) return [];

    const { includeFulfillmentStage = false, includeLineStatusCounts = false } = options;

    // Get unique customer IDs
    const customerIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))];

    // Fetch customer stats and tier thresholds in parallel
    const [customerStatsMap, thresholds] = await Promise.all([
        getCustomerStatsMap(prisma, customerIds),
        getTierThresholds(prisma),
    ]);

    // Enrich each order
    return orders.map((order) => {
        const customerStats = customerStatsMap[order.customerId] || { ltv: 0, orderCount: 0 };

        const enriched = {
            ...order,
            customerLtv: customerStats.ltv,
            customerOrderCount: customerStats.orderCount,
            customerTier: calculateTier(customerStats.ltv, thresholds),
        };

        // Optionally add fulfillment stage (for open orders)
        if (includeFulfillmentStage && order.orderLines) {
            enriched.fulfillmentStage = calculateFulfillmentStage(order.orderLines);
        }

        // Optionally add line status counts (for open orders)
        if (includeLineStatusCounts && order.orderLines) {
            Object.assign(enriched, calculateLineStatusCounts(order.orderLines));
        }

        return enriched;
    });
}

/**
 * Extract tracking fields from Shopify cache rawData
 * Used for shipped orders to get fulfillment details
 *
 * @param {Object} shopifyCache - ShopifyOrderCache object with rawData
 * @returns {Object} Enriched cache object without rawData
 */
export function extractShopifyTrackingFields(shopifyCache) {
    if (!shopifyCache) return {};

    if (!shopifyCache.rawData) {
        return shopifyCache;
    }

    try {
        const shopifyOrder = JSON.parse(shopifyCache.rawData);
        const fulfillment =
            shopifyOrder.fulfillments?.find((f) => f.tracking_number) || shopifyOrder.fulfillments?.[0];

        const enrichedCache = {
            ...shopifyCache,
            trackingNumber: fulfillment?.tracking_number || null,
            trackingCompany: fulfillment?.tracking_company || null,
            trackingUrl: fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0] || null,
            shippedAt: fulfillment?.created_at || null,
            shipmentStatus: fulfillment?.shipment_status || null,
            deliveredAt: fulfillment?.shipment_status === 'delivered' ? fulfillment?.updated_at : null,
            fulfillmentUpdatedAt: fulfillment?.updated_at || null,
            customerNotes: shopifyOrder.note || null,
        };

        // Remove rawData from response (too large)
        delete enrichedCache.rawData;
        return enrichedCache;
    } catch (e) {
        // If JSON parse fails, just remove rawData and return
        const { rawData, ...rest } = shopifyCache;
        return rest;
    }
}

/**
 * Calculate days in transit/RTO/delivery for shipped orders
 * @param {Date|string} sinceDate - The date to calculate from
 * @returns {number} Days elapsed
 */
export function calculateDaysSince(sinceDate) {
    if (!sinceDate) return 0;
    return Math.floor((Date.now() - new Date(sinceDate).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Determine tracking status for an order (fallback when not in DB)
 * @param {Object} order - Order object
 * @param {number} daysInTransit - Days since shipped
 * @returns {string} Tracking status
 */
export function determineTrackingStatus(order, daysInTransit) {
    if (order.trackingStatus) return order.trackingStatus;

    if (order.rtoReceivedAt) return 'rto_received';
    if (order.rtoInitiatedAt) return 'rto_initiated';
    if (order.status === 'delivered' || order.deliveredAt) return 'delivered';
    if (daysInTransit > 7) return 'delivery_delayed';
    return 'in_transit';
}

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
