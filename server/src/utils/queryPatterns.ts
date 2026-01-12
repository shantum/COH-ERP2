/**
 * @module queryPatterns
 * Shared Prisma query patterns, transaction helpers, and inventory calculations.
 *
 * Key patterns:
 * - ORDER_LIST_SELECT: Unified select for all order list views (excludes Shopify-owned fields)
 * - Transaction helpers: createReservedTransaction, createSaleTransaction, releaseReservedInventory
 * - Inventory balance: calculateInventoryBalance (single SKU), calculateAllInventoryBalances (batch)
 * - Customer enrichment: enrichOrdersWithCustomerStats (adds LTV, tier, fulfillment stage)
 * - Custom SKU workflow: createCustomSku, removeCustomization
 *
 * CRITICAL GOTCHAS:
 * - Shopify fields (discountCode, customerNotes, fulfillmentStatus) live in shopifyCache, NOT on Order
 * - Use accessor functions (getOrderDiscountCodes, getOrderCustomerNotes) for safe field access
 * - Inventory balance can be negative (data integrity issue) - use allowNegative option
 * - Custom SKUs auto-allocate on production completion (standard batches don't)
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { getCustomerStatsMap, getTierThresholds, calculateTier } from './tierUtils.js';
import type { CustomerTier } from './tierUtils.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Prisma transaction client type
 * Used for functions that can accept either PrismaClient or a transaction
 */
export type PrismaTransactionClient = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Union type for prisma client or transaction
 */
export type PrismaOrTransaction = PrismaClient | PrismaTransactionClient;

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
} as const;

export type TxnType = typeof TXN_TYPE[keyof typeof TXN_TYPE];

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
} as const;

export type TxnReason = typeof TXN_REASON[keyof typeof TXN_REASON];

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
} as const;

export type TxnReferenceType = typeof TXN_REFERENCE_TYPE[keyof typeof TXN_REFERENCE_TYPE];

/**
 * Fabric transaction types
 */
export const FABRIC_TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

export type FabricTxnType = typeof FABRIC_TXN_TYPE[keyof typeof FABRIC_TXN_TYPE];

// ============================================
// INVENTORY BALANCE TYPES
// ============================================

/**
 * Result of inventory balance calculation
 */
export interface InventoryBalance {
    totalInward: number;
    totalOutward: number;
    totalReserved: number;
    currentBalance: number;
    availableBalance: number;
    hasDataIntegrityIssue: boolean;
}

/**
 * Inventory balance with SKU ID (for batch operations)
 */
export interface InventoryBalanceWithSkuId extends InventoryBalance {
    skuId: string;
}

/**
 * Options for inventory balance calculation
 */
export interface InventoryBalanceOptions {
    /** If false, floors negative balances at 0 (hides data issues) */
    allowNegative?: boolean;
    /** If true, excludes custom SKUs (isCustomSku=true) */
    excludeCustomSkus?: boolean;
}

/**
 * Fabric balance result
 */
export interface FabricBalance {
    totalInward: number;
    totalOutward: number;
    currentBalance: number;
}

/**
 * Fabric balance with ID (for batch operations)
 */
export interface FabricBalanceWithId extends FabricBalance {
    fabricId: string;
}

// ============================================
// VALIDATION TYPES
// ============================================

/**
 * Result of outward transaction validation
 */
export interface OutwardValidationResult {
    allowed: boolean;
    reason?: string;
    currentBalance: number;
    availableBalance: number;
}

/**
 * Result of SKU validation
 */
export interface SkuValidationResult {
    valid: boolean;
    sku?: SkuWithRelations;
    error?: string;
}

/**
 * SKU with product/variation relations
 */
export interface SkuWithRelations {
    id: string;
    skuCode: string;
    isActive: boolean;
    variation?: {
        product?: {
            isActive: boolean;
        } | null;
    } | null;
    [key: string]: unknown;
}

/**
 * Parameters for SKU validation
 */
export interface SkuValidationParams {
    skuId?: string;
    skuCode?: string;
    barcode?: string;
}

/**
 * Dependency info for transaction deletion validation
 */
export interface TransactionDependency {
    type: string;
    message: string;
    [key: string]: unknown;
}

/**
 * Result of transaction deletion validation
 */
export interface TransactionDeletionValidation {
    canDelete: boolean;
    reason?: string | null;
    dependencies?: TransactionDependency[];
    transaction?: {
        id: string;
        skuCode?: string;
        txnType: string;
        qty: number;
        reason: string | null;
    };
}

// ============================================
// ORDER TYPES
// ============================================

/**
 * Order line status values
 */
export type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'cancelled' | 'shipped';

/**
 * Fulfillment stage derived from line statuses
 */
export type FulfillmentStage = 'pending' | 'allocated' | 'in_progress' | 'ready_to_ship';

/**
 * Line status counts
 */
export interface LineStatusCounts {
    totalLines: number;
    pendingLines: number;
    allocatedLines: number;
    pickedLines: number;
    packedLines: number;
}

/**
 * Order line with minimal fields for fulfillment calculation
 */
export interface OrderLineForFulfillment {
    lineStatus: LineStatus | string;
}

/**
 * Options for order enrichment
 */
export interface EnrichmentOptions {
    includeFulfillmentStage?: boolean;
    includeLineStatusCounts?: boolean;
}

/**
 * Order with customer ID for enrichment
 */
export interface OrderForEnrichment {
    customerId: string | null;
    orderLines?: OrderLineForFulfillment[];
    [key: string]: unknown;
}

/**
 * Enriched order with customer stats
 */
export interface EnrichedOrder extends OrderForEnrichment {
    customerLtv: number;
    customerOrderCount: number;
    customerRtoCount: number;
    customerTier: CustomerTier;
    fulfillmentStage?: FulfillmentStage;
    totalLines?: number;
    pendingLines?: number;
    allocatedLines?: number;
    pickedLines?: number;
    packedLines?: number;
}

/**
 * Order with shopifyCache relation
 */
export interface OrderWithShopifyCache {
    shopifyCache?: ShopifyCache | null;
    shippingAddress?: string | null;
    [key: string]: unknown;
}

/**
 * Order line with shipping address
 */
export interface OrderLineWithAddress {
    shippingAddress?: string | null;
    [key: string]: unknown;
}

/**
 * Shopify cache data
 */
export interface ShopifyCache {
    rawData?: string | null;
    discountCodes?: string | null;
    customerNotes?: string | null;
    fulfillmentStatus?: string | null;
    financialStatus?: string | null;
    paymentMethod?: string | null;
    tags?: string | null;
    trackingNumber?: string | null;
    trackingCompany?: string | null;
    shippedAt?: Date | string | null;
}

/**
 * Enriched shopify cache with extracted tracking fields
 */
export interface EnrichedShopifyCache extends Omit<ShopifyCache, 'rawData'> {
    trackingUrl?: string | null;
    shipmentStatus?: string | null;
    deliveredAt?: string | null;
    fulfillmentUpdatedAt?: string | null;
}

// ============================================
// TRANSACTION HELPER TYPES
// ============================================

/**
 * Parameters for creating reserved transaction
 */
export interface CreateReservedTransactionParams {
    skuId: string;
    qty: number;
    orderLineId: string;
    userId: string;
}

/**
 * Parameters for creating sale transaction
 */
export interface CreateSaleTransactionParams {
    skuId: string;
    qty: number;
    orderLineId: string;
    userId: string;
}

// ============================================
// CUSTOMIZATION TYPES
// ============================================

/**
 * Customization data for creating custom SKU
 */
export interface CustomizationData {
    type: 'length' | 'size' | 'measurements' | 'other';
    value: string;
    notes?: string;
}

/**
 * Result of custom SKU creation
 */
export interface CreateCustomSkuResult {
    customSku: {
        id: string;
        skuCode: string;
        [key: string]: unknown;
    };
    orderLine: {
        id: string;
        [key: string]: unknown;
    };
    originalSkuCode: string;
}

/**
 * Options for removing customization
 */
export interface RemoveCustomizationOptions {
    force?: boolean;
}

/**
 * Result of customization removal
 */
export interface RemoveCustomizationResult {
    success: boolean;
    orderLine: {
        id: string;
        [key: string]: unknown;
    };
    deletedCustomSkuCode: string;
    forcedCleanup: boolean;
    deletedTransactions: number;
    deletedBatches: number;
}

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
} as const;

/**
 * Base select for order list views - common fields across all list endpoints
 * Used by /open, /shipped, /rto, /cod-pending
 *
 * NOTE: Shopify-owned fields (discountCode, customerNotes, shopifyFulfillmentStatus)
 * are accessed via shopifyCache JOIN, not stored on Order.
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
    // NOTE: customerNotes removed - use shopifyCache.customerNotes
    internalNotes: true,
    status: true,
    awbNumber: true,
    courier: true,
    shippedAt: true,
    deliveredAt: true,
    totalAmount: true,
    createdAt: true,
    // NOTE: shopifyFulfillmentStatus removed - use shopifyCache.fulfillmentStatus
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
} as const;

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
} as const;

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
} as const;

/**
 * Extended select for open orders
 * Adds shopifyCache for discount/tag display
 */
export const ORDER_LIST_SELECT_OPEN = {
    ...ORDER_LIST_SELECT,
    shopifyCache: SHOPIFY_CACHE_SELECT_COMPACT,
} as const;

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
} as const;

/**
 * Extended select for RTO orders
 * Adds RTO-specific fields
 */
export const ORDER_LIST_SELECT_RTO = {
    ...ORDER_LIST_SELECT,
    rtoInitiatedAt: true,
    rtoReceivedAt: true,
} as const;

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
 */
export function calculateFulfillmentStage(orderLines: OrderLineForFulfillment[]): FulfillmentStage {
    if (!orderLines || orderLines.length === 0) return 'pending';

    const lineStatuses = orderLines.map((l) => l.lineStatus);

    if (lineStatuses.every((s) => s === 'packed')) {
        return 'ready_to_ship';
    }
    if (lineStatuses.some((s) => ['picked', 'packed'].includes(s as string))) {
        return 'in_progress';
    }
    if (lineStatuses.every((s) => s === 'allocated')) {
        return 'allocated';
    }
    return 'pending';
}

/**
 * Calculate line status counts for an order
 */
export function calculateLineStatusCounts(orderLines: OrderLineForFulfillment[]): LineStatusCounts {
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
 */
export async function recalculateOrderStatus(
    prisma: PrismaOrTransaction,
    orderId: string
): Promise<Prisma.OrderGetPayload<{ include: { orderLines: true } }> | null> {
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
            include: { orderLines: true },
        });
    }

    // If order was cancelled but has non-cancelled lines, restore to open
    if (order.status === 'cancelled' && nonCancelledLines.length > 0) {
        return prisma.order.update({
            where: { id: orderId },
            data: { status: 'open' },
            include: { orderLines: true },
        });
    }

    return order;
}

/**
 * Enrich orders with customer LTV, tier, and order count
 * Consolidates the duplicate customer enrichment pattern from list endpoints
 */
export async function enrichOrdersWithCustomerStats<T extends OrderForEnrichment>(
    prisma: PrismaClient,
    orders: T[],
    options: EnrichmentOptions = {}
): Promise<(T & Partial<EnrichedOrder>)[]> {
    if (!orders || orders.length === 0) return [];

    const { includeFulfillmentStage = false, includeLineStatusCounts = false } = options;

    // Get unique customer IDs
    const customerIds = [...new Set(orders.map((o) => o.customerId).filter((id): id is string => Boolean(id)))];

    // Fetch customer stats and tier thresholds in parallel
    const [customerStatsMap, thresholds] = await Promise.all([
        getCustomerStatsMap(prisma, customerIds),
        getTierThresholds(prisma),
    ]);

    // Enrich each order
    return orders.map((order) => {
        const customerStats = customerStatsMap[order.customerId || ''] || { ltv: 0, orderCount: 0, rtoCount: 0 };

        const enriched: T & Partial<EnrichedOrder> = {
            ...order,
            customerLtv: customerStats.ltv,
            customerOrderCount: customerStats.orderCount,
            customerRtoCount: customerStats.rtoCount,
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
 */
export function extractShopifyTrackingFields(shopifyCache: ShopifyCache | null | undefined): EnrichedShopifyCache | Record<string, never> {
    if (!shopifyCache) return {};

    if (!shopifyCache.rawData) {
        const { rawData: _rawData, ...rest } = shopifyCache as ShopifyCache & { rawData?: string };
        return rest;
    }

    try {
        const shopifyOrder = JSON.parse(shopifyCache.rawData) as {
            fulfillments?: Array<{
                tracking_number?: string;
                tracking_company?: string;
                tracking_url?: string;
                tracking_urls?: string[];
                created_at?: string;
                shipment_status?: string;
                updated_at?: string;
            }>;
            note?: string;
        };
        const fulfillment =
            shopifyOrder.fulfillments?.find((f) => f.tracking_number) || shopifyOrder.fulfillments?.[0];

        const enrichedCache: EnrichedShopifyCache = {
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
        delete (enrichedCache as { rawData?: string }).rawData;
        return enrichedCache;
    } catch {
        // If JSON parse fails, just remove rawData and return
        const { rawData: _rawData, ...rest } = shopifyCache;
        return rest;
    }
}

// ============================================
// SHOPIFY FIELD ACCESSORS (VLOOKUP Pattern)
// ============================================

/**
 * Get discount codes for an order (from Shopify cache)
 * Use this instead of order.discountCode
 */
export function getOrderDiscountCodes(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.discountCodes || null;
}

/**
 * Get customer notes for an order (from Shopify cache)
 * Use this instead of order.customerNotes
 */
export function getOrderCustomerNotes(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.customerNotes || null;
}

/**
 * Get Shopify fulfillment status for an order (from cache)
 * Use this instead of order.shopifyFulfillmentStatus
 */
export function getShopifyFulfillmentStatus(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.fulfillmentStatus || null;
}

/**
 * Get financial status for an order (from Shopify cache)
 */
export function getOrderFinancialStatus(order: OrderWithShopifyCache): string | null {
    return order.shopifyCache?.financialStatus || null;
}


/**
 * Calculate days in transit/RTO/delivery for shipped orders
 */
export function calculateDaysSince(sinceDate: Date | string | null | undefined): number {
    if (!sinceDate) return 0;
    return Math.floor((Date.now() - new Date(sinceDate).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Determine tracking status for an order (fallback when not in DB)
 */
export function determineTrackingStatus(
    order: {
        trackingStatus?: string | null;
        rtoReceivedAt?: Date | null;
        rtoInitiatedAt?: Date | null;
        status?: string;
        deliveredAt?: Date | null;
    },
    daysInTransit: number
): string {
    if (order.trackingStatus) return order.trackingStatus;

    if (order.rtoReceivedAt) return 'rto_received';
    if (order.rtoInitiatedAt) return 'rto_initiated';
    if (order.status === 'delivered' || order.deliveredAt) return 'delivered';
    if (daysInTransit > 7) return 'delivery_delayed';
    return 'in_transit';
}

/**
 * Resolve shipping address for an order line with fallback chain:
 * 1. OrderLine.shippingAddress (if populated)
 * 2. Order.shippingAddress (parent order)
 * 3. ShopifyOrderCache.rawData.shipping_address (if Shopify order)
 */
export function resolveLineShippingAddress(
    orderLine: OrderLineWithAddress,
    order: OrderWithShopifyCache
): string | null {
    // 1. Line-level address (highest priority)
    if (orderLine.shippingAddress) {
        return orderLine.shippingAddress;
    }

    // 2. Order-level address
    if (order.shippingAddress) {
        return order.shippingAddress;
    }

    // 3. Shopify cache fallback
    if (order.shopifyCache?.rawData) {
        try {
            const shopifyOrder = JSON.parse(order.shopifyCache.rawData) as {
                shipping_address?: Record<string, unknown>;
            };
            if (shopifyOrder.shipping_address) {
                return JSON.stringify(shopifyOrder.shipping_address);
            }
        } catch {
            // Invalid JSON in cache, skip
        }
    }

    return null;
}

/**
 * Enrich order lines with resolved shipping addresses
 * Modifies order lines in place, adding resolvedShippingAddress
 */
export function enrichOrderLinesWithAddresses<T extends OrderWithShopifyCache & { orderLines?: OrderLineWithAddress[] }>(
    order: T
): T {
    if (!order.orderLines) return order;

    return {
        ...order,
        orderLines: order.orderLines.map(line => ({
            ...line,
            // Add resolved address while keeping original
            resolvedShippingAddress: resolveLineShippingAddress(line, order),
        })),
    } as T;
}

/**
 * Calculate inventory balance for a SKU
 * Uses aggregation to avoid N+1 queries.
 */
export async function calculateInventoryBalance(
    prisma: PrismaOrTransaction,
    skuId: string,
    options: Pick<InventoryBalanceOptions, 'allowNegative'> = {}
): Promise<InventoryBalance> {
    const { allowNegative = true } = options;

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
 * Uses single aggregation query - O(1) instead of O(N) with calculateInventoryBalance.
 */
export async function calculateAllInventoryBalances(
    prisma: PrismaOrTransaction,
    skuIds: string[] | null = null,
    options: InventoryBalanceOptions = {}
): Promise<Map<string, InventoryBalanceWithSkuId>> {
    const { allowNegative = true, excludeCustomSkus = false } = options;

    // Build where clause for inventory transactions
    const where: Prisma.InventoryTransactionWhereInput = {};

    if (skuIds) {
        where.skuId = { in: skuIds };
    }

    // If excluding custom SKUs, we need to filter via the sku relation
    if (excludeCustomSkus) {
        where.sku = { isCustomSku: false };
    }

    const result = await prisma.inventoryTransaction.groupBy({
        by: ['skuId', 'txnType'],
        where,
        _sum: { qty: true },
    });

    // Build a map of balances
    const balanceMap = new Map<string, InventoryBalanceWithSkuId>();

    result.forEach((r) => {
        if (!balanceMap.has(r.skuId)) {
            balanceMap.set(r.skuId, {
                skuId: r.skuId,
                totalInward: 0,
                totalOutward: 0,
                totalReserved: 0,
                currentBalance: 0,
                availableBalance: 0,
                hasDataIntegrityIssue: false,
            });
        }

        const balance = balanceMap.get(r.skuId)!;
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
 */
export async function calculateFabricBalance(
    prisma: PrismaOrTransaction,
    fabricId: string
): Promise<FabricBalance> {
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
 */
export async function calculateAllFabricBalances(
    prisma: PrismaOrTransaction
): Promise<Map<string, FabricBalanceWithId>> {
    const result = await prisma.fabricTransaction.groupBy({
        by: ['fabricId', 'txnType'],
        _sum: { qty: true },
    });

    const balanceMap = new Map<string, FabricBalanceWithId>();

    result.forEach((r) => {
        if (!balanceMap.has(r.fabricId)) {
            balanceMap.set(r.fabricId, {
                fabricId: r.fabricId,
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
            });
        }

        const balance = balanceMap.get(r.fabricId)!;
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
 * Cascade priority: SKU.fabricConsumption -> Product.defaultFabricConsumption -> 1.5 (system default)
 */
export function getEffectiveFabricConsumption(sku: {
    fabricConsumption?: number | null;
    variation?: {
        product?: {
            defaultFabricConsumption?: number | null;
        } | null;
    } | null;
}): number {
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
 * Validate if an outward transaction is allowed
 * Prevents creating outward transactions that would cause negative balance.
 * Use before creating sale/damage/write-off transactions.
 */
export async function validateOutwardTransaction(
    prisma: PrismaOrTransaction,
    skuId: string,
    qty: number
): Promise<OutwardValidationResult> {
    const balance = await calculateInventoryBalance(prisma, skuId, { allowNegative: true });

    // Block if balance is already negative (data integrity issue - needs fixing first)
    if (balance.currentBalance < 0) {
        return {
            allowed: false,
            reason: `Cannot create outward: balance is already negative (${balance.currentBalance}). Fix data integrity issue first.`,
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
        };
    }

    // Block if transaction would make balance negative
    if (balance.availableBalance < qty) {
        return {
            allowed: false,
            reason: `Insufficient stock: available=${balance.availableBalance}, requested=${qty}`,
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
        };
    }

    return {
        allowed: true,
        currentBalance: balance.currentBalance,
        availableBalance: balance.availableBalance,
    };
}

/**
 * Release reserved inventory for an order line
 * Used when unallocating, shipping, or cancelling an order line
 */
export async function releaseReservedInventory(
    prisma: PrismaOrTransaction,
    orderLineId: string
): Promise<number> {
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
 */
export async function releaseReservedInventoryBatch(
    prisma: PrismaOrTransaction,
    orderLineIds: string[]
): Promise<number> {
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
 */
export async function createReservedTransaction(
    prisma: PrismaOrTransaction,
    { skuId, qty, orderLineId, userId }: CreateReservedTransactionParams
): Promise<Prisma.InventoryTransactionGetPayload<object>> {
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
 */
export async function createSaleTransaction(
    prisma: PrismaOrTransaction,
    { skuId, qty, orderLineId, userId }: CreateSaleTransactionParams
): Promise<Prisma.InventoryTransactionGetPayload<object>> {
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
 */
export async function deleteSaleTransactions(
    prisma: PrismaOrTransaction,
    orderLineId: string
): Promise<number> {
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
 */
export async function findExistingRtoInward(
    prisma: PrismaOrTransaction,
    orderLineId: string
): Promise<Prisma.InventoryTransactionGetPayload<object> | null> {
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
 */
export async function validateTransactionDeletion(
    prisma: PrismaOrTransaction,
    transactionId: string
): Promise<TransactionDeletionValidation> {
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

    const dependencies: TransactionDependency[] = [];

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

    // For production transactions, check if the production batch is still completed
    // Note: Deletion will automatically revert the production batch and fabric usage
    // This is informational - the delete handler will cascade properly
    if ((transaction.reason === TXN_REASON.PRODUCTION || transaction.reason === 'production_custom') && transaction.referenceId) {
        const productionBatch = await prisma.productionBatch.findUnique({
            where: { id: transaction.referenceId },
            include: {
                sku: { select: { skuCode: true, isCustomSku: true } },
            },
        });

        if (productionBatch && productionBatch.status === 'completed') {
            // Check if custom SKU order has progressed - this IS a blocking issue
            if (productionBatch.sku?.isCustomSku && productionBatch.sourceOrderLineId) {
                // Query the source order line separately since it's not a direct relation
                const sourceOrderLine = await prisma.orderLine.findUnique({
                    where: { id: productionBatch.sourceOrderLineId },
                    select: { lineStatus: true },
                });
                if (sourceOrderLine) {
                    const lineStatus = sourceOrderLine.lineStatus;
                    if (['picked', 'packed', 'shipped'].includes(lineStatus)) {
                        dependencies.push({
                            type: 'order_progression',
                            message: `Cannot delete - linked order line has progressed to ${lineStatus}`,
                            hint: 'Unship or unpick the order line first',
                        });
                    }
                }
            }
            // Note: Production batch revert is handled automatically by delete handler
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
 */
export async function validateSku(
    prisma: PrismaOrTransaction,
    { skuId, skuCode, barcode }: SkuValidationParams
): Promise<SkuValidationResult> {
    let sku: SkuWithRelations | null = null;

    if (skuId) {
        sku = await prisma.sku.findUnique({
            where: { id: skuId },
            include: {
                variation: { include: { product: true } },
            },
        }) as SkuWithRelations | null;
    } else if (barcode) {
        // Barcode is same as skuCode in this schema
        sku = await prisma.sku.findFirst({
            where: { skuCode: barcode },
            include: {
                variation: { include: { product: true } },
            },
        }) as SkuWithRelations | null;
    } else if (skuCode) {
        sku = await prisma.sku.findUnique({
            where: { skuCode },
            include: {
                variation: { include: { product: true } },
            },
        }) as SkuWithRelations | null;
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

// ============================================
// CUSTOMIZATION HELPERS
// ============================================

/**
 * Create a custom SKU for an order line
 * Generates a unique custom SKU code in format {BASE_SKU}-C{XX}
 */
export async function createCustomSku(
    prisma: PrismaClient,
    baseSkuId: string,
    customizationData: CustomizationData,
    orderLineId: string,
    userId: string
): Promise<CreateCustomSkuResult> {
    return prisma.$transaction(async (tx) => {
        // 1. Validate order line exists and is in pending status
        const orderLine = await tx.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: { select: { status: true, orderNumber: true } },
                sku: true,
            },
        });

        if (!orderLine) {
            throw new Error('ORDER_LINE_NOT_FOUND');
        }

        if (orderLine.lineStatus !== 'pending') {
            throw new Error('LINE_NOT_PENDING');
        }

        if (orderLine.isCustomized) {
            throw new Error('ALREADY_CUSTOMIZED');
        }

        // 2. Get base SKU and atomically increment counter
        const baseSku = await tx.sku.update({
            where: { id: baseSkuId },
            data: { customizationCount: { increment: 1 } },
            include: { variation: true },
        });

        // 3. Generate custom SKU code
        const count = baseSku.customizationCount;
        const customCode = `${baseSku.skuCode}-C${String(count).padStart(2, '0')}`;

        // 4. Create new Sku record for custom piece
        const customSku = await tx.sku.create({
            data: {
                skuCode: customCode,
                variationId: baseSku.variationId,
                size: baseSku.size,
                mrp: baseSku.mrp,
                isActive: true,
                isCustomSku: true,
                parentSkuId: baseSkuId,
                customizationType: customizationData.type,
                customizationValue: customizationData.value,
                customizationNotes: customizationData.notes || null,
                linkedOrderLineId: orderLineId,
                fabricConsumption: baseSku.fabricConsumption,
            },
        });

        // 5. Update order line to point to custom SKU
        const updatedLine = await tx.orderLine.update({
            where: { id: orderLineId },
            data: {
                skuId: customSku.id,
                originalSkuId: baseSkuId,
                isCustomized: true,
                isNonReturnable: true,
                customizedAt: new Date(),
                customizedById: userId,
            },
            include: {
                sku: {
                    include: {
                        parentSku: true,
                        variation: { include: { product: true } },
                    },
                },
                order: { select: { orderNumber: true } },
            },
        });

        return {
            customSku,
            orderLine: updatedLine,
            originalSkuCode: baseSku.skuCode,
        };
    }, {
        maxWait: 15000, // Wait up to 15 seconds to start the transaction
        timeout: 15000, // Allow up to 15 seconds for the transaction to complete
    });
}

/**
 * Remove customization from an order line
 * Reverts the line to original SKU and deletes the custom SKU
 * Only allowed if no inventory transactions or production batches exist (unless force=true)
 */
export async function removeCustomization(
    prisma: PrismaClient,
    orderLineId: string,
    options: RemoveCustomizationOptions = {}
): Promise<RemoveCustomizationResult> {
    const { force = false } = options;

    return prisma.$transaction(async (tx) => {
        // 1. Get order line with custom SKU
        const orderLine = await tx.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                sku: true,
                order: { select: { orderNumber: true } },
            },
        });

        if (!orderLine) {
            throw new Error('ORDER_LINE_NOT_FOUND');
        }

        if (!orderLine.isCustomized || !orderLine.originalSkuId) {
            throw new Error('NOT_CUSTOMIZED');
        }

        const customSkuId = orderLine.skuId;

        // 2. Check if custom SKU has inventory transactions
        const txnCount = await tx.inventoryTransaction.count({
            where: { skuId: customSkuId },
        });

        if (txnCount > 0) {
            if (!force) {
                throw new Error('CANNOT_UNDO_HAS_INVENTORY');
            }
            // Force mode: delete inventory transactions for this custom SKU
            await tx.inventoryTransaction.deleteMany({
                where: { skuId: customSkuId },
            });
        }

        // 3. Check if production batch exists for this custom SKU
        const batchCount = await tx.productionBatch.count({
            where: { skuId: customSkuId },
        });

        if (batchCount > 0) {
            if (!force) {
                throw new Error('CANNOT_UNDO_HAS_PRODUCTION');
            }
            // Force mode: delete production batches for this custom SKU
            await tx.productionBatch.deleteMany({
                where: { skuId: customSkuId },
            });
        }

        // 4. Revert order line to original SKU
        const updatedLine = await tx.orderLine.update({
            where: { id: orderLineId },
            data: {
                skuId: orderLine.originalSkuId,
                originalSkuId: null,
                isCustomized: false,
                isNonReturnable: false,
                customizedAt: null,
                customizedById: null,
            },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
                order: { select: { orderNumber: true } },
            },
        });

        // 6. Delete the custom SKU record
        await tx.sku.delete({ where: { id: customSkuId } });

        return {
            success: true,
            orderLine: updatedLine,
            deletedCustomSkuCode: orderLine.sku.skuCode,
            forcedCleanup: force && (txnCount > 0 || batchCount > 0),
            deletedTransactions: force ? txnCount : 0,
            deletedBatches: force ? batchCount : 0,
        };
    }, {
        maxWait: 15000,
        timeout: 15000,
    });
}
