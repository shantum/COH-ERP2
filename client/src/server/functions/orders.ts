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
import type { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import { authMiddleware } from '../middleware/auth';

// Re-export types and schemas from orderTypes.ts for backward compatibility
export type {
    SearchAllInput,
    OrdersListInput,
    OrdersResponse,
    FlattenedOrderRow,
    OrderViewCounts,
    SearchResultOrder,
    TabResult,
    SearchAllResponse,
    GetOrderByIdInput,
    OrderDetail,
    SearchUnifiedInput,
    SearchUnifiedResponse,
    OrderForExchange,
    GetOrderForExchangeResult,
    GetOrderForExchangeInput,
    CustomerStats,
    RevenueData,
    TopProduct,
    OrdersAnalyticsResponse,
} from './orderTypes';

import {
    ordersListInputSchema,
    searchAllInputSchema,
    getOrderByIdInputSchema,
    searchUnifiedInputSchema,
    type OrdersResponse,
    type FlattenedOrderRow,
    type OrderViewCounts,
    type SearchAllResponse,
    type OrderDetail,
    type SearchUnifiedResponse,
} from './orderTypes';

// Re-export server functions from extracted files
export { getOrdersAnalytics } from './ordersAnalytics';
export { getOrderForExchange } from './orderExchange';

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
        mrp: number;
        isCustomSku: boolean;
        customizationType: string | null;
        customizationValue: string | null;
        customizationNotes: string | null;
        currentBalance: number;
        bomCost: number | null;
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
                    id: string;
                    colourName: string;
                    currentBalance: number;
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
    view: string,
    search?: string,
    sinceDate?: Date | null,
): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {
        isArchived: false,
    };

    switch (view) {
        case 'in_transit':
            // Orders with at least one line shipped but not delivered/RTO
            where.orderLines = {
                some: {
                    lineStatus: 'shipped',
                    trackingStatus: {
                        notIn: ['delivered', 'rto_in_transit', 'rto_delivered', 'rto_initiated', 'rto_received'],
                    },
                },
            };
            break;

        case 'delivered':
            // Orders where tracking shows delivered
            where.orderLines = {
                some: {
                    trackingStatus: 'delivered',
                },
            };
            break;

        case 'rto':
            // Orders with RTO tracking status
            where.orderLines = {
                some: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered', 'rto_initiated', 'rto_received'] },
                },
            };
            break;

        case 'cancelled':
            where.releasedToCancelled = true;
            break;

        case 'all':
        default:
            // No additional filters - shows all non-archived orders
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
                mrp: 0,
                discountPercent: 0,
                bomCost: 0,
                margin: 0,
                fabricColourName: null,
                fabricColourId: null,
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
                mrp: line.sku.mrp || 0,
                discountPercent: (() => {
                    const mrp = line.sku.mrp || 0;
                    const price = line.unitPrice || 0;
                    if (mrp <= 0 || price >= mrp) return 0;
                    return Math.round(((mrp - price) / mrp) * 100);
                })(),
                bomCost: line.sku.bomCost ?? 0,
                margin: line.unitPrice > 0 && line.sku.bomCost
                    ? Math.round(((line.unitPrice - line.sku.bomCost) / line.unitPrice) * 100)
                    : 0,
                fabricColourName: line.sku.variation.bomLines[0]?.fabricColour?.colourName ?? null,
                fabricColourId: line.sku.variation.bomLines[0]?.fabricColour?.id ?? null,
                skuStock: line.sku.currentBalance ?? 0,
                fabricBalance: line.sku.variation.bomLines[0]?.fabricColour?.currentBalance ?? 0,
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
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => ordersListInputSchema.parse(input))
    .handler(async ({ data }): Promise<OrdersResponse> => {
        try {
            const prisma = await getPrisma();

            const { view, page, limit, search, days, sortBy } = data;
            const offset = (page - 1) * limit;

            // Calculate date filter if days specified
            let sinceDate: Date | null = null;
            if (days) {
                sinceDate = new Date();
                sinceDate.setDate(sinceDate.getDate() - days);
            }

            // Build where clause
            const where = buildWhereClause(view, search, sinceDate);

            // Determine sort field
            const sortField = sortBy || 'orderDate';
            const orderBy = { [sortField]: 'desc' as const };

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
                                                            select: {
                                                                id: true,
                                                                colourName: true,
                                                                currentBalance: true,
                                                                isOutOfStock: true,
                                                            },
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
            ]);

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
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrders:', error);
            throw error;
        }
    });

// ============================================
// VIEW COUNTS - For OrderViewTabs
// ============================================

/**
 * Server Function: Get order view counts
 *
 * Returns counts for each view tab for the segmented control.
 * Uses parallel count queries for performance.
 */
export const getOrderViewCounts = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<OrderViewCounts> => {
        try {
            const prisma = await getPrisma();

            const allWhere = { isArchived: false };

            const inTransitWhere = {
                isArchived: false,
                orderLines: {
                    some: {
                        lineStatus: 'shipped',
                        trackingStatus: {
                            notIn: ['delivered', 'rto_in_transit', 'rto_delivered', 'rto_initiated', 'rto_received'],
                        },
                    },
                },
            };

            const deliveredWhere = {
                isArchived: false,
                orderLines: {
                    some: {
                        trackingStatus: 'delivered',
                    },
                },
            };

            const rtoWhere = {
                isArchived: false,
                orderLines: {
                    some: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered', 'rto_initiated', 'rto_received'] },
                    },
                },
            };

            const cancelledWhere = {
                isArchived: false,
                releasedToCancelled: true,
            };

            const [allCount, inTransitCount, deliveredCount, rtoCount, cancelledCount] = await Promise.all([
                prisma.order.count({ where: allWhere }),
                prisma.order.count({ where: inTransitWhere }),
                prisma.order.count({ where: deliveredWhere }),
                prisma.order.count({ where: rtoWhere }),
                prisma.order.count({ where: cancelledWhere }),
            ]);

            return {
                all: allCount,
                in_transit: inTransitCount,
                delivered: deliveredCount,
                rto: rtoCount,
                cancelled: cancelledCount,
            };
        } catch (error: unknown) {
            console.error('[Server Function] Error in getOrderViewCounts:', error);
            throw error;
        }
    });

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
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => searchAllInputSchema.parse(input))
    .handler(async ({ data }): Promise<SearchAllResponse> => {
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
            const tabs: Record<string, Prisma.OrderWhereInput> = {
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
// SEARCH UNIFIED - For useSearchOrders hook
// ============================================

/**
 * Server Function: Search orders across all views
 *
 * Unified search that returns flattened rows for grid display.
 * Searches across all order statuses (open, shipped, cancelled).
 */
export const searchUnifiedOrders = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => searchUnifiedInputSchema.parse(input))
    .handler(async ({ data }): Promise<SearchUnifiedResponse> => {
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
    .middleware([authMiddleware])
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
                orderLines: order.orderLines.map((line) => ({
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
