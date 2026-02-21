/**
 * Order Views Configuration
 *
 * Defines all order views (open, shipped, rto, etc.) as configuration objects.
 * This follows the spreadsheet model: one table, filtered views.
 */

import type { Prisma } from '@prisma/client';

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
    enrichment: string[];
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
 * - enrichment: Array of enrichment keys (historical, kept for config compatibility)
 * - dateFilter: Optional date range filter config
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
// DELIVERY FLAG UTILITY
// ============================================

/** Days after shipping before flagging as needs_review */
export const DELIVERY_REVIEW_DAYS = 10;

export type DeliveryConfirmationFlag = 'confirm_delivery' | 'needs_review' | null;

/**
 * Compute delivery confirmation flag for a single line.
 * null = not applicable, 'confirm_delivery' = tracking says delivered, 'needs_review' = stale shipped
 */
export function computeDeliveryFlag(
    lineStatus: string | null,
    trackingStatus: string | null,
    shippedAt: string | Date | null,
): DeliveryConfirmationFlag {
    // Not shipped yet or already delivered — no flag needed
    if (!lineStatus || lineStatus !== 'shipped') return null;

    // Tracking says delivered but line is still shipped — needs confirmation
    if (trackingStatus === 'delivered') return 'confirm_delivery';

    // Shipped 10+ days with no delivery confirmation from any source
    if (shippedAt) {
        const ts = shippedAt instanceof Date ? shippedAt.getTime() : new Date(shippedAt).getTime();
        const daysSinceShipped = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
        if (daysSinceShipped >= DELIVERY_REVIEW_DAYS) return 'needs_review';
    }

    return null;
}
