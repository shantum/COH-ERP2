/**
 * Order Views Configuration
 * 
 * Defines all order views (open, shipped, rto, etc.) as configuration objects.
 * This follows the spreadsheet model: one table, filtered views.
 */

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
export const ORDER_VIEWS = {
    open: {
        name: 'Open Orders',
        description: 'Orders pending fulfillment',
        where: {
            status: 'open',
            isArchived: false,
        },
        orderBy: { orderDate: 'asc' }, // Oldest first (FIFO queue)
        enrichment: ['fulfillmentStage', 'lineStatusCounts', 'customerStats'],
        defaultLimit: 10000,
    },

    shipped: {
        name: 'Shipped Orders',
        description: 'Orders in transit or delivered',
        where: {
            status: { in: ['shipped', 'delivered'] },
            isArchived: false,
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

    all: {
        name: 'All Orders',
        description: 'All orders without filtering',
        where: {},
        orderBy: { orderDate: 'desc' },
        enrichment: ['customerStats'],
        defaultLimit: 50,
    },
};

// ============================================
// WHERE CLAUSE BUILDER
// ============================================

/**
 * Build the complete WHERE clause for a view
 * Handles exclusions and additional filters
 */
export function buildViewWhereClause(viewName, options = {}) {
    const view = ORDER_VIEWS[viewName];
    if (!view) {
        throw new Error(`Unknown view: ${viewName}`);
    }

    const { days, search, additionalFilters = {} } = options;

    // Start with base where clause
    let where = { ...view.where };

    // Apply date filter if view has one and days is specified
    if (view.dateFilter && days) {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - Number(days));
        where[view.dateFilter.field] = { gte: sinceDate };
    } else if (view.dateFilter && view.dateFilter.defaultDays && viewName !== 'all') {
        // Apply default date filter
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - view.dateFilter.defaultDays);
        where[view.dateFilter.field] = { gte: sinceDate };
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
        ];
    }

    // Apply additional filters
    Object.entries(additionalFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            where[key] = value;
        }
    });

    return where;
}

// ============================================
// ENRICHMENT FUNCTIONS
// ============================================

import {
    enrichOrdersWithCustomerStats,
    calculateFulfillmentStage,
    calculateLineStatusCounts,
    calculateDaysSince,
    determineTrackingStatus,
    extractShopifyTrackingFields,
} from './queryPatterns.js';

/**
 * Apply enrichments to orders based on view configuration
 */
export async function enrichOrdersForView(prisma, orders, enrichments = []) {
    if (!orders || orders.length === 0) return orders;

    let enriched = orders;

    // Customer stats (common to most views)
    if (enrichments.includes('customerStats')) {
        const options = {
            includeFulfillmentStage: enrichments.includes('fulfillmentStage'),
            includeLineStatusCounts: enrichments.includes('lineStatusCounts'),
        };
        enriched = await enrichOrdersWithCustomerStats(prisma, enriched, options);
    }

    // Fulfillment stage (for open orders) - handled in customerStats if both present
    if (enrichments.includes('fulfillmentStage') && !enrichments.includes('customerStats')) {
        enriched = enriched.map((order) => ({
            ...order,
            fulfillmentStage: calculateFulfillmentStage(order.orderLines),
        }));
    }

    // Line status counts (for open orders) - handled in customerStats if both present
    if (enrichments.includes('lineStatusCounts') && !enrichments.includes('customerStats')) {
        enriched = enriched.map((order) => ({
            ...order,
            ...calculateLineStatusCounts(order.orderLines),
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
                trackingStatus: determineTrackingStatus(order, daysInTransit),
            };
        });
    }

    // Shopify tracking extraction (for shipped)
    if (enrichments.includes('shopifyTracking')) {
        enriched = enriched.map((order) => ({
            ...order,
            shopifyCache: extractShopifyTrackingFields(order.shopifyCache),
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

    return enriched;
}

// ============================================
// UNIFIED SELECT PATTERN
// ============================================

import { ORDER_LINES_INCLUDE } from './queryPatterns.js';

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
        },
    },
};

/**
 * Get view names for validation
 */
export function getValidViewNames() {
    return Object.keys(ORDER_VIEWS);
}

/**
 * Get view configuration
 */
export function getViewConfig(viewName) {
    return ORDER_VIEWS[viewName] || null;
}
