/**
 * Orders Server Functions
 *
 * TanStack Start Server Functions for orders data fetching.
 * Uses Prisma for database queries with JavaScript-based transformation.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import { getISTMidnightAsUTC, getISTMonthStartAsUTC, getISTMonthEndAsUTC } from '@coh/shared';

// ============================================
// INPUT VALIDATION SCHEMAS
// ============================================

const searchAllInputSchema = z.object({
    q: z.string().min(2, 'Search query must be at least 2 characters'),
    limit: z.number().int().positive().max(50).default(10),
});

export type SearchAllInput = z.infer<typeof searchAllInputSchema>;

const ordersListInputSchema = z.object({
    view: z.enum(['open', 'shipped', 'rto', 'all', 'cancelled'] as const),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(1000).default(250),
    search: z.string().optional(),
    days: z.number().int().positive().optional(),
    sortBy: z.enum(['orderDate', 'archivedAt', 'shippedAt', 'createdAt'] as const).optional(),
    // Open view filters (server-side filtering for performance)
    allocatedFilter: z.enum(['all', 'allocated', 'pending']).optional(),
    productionFilter: z.enum(['all', 'scheduled', 'needs', 'ready']).optional(),
});

export type OrdersListInput = z.infer<typeof ordersListInputSchema>;

// ============================================
// RESPONSE TYPES
// ============================================

/**
 * Pipeline counts for Open view
 * Computed server-side for efficiency (SQL vs client iteration)
 */
export interface OpenViewCounts {
    /** Orders in pending state (not all lines allocated+) */
    pending: number;
    /** Orders in allocated state (all lines allocated but not all packed) */
    allocated: number;
    /** Orders ready to ship (all lines packed or shipped) */
    ready: number;
    /** Orders fully shipped but not released */
    releasableShipped: number;
    /** Orders fully cancelled but not released */
    releasableCancelled: number;
}

/**
 * Response type matching useUnifiedOrdersData expectations
 */
export interface OrdersResponse {
    rows: FlattenedOrderRow[];
    view: string;
    hasInventory: boolean;
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasMore: boolean;
    };
    /** Pipeline counts - only present for 'open' view */
    openViewCounts?: OpenViewCounts;
}

/**
 * Flattened row for AG-Grid display (one row per order line)
 */
export interface FlattenedOrderRow {
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
    orderStatus: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
    isExchange: boolean;
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
    skuStock: number;
    fabricBalance: number;
    shopifyStatus: string;
    productionBatch: {
        id: string;
        batchCode: string | null;
        batchDate: string | null;
        status: string;
    } | null;
    productionBatchId: string | null;
    productionDate: string | null;
    isFirstLine: boolean;
    totalLines: number;
    fulfillmentStage: string | null;
    order: {
        id: string;
        orderNumber: string;
        orderLines: Array<{
            id: string;
            lineStatus: string | null;
            qty: number;
            unitPrice: number;
            notes: string | null;
            awbNumber: string | null;
            courier: string | null;
            shippedAt: string | null;
            deliveredAt: string | null;
            trackingStatus: string | null;
            isCustomized: boolean;
            productionBatchId: string | null;
            skuId: string;
        }>;
        lastScanAt?: string | null;
    };
    isCustomized: boolean;
    isNonReturnable: boolean;
    customSkuCode: string | null;
    customizationType: string | null;
    customizationValue: string | null;
    customizationNotes: string | null;
    originalSkuCode: string | null;
    lineShippedAt: string | null;
    lineDeliveredAt: string | null;
    lineTrackingStatus: string | null;
    lineAwbNumber: string | null;
    lineCourier: string | null;
    daysInTransit: number | null;
    daysSinceDelivery: number | null;
    daysInRto: number | null;
    rtoStatus: string | null;
    // Return fields
    returnStatus: string | null;
    returnQty: number | null;
    discountCodes: string | null;
    customerNotes: string | null;
    shopifyTags: string | null;
    shopifyAwb: string | null;
    shopifyCourier: string | null;
    shopifyTrackingUrl: string | null;
    customerTags: string[] | null;
    /** null = no fabric colour linked, false = linked & in stock, true = linked & out of stock */
    isFabricOutOfStock: boolean | null;
}

// ============================================
// INTERNAL TYPES (for Prisma query results)
// ============================================

interface PrismaOrderLine {
    id: string;
    lineStatus: string | null;
    qty: number;
    unitPrice: number;
    notes: string | null;
    awbNumber: string | null;
    courier: string | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    trackingStatus: string | null;
    isCustomized: boolean;
    isNonReturnable: boolean;
    productionBatchId: string | null;
    rtoInitiatedAt: Date | null;
    rtoReceivedAt: Date | null;
    lastScanAt: Date | null;
    // Return fields
    returnStatus: string | null;
    returnQty: number | null;
    skuId: string;
    sku: {
        id: string;
        skuCode: string;
        size: string;
        isCustomSku: boolean;
        customizationType: string | null;
        customizationValue: string | null;
        customizationNotes: string | null;
        currentBalance: number;
        variation: {
            colorName: string;
            colorHex: string | null;
            imageUrl: string | null;
            product: {
                name: string;
                imageUrl: string | null;
            };
            bomLines: Array<{
                fabricColour: {
                    isOutOfStock: boolean;
                } | null;
            }>;
        };
    };
    productionBatch: {
        id: string;
        batchCode: string | null;
        batchDate: Date | null;
        status: string;
    } | null;
}

interface PrismaOrder {
    id: string;
    orderNumber: string;
    orderDate: Date;
    shipByDate: Date | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerId: string | null;
    shippingAddress: string | null;
    totalAmount: number;
    paymentMethod: string | null;
    channel: string | null;
    internalNotes: string | null;
    status: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
    isExchange: boolean;
    codRemittedAt: Date | null;
    customer: {
        tags: string | null;
        orderCount: number;
        ltv: number;
        tier: string | null;
        rtoCount: number;
    } | null;
    shopifyCache: {
        fulfillmentStatus: string | null;
        discountCodes: string | null;
        customerNotes: string | null;
        tags: string | null;
        trackingNumber: string | null;
        trackingCompany: string | null;
        trackingUrl: string | null;
    } | null;
    orderLines: PrismaOrderLine[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

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
 * Calculate days between a date and now
 */
function daysSince(date: Date | null): number | null {
    if (!date) return null;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format date to ISO string or null
 */
function toIsoString(date: Date | null): string | null {
    if (!date) return null;
    return date.toISOString();
}

/**
 * Calculate fulfillment stage from line statuses
 */
function calculateFulfillmentStage(orderLines: PrismaOrderLine[]): string {
    if (orderLines.length === 0) return 'pending';

    const totalLines = orderLines.length;
    const statusCounts = {
        pending: 0,
        allocated: 0,
        picked: 0,
        packed: 0,
        shipped: 0,
        cancelled: 0,
    };

    for (const line of orderLines) {
        const status = line.lineStatus as keyof typeof statusCounts;
        if (status in statusCounts) {
            statusCounts[status]++;
        }
    }

    // Determine fulfillment stage based on line statuses
    if (statusCounts.packed === totalLines && totalLines > 0) {
        return 'ready_to_ship';
    }
    if (statusCounts.picked + statusCounts.packed > 0) {
        return 'in_progress';
    }
    if (statusCounts.allocated === totalLines && totalLines > 0) {
        return 'allocated';
    }
    return 'pending';
}

/**
 * Calculate RTO status from line data
 */
function calculateRtoStatus(line: PrismaOrderLine): string | null {
    if (line.rtoReceivedAt) return 'received';
    if (line.rtoInitiatedAt) return 'in_transit';
    return null;
}

/**
 * Parse customer tags from string or array
 */
function parseCustomerTags(tags: string | null): string[] | null {
    if (!tags) return null;
    try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) return parsed;
        return tags.split(',').map((t: string) => t.trim());
    } catch {
        return tags.split(',').map((t: string) => t.trim());
    }
}

/**
 * Build Prisma where clause for view filtering
 */
function buildWhereClause(
    view: 'open' | 'shipped' | 'rto' | 'all' | 'cancelled',
    search: string | undefined,
    sinceDate: Date | null,
    allocatedFilter?: 'all' | 'allocated' | 'pending',
    productionFilter?: 'all' | 'scheduled' | 'needs' | 'ready'
): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {
        isArchived: false,
    };

    // View-specific filtering
    switch (view) {
        case 'open':
            // Must match ORDER_VIEWS.open from orderViews.ts exactly
            // Base open view conditions
            const openBaseConditions: Prisma.OrderWhereInput[] = [
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
            ];

            // Apply allocated filter (filters orders with matching lines)
            if (allocatedFilter === 'allocated') {
                // Orders with at least one allocated/picked/packed line
                where.AND = [
                    { OR: openBaseConditions },
                    {
                        orderLines: {
                            some: {
                                lineStatus: { in: ['allocated', 'picked', 'packed'] },
                            },
                        },
                    },
                ];
            } else if (allocatedFilter === 'pending') {
                // Orders with at least one pending line
                where.AND = [
                    { OR: openBaseConditions },
                    {
                        orderLines: {
                            some: {
                                lineStatus: 'pending',
                            },
                        },
                    },
                ];
            } else {
                where.OR = openBaseConditions;
            }

            // Apply production filter (additional narrowing)
            if (productionFilter && productionFilter !== 'all') {
                // Ensure AND array exists
                if (!where.AND) {
                    where.AND = where.OR ? [{ OR: where.OR }] : [];
                    delete where.OR;
                }

                if (productionFilter === 'scheduled') {
                    // Orders with at least one scheduled line
                    (where.AND as Prisma.OrderWhereInput[]).push({
                        orderLines: {
                            some: {
                                productionBatchId: { not: null },
                            },
                        },
                    });
                } else if (productionFilter === 'needs') {
                    // Orders with pending lines without production batch
                    // Note: Stock comparison (skuStock < qty) still done client-side
                    // because it requires comparing sku.currentBalance with qty
                    (where.AND as Prisma.OrderWhereInput[]).push({
                        orderLines: {
                            some: {
                                lineStatus: 'pending',
                                productionBatchId: null,
                            },
                        },
                    });
                } else if (productionFilter === 'ready') {
                    // Orders where ALL non-cancelled lines are allocated/picked/packed
                    // This means NO lines exist that are pending or in other non-ready states
                    (where.AND as Prisma.OrderWhereInput[]).push(
                        // Must have at least one allocated/picked/packed line
                        {
                            orderLines: {
                                some: {
                                    lineStatus: { in: ['allocated', 'picked', 'packed'] },
                                },
                            },
                        },
                        // Must NOT have any pending lines (shipped/cancelled are OK)
                        {
                            NOT: {
                                orderLines: {
                                    some: {
                                        lineStatus: 'pending',
                                    },
                                },
                            },
                        }
                    );
                }
            }
            break;

        case 'shipped':
            where.releasedToShipped = true;
            // Exclude RTO orders from shipped view
            where.NOT = {
                orderLines: {
                    some: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered', 'rto_initiated'] },
                    },
                },
            };
            break;

        case 'rto':
            // Orders with at least one line in RTO status
            where.orderLines = {
                some: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered', 'rto_initiated'] },
                },
            };
            break;

        case 'all':
            // No additional filters - shows all non-archived orders
            break;

        case 'cancelled':
            where.releasedToCancelled = true;
            break;
    }

    // Search filter
    if (search && search.trim()) {
        const searchTerm = search.trim();
        where.OR = [
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { customerName: { contains: searchTerm, mode: 'insensitive' } },
            { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
            { customerPhone: { contains: searchTerm } },
            { orderLines: { some: { awbNumber: { contains: searchTerm } } } },
        ];
    }

    // Days filter
    if (sinceDate) {
        where.orderDate = { gte: sinceDate };
    }

    return where;
}

/**
 * Transform Prisma orders to flattened rows for AG-Grid
 */
function flattenOrdersToRows(orders: PrismaOrder[]): FlattenedOrderRow[] {
    const rows: FlattenedOrderRow[] = [];

    for (const order of orders) {
        const city = parseCity(order.shippingAddress);
        const shopifyStatus = order.shopifyCache?.fulfillmentStatus || '-';
        const customerTags = parseCustomerTags(order.customer?.tags || null);

        // Build order reference with parsed orderLines for client compatibility
        const orderRef = {
            id: order.id,
            orderNumber: order.orderNumber,
            orderLines: order.orderLines.map((line) => ({
                id: line.id,
                lineStatus: line.lineStatus,
                qty: line.qty,
                unitPrice: line.unitPrice,
                notes: line.notes,
                awbNumber: line.awbNumber,
                courier: line.courier,
                shippedAt: toIsoString(line.shippedAt),
                deliveredAt: toIsoString(line.deliveredAt),
                trackingStatus: line.trackingStatus,
                isCustomized: line.isCustomized,
                productionBatchId: line.productionBatchId,
                skuId: line.skuId,
            })),
            lastScanAt: order.orderLines[0]?.lastScanAt
                ? toIsoString(order.orderLines[0].lastScanAt)
                : null,
        };

        const totalLines = order.orderLines.length;
        const fulfillmentStage = calculateFulfillmentStage(order.orderLines);

        // Handle orders with no lines
        if (order.orderLines.length === 0) {
            rows.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate.toISOString(),
                shipByDate: toIsoString(order.shipByDate),
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                customerId: order.customerId,
                city,
                customerOrderCount: order.customer?.orderCount ?? 0,
                customerLtv: order.customer?.ltv ?? 0,
                customerTier: order.customer?.tier ?? null,
                customerRtoCount: order.customer?.rtoCount ?? 0,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                channel: order.channel,
                internalNotes: order.internalNotes,
                orderStatus: order.status || 'pending',
                isArchived: order.isArchived,
                releasedToShipped: order.releasedToShipped,
                releasedToCancelled: order.releasedToCancelled,
                isExchange: order.isExchange,
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
                fulfillmentStage: null,
                order: orderRef,
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
                daysInTransit: null,
                daysSinceDelivery: null,
                daysInRto: null,
                rtoStatus: null,
                // Return status fields
                returnStatus: null,
                returnQty: null,
                discountCodes: order.shopifyCache?.discountCodes ?? null,
                customerNotes: order.shopifyCache?.customerNotes ?? null,
                shopifyTags: order.shopifyCache?.tags ?? null,
                shopifyAwb: order.shopifyCache?.trackingNumber ?? null,
                shopifyCourier: order.shopifyCache?.trackingCompany ?? null,
                shopifyTrackingUrl: order.shopifyCache?.trackingUrl ?? null,
                customerTags,
                isFabricOutOfStock: null, // No lines = no fabric linked
            });
            continue;
        }

        // Create a row for each order line
        for (let i = 0; i < order.orderLines.length; i++) {
            const line = order.orderLines[i];
            const isFirstLine = i === 0;
            const rtoStatus = calculateRtoStatus(line);

            rows.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate.toISOString(),
                shipByDate: toIsoString(order.shipByDate),
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                customerId: order.customerId,
                city,
                customerOrderCount: order.customer?.orderCount ?? 0,
                customerLtv: order.customer?.ltv ?? 0,
                customerTier: order.customer?.tier ?? null,
                customerRtoCount: order.customer?.rtoCount ?? 0,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                channel: order.channel,
                internalNotes: order.internalNotes,
                orderStatus: order.status || 'pending',
                isArchived: order.isArchived,
                releasedToShipped: order.releasedToShipped,
                releasedToCancelled: order.releasedToCancelled,
                isExchange: order.isExchange,
                productName: line.sku.variation.product.name || '(unknown)',
                colorName: line.sku.variation.colorName || '-',
                colorHex: line.sku.variation.colorHex || null,
                imageUrl:
                    line.sku.variation.imageUrl || line.sku.variation.product.imageUrl || null,
                size: line.sku.size || '-',
                skuCode: line.sku.skuCode || '-',
                skuId: line.skuId,
                qty: line.qty,
                lineId: line.id,
                lineStatus: line.lineStatus,
                lineNotes: line.notes || '',
                unitPrice: line.unitPrice,
                skuStock: line.sku.currentBalance ?? 0,
                fabricBalance: 0,
                shopifyStatus,
                productionBatch: line.productionBatch
                    ? {
                          id: line.productionBatch.id,
                          batchCode: line.productionBatch.batchCode,
                          batchDate: line.productionBatch.batchDate
                              ? line.productionBatch.batchDate.toISOString().split('T')[0]
                              : null,
                          status: line.productionBatch.status,
                      }
                    : null,
                productionBatchId: line.productionBatchId,
                productionDate: line.productionBatch?.batchDate
                    ? line.productionBatch.batchDate.toISOString().split('T')[0]
                    : null,
                isFirstLine,
                totalLines,
                fulfillmentStage,
                order: orderRef,
                isCustomized: line.isCustomized || false,
                isNonReturnable: line.isNonReturnable || line.isCustomized || false,
                customSkuCode: line.sku.isCustomSku ? line.sku.skuCode : null,
                customizationType: line.sku.customizationType || null,
                customizationValue: line.sku.customizationValue || null,
                customizationNotes: line.sku.customizationNotes || null,
                originalSkuCode: null, // Not tracked in current query
                lineShippedAt: toIsoString(line.shippedAt),
                lineDeliveredAt: toIsoString(line.deliveredAt),
                lineTrackingStatus: line.trackingStatus,
                lineAwbNumber: line.awbNumber,
                lineCourier: line.courier,
                daysInTransit: daysSince(line.shippedAt),
                daysSinceDelivery: daysSince(line.deliveredAt),
                daysInRto: daysSince(line.rtoInitiatedAt),
                rtoStatus,
                // Return status fields
                returnStatus: line.returnStatus ?? null,
                returnQty: line.returnQty ?? null,
                discountCodes: order.shopifyCache?.discountCodes ?? null,
                customerNotes: order.shopifyCache?.customerNotes ?? null,
                shopifyTags: order.shopifyCache?.tags ?? null,
                shopifyAwb: order.shopifyCache?.trackingNumber ?? null,
                shopifyCourier: order.shopifyCache?.trackingCompany ?? null,
                shopifyTrackingUrl: order.shopifyCache?.trackingUrl ?? null,
                customerTags,
                // null = no fabric linked via BOM, false = linked & in stock, true = linked & OOS
                isFabricOutOfStock: line.sku.variation.bomLines.length > 0
                    ? (line.sku.variation.bomLines[0].fabricColour?.isOutOfStock ?? false)
                    : null,
            });
        }
    }

    return rows;
}

/**
 * Compute pipeline counts for Open view
 *
 * Runs efficient SQL count queries to determine order distribution:
 * - pending: has at least one pending line
 * - allocated: no pending lines, has at least one allocated/picked line (not all packed)
 * - ready: all non-cancelled lines are packed or shipped
 * - releasableShipped: fully shipped but not released
 * - releasableCancelled: fully cancelled but not released
 */
async function computeOpenViewCounts(
    prisma: Awaited<ReturnType<typeof getPrisma>>
): Promise<OpenViewCounts> {
    // Base condition for open orders (not archived)
    const baseCondition = { isArchived: false };

    // Run all count queries in parallel for efficiency
    const [pending, allocated, ready, releasableShipped, releasableCancelled] = await Promise.all([
        // Pending: orders with at least one pending line (not shipped/cancelled)
        prisma.order.count({
            where: {
                ...baseCondition,
                orderLines: {
                    some: { lineStatus: 'pending' },
                },
                // Must be in open view (not released)
                releasedToShipped: false,
                releasedToCancelled: false,
            },
        }),

        // Allocated: no pending lines, but has allocated/picked lines (not all packed/shipped)
        prisma.order.count({
            where: {
                ...baseCondition,
                releasedToShipped: false,
                releasedToCancelled: false,
                // No pending lines
                NOT: {
                    orderLines: { some: { lineStatus: 'pending' } },
                },
                // Has at least one allocated or picked line
                orderLines: {
                    some: { lineStatus: { in: ['allocated', 'picked'] } },
                },
            },
        }),

        // Ready: all non-cancelled lines are packed or shipped
        prisma.order.count({
            where: {
                ...baseCondition,
                releasedToShipped: false,
                releasedToCancelled: false,
                // No pending, allocated, or picked lines
                NOT: {
                    orderLines: { some: { lineStatus: { in: ['pending', 'allocated', 'picked'] } } },
                },
                // Has at least one packed line (not yet shipped)
                orderLines: {
                    some: { lineStatus: 'packed' },
                },
            },
        }),

        // Releasable Shipped: fully shipped, not released
        // All non-cancelled lines must be shipped
        prisma.order.count({
            where: {
                ...baseCondition,
                releasedToShipped: false,
                // Has at least one shipped line
                orderLines: { some: { lineStatus: 'shipped' } },
                // No lines that aren't shipped or cancelled
                NOT: {
                    orderLines: {
                        some: { lineStatus: { notIn: ['shipped', 'cancelled'] } },
                    },
                },
            },
        }),

        // Releasable Cancelled: all lines cancelled, not released
        prisma.order.count({
            where: {
                ...baseCondition,
                releasedToCancelled: false,
                // Has at least one line
                orderLines: { some: {} },
                // All lines must be cancelled (no non-cancelled lines)
                NOT: {
                    orderLines: {
                        some: { lineStatus: { not: 'cancelled' } },
                    },
                },
            },
        }),
    ]);

    return {
        pending,
        allocated,
        ready,
        releasableShipped,
        releasableCancelled,
    };
}

// ============================================
// SERVER FUNCTION
// ============================================

/**
 * Server Function: Get orders list
 *
 * Fetches orders directly from database using Prisma.
 * Returns flattened rows ready for AG-Grid display.
 */
export const getOrders = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => ordersListInputSchema.parse(input))
    .handler(async ({ data }): Promise<OrdersResponse> => {
        console.log('[Server Function] getOrders called with:', data);

        try {
            const prisma = await getPrisma();

            const { view, page, limit, search, days, sortBy, allocatedFilter, productionFilter } = data;
            const offset = (page - 1) * limit;

            // Calculate date filter if days specified
            let sinceDate: Date | null = null;
            if (days) {
                sinceDate = new Date();
                sinceDate.setDate(sinceDate.getDate() - days);
            }

            // Build where clause with filters (filters only apply to 'open' view)
            const where = buildWhereClause(
                view,
                search,
                sinceDate,
                view === 'open' ? allocatedFilter : undefined,
                view === 'open' ? productionFilter : undefined
            );

            // Determine sort field
            const sortField = sortBy || 'orderDate';
            const orderBy = { [sortField]: 'desc' as const };

            // Execute count, data, and pipeline counts queries in parallel
            // Pipeline counts only computed for 'open' view (where they're displayed)
            const [totalCount, orders, openViewCounts] = await Promise.all([
                prisma.order.count({ where }),
                prisma.order.findMany({
                    where,
                    include: {
                        customer: {
                            select: {
                                tags: true,
                                orderCount: true,
                                ltv: true,
                                tier: true,
                                rtoCount: true,
                            },
                        },
                        shopifyCache: {
                            select: {
                                fulfillmentStatus: true,
                                discountCodes: true,
                                customerNotes: true,
                                tags: true,
                                trackingNumber: true,
                                trackingCompany: true,
                                trackingUrl: true,
                            },
                        },
                        orderLines: {
                            include: {
                                sku: {
                                    include: {
                                        variation: {
                                            include: {
                                                product: {
                                                    select: {
                                                        name: true,
                                                        imageUrl: true,
                                                    },
                                                },
                                                bomLines: {
                                                    where: { fabricColourId: { not: null } },
                                                    select: {
                                                        fabricColour: {
                                                            select: { isOutOfStock: true },
                                                        },
                                                    },
                                                    take: 1,
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
                            orderBy: { id: 'asc' },
                        },
                    },
                    orderBy,
                    skip: offset,
                    take: limit,
                }),
                // Only compute pipeline counts for 'open' view
                view === 'open' ? computeOpenViewCounts(prisma) : Promise.resolve(undefined),
            ]);

            console.log('[Server Function] Query returned', orders.length, 'orders, total:', totalCount);

            // Transform to flattened rows for AG-Grid
            const rows = flattenOrdersToRows(orders as PrismaOrder[]);

            // Calculate pagination
            const totalPages = Math.ceil(totalCount / limit);

            return {
                rows,
                view: data.view,
                hasInventory: true,
                pagination: {
                    total: totalCount,
                    page: data.page,
                    limit: data.limit,
                    totalPages,
                    hasMore: data.page < totalPages,
                },
                // Only include for 'open' view
                ...(openViewCounts ? { openViewCounts } : {}),
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrders:', error);
            throw error;
        }
    });

// ============================================
// VIEW COUNTS - For OrderViewTabs
// ============================================

export interface OrderViewCounts {
    open: number;
    shipped: number;
    rto: number;
    all: number;
}

/**
 * Server Function: Get order view counts
 *
 * Returns counts for each view tab for the segmented control.
 * Uses parallel count queries for performance.
 */
export const getOrderViewCounts = createServerFn({ method: 'GET' })
    .handler(async (): Promise<OrderViewCounts> => {
        console.log('[Server Function] getOrderViewCounts called');

        try {
            const prisma = await getPrisma();

            // Build where clauses for each view
            const openWhere = {
                isArchived: false,
                OR: [
                    { status: 'open' },
                    {
                        AND: [{ releasedToShipped: false }, { releasedToCancelled: false }],
                    },
                ],
            };

            const shippedWhere = {
                isArchived: false,
                releasedToShipped: true,
                NOT: {
                    orderLines: {
                        some: {
                            trackingStatus: { in: ['rto_in_transit', 'rto_delivered', 'rto_initiated'] },
                        },
                    },
                },
            };

            const rtoWhere = {
                isArchived: false,
                orderLines: {
                    some: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered', 'rto_initiated'] },
                    },
                },
            };

            const allWhere = {
                isArchived: false,
            };

            // Execute all count queries in parallel
            const [openCount, shippedCount, rtoCount, allCount] = await Promise.all([
                prisma.order.count({ where: openWhere }),
                prisma.order.count({ where: shippedWhere }),
                prisma.order.count({ where: rtoWhere }),
                prisma.order.count({ where: allWhere }),
            ]);

            return {
                open: openCount,
                shipped: shippedCount,
                rto: rtoCount,
                all: allCount,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrderViewCounts:', error);
            throw error;
        }
    });

// ============================================
// SEARCH ALL ORDERS - RESPONSE TYPES
// ============================================

export interface SearchResultOrder {
    id: string;
    orderNumber: string;
    customerId: string | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    status: string;
    paymentMethod: string | null;
    totalAmount: number | null;
    trackingStatus?: string;
    awbNumber?: string;
}

export interface TabResult {
    tab: string;
    tabName: string;
    count: number;
    orders: SearchResultOrder[];
}

export interface SearchAllResponse {
    query: string;
    totalResults: number;
    results: TabResult[];
}

// ============================================
// SEARCH ALL ORDERS - SERVER FUNCTION
// ============================================

/**
 * Helper to get tab display name
 */
function getTabDisplayName(tab: string): string {
    const names: Record<string, string> = {
        open: 'Open',
        cancelled: 'Cancelled',
        shipped: 'Shipped',
        rto: 'RTO',
        cod_pending: 'COD Pending',
        archived: 'Archived',
    };
    return names[tab] || tab;
}

/**
 * Server Function: Search all orders across tabs
 *
 * Searches across all order statuses (open, shipped, cancelled, RTO, COD pending, archived)
 * and returns results grouped by tab.
 */
export const searchAllOrders = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => searchAllInputSchema.parse(input))
    .handler(async ({ data }): Promise<SearchAllResponse> => {
        console.log('[Server Function] searchAllOrders called with:', data);

        try {
            const prisma = await getPrisma();

            const { q, limit } = data;
            const searchTerm = q.trim();
            const take = Math.min(limit, 20); // Cap at 20 per tab

            // Build search OR clause
            // AWB is on OrderLine, so search via nested relation
            const searchWhere = {
                OR: [
                    { orderNumber: { contains: searchTerm, mode: 'insensitive' as const } },
                    { customerName: { contains: searchTerm, mode: 'insensitive' as const } },
                    { customerEmail: { contains: searchTerm, mode: 'insensitive' as const } },
                    { customerPhone: { contains: searchTerm } },
                    // Search AWB via order lines
                    { orderLines: { some: { awbNumber: { contains: searchTerm } } } },
                ],
            };

            // Define tab filters (matching buildWhereClause logic from getOrders)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tabs: Record<string, any> = {
                open: {
                    AND: [
                        searchWhere,
                        {
                            isArchived: false,
                            // Match buildWhereClause: status='open' OR (not released to shipped/cancelled)
                            OR: [
                                { status: 'open' },
                                {
                                    AND: [{ releasedToShipped: false }, { releasedToCancelled: false }],
                                },
                            ],
                        },
                    ],
                },
                shipped: {
                    AND: [
                        searchWhere,
                        {
                            isArchived: false,
                            releasedToShipped: true,
                        },
                        // Exclude RTO orders (check at line level)
                        {
                            NOT: {
                                orderLines: {
                                    some: {
                                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                                    },
                                },
                            },
                        },
                    ],
                },
                rto: {
                    AND: [
                        searchWhere,
                        {
                            isArchived: false,
                            releasedToShipped: true,
                            orderLines: {
                                some: {
                                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                                },
                            },
                        },
                    ],
                },
                cod_pending: {
                    AND: [
                        searchWhere,
                        {
                            isArchived: false,
                            releasedToShipped: true,
                            paymentMethod: 'COD',
                            codRemittedAt: null,
                            // At least one delivered line
                            orderLines: {
                                some: { trackingStatus: 'delivered' },
                            },
                        },
                    ],
                },
                cancelled: {
                    AND: [searchWhere, { releasedToCancelled: true, isArchived: false }],
                },
                archived: {
                    AND: [searchWhere, { isArchived: true }],
                },
            };

            // Query all tabs in parallel
            const queries = Object.entries(tabs).map(([tabName, where]) =>
                prisma.order
                    .findMany({
                        where,
                        select: {
                            id: true,
                            orderNumber: true,
                            customerId: true,
                            customerName: true,
                            customerEmail: true,
                            customerPhone: true,
                            status: true,
                            paymentMethod: true,
                            totalAmount: true,
                            orderDate: true,
                            // Get first line's AWB and tracking status for display
                            orderLines: {
                                select: {
                                    awbNumber: true,
                                    trackingStatus: true,
                                },
                                take: 1,
                            },
                        },
                        orderBy: { orderDate: 'desc' },
                        take,
                    })
                    .then(
                        (
                            orders: Array<{
                                id: string;
                                orderNumber: string;
                                customerId: string | null;
                                customerName: string | null;
                                customerEmail: string | null;
                                customerPhone: string | null;
                                status: string;
                                paymentMethod: string | null;
                                totalAmount: number | null;
                                orderLines: Array<{
                                    awbNumber: string | null;
                                    trackingStatus: string | null;
                                }>;
                            }>
                        ) => ({
                            tab: tabName,
                            orders: orders.map((o) => ({
                                id: o.id,
                                orderNumber: o.orderNumber,
                                customerId: o.customerId,
                                customerName: o.customerName,
                                customerEmail: o.customerEmail,
                                customerPhone: o.customerPhone,
                                status: o.status,
                                paymentMethod: o.paymentMethod,
                                totalAmount: o.totalAmount,
                                awbNumber: o.orderLines[0]?.awbNumber ?? undefined,
                                trackingStatus: o.orderLines[0]?.trackingStatus ?? undefined,
                            })),
                        })
                    )
            );

            const tabResults = await Promise.all(queries);

            // Format response - filter out empty tabs
            const results = tabResults
                .filter((r) => r.orders.length > 0)
                .map((r) => ({
                    tab: r.tab,
                    tabName: getTabDisplayName(r.tab),
                    count: r.orders.length,
                    orders: r.orders,
                }));

            console.log(
                '[Server Function] searchAllOrders found',
                results.reduce((sum, r) => sum + r.count, 0),
                'results'
            );

            return {
                query: searchTerm,
                totalResults: results.reduce((sum, r) => sum + r.count, 0),
                results,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in searchAllOrders:', error);
            throw error;
        }
    });

// ============================================
// GET ORDER BY ID - For UnifiedOrderModal
// ============================================

const getOrderByIdInputSchema = z.object({
    id: z.string().uuid('Invalid order ID'),
});

export type GetOrderByIdInput = z.infer<typeof getOrderByIdInputSchema>;

/**
 * Order detail for UnifiedOrderModal
 * Includes all fields needed for view/edit/ship operations.
 */
export interface OrderDetail {
    id: string;
    orderNumber: string;
    orderDate: string;
    shipByDate: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    customerId: string | null;
    shippingAddress: string | null;
    totalAmount: number | null;
    paymentMethod: string | null;
    paymentStatus: string | null;
    channel: string | null;
    internalNotes: string | null;
    status: string;
    isArchived: boolean;
    releasedToShipped: boolean;
    releasedToCancelled: boolean;
    isExchange: boolean;
    codRemittedAt: string | null;
    customer: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        tags: string | null;
        orderCount: number;
        ltv: number;
        tier: string | null;
        rtoCount: number;
    } | null;
    shopifyCache: {
        fulfillmentStatus: string | null;
        discountCodes: string | null;
        customerNotes: string | null;
        tags: string | null;
        trackingNumber: string | null;
        trackingCompany: string | null;
        trackingUrl: string | null;
    } | null;
    orderLines: Array<{
        id: string;
        skuId: string;
        qty: number;
        unitPrice: number;
        lineStatus: string | null;
        notes: string | null;
        awbNumber: string | null;
        courier: string | null;
        shippedAt: string | null;
        deliveredAt: string | null;
        trackingStatus: string | null;
        rtoInitiatedAt: string | null;
        rtoReceivedAt: string | null;
        lastScanAt: string | null;
        lastScanLocation: string | null;
        expectedDeliveryDate: string | null;
        isCustomized: boolean;
        isNonReturnable: boolean;
        productionBatchId: string | null;
        sku: {
            id: string;
            skuCode: string;
            size: string;
            mrp: number | null;
            isCustomSku: boolean;
            customizationType: string | null;
            customizationValue: string | null;
            customizationNotes: string | null;
            variation: {
                id: string;
                colorName: string;
                colorHex: string | null;
                imageUrl: string | null;
                product: {
                    id: string;
                    name: string;
                    imageUrl: string | null;
                };
            };
        };
        productionBatch: {
            id: string;
            batchCode: string | null;
            batchDate: string | null;
            status: string;
        } | null;
    }>;
}

/**
 * Server Function: Get order by ID
 *
 * Fetches complete order details for the UnifiedOrderModal.
 * Includes all nested relations needed for view/edit/ship operations.
 */
// ============================================
// SEARCH UNIFIED - For useSearchOrders hook
// ============================================

const searchUnifiedInputSchema = z.object({
    q: z.string().min(2, 'Search query must be at least 2 characters'),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(500).default(100),
});

export type SearchUnifiedInput = z.infer<typeof searchUnifiedInputSchema>;

export interface SearchUnifiedResponse {
    data: FlattenedOrderRow[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
    searchQuery: string;
}

/**
 * Server Function: Search orders across all views
 *
 * Unified search that returns flattened rows for grid display.
 * Searches across all order statuses (open, shipped, cancelled).
 */
export const searchUnifiedOrders = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => searchUnifiedInputSchema.parse(input))
    .handler(async ({ data }): Promise<SearchUnifiedResponse> => {
        console.log('[Server Function] searchUnifiedOrders called with:', data);

        try {
            const prisma = await getPrisma();

            const { q, page, pageSize } = data;
            const offset = (page - 1) * pageSize;
            const searchTerm = q.trim();

            // Build search where clause - search across all views
            const where = {
                OR: [
                    { orderNumber: { contains: searchTerm, mode: 'insensitive' as const } },
                    { customerName: { contains: searchTerm, mode: 'insensitive' as const } },
                    { customerEmail: { contains: searchTerm, mode: 'insensitive' as const } },
                    { customerPhone: { contains: searchTerm } },
                    { orderLines: { some: { awbNumber: { contains: searchTerm } } } },
                ],
            };

            // Execute count and data queries in parallel
            const [totalCount, orders] = await Promise.all([
                prisma.order.count({ where }),
                prisma.order.findMany({
                    where,
                    include: {
                        customer: {
                            select: {
                                tags: true,
                                orderCount: true,
                                ltv: true,
                                tier: true,
                                rtoCount: true,
                            },
                        },
                        shopifyCache: {
                            select: {
                                fulfillmentStatus: true,
                                discountCodes: true,
                                customerNotes: true,
                                tags: true,
                                trackingNumber: true,
                                trackingCompany: true,
                                trackingUrl: true,
                            },
                        },
                        orderLines: {
                            include: {
                                sku: {
                                    include: {
                                        variation: {
                                            include: {
                                                product: {
                                                    select: {
                                                        name: true,
                                                        imageUrl: true,
                                                    },
                                                },
                                                bomLines: {
                                                    where: { fabricColourId: { not: null } },
                                                    select: {
                                                        fabricColour: {
                                                            select: { isOutOfStock: true },
                                                        },
                                                    },
                                                    take: 1,
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
                            orderBy: { id: 'asc' },
                        },
                    },
                    orderBy: { orderDate: 'desc' },
                    skip: offset,
                    take: pageSize,
                }),
            ]);

            console.log('[Server Function] searchUnifiedOrders found', orders.length, 'orders, total:', totalCount);

            // Transform to flattened rows for AG-Grid
            const rows = flattenOrdersToRows(orders as PrismaOrder[]);

            // Calculate pagination
            const totalPages = Math.ceil(totalCount / pageSize);

            return {
                data: rows,
                pagination: {
                    page,
                    pageSize,
                    total: totalCount,
                    totalPages,
                },
                searchQuery: searchTerm,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in searchUnifiedOrders:', error);
            throw error;
        }
    });

// ============================================
// GET ORDER BY ID - For UnifiedOrderModal
// ============================================

export const getOrderById = createServerFn({ method: 'GET' })
    .inputValidator((input: unknown) => getOrderByIdInputSchema.parse(input))
    .handler(async ({ data }): Promise<OrderDetail> => {
        try {
            const prisma = await getPrisma();

            const order = await prisma.order.findUnique({
                where: { id: data.id },
                include: {
                    customer: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                            tags: true,
                            orderCount: true,
                            ltv: true,
                            tier: true,
                            rtoCount: true,
                        },
                    },
                    shopifyCache: {
                        select: {
                            fulfillmentStatus: true,
                            discountCodes: true,
                            customerNotes: true,
                            tags: true,
                            trackingNumber: true,
                            trackingCompany: true,
                            trackingUrl: true,
                        },
                    },
                    orderLines: {
                        include: {
                            sku: {
                                include: {
                                    variation: {
                                        include: {
                                            product: true,
                                            bomLines: {
                                                where: { fabricColourId: { not: null } },
                                                select: {
                                                    fabricColour: {
                                                        select: { isOutOfStock: true },
                                                    },
                                                },
                                                take: 1,
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
                        orderBy: { id: 'asc' },
                    },
                },
            });

            if (!order) {
                throw new Error('Order not found');
            }

            // Transform dates to ISO strings
            return {
                id: order.id,
                orderNumber: order.orderNumber,
                orderDate: order.orderDate.toISOString(),
                shipByDate: order.shipByDate ? order.shipByDate.toISOString() : null,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                customerId: order.customerId,
                shippingAddress: order.shippingAddress,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                channel: order.channel,
                internalNotes: order.internalNotes,
                status: order.status,
                isArchived: order.isArchived,
                releasedToShipped: order.releasedToShipped,
                releasedToCancelled: order.releasedToCancelled,
                isExchange: order.isExchange,
                codRemittedAt: order.codRemittedAt ? order.codRemittedAt.toISOString() : null,
                customer: order.customer,
                shopifyCache: order.shopifyCache,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderLines: order.orderLines.map((line: any) => ({
                    id: line.id,
                    skuId: line.skuId,
                    qty: line.qty,
                    unitPrice: line.unitPrice,
                    lineStatus: line.lineStatus,
                    notes: line.notes,
                    awbNumber: line.awbNumber,
                    courier: line.courier,
                    shippedAt: line.shippedAt ? line.shippedAt.toISOString() : null,
                    deliveredAt: line.deliveredAt ? line.deliveredAt.toISOString() : null,
                    trackingStatus: line.trackingStatus,
                    rtoInitiatedAt: line.rtoInitiatedAt ? line.rtoInitiatedAt.toISOString() : null,
                    rtoReceivedAt: line.rtoReceivedAt ? line.rtoReceivedAt.toISOString() : null,
                    lastScanAt: line.lastScanAt ? line.lastScanAt.toISOString() : null,
                    lastScanLocation: line.lastScanLocation,
                    expectedDeliveryDate: line.expectedDeliveryDate ? line.expectedDeliveryDate.toISOString() : null,
                    isCustomized: line.isCustomized,
                    isNonReturnable: line.isNonReturnable,
                    productionBatchId: line.productionBatchId,
                    // Return fields
                    returnStatus: line.returnStatus,
                    returnQty: line.returnQty,
                    returnRequestedAt: line.returnRequestedAt ? line.returnRequestedAt.toISOString() : null,
                    returnReasonCategory: line.returnReasonCategory,
                    returnReasonDetail: line.returnReasonDetail,
                    returnResolution: line.returnResolution,
                    returnCondition: line.returnCondition,
                    returnConditionNotes: line.returnConditionNotes,
                    returnPickupType: line.returnPickupType,
                    returnAwbNumber: line.returnAwbNumber,
                    returnCourier: line.returnCourier,
                    returnPickupScheduledAt: line.returnPickupScheduledAt ? line.returnPickupScheduledAt.toISOString() : null,
                    returnPickupAt: line.returnPickupAt ? line.returnPickupAt.toISOString() : null,
                    returnReceivedAt: line.returnReceivedAt ? line.returnReceivedAt.toISOString() : null,
                    returnNotes: line.returnNotes,
                    returnRefundCompletedAt: line.returnRefundCompletedAt ? line.returnRefundCompletedAt.toISOString() : null,
                    returnExchangeOrderId: line.returnExchangeOrderId,
                    returnExchangeSkuId: line.returnExchangeSkuId,
                    sku: {
                        id: line.sku.id,
                        skuCode: line.sku.skuCode,
                        size: line.sku.size,
                        mrp: line.sku.mrp,
                        isCustomSku: line.sku.isCustomSku,
                        customizationType: line.sku.customizationType,
                        customizationValue: line.sku.customizationValue,
                        customizationNotes: line.sku.customizationNotes,
                        variation: {
                            id: line.sku.variation.id,
                            colorName: line.sku.variation.colorName,
                            colorHex: line.sku.variation.colorHex,
                            imageUrl: line.sku.variation.imageUrl,
                            product: {
                                id: line.sku.variation.product.id,
                                name: line.sku.variation.product.name,
                                imageUrl: line.sku.variation.product.imageUrl,
                            },
                        },
                    },
                    productionBatch: line.productionBatch ? {
                        id: line.productionBatch.id,
                        batchCode: line.productionBatch.batchCode,
                        batchDate: line.productionBatch.batchDate ?
                            line.productionBatch.batchDate.toISOString().split('T')[0] : null,
                        status: line.productionBatch.status,
                    } : null,
                })),
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrderById:', error);
            throw error;
        }
    });

// ============================================
// ORDERS ANALYTICS - Response Types
// ============================================

export interface CustomerStats {
    newCustomers: number;
    returningCustomers: number;
    newPercent: number;
    returningPercent: number;
}

export interface RevenueData {
    total: number;
    orderCount: number;
    change: number | null;
    customers?: CustomerStats;
}

export interface TopProduct {
    id: string;
    name: string;
    imageUrl: string | null;
    qty: number;
    orderCount: number;
    salesValue: number;
    variants: Array<{ name: string; qty: number }>;
}

export interface OrdersAnalyticsResponse {
    totalOrders: number;
    pendingOrders: number;
    allocatedOrders: number;
    readyToShip: number;
    totalUnits: number;
    paymentSplit: {
        cod: { count: number; amount: number };
        prepaid: { count: number; amount: number };
    };
    topProducts: TopProduct[];
    revenue: {
        today: RevenueData;
        yesterday: RevenueData;
        last7Days: RevenueData;
        last30Days: RevenueData;
        lastMonth: RevenueData;
        thisMonth: RevenueData;
    };
}

// ============================================
// ORDERS ANALYTICS - Server Function
// ============================================

/**
 * Server Function: Get orders analytics
 *
 * Returns analytics data for the OrdersAnalyticsBar component.
 * Includes pipeline counts, revenue data, payment split, and top products.
 */
export const getOrdersAnalytics = createServerFn({ method: 'GET' })
    .handler(async (): Promise<OrdersAnalyticsResponse> => {
        console.log('[Server Function] getOrdersAnalytics called');

        try {
            const prisma = await getPrisma();

            // Calculate date ranges in IST timezone for user-facing analytics
            // All dates are converted to UTC for database queries
            const todayStart = getISTMidnightAsUTC(0);
            const yesterdayStart = getISTMidnightAsUTC(-1);
            const yesterdayEnd = todayStart; // Yesterday ends when today starts
            const last7DaysStart = getISTMidnightAsUTC(-7);
            const last30DaysStart = getISTMidnightAsUTC(-30);
            const thisMonthStart = getISTMonthStartAsUTC(0);
            const lastMonthStart = getISTMonthStartAsUTC(-1);
            const lastMonthEnd = getISTMonthEndAsUTC(-1);

            // Open orders base filter
            const openFilter = {
                isArchived: false,
                OR: [
                    { status: 'open' },
                    {
                        AND: [{ releasedToShipped: false }, { releasedToCancelled: false }],
                    },
                ],
            };

            // Get pipeline counts by line status
            const [totalOrders, pendingLines, allocatedLines, readyLines, totalUnits] = await Promise.all([
                prisma.order.count({ where: openFilter }),
                prisma.orderLine.count({
                    where: {
                        order: openFilter,
                        lineStatus: 'pending',
                    },
                }),
                prisma.orderLine.count({
                    where: {
                        order: openFilter,
                        lineStatus: 'allocated',
                    },
                }),
                prisma.orderLine.count({
                    where: {
                        order: openFilter,
                        lineStatus: 'packed',
                    },
                }),
                prisma.orderLine.aggregate({
                    where: { order: openFilter },
                    _sum: { qty: true },
                }),
            ]);

            // Get payment split
            const [codOrders, prepaidOrders] = await Promise.all([
                prisma.order.aggregate({
                    where: { ...openFilter, paymentMethod: 'COD' },
                    _count: true,
                    _sum: { totalAmount: true },
                }),
                prisma.order.aggregate({
                    where: { ...openFilter, paymentMethod: { not: 'COD' } },
                    _count: true,
                    _sum: { totalAmount: true },
                }),
            ]);

            // Get revenue data for different periods
            const getRevenueForPeriod = async (startDate: Date, endDate?: Date) => {
                const dateFilter = endDate
                    ? { orderDate: { gte: startDate, lt: endDate } }
                    : { orderDate: { gte: startDate } };

                const result = await prisma.order.aggregate({
                    where: {
                        ...dateFilter,
                        releasedToCancelled: false,
                    },
                    _sum: { totalAmount: true },
                    _count: true,
                });

                // Get customer breakdown (new vs returning)
                const customerOrders = await prisma.order.findMany({
                    where: {
                        ...dateFilter,
                        releasedToCancelled: false,
                    },
                    select: {
                        customerId: true,
                        customer: {
                            select: { orderCount: true },
                        },
                    },
                });

                const newCustomers = customerOrders.filter((o: { customer: { orderCount: number } | null }) => o.customer?.orderCount === 1).length;
                const returningCustomers = customerOrders.length - newCustomers;
                const total = customerOrders.length || 1;

                return {
                    total: result._sum.totalAmount || 0,
                    orderCount: result._count,
                    change: null as number | null,
                    customers: {
                        newCustomers,
                        returningCustomers,
                        newPercent: Math.round((newCustomers / total) * 100),
                        returningPercent: Math.round((returningCustomers / total) * 100),
                    },
                };
            };

            // Get all revenue data in parallel
            const [today, yesterday, last7Days, last30Days, lastMonth, thisMonth] = await Promise.all([
                getRevenueForPeriod(todayStart),
                getRevenueForPeriod(yesterdayStart, yesterdayEnd),
                getRevenueForPeriod(last7DaysStart),
                getRevenueForPeriod(last30DaysStart),
                getRevenueForPeriod(lastMonthStart, lastMonthEnd),
                getRevenueForPeriod(thisMonthStart),
            ]);

            // Calculate change percentages
            if (yesterday.total > 0) {
                today.change = Math.round(((today.total - yesterday.total) / yesterday.total) * 100);
            }

            // Get top products from last 30 days
            const topProductsData = await prisma.orderLine.groupBy({
                by: ['skuId'],
                where: {
                    order: {
                        orderDate: { gte: last30DaysStart },
                        releasedToCancelled: false,
                    },
                },
                _sum: { qty: true, unitPrice: true },
                _count: { orderId: true },
                orderBy: { _sum: { qty: 'desc' } },
                take: 10,
            });

            // Get product details for top products
            const skuIds = topProductsData.map((p: { skuId: string }) => p.skuId);
            const skuDetails = await prisma.sku.findMany({
                where: { id: { in: skuIds } },
                include: {
                    variation: {
                        include: {
                            product: {
                                select: { id: true, name: true, imageUrl: true },
                            },
                        },
                    },
                },
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const skuMap = new Map<string, any>(skuDetails.map((s: any) => [s.id, s]));

            // Aggregate by product
            const productAggregates = new Map<string, TopProduct>();
            for (const item of topProductsData) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sku: any = skuMap.get(item.skuId);
                if (!sku) continue;

                const product = sku.variation.product;
                const existing = productAggregates.get(product.id);
                const qty = item._sum.qty || 0;
                const salesValue = (item._sum.unitPrice || 0) * qty;

                if (existing) {
                    existing.qty += qty;
                    existing.orderCount += item._count.orderId;
                    existing.salesValue += salesValue;
                    existing.variants.push({
                        name: `${sku.variation.colorName} - ${sku.size}`,
                        qty,
                    });
                } else {
                    productAggregates.set(product.id, {
                        id: product.id,
                        name: product.name,
                        imageUrl: product.imageUrl || sku.variation.imageUrl,
                        qty,
                        orderCount: item._count.orderId,
                        salesValue,
                        variants: [{
                            name: `${sku.variation.colorName} - ${sku.size}`,
                            qty,
                        }],
                    });
                }
            }

            const topProducts = Array.from(productAggregates.values())
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 6);

            return {
                totalOrders,
                pendingOrders: pendingLines,
                allocatedOrders: allocatedLines,
                readyToShip: readyLines,
                totalUnits: totalUnits._sum.qty || 0,
                paymentSplit: {
                    cod: {
                        count: codOrders._count,
                        amount: codOrders._sum.totalAmount || 0,
                    },
                    prepaid: {
                        count: prepaidOrders._count,
                        amount: prepaidOrders._sum.totalAmount || 0,
                    },
                },
                topProducts,
                revenue: {
                    today,
                    yesterday,
                    last7Days,
                    last30Days,
                    lastMonth,
                    thisMonth,
                },
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrdersAnalytics:', error);
            throw error;
        }
    });
