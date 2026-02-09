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
        defaultLimit: 500, // Active management view - larger page for workflow
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
        defaultLimit: 100, // Historical view - smaller page for reference
    },

    rto: {
        name: 'RTO Orders',
        description: 'Return to origin orders',
        where: {
            // Filter by line-level tracking status (has at least one RTO line)
            orderLines: {
                some: {
                    trackingStatus: { in: ['rto_initiated', 'rto_in_transit', 'rto_delivered'] },
                },
            },
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
            // Filter by line-level tracking status (has at least one delivered line)
            orderLines: {
                some: {
                    trackingStatus: 'delivered',
                },
            },
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
        defaultLimit: 100, // Historical view - smaller page for reference
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
     * Open orders ready for fulfillment (at least one line not shipped/cancelled)
     */
    ready_to_ship: {
        name: 'Ready to Ship',
        description: 'Orders ready for fulfillment',
        where: {
            isArchived: false,
            // At least one line is not shipped/cancelled
            orderLines: {
                some: {
                    lineStatus: { notIn: ['shipped', 'cancelled'] },
                },
            },
        },
        orderBy: { orderDate: 'asc' }, // FIFO - oldest first
        enrichment: ['fulfillmentStage', 'lineStatusCounts', 'customerStats', 'addressResolution', 'daysInTransit'],
        defaultLimit: 500, // Active management view - larger page for workflow
    },

    /**
     * Needs Attention: What's stuck or unusual?
     * Orders with RTO lines awaiting processing
     */
    needs_attention: {
        name: 'Needs Attention',
        description: 'Orders requiring manual attention',
        where: {
            // Has at least one RTO delivered line
            orderLines: {
                some: {
                    trackingStatus: 'rto_delivered',
                },
            },
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
            // Has at least one RTO in-progress line
            orderLines: {
                some: {
                    trackingStatus: { in: ['rto_initiated', 'rto_in_transit'] },
                },
            },
            isArchived: false,
        },
        // Note: COD >7 days requires runtime filter (see enrichment)
        orderBy: { orderDate: 'asc' }, // Oldest at-risk first (use orderDate instead of removed shippedAt)
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
            isArchived: false,
            // Has at least one shipped line that's in transit (not RTO, not delivered)
            orderLines: {
                some: {
                    lineStatus: 'shipped',
                    trackingStatus: { notIn: ['rto_initiated', 'rto_in_transit', 'rto_delivered', 'delivered'] },
                },
            },
        },
        orderBy: { orderDate: 'desc' }, // Use orderDate instead of removed shippedAt
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
            paymentMethod: 'COD',
            codRemittedAt: null,
            isArchived: false,
            // Has at least one delivered line
            orderLines: {
                some: {
                    trackingStatus: 'delivered',
                },
            },
        },
        orderBy: { orderDate: 'asc' }, // Oldest pending first (use orderDate instead of removed terminalAt)
        enrichment: ['daysSinceDelivery', 'customerStats'],
        defaultLimit: 200,
    },

    /**
     * Completed: All orders that reached terminal status (all lines delivered or RTO delivered)
     * Reference only - everything that's "done"
     */
    completed: {
        name: 'Completed',
        description: 'Orders that have reached a terminal state',
        where: {
            isArchived: false,
            // All lines are in terminal state (delivered or rto_delivered)
            NOT: {
                orderLines: {
                    some: {
                        trackingStatus: { notIn: ['delivered', 'rto_delivered'] },
                    },
                },
            },
            // Must have at least one terminal line
            orderLines: {
                some: {
                    trackingStatus: { in: ['delivered', 'rto_delivered'] },
                },
            },
        },
        orderBy: { orderDate: 'desc' }, // Use orderDate instead of removed terminalAt
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

    // Note: excludeWhere and excludeCodPending logic removed - tracking status is now at line level
    // Views that need exclusions should define the full filter in their where clause

    // Apply search filter
    if (search && search.trim()) {
        const searchTerm = search.trim();
        where.OR = [
            ...(where.OR || []),
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { customerName: { contains: searchTerm, mode: 'insensitive' } },
            { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
            { customerPhone: { contains: searchTerm } },
            // Search by AWB in order lines
            { orderLines: { some: { awbNumber: { contains: searchTerm } } } },
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

    // COD fields
    codRemittedAt: true,
    codRemittanceUtr: true,
    codRemittedAmount: true,

    // Note: Fulfillment/tracking fields (awbNumber, courier, shippedAt, deliveredAt,
    // trackingStatus, lastTrackingUpdate, rtoInitiatedAt, rtoReceivedAt, etc.)
    // are now on OrderLine, not Order. Access via orderLines relation.

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
            // Line-level fulfillment fields
            awbNumber: true,
            courier: true,
            shippedAt: true,
            deliveredAt: true,
            // Line-level tracking fields
            trackingStatus: true,
            lastTrackingUpdate: true,
            rtoInitiatedAt: true,
            rtoReceivedAt: true,
            lastScanAt: true,
            lastScanLocation: true,
            lastScanStatus: true,
            courierStatusCode: true,
            deliveryAttempts: true,
            expectedDeliveryDate: true,
            // Other line fields
            isCustomized: true,
            rtoCondition: true,
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
                            colorHex: true,
                            imageUrl: true,
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    imageUrl: true,
                                },
                            },
                            // NOTE: fabric removed from Variation - fabric assignment now via BOM
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
            trackingUrl: true,
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

    // Order status fields (needed for SSE updates)
    orderStatus: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
    isExchange: boolean;
    isOnHold: boolean;
    orderAwbNumber: string | null;
    orderCourier: string | null;
    orderShippedAt: string | null;
    orderTrackingStatus: string | null;

    // Line-level fields
    productName: string;
    colorName: string;
    colorHex: string | null;
    imageUrl: string | null;
    size: string;
    skuCode: string;
    skuId: string | null;
    qty: number;
    lineId: string | null;
    lineStatus: string | null;
    lineNotes: string;
    unitPrice: number;

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
    shopifyTrackingUrl: string | null;

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
                    colorHex: string | null;
                    imageUrl: string | null;
                    product: { id: string; name: string; imageUrl: string | null } | null;
                    fabric: {
                        colorHex: string | null;
                        colours: { colourName: string; colourHex: string | null }[];
                    } | null;
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
            trackingUrl: string | null;
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
        const shopifyTrackingUrl = shopifyCache?.trackingUrl || null;
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
                orderStatus: (order.status as string) || 'pending',
                isArchived: (order.isArchived as boolean) || false,
                releasedToShipped: (order.releasedToShipped as boolean) || false,
                releasedToCancelled: (order.releasedToCancelled as boolean) || false,
                isExchange: (order.isExchange as boolean) || false,
                // Note: isOnHold, awbNumber, courier, shippedAt, trackingStatus are now at line level
                isOnHold: false,
                orderAwbNumber: null, // No lines, so no AWB
                orderCourier: null,
                orderShippedAt: null,
                orderTrackingStatus: null,
                productName: '(no items)',
                colorName: '-',
                colorHex: null,
                imageUrl: null,
                size: '-',
                skuCode: '-',
                skuId: null,
                qty: 0,
                lineId: null,
                lineStatus: null,
                lineNotes: '',
                unitPrice: 0,
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
                shopifyTrackingUrl,
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
                orderStatus: (order.status as string) || 'pending',
                isArchived: (order.isArchived as boolean) || false,
                releasedToShipped: (order.releasedToShipped as boolean) || false,
                releasedToCancelled: (order.releasedToCancelled as boolean) || false,
                isExchange: (order.isExchange as boolean) || false,
                // Note: isOnHold, awbNumber, courier, shippedAt, trackingStatus are now at line level
                // Use line-level values for "order" fields (for display purposes, use first line's values)
                isOnHold: false,
                orderAwbNumber: line.awbNumber || null,
                orderCourier: line.courier || null,
                orderShippedAt: line.shippedAt || null,
                orderTrackingStatus: line.trackingStatus || null,
                productName: sku?.variation?.product?.name || '-',
                colorName: sku?.variation?.colorName || '-',
                colorHex: (() => {
                    // Priority: FabricColour (by matching name) > Fabric.colorHex > Variation.colorHex
                    const variationColorName = sku?.variation?.colorName?.toLowerCase().trim();
                    const fabricColours = sku?.variation?.fabric?.colours || [];
                    const matchingColour = fabricColours.find(
                        (c) => c.colourName?.toLowerCase().trim() === variationColorName
                    );
                    return matchingColour?.colourHex || sku?.variation?.fabric?.colorHex || sku?.variation?.colorHex || null;
                })(),
                imageUrl: sku?.variation?.imageUrl || sku?.variation?.product?.imageUrl || null,
                size: sku?.size || '-',
                skuCode: sku?.skuCode || '-',
                skuId: line.skuId || null,
                qty: line.qty,
                lineId: line.id,
                lineStatus: line.lineStatus,
                lineNotes: line.notes || '',
                unitPrice: line.unitPrice || 0,
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
                shopifyTrackingUrl,
                customerTags,
            });
        }
    }

    return rows;
}

// ============================================
// SSE HELPER: Fetch and flatten single line for broadcast
// ============================================

/**
 * Lightweight SELECT for fetching a single line for SSE broadcast
 * Includes just enough data to update client cache
 */
export const LINE_SSE_SELECT = {
    id: true,
    lineStatus: true,
    qty: true,
    unitPrice: true,
    skuId: true,
    notes: true,
    awbNumber: true,
    courier: true,
    shippedAt: true,
    deliveredAt: true,
    isCustomized: true,
    trackingStatus: true,
    lastTrackingUpdate: true,
    productionBatchId: true,
    orderId: true,
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
                    colorHex: true,
                    imageUrl: true,
                    product: {
                        select: {
                            id: true,
                            name: true,
                            imageUrl: true,
                        },
                    },
                    fabric: {
                        select: {
                            colorHex: true,
                            colours: {
                                select: {
                                    colourName: true,
                                    colourHex: true,
                                },
                            },
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
    order: {
        select: {
            id: true,
            orderNumber: true,
            orderDate: true,
            shipByDate: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            customerId: true,
            shippingAddress: true,
            totalAmount: true,
            paymentMethod: true,
            channel: true,
            status: true,
            isArchived: true,
            releasedToShipped: true,
            releasedToCancelled: true,
            internalNotes: true,
            isExchange: true,
            // Note: isOnHold, awbNumber, courier, shippedAt, trackingStatus removed from Order
            // These fields are now at line level
            customer: {
                select: {
                    tags: true,
                },
            },
            shopifyCache: {
                select: {
                    discountCodes: true,
                    customerNotes: true,
                    tags: true,
                    trackingNumber: true,
                    trackingCompany: true,
                    trackingUrl: true,
                    fulfillmentStatus: true,
                },
            },
            // Include _count to get total lines for this order
            _count: {
                select: {
                    orderLines: true,
                },
            },
        },
    },
} as const;

/**
 * Flatten a single fetched line into row format for SSE broadcast
 * @param line - Line fetched with LINE_SSE_SELECT
 * @param customerStats - Customer stats (ltv, orderCount, rtoCount)
 * @returns Flattened row or null if data incomplete
 */
/** Shape of a line fetched with LINE_SSE_SELECT (manually declared because the select references a removed fabric relation) */
interface LineSsePayload {
    id: string;
    lineStatus: string;
    qty: number;
    unitPrice: number | null;
    skuId: string | null;
    notes: string | null;
    awbNumber: string | null;
    courier: string | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    isCustomized: boolean;
    trackingStatus: string | null;
    lastTrackingUpdate: Date | null;
    productionBatchId: string | null;
    orderId: string;
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
            colorName: string;
            colorHex: string | null;
            imageUrl: string | null;
            product: { id: string; name: string; imageUrl: string | null };
            fabric: { colorHex: string | null; colours: Array<{ colourName: string; colourHex: string | null }> } | null;
        };
    } | null;
    productionBatch: {
        id: string;
        batchCode: string | null;
        batchDate: Date;
        status: string;
    } | null;
    order: {
        id: string;
        orderNumber: string;
        orderDate: Date;
        shipByDate: Date | null;
        customerName: string;
        customerEmail: string | null;
        customerPhone: string | null;
        customerId: string | null;
        shippingAddress: string | null;
        totalAmount: number | null;
        paymentMethod: string | null;
        channel: string | null;
        status: string;
        isArchived: boolean;
        releasedToShipped: boolean | null;
        releasedToCancelled: boolean | null;
        internalNotes: string | null;
        isExchange: boolean;
        customer: { tags: string | null } | null;
        shopifyCache: {
            discountCodes: string | null;
            customerNotes: string | null;
            tags: string | null;
            trackingNumber: string | null;
            trackingCompany: string | null;
            trackingUrl: string | null;
            fulfillmentStatus: string | null;
        } | null;
        _count: { orderLines: number } | null;
    };
}

export function flattenLineForSSE(
    line: LineSsePayload | null,
    customerStats?: { ltv: number; orderCount: number; rtoCount: number; tier?: string }
): FlattenedOrderRow | null {
    if (!line || !line.order) return null;

    const order = line.order;
    const sku = line.sku;
    const productionBatch = line.productionBatch;
    const shopifyCache = order.shopifyCache;
    const customer = order.customer;

    // Parse city from shipping address
    let city = '-';
    if (order.shippingAddress) {
        try {
            const addr = JSON.parse(order.shippingAddress);
            city = addr.city || '-';
        } catch { /* ignore */ }
    }

    // Build SKU display strings
    const productName = sku?.variation?.product?.name || '-';
    const colorName = sku?.variation?.colorName || '-';
    // Priority: FabricColour (by matching name) > Fabric.colorHex > Variation.colorHex
    const variationColorNameLower = sku?.variation?.colorName?.toLowerCase().trim();
    const fabricColours = sku?.variation?.fabric?.colours || [];
    const matchingColour = fabricColours.find(
        (c: { colourName: string; colourHex: string | null }) => c.colourName?.toLowerCase().trim() === variationColorNameLower
    );
    const colorHex = matchingColour?.colourHex || sku?.variation?.fabric?.colorHex || sku?.variation?.colorHex || null;
    const imageUrl = sku?.variation?.imageUrl || sku?.variation?.product?.imageUrl || null;
    const skuCode = sku?.skuCode || '-';
    const size = sku?.size || '-';

    // Handle customization
    const isCustomized = line.isCustomized || sku?.isCustomSku || false;
    const customSkuCode = sku?.isCustomSku ? skuCode : null;

    return {
        // IDs
        orderId: order.id,
        lineId: line.id,
        skuId: line.skuId,

        // Order-level fields
        orderNumber: order.orderNumber,
        orderDate: order.orderDate instanceof Date ? order.orderDate.toISOString() : order.orderDate,
        shipByDate: order.shipByDate instanceof Date ? order.shipByDate.toISOString() : (order.shipByDate || null),
        customerName: order.customerName,
        customerEmail: order.customerEmail || null,
        customerPhone: order.customerPhone || null,
        customerId: order.customerId || null,
        city,
        customerOrderCount: customerStats?.orderCount || 0,
        customerLtv: customerStats?.ltv || 0,
        customerTier: customerStats?.tier || null,
        customerRtoCount: customerStats?.rtoCount || 0,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod || null,
        channel: order.channel || null,
        orderStatus: order.status,
        isArchived: order.isArchived,
        releasedToShipped: order.releasedToShipped || false,
        releasedToCancelled: order.releasedToCancelled || false,
        internalNotes: order.internalNotes || null,
        isExchange: order.isExchange || false,
        // Note: isOnHold, awbNumber, courier, shippedAt, trackingStatus are now at line level
        // For SSE, use line-level values for these fields
        isOnHold: false, // isOnHold no longer exists on Order
        orderAwbNumber: line.awbNumber || null, // Use line-level AWB
        orderCourier: line.courier || null, // Use line-level courier
        orderShippedAt: line.shippedAt instanceof Date ? line.shippedAt.toISOString() : (line.shippedAt || null), // Use line-level shippedAt
        orderTrackingStatus: line.trackingStatus || null, // Use line-level trackingStatus

        // Line-level fields
        lineStatus: line.lineStatus,
        qty: line.qty,
        unitPrice: line.unitPrice || 0,
        lineNotes: line.notes || '',
        productName,
        colorName,
        colorHex,
        imageUrl,
        skuCode,
        size,

        // Inventory (filled by client or set to 0)
        skuStock: 0,
        fabricBalance: 0,

        // Shopify
        shopifyStatus: shopifyCache?.fulfillmentStatus || '-',

        // Production
        productionBatch: productionBatch ? {
            id: productionBatch.id,
            batchCode: productionBatch.batchCode || '',
            batchDate: productionBatch.batchDate instanceof Date ? productionBatch.batchDate.toISOString() : productionBatch.batchDate,
            status: productionBatch.status,
        } : null,
        productionBatchId: productionBatch?.id || null,
        productionDate: productionBatch?.batchDate ? new Date(productionBatch.batchDate).toISOString().split('T')[0] : null,

        // Row metadata
        isFirstLine: false, // Will be corrected client-side if needed
        totalLines: order._count?.orderLines || 1,
        fulfillmentStage: null, // Would need full order context

        // Full order reference (minimal for SSE — cast because SSE provides partial order data)
        order: order as unknown as EnrichedOrder,

        // Customization
        isCustomized,
        isNonReturnable: false,
        customSkuCode,
        customizationType: sku?.customizationType || null,
        customizationValue: sku?.customizationValue || null,
        customizationNotes: sku?.customizationNotes || null,
        originalSkuCode: null,

        // Line-level tracking
        lineShippedAt: line.shippedAt instanceof Date ? line.shippedAt.toISOString() : (line.shippedAt || null),
        lineDeliveredAt: line.deliveredAt instanceof Date ? line.deliveredAt.toISOString() : (line.deliveredAt || null),
        lineTrackingStatus: line.trackingStatus || null,
        lineAwbNumber: line.awbNumber || null,
        lineCourier: line.courier || null,

        // Enriched fields (not computed for SSE - would need full context)
        daysInTransit: null,
        daysSinceDelivery: null,
        daysInRto: null,
        rtoStatus: null,

        // Shopify cache fields
        discountCodes: shopifyCache?.discountCodes || null,
        customerNotes: shopifyCache?.customerNotes || null,
        shopifyTags: shopifyCache?.tags || null,
        shopifyAwb: shopifyCache?.trackingNumber || null,
        shopifyCourier: shopifyCache?.trackingCompany || null,
        shopifyTrackingUrl: shopifyCache?.trackingUrl || null,

        // Customer tags (stored as comma-separated string, split for display)
        customerTags: customer?.tags ? customer.tags.split(',').map(t => t.trim()) : null,
    };
}
