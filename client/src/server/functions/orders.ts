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

// ============================================
// INPUT VALIDATION SCHEMA
// ============================================

const ordersListInputSchema = z.object({
    view: z.enum(['open', 'shipped', 'cancelled'] as const),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(1000).default(100),
    shippedFilter: z.enum(['all', 'rto', 'cod_pending'] as const).optional(),
    search: z.string().optional(),
    days: z.number().int().positive().optional(),
    sortBy: z.enum(['orderDate', 'archivedAt', 'shippedAt', 'createdAt'] as const).optional(),
});

export type OrdersListInput = z.infer<typeof ordersListInputSchema>;

// ============================================
// RESPONSE TYPES
// ============================================

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
    discountCodes: string | null;
    customerNotes: string | null;
    shopifyTags: string | null;
    shopifyAwb: string | null;
    shopifyCourier: string | null;
    shopifyTrackingUrl: string | null;
    customerTags: string[] | null;
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
    skuId: string;
    sku: {
        id: string;
        skuCode: string;
        size: string;
        isCustomSku: boolean;
        customizationType: string | null;
        customizationValue: string | null;
        customizationNotes: string | null;
        variation: {
            colorName: string;
            colorHex: string | null;
            imageUrl: string | null;
            product: {
                name: string;
                imageUrl: string | null;
            };
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
    view: 'open' | 'shipped' | 'cancelled',
    search: string | undefined,
    shippedFilter: 'all' | 'rto' | 'cod_pending' | undefined,
    sinceDate: Date | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
        isArchived: false,
    };

    // View-specific filtering
    switch (view) {
        case 'open':
            where.OR = [
                { status: 'open' },
                {
                    AND: [{ releasedToShipped: false }, { releasedToCancelled: false }],
                },
            ];
            break;

        case 'shipped':
            where.releasedToShipped = true;

            if (shippedFilter === 'rto') {
                // Orders with at least one line in RTO status
                where.orderLines = {
                    some: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                    },
                };
            } else if (shippedFilter === 'cod_pending') {
                where.paymentMethod = 'COD';
                where.codRemittedAt = null;
                // Orders with at least one delivered line
                where.orderLines = {
                    some: {
                        trackingStatus: 'delivered',
                    },
                };
            }
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
                discountCodes: order.shopifyCache?.discountCodes ?? null,
                customerNotes: order.shopifyCache?.customerNotes ?? null,
                shopifyTags: order.shopifyCache?.tags ?? null,
                shopifyAwb: order.shopifyCache?.trackingNumber ?? null,
                shopifyCourier: order.shopifyCache?.trackingCompany ?? null,
                shopifyTrackingUrl: order.shopifyCache?.trackingUrl ?? null,
                customerTags,
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
                skuStock: 0, // Filled by inventory cache later
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
                discountCodes: order.shopifyCache?.discountCodes ?? null,
                customerNotes: order.shopifyCache?.customerNotes ?? null,
                shopifyTags: order.shopifyCache?.tags ?? null,
                shopifyAwb: order.shopifyCache?.trackingNumber ?? null,
                shopifyCourier: order.shopifyCache?.trackingCompany ?? null,
                shopifyTrackingUrl: order.shopifyCache?.trackingUrl ?? null,
                customerTags,
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
    .inputValidator((input: unknown) => ordersListInputSchema.parse(input))
    .handler(async ({ data }): Promise<OrdersResponse> => {
        console.log('[Server Function] getOrders called with:', data);

        try {
            // Dynamic import to prevent bundling Prisma into client
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { PrismaClient } = (await import('@prisma/client')) as any;

            // Use global singleton pattern
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const globalForPrisma = globalThis as any;
            const prisma = globalForPrisma.prisma ?? new PrismaClient();
            if (process.env.NODE_ENV !== 'production') {
                globalForPrisma.prisma = prisma;
            }

            const { view, page, limit, shippedFilter, search, days, sortBy } = data;
            const offset = (page - 1) * limit;

            // Calculate date filter if days specified
            let sinceDate: Date | null = null;
            if (days) {
                sinceDate = new Date();
                sinceDate.setDate(sinceDate.getDate() - days);
            }

            // Build where clause
            const where = buildWhereClause(view, search, shippedFilter, sinceDate);

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

            console.log('[Server Function] Query returned', orders.length, 'orders, total:', totalCount);

            // Transform to flattened rows for AG-Grid
            const rows = flattenOrdersToRows(orders as PrismaOrder[]);

            // Calculate pagination
            const totalPages = Math.ceil(totalCount / limit);

            return {
                rows,
                view: data.view,
                hasInventory: false, // TODO: Add inventory enrichment
                pagination: {
                    total: totalCount,
                    page: data.page,
                    limit: data.limit,
                    totalPages,
                    hasMore: data.page < totalPages,
                },
            };
        } catch (error) {
            console.error('[Server Function] Error in getOrders:', error);
            throw error;
        }
    });
