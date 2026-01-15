/**
 * Order Views Configuration
 *
 * Defines all order views (open, shipped, rto, etc.) as configuration objects.
 * This follows the spreadsheet model: one table, filtered views.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import {
    ORDER_LINES_INCLUDE,
    enrichOrdersWithCustomerStats,
    calculateFulfillmentStage,
    calculateLineStatusCounts,
    calculateDaysSince,
    determineTrackingStatus,
    extractShopifyTrackingFields,
    enrichOrderLinesWithAddresses,
    type ShopifyCache,
    type EnrichedShopifyCache,
} from './queryPatterns.js';

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

/**
 * Enrichment types that can be applied to orders
 */
export type EnrichmentType =
    | 'fulfillmentStage'
    | 'lineStatusCounts'
    | 'customerStats'
    | 'addressResolution'
    | 'daysInTransit'
    | 'trackingStatus'
    | 'shopifyTracking'
    | 'daysSinceDelivery'
    | 'rtoStatus';

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

/**
 * Order line for enrichment (minimal fields needed)
 */
interface OrderLineForEnrichment {
    lineStatus?: string | null;
    [key: string]: unknown;
}

/**
 * Order with orderLines and optional shopifyCache
 * Uses generic base with index signature for flexibility
 */
interface OrderWithRelations {
    customerId?: string | null;
    orderNumber?: string;
    totalAmount?: number | null;
    shippedAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    rtoInitiatedAt?: Date | string | null;
    rtoReceivedAt?: Date | string | null;
    trackingStatus?: string | null;
    orderLines?: OrderLineForEnrichment[];
    shopifyCache?: ShopifyCache | null;
    [key: string]: unknown;
}

/**
 * Enriched order with computed fields
 */
export interface EnrichedOrder {
    customerId?: string | null;
    orderNumber?: string;
    totalAmount?: number | null;
    shippedAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    rtoInitiatedAt?: Date | string | null;
    rtoReceivedAt?: Date | string | null;
    trackingStatus?: string | null;
    orderLines?: OrderLineForEnrichment[];
    shopifyCache?: ShopifyCache | EnrichedShopifyCache | Record<string, never> | null;
    daysInTransit?: number;
    rtoStatus?: 'received' | 'in_transit';
    daysInRto?: number;
    daysSinceDelivery?: number;
    fulfillmentStage?: string;
    totalLines?: number;
    pendingLines?: number;
    allocatedLines?: number;
    pickedLines?: number;
    packedLines?: number;
    customerLtv?: number;
    customerOrderCount?: number;
    customerRtoCount?: number;
    customerTier?: string;
    [key: string]: unknown;
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
     * Open Orders: Orders with at least one line that is not closed
     * Uses closedAt on OrderLine for visibility control (not Order.status)
     * Cancelled lines still show in open view (with strikethrough) until explicitly closed
     */
    open: {
        name: 'Open Orders',
        description: 'Orders pending fulfillment',
        where: {
            isArchived: false,
            // At least one line is open (closedAt is null) - includes cancelled lines
            orderLines: {
                some: {
                    closedAt: null,
                },
            },
        },
        orderBy: { orderDate: 'desc' }, // Newest first
        enrichment: ['fulfillmentStage', 'lineStatusCounts', 'customerStats', 'addressResolution'],
        defaultLimit: 10000,
    },

    /**
     * Shipped/Closed Orders: Orders where all non-cancelled lines are closed
     * This is the inverse of 'open' - all active lines have closedAt set
     */
    shipped: {
        name: 'Shipped Orders',
        description: 'Orders in transit or delivered',
        where: {
            isArchived: false,
            // All non-cancelled lines are closed
            NOT: {
                orderLines: {
                    some: {
                        closedAt: null,
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
            // Must have at least one line (exclude empty orders)
            orderLines: {
                some: {},
            },
        },
        // Exclude RTO orders
        excludeWhere: {
            trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
        },
        // Exclude delivered COD awaiting payment
        excludeCodPending: true,
        orderBy: { shippedAt: 'desc' },
        enrichment: ['daysInTransit', 'trackingStatus', 'shopifyTracking', 'customerStats'],
        dateFilter: { field: 'shippedAt', defaultDays: 30 },
        defaultLimit: 100,
    },

    rto: {
        name: 'RTO Orders',
        description: 'Return to origin orders',
        where: {
            trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
            isArchived: false,
        },
        orderBy: { rtoInitiatedAt: 'desc' },
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
        orderBy: { deliveredAt: 'desc' },
        enrichment: ['daysSinceDelivery', 'customerStats'],
        defaultLimit: 200,
    },

    archived: {
        name: 'Archived Orders',
        description: 'Completed or archived orders',
        where: {
            isArchived: true,
        },
        orderBy: { archivedAt: 'desc' },
        enrichment: ['customerStats'],
        defaultLimit: 100,
    },

    cancelled: {
        name: 'Cancelled Lines',
        description: 'Individual cancelled order lines (line-level view)',
        // Note: This view uses a special line-level query in listOrders.js
        // The where clause here is just for reference
        where: {
            status: 'cancelled', // Fully cancelled orders only for unified API
            isArchived: false,
        },
        orderBy: { createdAt: 'desc' },
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
            // At least one line is open (closedAt is null and not cancelled)
            orderLines: {
                some: {
                    closedAt: null,
                    lineStatus: { not: 'cancelled' },
                },
            },
        },
        orderBy: { orderDate: 'asc' }, // FIFO - oldest first
        enrichment: ['fulfillmentStage', 'lineStatusCounts', 'customerStats', 'addressResolution'],
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
// ENRICHMENT FUNCTIONS
// ============================================

/**
 * Apply enrichments to orders based on view configuration
 */
export async function enrichOrdersForView<T extends OrderWithRelations>(
    prisma: PrismaClient,
    orders: T[],
    enrichments: EnrichmentType[] = []
): Promise<EnrichedOrder[]> {
    if (!orders || orders.length === 0) return [];

    console.log('[enrichOrdersForView] Processing', orders.length, 'orders');

    // Always calculate totalAmount from orderLines if null (fallback for unmigrated data)
    let enriched: EnrichedOrder[] = orders.map((order, idx) => {
        if (order.totalAmount != null) return order as EnrichedOrder;

        // Calculate from orderLines
        const linesTotal =
            order.orderLines?.reduce((sum, line) => {
                const unitPrice = (line as { unitPrice?: number }).unitPrice || 0;
                const qty = (line as { qty?: number }).qty || 1;
                const lineTotal = unitPrice * qty;
                return sum + lineTotal;
            }, 0) || 0;

        // Debug first order
        if (idx === 0) {
            console.log(
                '[enrichOrdersForView] Order:',
                order.orderNumber,
                'db totalAmount:',
                order.totalAmount,
                'lines:',
                order.orderLines?.length,
                'linesTotal:',
                linesTotal
            );
        }

        // Fallback to shopifyCache rawData if no line prices
        if (linesTotal === 0 && order.shopifyCache?.rawData) {
            const rawData =
                typeof order.shopifyCache.rawData === 'string'
                    ? JSON.parse(order.shopifyCache.rawData)
                    : order.shopifyCache.rawData;
            return { ...order, totalAmount: parseFloat(rawData?.total_price) || null } as EnrichedOrder;
        }

        return { ...order, totalAmount: linesTotal > 0 ? linesTotal : null } as EnrichedOrder;
    });

    // Customer stats (common to most views)
    if (enrichments.includes('customerStats')) {
        const options = {
            includeFulfillmentStage: enrichments.includes('fulfillmentStage'),
            includeLineStatusCounts: enrichments.includes('lineStatusCounts'),
        };
        // Cast to expected type - enriched orders have customerId from DB query
        const ordersForStats = enriched.map((o) => ({
            ...o,
            customerId: o.customerId ?? null,
            orderLines: o.orderLines?.map((line) => ({
                ...line,
                lineStatus: (line.lineStatus ?? 'pending') as string,
            })),
        }));
        enriched = (await enrichOrdersWithCustomerStats(prisma, ordersForStats, options)) as EnrichedOrder[];
    }

    // Fulfillment stage (for open orders) - handled in customerStats if both present
    if (enrichments.includes('fulfillmentStage') && !enrichments.includes('customerStats')) {
        enriched = enriched.map((order) => ({
            ...order,
            fulfillmentStage: calculateFulfillmentStage(
                (order.orderLines || []) as { lineStatus: string }[]
            ),
        }));
    }

    // Line status counts (for open orders) - handled in customerStats if both present
    if (enrichments.includes('lineStatusCounts') && !enrichments.includes('customerStats')) {
        enriched = enriched.map((order) => ({
            ...order,
            ...calculateLineStatusCounts((order.orderLines || []) as { lineStatus: string }[]),
        }));
    }

    // Days in transit (for shipped/rto)
    if (enrichments.includes('daysInTransit')) {
        enriched = enriched.map((order) => ({
            ...order,
            daysInTransit: calculateDaysSince(order.shippedAt),
        }));
    }

    // Tracking status (for shipped)
    if (enrichments.includes('trackingStatus')) {
        enriched = enriched.map((order) => {
            const daysInTransit = order.daysInTransit ?? calculateDaysSince(order.shippedAt);
            return {
                ...order,
                trackingStatus: determineTrackingStatus(
                    {
                        trackingStatus: order.trackingStatus as string | null | undefined,
                        rtoReceivedAt: order.rtoReceivedAt as Date | null | undefined,
                        rtoInitiatedAt: order.rtoInitiatedAt as Date | null | undefined,
                        status: order.status as string | undefined,
                        deliveredAt: order.deliveredAt as Date | null | undefined,
                    },
                    daysInTransit
                ),
            };
        });
    }

    // Shopify tracking extraction (for shipped)
    if (enrichments.includes('shopifyTracking')) {
        enriched = enriched.map((order) => ({
            ...order,
            shopifyCache: extractShopifyTrackingFields(order.shopifyCache as ShopifyCache | null | undefined),
        }));
    }

    // Days since delivery (for COD pending)
    if (enrichments.includes('daysSinceDelivery')) {
        enriched = enriched.map((order) => ({
            ...order,
            daysSinceDelivery: calculateDaysSince(order.deliveredAt),
        }));
    }

    // RTO status (for RTO view)
    if (enrichments.includes('rtoStatus')) {
        enriched = enriched.map((order) => {
            const isReceived = order.trackingStatus === 'rto_delivered' || order.rtoReceivedAt;
            return {
                ...order,
                rtoStatus: isReceived ? 'received' : 'in_transit',
                daysInRto: calculateDaysSince(order.rtoInitiatedAt),
            };
        });
    }

    // Address resolution (fallback to shopifyCache for old orders)
    if (enrichments.includes('addressResolution')) {
        enriched = enriched.map((order) =>
            enrichOrderLinesWithAddresses(order) as EnrichedOrder
        );
    }

    return enriched;
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

    // Relations
    customer: true,
    orderLines: ORDER_LINES_INCLUDE,
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
            rawData: true, // For tracking extraction
            // Generated columns (auto-populated from rawData by PostgreSQL)
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
