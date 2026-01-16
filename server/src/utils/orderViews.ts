/**
 * Order Views Configuration
 *
 * Defines all order views (open, shipped, rto, etc.) as configuration objects.
 * This follows the spreadsheet model: one table, filtered views.
 */

import type { Prisma } from '@prisma/client';

// Import and re-export enrichment types for backwards compatibility
export {
    type EnrichmentType,
    type EnrichedOrder,
    enrichOrdersForView,
} from './orderEnrichment/index.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Valid view names for order filtering
 */
export type ViewName =
    | 'open'
    | 'shipped'
    | 'rto'
    | 'cod_pending'
    | 'archived'
    | 'cancelled'
    | 'all'
    | 'ready_to_ship'
    | 'needs_attention'
    | 'watch_list'
    | 'in_transit'
    | 'pending_payment'
    | 'completed';

// Import types for use in this file
import type { EnrichmentType, EnrichedOrder } from './orderEnrichment/index.js';

/**
 * Date filter configuration for views
 */
export interface DateFilterConfig {
    field: string;
    defaultDays: number;
}

/**
 * Order view configuration object
 */
export interface OrderViewConfig {
    name: string;
    description: string;
    where: Prisma.OrderWhereInput;
    excludeWhere?: {
        trackingStatus: { in: string[] };
    };
    excludeCodPending?: boolean;
    orderBy: Prisma.OrderOrderByWithRelationInput | Prisma.OrderOrderByWithRelationInput[];
    enrichment: EnrichmentType[];
    dateFilter?: DateFilterConfig;
    defaultLimit: number;
    isLineView?: boolean;
    runtimeFilters?: string[];
}

/**
 * Options for building view where clauses
 */
export interface ViewOptions {
    days?: string | number;
    search?: string;
    additionalFilters?: Record<string, unknown>;
}

// ============================================
// VIEW DEFINITIONS
// ============================================

/**
 * Order view configurations
 * Each view defines:
 * - where: Prisma where clause
 * - orderBy: Default sort order
 * - enrichment: Array of enrichment functions to apply
 * - dateFilter: Optional date range filter config
 * - excludeViews: Views to exclude from (for mutual exclusivity)
 */
export const ORDER_VIEWS: Record<ViewName, OrderViewConfig> = {
    /**
     * Open Orders: Orders still being processed OR shipped/cancelled but not released
     * Shipped orders stay here until user clicks "Release to Shipped"
     * Cancelled orders stay here until user clicks "Release to Cancelled"
     */
    open: {
        name: 'Open Orders',
        description: 'Orders pending fulfillment or awaiting release',
        where: {
            isArchived: false,
            OR: [
                // Still has lines being processed (not shipped, not cancelled)
                {
                    orderLines: {
                        some: {
                            lineStatus: { notIn: ['shipped', 'cancelled'] },
                        },
                    },
                },
                // Fully shipped but not released yet
                {
                    releasedToShipped: false,
                    orderLines: { some: { lineStatus: 'shipped' } },
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { notIn: ['shipped', 'cancelled'] },
                            },
                        },
                    },
                },
                // Fully cancelled but not released yet
                {
                    releasedToCancelled: false,
                    orderLines: { some: { lineStatus: 'cancelled' } },
                    NOT: {
                        orderLines: {
                            some: {
                                lineStatus: { not: 'cancelled' },
                            },
                        },
                    },
                },
            ],
        },
        orderBy: { orderDate: 'desc' }, // Newest first
        enrichment: ['fulfillmentStage', 'lineStatusCounts', 'customerStats', 'addressResolution', 'daysInTransit'],
        defaultLimit: 10000,
    },

    /**
     * Shipped Orders: Fully shipped AND released
     * Includes RTO and COD pending orders (filtered client-side)
     */
    shipped: {
        name: 'Shipped Orders',
        description: 'Released shipped orders (in transit, delivered, RTO, COD pending)',
        where: {
            isArchived: false,
            releasedToShipped: true,
            // All non-cancelled lines are shipped
            NOT: {
                orderLines: {
                    some: {
                        lineStatus: { notIn: ['shipped', 'cancelled'] },
                    },
                },
            },
            // Must have at least one shipped line
            orderLines: {
                some: { lineStatus: 'shipped' },
            },
        },
        orderBy: { orderDate: 'desc' },
        enrichment: ['daysInTransit', 'trackingStatus', 'shopifyTracking', 'customerStats', 'daysSinceDelivery', 'rtoStatus'],
        defaultLimit: 2000,
    },

    rto: {
        name: 'RTO Orders',
        description: 'Return to origin orders',
        where: {
            trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
            isArchived: false,
        },
        orderBy: { orderDate: 'desc' },
        enrichment: ['daysInTransit', 'rtoStatus', 'customerStats'],
        defaultLimit: 200,
    },

    cod_pending: {
        name: 'COD Pending',
        description: 'Delivered COD orders awaiting remittance',
        where: {
            paymentMethod: 'COD',
            trackingStatus: 'delivered',
            codRemittedAt: null,
            isArchived: false,
        },
        orderBy: { orderDate: 'desc' },
        enrichment: ['daysSinceDelivery', 'customerStats'],
        defaultLimit: 200,
    },

    archived: {
        name: 'Archived Orders',
        description: 'Completed or archived orders',
        where: {
            isArchived: true,
        },
        orderBy: { orderDate: 'desc' },
        enrichment: ['customerStats'],
        defaultLimit: 100,
    },

    cancelled: {
        name: 'Cancelled Lines',
        description: 'Released cancelled order lines (line-level view)',
        // Note: This view uses a special line-level query in listOrders.js
        // The where clause here is just for reference
        where: {
            releasedToCancelled: true, // Only show released cancelled orders
            isArchived: false,
        },
        orderBy: { orderDate: 'desc' },
        enrichment: ['customerStats'],
        defaultLimit: 200,
        // Flag indicating this is a line-level view
        isLineView: true,
    },

    all: {
        name: 'All Orders',
        description: 'All orders without filtering',
        where: {},
        orderBy: { orderDate: 'desc' },
        enrichment: ['customerStats'],
        defaultLimit: 50,
    },

    // ============================================
    // ACTION-ORIENTED VIEWS (Zen Philosophy)
    // "What needs my attention right now?"
    // ============================================

    /**
     * Ready to Ship: What can I ship now?
     * Open orders not on hold, ready for fulfillment
     */
    ready_to_ship: {
        name: 'Ready to Ship',
        description: 'Orders ready for fulfillment',
        where: {
            isArchived: false,
            isOnHold: false,
            // At least one line is not shipped/cancelled
            orderLines: {
                some: {
                    lineStatus: { notIn: ['shipped', 'cancelled'] },
                },
            },
        },
        orderBy: { orderDate: 'asc' }, // FIFO - oldest first
        enrichment: ['fulfillmentStage', 'lineStatusCounts', 'customerStats', 'addressResolution', 'daysInTransit'],
        defaultLimit: 10000,
    },

    /**
     * Needs Attention: What's stuck or unusual?
     * Orders on hold, or RTO awaiting processing
     */
    needs_attention: {
        name: 'Needs Attention',
        description: 'Orders requiring manual attention',
        where: {
            OR: [
                { isOnHold: true },
                // RTO delivered but not yet processed (terminalStatus still null)
                { trackingStatus: 'rto_delivered', terminalStatus: null },
            ],
            isArchived: false,
        },
        orderBy: { orderDate: 'asc' },
        enrichment: ['customerStats', 'rtoStatus'],
        defaultLimit: 200,
    },

    /**
     * Watch List: What's at risk in transit?
     * COD orders >7 days OR RTO in progress
     */
    watch_list: {
        name: 'Watch List',
        description: 'At-risk orders requiring monitoring',
        where: {
            OR: [
                // RTO in progress (not yet received)
                { trackingStatus: { in: ['rto_initiated', 'rto_in_transit'] } },
            ],
            isArchived: false,
            terminalStatus: null,
        },
        // Note: COD >7 days requires runtime filter (see enrichment)
        orderBy: { shippedAt: 'asc' }, // Oldest at-risk first
        enrichment: ['daysInTransit', 'customerStats'],
        runtimeFilters: ['codAtRisk'], // Applied after query
        defaultLimit: 200,
    },

    /**
     * In Transit: Orders in transit (happy path monitoring)
     * Shipped but not yet terminal
     */
    in_transit: {
        name: 'In Transit',
        description: 'Orders currently in transit',
        where: {
            status: 'shipped',
            terminalStatus: null,
            isArchived: false,
        },
        // Exclude RTO orders (they go to watch_list)
        excludeWhere: {
            trackingStatus: { in: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
        },
        orderBy: { shippedAt: 'desc' },
        enrichment: ['daysInTransit', 'trackingStatus', 'customerStats'],
        defaultLimit: 200,
    },

    /**
     * Pending Payment: COD delivered awaiting remittance
     * Finance queue for payment reconciliation
     */
    pending_payment: {
        name: 'Pending Payment',
        description: 'Delivered COD orders awaiting payment',
        where: {
            terminalStatus: 'delivered',
            paymentMethod: 'COD',
            codRemittedAt: null,
            isArchived: false,
        },
        orderBy: { terminalAt: 'asc' }, // Oldest pending first
        enrichment: ['daysSinceDelivery', 'customerStats'],
        defaultLimit: 200,
    },

    /**
     * Completed: All orders that reached terminal status
     * Reference only - everything that's "done"
     */
    completed: {
        name: 'Completed',
        description: 'Orders that have reached a terminal state',
        where: {
            terminalStatus: { not: null },
            isArchived: false,
        },
        orderBy: { terminalAt: 'desc' },
        enrichment: ['customerStats'],
        defaultLimit: 100,
    },
};

// ============================================
// WHERE CLAUSE BUILDER
// ============================================

/**
 * Build the complete WHERE clause for a view
 * Handles exclusions and additional filters
 */
export function buildViewWhereClause(
    viewName: string,
    options: ViewOptions = {}
): Prisma.OrderWhereInput {
    const view = ORDER_VIEWS[viewName as ViewName];
    if (!view) {
        throw new Error(`Unknown view: ${viewName}`);
    }

    const { days, search, additionalFilters = {} } = options;

    // Start with base where clause
    const where: Prisma.OrderWhereInput = { ...view.where };

    // Apply date filter if view has one and days is specified
    if (view.dateFilter && days) {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));
        (where as Record<string, unknown>)[view.dateFilter.field] = { gte: sinceDate };
    } else if (view.dateFilter && view.dateFilter.defaultDays && viewName !== 'all') {
        // Apply default date filter
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - view.dateFilter.defaultDays);
        (where as Record<string, unknown>)[view.dateFilter.field] = { gte: sinceDate };
    }

    // Apply exclusions for shipped view
    if (view.excludeWhere) {
        // Exclude orders matching excludeWhere
        where.OR = [
            { trackingStatus: null },
            { trackingStatus: { notIn: view.excludeWhere.trackingStatus.in } },
        ];
    }

    if (view.excludeCodPending) {
        // Exclude delivered COD orders awaiting payment
        where.NOT = {
            AND: [
                { paymentMethod: 'COD' },
                { trackingStatus: 'delivered' },
                { codRemittedAt: null },
            ],
        };
    }

    // Apply search filter
    if (search && search.trim()) {
        const searchTerm = search.trim();
        where.OR = [
            ...(where.OR || []),
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { customerName: { contains: searchTerm, mode: 'insensitive' } },
            { awbNumber: { contains: searchTerm } },
            { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
            { customerPhone: { contains: searchTerm } },
        ] as Prisma.OrderWhereInput[];
    }

    // Apply additional filters
    Object.entries(additionalFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            (where as Record<string, unknown>)[key] = value;
        }
    });

    return where;
}

// ============================================
// UNIFIED SELECT PATTERN
// ============================================

/**
 * Comprehensive SELECT pattern that works for all views
 * Slightly over-fetches for simple views, but simplifies code significantly
 */
export const ORDER_UNIFIED_SELECT = {
    // Core fields
    id: true,
    orderNumber: true,
    shopifyOrderId: true,
    channel: true,
    status: true,
    orderDate: true,
    shipByDate: true,
    customerName: true,
    customerEmail: true,
    customerPhone: true,
    customerId: true,
    shippingAddress: true,
    totalAmount: true,
    paymentMethod: true,
    isArchived: true,
    archivedAt: true,
    releasedToShipped: true,
    releasedToCancelled: true,
    createdAt: true,
    syncedAt: true,
    internalNotes: true,

    // Exchange order fields
    isExchange: true,
    originalOrderId: true,

    // Partial cancellation
    partiallyCancelled: true,

    // Fulfillment fields
    awbNumber: true,
    courier: true,
    shippedAt: true,
    deliveredAt: true,

    // Tracking fields (iThink)
    trackingStatus: true,
    expectedDeliveryDate: true,
    deliveryAttempts: true,
    lastScanStatus: true,
    lastScanLocation: true,
    lastScanAt: true,
    lastTrackingUpdate: true,
    courierStatusCode: true,

    // RTO fields
    rtoInitiatedAt: true,
    rtoReceivedAt: true,

    // Terminal status (zen philosophy: what's the final state?)
    terminalStatus: true,
    terminalAt: true,

    // COD fields
    codRemittedAt: true,
    codRemittanceUtr: true,
    codRemittedAmount: true,

    // Hold fields
    isOnHold: true,
    holdReason: true,
    holdNotes: true,
    holdAt: true,

    // Relations - lightweight for list views
    customer: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            tags: true,
        },
    },
    orderLines: {
        select: {
            id: true,
            lineStatus: true,
            qty: true,
            unitPrice: true,
            skuId: true,
            productionBatchId: true,
            notes: true,
            awbNumber: true,
            courier: true,
            shippedAt: true,
            deliveredAt: true,
            isCustomized: true,
            rtoCondition: true,
            trackingStatus: true,
            shopifyLineId: true,
            // SKU with minimal nested data (includes customization fields)
            sku: {
                select: {
                    id: true,
                    skuCode: true,
                    size: true,
                    isCustomSku: true,
                    customizationType: true,
                    customizationValue: true,
                    customizationNotes: true,
                    variation: {
                        select: {
                            id: true,
                            colorName: true,
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
            },
            productionBatch: {
                select: {
                    id: true,
                    batchCode: true,
                    batchDate: true,
                    status: true,
                },
            },
        },
    },
    shopifyCache: {
        select: {
            discountCodes: true,
            customerNotes: true,
            paymentMethod: true,
            tags: true,
            trackingNumber: true,
            trackingCompany: true,
            shippedAt: true,
            fulfillmentStatus: true,
            financialStatus: true,
            // rawData excluded for performance - use generated columns instead
            totalPrice: true,
            subtotalPrice: true,
            totalTax: true,
            totalDiscounts: true,
        },
    },
} as const satisfies Prisma.OrderSelect;

/**
 * Get view names for validation
 */
export function getValidViewNames(): ViewName[] {
    return Object.keys(ORDER_VIEWS) as ViewName[];
}

/**
 * Get view configuration
 */
export function getViewConfig(viewName: string): OrderViewConfig | null {
    return ORDER_VIEWS[viewName as ViewName] || null;
}

// ============================================
// FLATTENED ROW TYPE & FUNCTION
// ============================================

/**
 * Pre-flattened order row for AG-Grid display
 * Server computes this to eliminate client-side transformation overhead
 */
export interface FlattenedOrderRow {
    // Order-level fields
    orderId: string;
    orderNumber: string;
    orderDate: string;
    shipByDate: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerId: string | null;
    city: string;
    customerOrderCount: number;
    customerLtv: number;
    customerTier: string | null;
    customerRtoCount: number;
    totalAmount: number | null;
    paymentMethod: string | null;
    channel: string | null;
    internalNotes: string | null;

    // Line-level fields
    productName: string;
    colorName: string;
    size: string;
    skuCode: string;
    skuId: string | null;
    qty: number;
    lineId: string | null;
    lineStatus: string | null;
    lineNotes: string;

    // Inventory (filled client-side for now)
    skuStock: number;
    fabricBalance: number;

    // Shopify status
    shopifyStatus: string;

    // Production batch
    productionBatch: {
        id: string;
        batchCode: string;
        batchDate: string | null;
        status: string;
    } | null;
    productionBatchId: string | null;
    productionDate: string | null;

    // Row metadata
    isFirstLine: boolean;
    totalLines: number;
    fulfillmentStage: string | null;

    // Full order reference (for modals, actions)
    order: EnrichedOrder;

    // Customization fields
    isCustomized: boolean;
    isNonReturnable: boolean;
    customSkuCode: string | null;
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
    originalSkuCode: string | null;

    // Line-level tracking (pre-computed for O(1) access)
    lineShippedAt: string | null;
    lineDeliveredAt: string | null;
    lineTrackingStatus: string | null;
    lineAwbNumber: string | null;
    lineCourier: string | null;

    // Enriched fields (from server enrichments)
    daysInTransit: number | null;
    daysSinceDelivery: number | null;
    daysInRto: number | null;
    rtoStatus: string | null;

    // Shopify cache fields (for columns)
    discountCodes: string | null;
    customerNotes: string | null;
    shopifyTags: string | null;
    shopifyAwb: string | null;
    shopifyCourier: string | null;

    // Customer tags
    customerTags: string[] | null;
}

/**
 * Parse city from JSON shipping address
 */
function parseCity(shippingAddress: string | null | undefined): string {
    if (!shippingAddress) return '-';
    try {
        const addr = JSON.parse(shippingAddress);
        return addr.city || '-';
    } catch {
        return '-';
    }
}

/**
 * Flatten enriched orders into rows for AG-Grid
 * Sorted by orderDate descending (newest first)
 *
 * This runs on the server to eliminate client-side transformation overhead.
 * Inventory/fabric balances are filled client-side (separate query).
 */
export function flattenOrdersToRows(orders: EnrichedOrder[]): FlattenedOrderRow[] {
    if (!orders || orders.length === 0) return [];

    // Sort orders by date descending (newest first)
    const sortedOrders = [...orders].sort((a, b) => {
        const dateA = a.orderDate ? new Date(a.orderDate as string).getTime() : 0;
        const dateB = b.orderDate ? new Date(b.orderDate as string).getTime() : 0;
        return dateB - dateA;
    });

    const rows: FlattenedOrderRow[] = [];

    for (const order of sortedOrders) {
        const orderLines = (order.orderLines || []) as Array<{
            id: string;
            lineStatus: string | null;
            qty: number;
            unitPrice: number;
            skuId: string;
            notes: string | null;
            awbNumber: string | null;
            courier: string | null;
            shippedAt: string | null;
            deliveredAt: string | null;
            isCustomized: boolean;
            trackingStatus: string | null;
            productionBatchId: string | null;
            sku: {
                id: string;
                skuCode: string;
                size: string;
                isCustomSku: boolean;
                customizationType: string | null;
                customizationValue: string | null;
                customizationNotes: string | null;
                variation: {
                    id: string;
                    colorName: string | null;
                    product: { id: string; name: string } | null;
                } | null;
            } | null;
            productionBatch: {
                id: string;
                batchCode: string;
                batchDate: string | null;
                status: string;
            } | null;
        }>;

        const shopifyCache = order.shopifyCache as {
            discountCodes: string | null;
            customerNotes: string | null;
            tags: string | null;
            trackingNumber: string | null;
            trackingCompany: string | null;
            fulfillmentStatus: string | null;
        } | null;

        const customer = order.customer as {
            tags: string[] | null;
        } | null;

        // Common order-level values
        const city = parseCity(order.shippingAddress as string | null);
        const customerOrderCount = (order.customerOrderCount as number) || 0;
        const customerLtv = (order.customerLtv as number) || 0;
        const customerTier = (order.customerTier as string) || null;
        const customerRtoCount = (order.customerRtoCount as number) || 0;
        const shopifyStatus = shopifyCache?.fulfillmentStatus || '-';
        const discountCodes = shopifyCache?.discountCodes || null;
        const customerNotes = shopifyCache?.customerNotes || null;
        const shopifyTags = shopifyCache?.tags || null;
        const shopifyAwb = shopifyCache?.trackingNumber || null;
        const shopifyCourier = shopifyCache?.trackingCompany || null;
        const customerTags = customer?.tags || null;

        // Handle orders with no lines
        if (orderLines.length === 0) {
            rows.push({
                orderId: order.id as string,
                orderNumber: order.orderNumber as string,
                orderDate: order.orderDate as string,
                shipByDate: (order.shipByDate as string) || null,
                customerName: order.customerName as string,
                customerEmail: (order.customerEmail as string) || null,
                customerPhone: (order.customerPhone as string) || null,
                customerId: (order.customerId as string) || null,
                city,
                customerOrderCount,
                customerLtv,
                customerTier,
                customerRtoCount,
                totalAmount: (order.totalAmount as number) || null,
                paymentMethod: (order.paymentMethod as string) || null,
                channel: (order.channel as string) || null,
                internalNotes: (order.internalNotes as string) || null,
                productName: '(no items)',
                colorName: '-',
                size: '-',
                skuCode: '-',
                skuId: null,
                qty: 0,
                lineId: null,
                lineStatus: null,
                lineNotes: '',
                skuStock: 0,
                fabricBalance: 0,
                shopifyStatus,
                productionBatch: null,
                productionBatchId: null,
                productionDate: null,
                isFirstLine: true,
                totalLines: 0,
                fulfillmentStage: (order.fulfillmentStage as string) || null,
                order,
                isCustomized: false,
                isNonReturnable: false,
                customSkuCode: null,
                customizationType: null,
                customizationValue: null,
                customizationNotes: null,
                originalSkuCode: null,
                lineShippedAt: null,
                lineDeliveredAt: null,
                lineTrackingStatus: null,
                lineAwbNumber: null,
                lineCourier: null,
                daysInTransit: (order.daysInTransit as number) ?? null,
                daysSinceDelivery: (order.daysSinceDelivery as number) ?? null,
                daysInRto: (order.daysInRto as number) ?? null,
                rtoStatus: (order.rtoStatus as string) || null,
                discountCodes,
                customerNotes,
                shopifyTags,
                shopifyAwb,
                shopifyCourier,
                customerTags,
            });
            continue;
        }

        // Flatten each line into a row
        const lineCount = orderLines.length;
        for (let idx = 0; idx < lineCount; idx++) {
            const line = orderLines[idx];
            const sku = line.sku;
            const productionBatch = line.productionBatch;

            // Customization data
            const isCustomized = line.isCustomized || false;
            const customSkuCode = isCustomized && sku?.isCustomSku ? sku.skuCode : null;

            rows.push({
                orderId: order.id as string,
                orderNumber: order.orderNumber as string,
                orderDate: order.orderDate as string,
                shipByDate: (order.shipByDate as string) || null,
                customerName: order.customerName as string,
                customerEmail: (order.customerEmail as string) || null,
                customerPhone: (order.customerPhone as string) || null,
                customerId: (order.customerId as string) || null,
                city,
                customerOrderCount,
                customerLtv,
                customerTier,
                customerRtoCount,
                totalAmount: (order.totalAmount as number) || null,
                paymentMethod: (order.paymentMethod as string) || null,
                channel: (order.channel as string) || null,
                internalNotes: (order.internalNotes as string) || null,
                productName: sku?.variation?.product?.name || '-',
                colorName: sku?.variation?.colorName || '-',
                size: sku?.size || '-',
                skuCode: sku?.skuCode || '-',
                skuId: line.skuId || null,
                qty: line.qty,
                lineId: line.id,
                lineStatus: line.lineStatus,
                lineNotes: line.notes || '',
                skuStock: 0, // Filled client-side
                fabricBalance: 0, // Filled client-side
                shopifyStatus,
                productionBatch: productionBatch ? {
                    id: productionBatch.id,
                    batchCode: productionBatch.batchCode,
                    batchDate: productionBatch.batchDate,
                    status: productionBatch.status,
                } : null,
                productionBatchId: productionBatch?.id || null,
                productionDate: productionBatch?.batchDate ? new Date(productionBatch.batchDate).toISOString().split('T')[0] : null,
                isFirstLine: idx === 0,
                totalLines: lineCount,
                fulfillmentStage: (order.fulfillmentStage as string) || null,
                order,
                isCustomized,
                isNonReturnable: false, // Not tracked at line level currently
                customSkuCode,
                customizationType: sku?.customizationType || null,
                customizationValue: sku?.customizationValue || null,
                customizationNotes: sku?.customizationNotes || null,
                originalSkuCode: null, // Would need backend population
                lineShippedAt: line.shippedAt || null,
                lineDeliveredAt: line.deliveredAt || null,
                lineTrackingStatus: line.trackingStatus || null,
                lineAwbNumber: line.awbNumber || null,
                lineCourier: line.courier || null,
                daysInTransit: (order.daysInTransit as number) ?? null,
                daysSinceDelivery: (order.daysSinceDelivery as number) ?? null,
                daysInRto: (order.daysInRto as number) ?? null,
                rtoStatus: (order.rtoStatus as string) || null,
                discountCodes,
                customerNotes,
                shopifyTags,
                shopifyAwb,
                shopifyCourier,
                customerTags,
            });
        }
    }

    return rows;
}
