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
    WRITE_OFF: 'write_off',
};

/**
 * Reference types for inventory transactions
 * Used to link transactions to their source entities
 */
export const TXN_REFERENCE_TYPE = {
    ORDER_LINE: 'order_line',
    PRODUCTION_BATCH: 'production_batch',
    RETURN_REQUEST_LINE: 'return_request_line',
    REPACKING_QUEUE_ITEM: 'repacking_queue_item',
    WRITE_OFF_LOG: 'write_off_log',
    MANUAL_ADJUSTMENT: 'manual_adjustment',
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
 * Recalculate order status based on line statuses
 * Issue #10: Ensures order status is consistent with line statuses
 *
 * @param {PrismaClient} prisma - Prisma client (or transaction)
 * @param {string} orderId - Order ID to recalculate
 * @returns {Object} Updated order
 */
export async function recalculateOrderStatus(prisma, orderId) {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    if (!order) return null;

    // Don't modify terminal statuses
    if (['shipped', 'delivered', 'archived'].includes(order.status)) {
        return order;
    }

    const lineStatuses = order.orderLines.map((l) => l.lineStatus);
    const nonCancelledLines = lineStatuses.filter((s) => s !== 'cancelled');

    // If all lines are cancelled, order should be cancelled
    if (nonCancelledLines.length === 0 && lineStatuses.length > 0) {
        return prisma.order.update({
            where: { id: orderId },
            data: { status: 'cancelled' },
        });
    }

    // If order was cancelled but has non-cancelled lines, restore to open
    if (order.status === 'cancelled' && nonCancelledLines.length > 0) {
        return prisma.order.update({
            where: { id: orderId },
            data: { status: 'open' },
        });
    }

    return order;
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
 * @param {Object} options - Options for balance calculation
 * @param {boolean} options.allowNegative - If false (default), floors balance at 0
 * @returns {Object} Balance information
 */
export async function calculateInventoryBalance(prisma, skuId, options = {}) {
    const { allowNegative = false } = options;

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

    let currentBalance = totalInward - totalOutward;
    let availableBalance = currentBalance - totalReserved;

    // Flag for data integrity issues (when outward > inward)
    const hasDataIntegrityIssue = currentBalance < 0 || availableBalance < 0;

    // Floor at 0 unless explicitly allowing negative (for diagnostic purposes)
    if (!allowNegative) {
        currentBalance = Math.max(0, currentBalance);
        availableBalance = Math.max(0, availableBalance);
    }

    return {
        totalInward,
        totalOutward,
        totalReserved,
        currentBalance,
        availableBalance,
        hasDataIntegrityIssue
    };
}

/**
 * Calculate inventory balances for all SKUs efficiently
 * Uses a single aggregation query instead of N+1
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string[]} skuIds - Optional array of SKU IDs to filter
 * @param {Object} options - Options for balance calculation
 * @param {boolean} options.allowNegative - If false (default), floors balance at 0
 * @returns {Map} Map of skuId -> balance info
 */
export async function calculateAllInventoryBalances(prisma, skuIds = null, options = {}) {
    const { allowNegative = false } = options;
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
        let currentBalance = balance.totalInward - balance.totalOutward;
        let availableBalance = currentBalance - balance.totalReserved;

        // Flag for data integrity issues
        balance.hasDataIntegrityIssue = currentBalance < 0 || availableBalance < 0;

        // Floor at 0 unless explicitly allowing negative
        if (!allowNegative) {
            currentBalance = Math.max(0, currentBalance);
            availableBalance = Math.max(0, availableBalance);
        }

        balance.currentBalance = currentBalance;
        balance.availableBalance = availableBalance;
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

// ============================================
// IDEMPOTENCY & VALIDATION HELPERS
// ============================================

/**
 * Check if an RTO inward transaction already exists for an order line
 * Used to prevent duplicate transactions on network retries
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string} orderLineId - Order line ID
 * @returns {Object|null} Existing transaction or null
 */
export async function findExistingRtoInward(prisma, orderLineId) {
    return prisma.inventoryTransaction.findFirst({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.INWARD,
            reason: TXN_REASON.RTO_RECEIVED,
        },
    });
}

/**
 * Check if an inventory transaction can be safely deleted
 * Validates that no dependent operations exist
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {string} transactionId - Transaction ID to validate
 * @returns {Object} { canDelete: boolean, reason?: string, dependencies?: Object[] }
 */
export async function validateTransactionDeletion(prisma, transactionId) {
    const transaction = await prisma.inventoryTransaction.findUnique({
        where: { id: transactionId },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

    if (!transaction) {
        return { canDelete: false, reason: 'Transaction not found' };
    }

    const dependencies = [];

    // For inward transactions, check if deleting would cause negative balance
    if (transaction.txnType === TXN_TYPE.INWARD) {
        const balance = await calculateInventoryBalance(prisma, transaction.skuId, { allowNegative: true });
        const balanceAfterDeletion = balance.currentBalance - transaction.qty;

        if (balanceAfterDeletion < 0) {
            dependencies.push({
                type: 'negative_balance',
                message: `Deleting would cause negative balance (${balanceAfterDeletion})`,
                currentBalance: balance.currentBalance,
                transactionQty: transaction.qty,
            });
        }

        // Check if there are reserved quantities that would be affected
        if (balance.totalReserved > 0 && balanceAfterDeletion < balance.totalReserved) {
            dependencies.push({
                type: 'reserved_inventory',
                message: `Deleting would leave insufficient stock for ${balance.totalReserved} reserved units`,
                reserved: balance.totalReserved,
            });
        }
    }

    // For reserved transactions, check if order line is in a state that requires reservation
    if (transaction.txnType === TXN_TYPE.RESERVED && transaction.referenceId) {
        const orderLine = await prisma.orderLine.findFirst({
            where: { id: transaction.referenceId },
            include: { order: { select: { status: true, orderNumber: true } } },
        });

        if (orderLine && orderLine.lineStatus === 'allocated') {
            dependencies.push({
                type: 'active_allocation',
                message: `Order line ${orderLine.order?.orderNumber} is still allocated`,
                orderNumber: orderLine.order?.orderNumber,
                lineStatus: orderLine.lineStatus,
            });
        }
    }

    // For return_receipt transactions, check if repacking item would become orphaned
    if (transaction.reason === TXN_REASON.RETURN_RECEIPT && transaction.referenceId) {
        const repackItem = await prisma.repackingQueueItem.findUnique({
            where: { id: transaction.referenceId },
        });

        if (repackItem && repackItem.status === 'ready') {
            dependencies.push({
                type: 'repacking_queue_item',
                message: 'Associated repacking queue item is in ready status',
                repackItemId: repackItem.id,
            });
        }
    }

    return {
        canDelete: dependencies.length === 0,
        reason: dependencies.length > 0 ? 'Transaction has dependencies that must be resolved first' : null,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
        transaction: {
            id: transaction.id,
            skuCode: transaction.sku?.skuCode,
            txnType: transaction.txnType,
            qty: transaction.qty,
            reason: transaction.reason,
        },
    };
}

/**
 * Check if a SKU exists and is active
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} params - Search parameters
 * @param {string} params.skuId - SKU ID
 * @param {string} params.skuCode - SKU code
 * @param {string} params.barcode - Barcode (same as skuCode in this schema)
 * @returns {Object} { valid: boolean, sku?: Object, error?: string }
 */
export async function validateSku(prisma, { skuId, skuCode, barcode }) {
    let sku = null;

    if (skuId) {
        sku = await prisma.sku.findUnique({
            where: { id: skuId },
            include: {
                variation: { include: { product: true } },
            },
        });
    } else if (barcode) {
        // Barcode is same as skuCode in this schema
        sku = await prisma.sku.findFirst({
            where: { skuCode: barcode },
            include: {
                variation: { include: { product: true } },
            },
        });
    } else if (skuCode) {
        sku = await prisma.sku.findUnique({
            where: { skuCode },
            include: {
                variation: { include: { product: true } },
            },
        });
    }

    if (!sku) {
        return { valid: false, error: 'SKU not found' };
    }

    if (!sku.isActive) {
        return { valid: false, error: 'SKU is inactive', sku };
    }

    if (!sku.variation?.product?.isActive) {
        return { valid: false, error: 'Product is inactive', sku };
    }

    return { valid: true, sku };
}
