/**
 * Returns Query Server Functions
 *
 * TanStack Start Server Functions for returns/exchange data fetching.
 * Uses Prisma for database access.
 *
 * IMPORTANT: Prisma client is dynamically imported to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// INPUT SCHEMAS
// ============================================

const getReturnDetailInputSchema = z.object({
    orderLineId: z.string().uuid(),
});

const findBySkuCodeInputSchema = z.object({
    code: z.string().min(1, 'SKU code is required'),
});


// ============================================
// PENDING SOURCES & QUEUE (for ReturnsRto page)
// ============================================

const getPendingQueueInputSchema = z.object({
    source: z.enum(['production', 'repacking', 'returns', 'rto']),
    limit: z.number().int().positive().optional().default(200),
});

export interface PendingSourcesCounts {
    repacking: number;
    returns: number;
    rto: number;
    rtoUrgent: number;
}

export interface PendingSourcesResponse {
    counts: PendingSourcesCounts;
}

export interface QueuePanelItemResponse {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    imageUrl?: string;
    contextLabel: string;
    contextValue: string;
    // RTO-specific
    atWarehouse?: boolean;
    daysInRto?: number;
    customerName?: string;
    orderNumber?: string;
    // Returns-specific
    requestNumber?: string;
    // Repacking-specific
    queueItemId?: string;
    condition?: string;
    inspectionNotes?: string;
    returnRequestNumber?: string;
    orderLineId?: string;
    rtoOrderNumber?: string;
    // For click-to-process
    lineId?: string;
    orderId?: string;
    // Production-specific
    batchId?: string;
    batchCode?: string;
}

export interface PendingQueueResponse {
    source: string;
    items: QueuePanelItemResponse[];
    total: number;
}

/**
 * Get pending source counts for Returns RTO page tabs
 */
export const getPendingSources = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<PendingSourcesResponse> => {
        const prisma = await getPrisma();

        // Count repacking queue items (pending status)
        const repackingCount = await prisma.repackingQueueItem.count({
            where: { status: 'pending' },
        });

        // Count pending returns from OrderLine (new line-level system)
        const returnsCount = await prisma.orderLine.count({
            where: {
                returnStatus: {
                    in: ['requested', 'approved'],
                },
                returnReceivedAt: null,
            },
        });

        // Count RTO pending (rto_in_transit, at warehouse but not inwarded)
        const rtoCount = await prisma.orderLine.count({
            where: {
                trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                rtoReceivedAt: null,
            },
        });

        // Count urgent RTOs (more than 7 days in RTO status)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const rtoUrgentCount = await prisma.orderLine.count({
            where: {
                trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                rtoReceivedAt: null,
                rtoInitiatedAt: { lte: sevenDaysAgo },
            },
        });

        return {
            counts: {
                repacking: repackingCount,
                returns: returnsCount,
                rto: rtoCount,
                rtoUrgent: rtoUrgentCount,
            },
        };
    });

/**
 * Get pending queue items by source
 */
export const getPendingQueue = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getPendingQueueInputSchema.parse(input))
    .handler(async ({ data }): Promise<PendingQueueResponse> => {
        const prisma = await getPrisma();
        const { source, limit } = data;

        const items: QueuePanelItemResponse[] = [];

        if (source === 'repacking') {
            // Get repacking queue items
            const queueItems = await prisma.repackingQueueItem.findMany({
                where: { status: 'pending' },
                include: {
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                    orderLine: {
                        select: {
                            returnBatchNumber: true,
                            order: {
                                select: { orderNumber: true },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
                take: limit,
            });

            for (const item of queueItems) {
                items.push({
                    id: item.id,
                    queueItemId: item.id,
                    skuId: item.skuId,
                    skuCode: item.sku.skuCode,
                    productName: item.sku.variation.product.name,
                    colorName: item.sku.variation.colorName,
                    size: item.sku.size,
                    qty: item.qty,
                    imageUrl: item.sku.variation.imageUrl || item.sku.variation.product.imageUrl || undefined,
                    contextLabel: item.orderLine?.returnBatchNumber ? 'Return' : item.orderLine ? 'RTO' : 'Scan',
                    contextValue: item.orderLine?.returnBatchNumber || item.orderLine?.order?.orderNumber || 'Unallocated',
                    condition: item.condition || undefined,
                    inspectionNotes: item.inspectionNotes || undefined,
                    returnRequestNumber: item.orderLine?.returnBatchNumber || undefined,
                    rtoOrderNumber: item.orderLine?.order?.orderNumber || undefined,
                    orderLineId: item.orderLineId || undefined,
                });
            }
        } else if (source === 'returns') {
            // Get pending returns from OrderLine (new line-level system)
            // Items awaiting receipt at warehouse
            const returnLines = await prisma.orderLine.findMany({
                where: {
                    returnStatus: {
                        in: ['requested', 'approved'],
                    },
                    returnReceivedAt: null,
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                        },
                    },
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { returnRequestedAt: 'asc' },
                take: limit,
            });

            for (const line of returnLines) {
                items.push({
                    id: line.id,
                    skuId: line.skuId,
                    skuCode: line.sku.skuCode,
                    productName: line.sku.variation.product.name,
                    colorName: line.sku.variation.colorName,
                    size: line.sku.size,
                    qty: line.returnQty || line.qty,
                    imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl || undefined,
                    contextLabel: 'Order',
                    contextValue: line.order.orderNumber,
                    customerName: line.order.customerName,
                    orderLineId: line.id,
                });
            }
        } else if (source === 'rto') {
            // Get RTO pending lines
            const rtoLines = await prisma.orderLine.findMany({
                where: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                    rtoReceivedAt: null,
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                        },
                    },
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { rtoInitiatedAt: 'asc' },
                take: limit,
            });

            for (const line of rtoLines) {
                // Calculate days in RTO
                let daysInRto: number | undefined;
                if (line.rtoInitiatedAt) {
                    const daysDiff = Math.floor(
                        (Date.now() - new Date(line.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    daysInRto = daysDiff;
                }

                items.push({
                    id: line.id,
                    lineId: line.id,
                    orderId: line.order.id,
                    skuId: line.skuId,
                    skuCode: line.sku.skuCode,
                    productName: line.sku.variation.product.name,
                    colorName: line.sku.variation.colorName,
                    size: line.sku.size,
                    qty: line.qty,
                    imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl || undefined,
                    contextLabel: 'Order',
                    contextValue: line.order.orderNumber,
                    orderNumber: line.order.orderNumber,
                    customerName: line.order.customerName,
                    atWarehouse: line.trackingStatus === 'rto_out_for_delivery',
                    daysInRto,
                });
            }
        } else if (source === 'production') {
            // Get pending production batches
            const batches = await prisma.productionBatch.findMany({
                where: {
                    status: { in: ['planned', 'in_progress'] },
                    skuId: { not: null },
                },
                include: {
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { batchDate: 'asc' },
                take: limit,
            });

            for (const batch of batches) {
                if (!batch.sku) continue;
                const qtyPending = batch.qtyPlanned - (batch.qtyCompleted || 0);
                if (qtyPending <= 0) continue;

                items.push({
                    id: batch.id,
                    batchId: batch.id,
                    skuId: batch.skuId!,
                    skuCode: batch.sku.skuCode,
                    productName: batch.sku.variation.product.name,
                    colorName: batch.sku.variation.colorName,
                    size: batch.sku.size,
                    qty: qtyPending,
                    imageUrl: batch.sku.variation.imageUrl || batch.sku.variation.product.imageUrl || undefined,
                    contextLabel: 'Batch',
                    contextValue: batch.batchCode || `Batch ${batch.id.slice(0, 8)}`,
                    batchCode: batch.batchCode || undefined,
                });
            }
        }

        return {
            source,
            items,
            total: items.length,
        };
    });

// Type for scan lookup match
export interface ScanLookupMatch {
    source: string;
    priority: number;
    data: {
        lineId: string;
        requestId?: string;
        requestNumber?: string;
        reasonCategory?: string | null;
        orderId?: string;
        orderNumber?: string;
        customerName?: string;
        qty: number;
        atWarehouse?: boolean;
        // Repacking-specific fields
        queueId?: string;
        condition?: string;
        returnRequestNumber?: string | null;
        // Production-specific fields
        batchId?: string;
        batchCode?: string;
        qtyPlanned?: number;
        qtyCompleted?: number;
        qtyPending?: number;
        batchDate?: string;
    };
}

// Type for scan lookup result
export interface ScanLookupResult {
    sku: {
        id: string;
        skuCode: string;
        barcode: string | null;
        productName: string;
        colorName: string;
        size: string;
        mrp: number;
        imageUrl: string | null;
    };
    currentBalance: number;
    availableBalance: number;
    matches: ScanLookupMatch[];
    recommendedSource: string;
}

/**
 * Scan lookup for SKU code (used in allocation modal)
 */
export const scanLookup = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => findBySkuCodeInputSchema.parse(input))
    .handler(async ({ data }): Promise<ScanLookupResult> => {
        const prisma = await getPrisma();
        const { code } = data;

        // Find SKU by code (SKU model doesn't have barcode field)
        const sku = await prisma.sku.findFirst({
            where: { skuCode: code },
            include: {
                variation: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        if (!sku) {
            throw new Error('SKU not found');
        }

        // Get inventory balance
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        const balanceMap = await inventoryBalanceCache.get(prisma, [sku.id]);
        const balance = balanceMap.get(sku.id) || { currentBalance: 0, availableBalance: 0 };

        // Find matching return lines (line-level system on OrderLine)
        const returnMatches = await prisma.orderLine.findMany({
            where: {
                skuId: sku.id,
                returnStatus: {
                    in: ['requested', 'approved'],
                },
                returnReceivedAt: null,
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerName: true,
                    },
                },
            },
            take: 10,
        });

        // Find matching RTO orders
        const rtoMatches = await prisma.orderLine.findMany({
            where: {
                skuId: sku.id,
                trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                rtoReceivedAt: null,
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerName: true,
                    },
                },
            },
            take: 10,
        });

        // Find matching repacking queue items
        const repackingMatches = await prisma.repackingQueueItem.findMany({
            where: {
                skuId: sku.id,
                status: 'pending',
            },
            include: {
                orderLine: {
                    select: {
                        returnBatchNumber: true,
                        order: { select: { orderNumber: true } },
                    },
                },
            },
            take: 10,
        });

        // Find matching production batches
        const productionMatches = await prisma.productionBatch.findMany({
            where: {
                skuId: sku.id,
                status: { in: ['pending', 'planned', 'in_progress'] },
            },
            select: {
                id: true,
                batchCode: true,
                batchDate: true,
                qtyPlanned: true,
                qtyCompleted: true,
            },
            take: 10,
        });

        // Build matches array
        const matches: ScanLookupMatch[] = [];

        for (const returnLine of returnMatches) {
            matches.push({
                source: 'return',
                priority: 1,
                data: {
                    lineId: returnLine.id,
                    requestNumber: returnLine.returnBatchNumber || returnLine.order.orderNumber,
                    reasonCategory: returnLine.returnReasonCategory,
                    orderId: returnLine.order.id,
                    orderNumber: returnLine.order.orderNumber,
                    customerName: returnLine.order.customerName,
                    qty: returnLine.returnQty || returnLine.qty,
                },
            });
        }

        for (const rtoLine of rtoMatches) {
            matches.push({
                source: 'rto',
                priority: 2,
                data: {
                    lineId: rtoLine.id,
                    orderId: rtoLine.order.id,
                    orderNumber: rtoLine.order.orderNumber,
                    customerName: rtoLine.order.customerName,
                    qty: rtoLine.qty,
                    atWarehouse: rtoLine.trackingStatus === 'rto_out_for_delivery',
                },
            });
        }

        for (const repackItem of repackingMatches) {
            matches.push({
                source: 'repacking',
                priority: 3,
                data: {
                    lineId: repackItem.id,
                    queueId: repackItem.id,
                    qty: repackItem.qty,
                    condition: repackItem.condition || 'unknown',
                    returnRequestNumber: repackItem.orderLine?.order?.orderNumber || repackItem.orderLine?.returnBatchNumber || null,
                },
            });
        }

        for (const prodBatch of productionMatches) {
            const qtyPending = prodBatch.qtyPlanned - prodBatch.qtyCompleted;
            if (qtyPending > 0) {
                matches.push({
                    source: 'production',
                    priority: 4,
                    data: {
                        lineId: prodBatch.id,
                        batchId: prodBatch.id,
                        batchCode: prodBatch.batchCode || '',
                        qty: qtyPending,
                        qtyPlanned: prodBatch.qtyPlanned,
                        qtyCompleted: prodBatch.qtyCompleted,
                        qtyPending,
                        batchDate: prodBatch.batchDate.toISOString(),
                    },
                });
            }
        }

        return {
            sku: {
                id: sku.id,
                skuCode: sku.skuCode,
                barcode: null, // SKU model doesn't have barcode field
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                mrp: Number(sku.mrp),
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl,
            },
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
            matches,
            recommendedSource: matches.length > 0 ? matches[0].source : 'adjustment',
        };
    });

// ============================================
// RTO ORDERS SEARCH (for AllocationModal)
// ============================================

const searchRtoOrdersInputSchema = z.object({
    search: z.string().optional(),
    limit: z.number().int().positive().max(50).optional().default(5),
});

export interface RtoOrderSearchResult {
    id: string;
    orderNumber: string;
    customerName: string | null;
    awbNumber: string | null;
    rtoInitiatedAt: string | null;
    orderDate: string;
}

export interface RtoOrdersSearchResponse {
    orders: RtoOrderSearchResult[];
}

/**
 * Search RTO orders for allocation
 *
 * Returns RTO orders matching search query (order number or AWB).
 * Used by AllocationModal for finding RTO orders to link.
 */
export const searchRtoOrders = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => searchRtoOrdersInputSchema.parse(input))
    .handler(async ({ data }): Promise<RtoOrdersSearchResponse> => {
        const prisma = await getPrisma();
        const { search, limit } = data;

        // Build where clause for RTO orders
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {
            isArchived: false,
            orderLines: {
                some: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                    rtoReceivedAt: null,
                },
            },
        };

        // Add search filter
        if (search && search.length >= 3) {
            where.OR = [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { orderLines: { some: { awbNumber: { contains: search, mode: 'insensitive' } } } },
            ];
        }

        const orders = await prisma.order.findMany({
            where,
            select: {
                id: true,
                orderNumber: true,
                customerName: true,
                orderDate: true,
                orderLines: {
                    where: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_out_for_delivery'] },
                        rtoReceivedAt: null,
                    },
                    select: {
                        awbNumber: true,
                        rtoInitiatedAt: true,
                    },
                    take: 1,
                },
            },
            orderBy: { orderDate: 'desc' },
            take: limit,
        });

        return {
            orders: orders.map((order: (typeof orders)[number]) => ({
                id: order.id,
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                awbNumber: order.orderLines[0]?.awbNumber || null,
                rtoInitiatedAt: order.orderLines[0]?.rtoInitiatedAt?.toISOString() || null,
                orderDate: order.orderDate.toISOString(),
            })),
        };
    });

// ============================================
// LINE-LEVEL RETURN QUERIES (NEW)
// ============================================
// These queries work with OrderLine.return* fields directly,
// for the new line-level returns system.

import {
    type OrderForReturn,
    type OrderLineForReturn,
    type ActiveReturnLine,
    type ReturnActionQueueItem,
    type RefundCalculationResult,
} from '@coh/shared/schemas/returns';
import {
    checkEligibility,
    RETURN_POLICY,
    RETURN_REASONS,
    RETURN_CONDITIONS,
    RETURN_RESOLUTIONS,
    RETURN_PICKUP_TYPES,
    RETURN_REFUND_METHODS,
    NON_RETURNABLE_REASONS,
    type EligibilitySettings,
    toOptions,
} from '@coh/shared/domain/returns';

/**
 * Get order with lines for return initiation
 * Includes eligibility checks for each line
 */
export const getOrderForReturn = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderNumber: z.string() }).parse(input))
    .handler(async ({ data }): Promise<OrderForReturn> => {
        const prisma = await getPrisma();

        // Fetch settings from DB (with fallback to code defaults)
        const dbSettings = await prisma.returnSettings.findFirst({ where: { id: 'default' } });
        const settings: EligibilitySettings = dbSettings
            ? { windowDays: dbSettings.windowDays, windowWarningDays: dbSettings.windowWarningDays }
            : { windowDays: RETURN_POLICY.windowDays, windowWarningDays: RETURN_POLICY.windowWarningDays };

        const order = await prisma.order.findFirst({
            where: {
                OR: [
                    { orderNumber: data.orderNumber },
                    { shopifyCache: { orderNumber: data.orderNumber } },
                ],
            },
            include: {
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!order) {
            throw new Error('Order not found');
        }

        const lines: OrderLineForReturn[] = order.orderLines.map((line: (typeof order.orderLines)[number]) => {
            const product = line.sku.variation.product;
            const eligibility = checkEligibility({
                deliveredAt: line.deliveredAt,
                returnStatus: line.returnStatus,
                isNonReturnable: line.isNonReturnable,
                productIsReturnable: product.isReturnable,
                productNonReturnableReason: product.nonReturnableReason,
            }, settings);

            return {
                id: line.id,
                orderId: line.orderId,
                skuId: line.skuId,
                skuCode: line.sku.skuCode,
                size: line.sku.size,
                qty: line.qty,
                unitPrice: line.unitPrice,
                lineStatus: line.lineStatus,
                deliveredAt: line.deliveredAt,
                returnStatus: line.returnStatus,
                returnQty: line.returnQty,
                eligibility,
                productId: product.id,
                productName: product.name,
                colorName: line.sku.variation.colorName,
                imageUrl: line.sku.variation.imageUrl || product.imageUrl,
                isReturnable: product.isReturnable,
                nonReturnableReason: product.nonReturnableReason,
            };
        });

        return {
            id: order.id,
            orderNumber: order.orderNumber,
            orderDate: order.orderDate,
            totalAmount: order.totalAmount,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            shippingAddress: order.shippingAddress,
            lines,
        };
    });

/**
 * Get all active line-level returns
 * For returns dashboard listing
 */
export const getActiveLineReturns = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ActiveReturnLine[]> => {
        const prisma = await getPrisma();

        const lines = await prisma.orderLine.findMany({
            where: {
                returnStatus: {
                    notIn: ['refunded', 'archived', 'rejected', 'cancelled'],
                },
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerId: true,
                        customerName: true,
                        customerEmail: true,
                        customerPhone: true,
                    },
                },
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
            orderBy: { returnRequestedAt: 'desc' },
        });

        return lines.map((line: (typeof lines)[number]) => ({
            id: line.id,
            orderId: line.orderId,
            orderNumber: line.order.orderNumber,
            skuId: line.skuId,
            skuCode: line.sku.skuCode,
            size: line.sku.size,
            qty: line.qty,
            unitPrice: line.unitPrice,
            returnBatchNumber: line.returnBatchNumber,
            returnStatus: line.returnStatus!,
            returnQty: line.returnQty!,
            returnRequestedAt: line.returnRequestedAt,
            returnReasonCategory: line.returnReasonCategory,
            returnReasonDetail: line.returnReasonDetail,
            returnResolution: line.returnResolution,
            returnPickupType: line.returnPickupType,
            returnAwbNumber: line.returnAwbNumber,
            returnCourier: line.returnCourier,
            returnPickupScheduledAt: line.returnPickupScheduledAt,
            returnReceivedAt: line.returnReceivedAt,
            returnCondition: line.returnCondition,
            returnExchangeOrderId: line.returnExchangeOrderId,
            returnExchangeSkuId: line.returnExchangeSkuId,
            returnExchangePriceDiff: line.returnExchangePriceDiff?.toNumber() ?? null,
            returnQcResult: line.returnQcResult,
            returnNotes: line.returnNotes,
            returnRefundCompletedAt: line.returnRefundCompletedAt,
            returnNetAmount: line.returnNetAmount?.toNumber() ?? null,
            returnRefundMethod: line.returnRefundMethod,
            customerId: line.order.customerId,
            customerName: line.order.customerName,
            customerEmail: line.order.customerEmail,
            customerPhone: line.order.customerPhone,
            productId: line.sku.variation.product.id,
            productName: line.sku.variation.product.name,
            colorName: line.sku.variation.colorName,
            imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
        }));
    });

/**
 * Return detail response shape (superset of ActiveReturnLine with extra fields)
 */
export interface ReturnDetailResponse {
    // Line info
    id: string;
    orderId: string;
    orderNumber: string;
    skuId: string;
    skuCode: string;
    size: string;
    qty: number;
    unitPrice: number;
    // Return info
    returnBatchNumber: string | null;
    returnStatus: string;
    returnQty: number;
    returnRequestedAt: Date | null;
    returnReasonCategory: string | null;
    returnReasonDetail: string | null;
    returnResolution: string | null;
    returnNotes: string | null;
    // Pickup
    returnPickupType: string | null;
    returnAwbNumber: string | null;
    returnCourier: string | null;
    returnPickupScheduledAt: Date | null;
    returnReceivedAt: Date | null;
    // Condition & QC
    returnCondition: string | null;
    returnConditionNotes: string | null;
    returnQcResult: string | null;
    // Refund
    returnGrossAmount: number | null;
    returnDiscountClawback: number | null;
    returnDeductions: number | null;
    returnDeductionNotes: string | null;
    returnNetAmount: number | null;
    returnRefundMethod: string | null;
    returnRefundCompletedAt: Date | null;
    returnRefundReference: string | null;
    // Exchange
    returnExchangeOrderId: string | null;
    returnExchangeSkuId: string | null;
    returnExchangePriceDiff: number | null;
    // Product info
    productId: string;
    productName: string;
    colorName: string;
    imageUrl: string | null;
    // Order/customer info
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    shippingAddress: Record<string, unknown> | string | null;
    orderDate: Date;
    paymentMethod: string | null;
    totalAmount: number;
}

/**
 * Get detailed return info for a single order line
 */
export const getReturnDetail = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReturnDetailInputSchema.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();

        const line = await prisma.orderLine.findUnique({
            where: { id: data.orderLineId },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerId: true,
                        customerName: true,
                        customerEmail: true,
                        customerPhone: true,
                        shippingAddress: true,
                        totalAmount: true,
                        orderDate: true,
                        paymentMethod: true,
                    },
                },
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
        });

        if (!line || !line.returnStatus) {
            throw new Error('Return not found');
        }

        return {
            id: line.id,
            orderId: line.orderId,
            orderNumber: line.order.orderNumber,
            skuId: line.skuId,
            skuCode: line.sku.skuCode,
            size: line.sku.size,
            qty: line.qty,
            unitPrice: line.unitPrice,
            returnBatchNumber: line.returnBatchNumber,
            returnStatus: line.returnStatus,
            returnQty: line.returnQty!,
            returnRequestedAt: line.returnRequestedAt,
            returnReasonCategory: line.returnReasonCategory,
            returnReasonDetail: line.returnReasonDetail,
            returnResolution: line.returnResolution,
            returnNotes: line.returnNotes,
            returnPickupType: line.returnPickupType,
            returnAwbNumber: line.returnAwbNumber,
            returnCourier: line.returnCourier,
            returnPickupScheduledAt: line.returnPickupScheduledAt,
            returnReceivedAt: line.returnReceivedAt,
            returnCondition: line.returnCondition,
            returnConditionNotes: line.returnConditionNotes || null,
            returnQcResult: line.returnQcResult,
            returnGrossAmount: line.returnGrossAmount?.toNumber() ?? null,
            returnDiscountClawback: line.returnDiscountClawback?.toNumber() ?? null,
            returnDeductions: line.returnDeductions?.toNumber() ?? null,
            returnDeductionNotes: line.returnDeductionNotes || null,
            returnNetAmount: line.returnNetAmount?.toNumber() ?? null,
            returnRefundMethod: line.returnRefundMethod,
            returnRefundCompletedAt: line.returnRefundCompletedAt,
            returnRefundReference: line.returnRefundReference || null,
            returnExchangeOrderId: line.returnExchangeOrderId,
            returnExchangeSkuId: line.returnExchangeSkuId,
            returnExchangePriceDiff: line.returnExchangePriceDiff?.toNumber() ?? null,
            productId: line.sku.variation.product.id,
            productName: line.sku.variation.product.name,
            colorName: line.sku.variation.colorName,
            imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
            customerName: line.order.customerName,
            customerEmail: line.order.customerEmail,
            customerPhone: line.order.customerPhone,
            shippingAddress: line.order.shippingAddress,
            orderDate: line.order.orderDate,
            paymentMethod: line.order.paymentMethod,
            totalAmount: line.order.totalAmount,
        };
    });

/**
 * Get ALL returns (active + completed + cancelled) with pagination and filters
 * For the All Returns AG-Grid tab
 */
export interface AllReturnsResponse {
    items: ActiveReturnLine[];
    total: number;
    page: number;
    limit: number;
}

const getAllReturnsInputSchema = z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(500).default(100),
    status: z.string().optional(),
    resolution: z.string().optional(),
    search: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
});

export const getAllReturns = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getAllReturnsInputSchema.parse(input))
    .handler(async ({ data }): Promise<AllReturnsResponse> => {
        const prisma = await getPrisma();
        const { page, limit, status, resolution, search, dateFrom, dateTo } = data;
        const skip = (page - 1) * limit;

        // Build where clause — must have a return status (i.e. was ever a return)
        const where: Record<string, unknown> = {
            returnStatus: status ? status : { not: null },
        };

        if (resolution) {
            where.returnResolution = resolution;
        }

        if (dateFrom || dateTo) {
            const dateFilter: Record<string, Date> = {};
            if (dateFrom) dateFilter.gte = new Date(dateFrom);
            if (dateTo) dateFilter.lte = new Date(dateTo + 'T23:59:59Z');
            where.returnRequestedAt = dateFilter;
        }

        if (search) {
            where.OR = [
                { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
                { order: { customerName: { contains: search, mode: 'insensitive' } } },
                { sku: { skuCode: { contains: search, mode: 'insensitive' } } },
                { returnAwbNumber: { contains: search, mode: 'insensitive' } },
                { returnBatchNumber: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [lines, total] = await Promise.all([
            prisma.orderLine.findMany({
                where,
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerId: true,
                            customerName: true,
                            customerEmail: true,
                            customerPhone: true,
                        },
                    },
                    sku: {
                        include: {
                            variation: {
                                include: {
                                    product: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { returnRequestedAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.orderLine.count({ where }),
        ]);

        const items: ActiveReturnLine[] = lines.map((line: (typeof lines)[number]) => ({
            id: line.id,
            orderId: line.orderId,
            orderNumber: line.order.orderNumber,
            skuId: line.skuId,
            skuCode: line.sku.skuCode,
            size: line.sku.size,
            qty: line.qty,
            unitPrice: line.unitPrice,
            returnBatchNumber: line.returnBatchNumber,
            returnStatus: line.returnStatus!,
            returnQty: line.returnQty!,
            returnRequestedAt: line.returnRequestedAt,
            returnReasonCategory: line.returnReasonCategory,
            returnReasonDetail: line.returnReasonDetail,
            returnResolution: line.returnResolution,
            returnPickupType: line.returnPickupType,
            returnAwbNumber: line.returnAwbNumber,
            returnCourier: line.returnCourier,
            returnPickupScheduledAt: line.returnPickupScheduledAt,
            returnReceivedAt: line.returnReceivedAt,
            returnCondition: line.returnCondition,
            returnExchangeOrderId: line.returnExchangeOrderId,
            returnExchangeSkuId: line.returnExchangeSkuId,
            returnExchangePriceDiff: line.returnExchangePriceDiff?.toNumber() ?? null,
            returnQcResult: line.returnQcResult,
            returnNotes: line.returnNotes,
            returnRefundCompletedAt: line.returnRefundCompletedAt,
            returnNetAmount: line.returnNetAmount?.toNumber() ?? null,
            returnRefundMethod: line.returnRefundMethod,
            customerId: line.order.customerId,
            customerName: line.order.customerName,
            customerEmail: line.order.customerEmail,
            customerPhone: line.order.customerPhone,
            productId: line.sku.variation.product.id,
            productName: line.sku.variation.product.name,
            colorName: line.sku.variation.colorName,
            imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
        }));

        return { items, total, page, limit };
    });

/**
 * Get return status counts for pill tab badges
 * Groups by returnStatus, returns counts per status + total
 */
const getReturnStatusCountsInputSchema = z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    search: z.string().optional(),
});

export const getReturnStatusCounts = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReturnStatusCountsInputSchema.parse(input))
    .handler(async ({ data }): Promise<Record<string, number>> => {
        const prisma = await getPrisma();
        const where: Record<string, unknown> = { returnStatus: { not: null } };

        if (data.dateFrom || data.dateTo) {
            const dateFilter: Record<string, Date> = {};
            if (data.dateFrom) dateFilter.gte = new Date(data.dateFrom);
            if (data.dateTo) dateFilter.lte = new Date(data.dateTo + 'T23:59:59Z');
            where.returnRequestedAt = dateFilter;
        }

        if (data.search) {
            where.OR = [
                { order: { orderNumber: { contains: data.search, mode: 'insensitive' } } },
                { order: { customerName: { contains: data.search, mode: 'insensitive' } } },
                { sku: { skuCode: { contains: data.search, mode: 'insensitive' } } },
                { returnBatchNumber: { contains: data.search, mode: 'insensitive' } },
            ];
        }

        const counts = await prisma.orderLine.groupBy({
            by: ['returnStatus'],
            where,
            _count: true,
        });

        const result: Record<string, number> = { all: 0 };
        for (const c of counts) {
            if (c.returnStatus) {
                result[c.returnStatus] = c._count;
                result.all += c._count;
            }
        }
        return result;
    });

/**
 * Get return action queue (lines needing action)
 * Prioritized list for staff to process
 */
export const getLineReturnActionQueue = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ReturnActionQueueItem[]> => {
        const prisma = await getPrisma();

        const lines = await prisma.orderLine.findMany({
            where: {
                returnStatus: {
                    in: ['requested', 'approved', 'inspected'],
                },
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerId: true,
                        customerName: true,
                        customerEmail: true,
                        customerPhone: true,
                    },
                },
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: true,
                            },
                        },
                    },
                },
            },
            orderBy: { returnRequestedAt: 'asc' },
        });

        const actionItems: ReturnActionQueueItem[] = [];

        for (const line of lines) {
            // Determine action needed based on status and resolution
            let actionNeeded: 'schedule_pickup' | 'receive' | 'process_refund' | 'create_exchange' | 'complete';

            switch (line.returnStatus) {
                case 'requested':
                    actionNeeded = 'schedule_pickup';
                    break;
                case 'approved':
                    actionNeeded = 'receive';
                    break;
                case 'inspected':
                    if (line.returnResolution === 'refund' && !line.returnRefundCompletedAt) {
                        actionNeeded = 'process_refund';
                    } else if (line.returnResolution === 'exchange' && !line.returnExchangeOrderId) {
                        actionNeeded = 'create_exchange';
                    } else {
                        actionNeeded = 'complete';
                    }
                    break;
                default:
                    continue;
            }

            const daysSinceRequest = line.returnRequestedAt
                ? Math.floor((Date.now() - line.returnRequestedAt.getTime()) / (1000 * 60 * 60 * 24))
                : 0;

            actionItems.push({
                id: line.id,
                orderId: line.orderId,
                orderNumber: line.order.orderNumber,
                skuId: line.skuId,
                skuCode: line.sku.skuCode,
                size: line.sku.size,
                qty: line.qty,
                unitPrice: line.unitPrice,
                returnBatchNumber: line.returnBatchNumber,
                returnStatus: line.returnStatus!,
                returnQty: line.returnQty!,
                returnRequestedAt: line.returnRequestedAt,
                returnReasonCategory: line.returnReasonCategory,
                returnReasonDetail: line.returnReasonDetail,
                returnResolution: line.returnResolution,
                returnPickupType: line.returnPickupType,
                returnAwbNumber: line.returnAwbNumber,
                returnCourier: line.returnCourier,
                returnPickupScheduledAt: line.returnPickupScheduledAt,
                returnReceivedAt: line.returnReceivedAt,
                returnCondition: line.returnCondition,
                returnExchangeOrderId: line.returnExchangeOrderId,
                returnExchangeSkuId: line.returnExchangeSkuId,
                returnExchangePriceDiff: line.returnExchangePriceDiff?.toNumber() ?? null,
                returnQcResult: line.returnQcResult,
                returnNotes: line.returnNotes,
                returnRefundCompletedAt: line.returnRefundCompletedAt,
                returnNetAmount: line.returnNetAmount?.toNumber() ?? null,
                returnRefundMethod: line.returnRefundMethod,
                customerId: line.order.customerId,
                customerName: line.order.customerName,
                customerEmail: line.order.customerEmail,
                customerPhone: line.order.customerPhone,
                productId: line.sku.variation.product.id,
                productName: line.sku.variation.product.name,
                colorName: line.sku.variation.colorName,
                imageUrl: line.sku.variation.imageUrl || line.sku.variation.product.imageUrl,
                actionNeeded,
                daysSinceRequest,
            });
        }

        // Sort by priority: receive first, then by age
        actionItems.sort((a, b) => {
            const priorityOrder = ['process_refund', 'create_exchange', 'complete', 'receive', 'schedule_pickup'];
            const aPriority = priorityOrder.indexOf(a.actionNeeded);
            const bPriority = priorityOrder.indexOf(b.actionNeeded);
            if (aPriority !== bPriority) return aPriority - bPriority;
            return b.daysSinceRequest - a.daysSinceRequest;
        });

        return actionItems;
    });

/**
 * Calculate refund amount for a return line
 * Shows breakdown: gross, discount clawback, net
 */
export const calculateLineReturnRefund = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => z.object({ orderLineId: z.string().uuid() }).parse(input))
    .handler(async ({ data }): Promise<RefundCalculationResult> => {
        const prisma = await getPrisma();
        const { orderLineId } = data;

        const line = await prisma.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: {
                    select: {
                        totalAmount: true,
                        orderLines: {
                            select: {
                                id: true,
                                qty: true,
                                unitPrice: true,
                                returnStatus: true,
                                returnQty: true,
                            },
                        },
                    },
                },
            },
        });

        if (!line) {
            throw new Error('Order line not found');
        }

        if (!line.returnQty) {
            throw new Error('No return quantity set');
        }

        // Calculate gross amount (line value * return qty ratio)
        const lineTotal = line.unitPrice * line.qty;
        const grossAmount = (line.unitPrice * line.returnQty);

        // Calculate discount clawback (if order total drops below discount threshold)
        // This is a simplified calculation - in practice, you'd check against order-level discounts
        const discountClawback = 0;

        // Check if this return would drop order below any discount threshold
        // For now, assume no clawback (would need to implement discount rules)
        const suggestedDeductions = 0;

        const netAmount = grossAmount - discountClawback - suggestedDeductions;

        return {
            orderLineId,
            lineTotal,
            returnQty: line.returnQty,
            grossAmount,
            discountClawback,
            suggestedDeductions,
            netAmount,
        };
    });

// ============================================
// RETURN CONFIGURATION
// ============================================

export interface ReturnConfigResponse {
    windowDays: number;
    windowWarningDays: number;
    autoRejectAfterDays: number | null;
    allowExpiredOverride: boolean;
    reasonCategories: Array<{ value: string; label: string }>;
    conditions: Array<{ value: string; label: string }>;
    resolutions: Array<{ value: string; label: string }>;
    pickupTypes: Array<{ value: string; label: string }>;
    refundMethods: Array<{ value: string; label: string }>;
    nonReturnableReasons: Array<{ value: string; label: string }>;
}

/**
 * Get return settings from DB with fallback to code defaults
 */
async function getReturnSettingsFromDb(): Promise<EligibilitySettings & { autoRejectAfterDays: number | null; allowExpiredOverride: boolean }> {
    try {
        const prisma = await getPrisma();

        // Try to get settings from DB
        const dbSettings = await prisma.returnSettings.findFirst({
            where: { id: 'default' },
        });

        if (dbSettings) {
            return {
                windowDays: dbSettings.windowDays,
                windowWarningDays: dbSettings.windowWarningDays,
                autoRejectAfterDays: dbSettings.autoRejectAfterDays,
                allowExpiredOverride: dbSettings.allowExpiredOverride,
            };
        }
    } catch (error) {
        // Table might not exist yet - fall back to defaults
        console.warn('Failed to load return settings from DB, using defaults:', error);
    }

    // Return code defaults
    return {
        windowDays: RETURN_POLICY.windowDays,
        windowWarningDays: RETURN_POLICY.windowWarningDays,
        autoRejectAfterDays: RETURN_POLICY.autoRejectAfterDays,
        allowExpiredOverride: RETURN_POLICY.allowExpiredWithOverride,
    };
}

/**
 * Get return configuration settings
 * Reads from DB if available, falls back to code defaults
 */
export const getReturnConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<ReturnConfigResponse> => {
        const settings = await getReturnSettingsFromDb();

        return {
            windowDays: settings.windowDays,
            windowWarningDays: settings.windowWarningDays,
            autoRejectAfterDays: settings.autoRejectAfterDays,
            allowExpiredOverride: settings.allowExpiredOverride,
            reasonCategories: toOptions(RETURN_REASONS),
            conditions: toOptions(RETURN_CONDITIONS),
            resolutions: toOptions(RETURN_RESOLUTIONS),
            pickupTypes: toOptions(RETURN_PICKUP_TYPES),
            refundMethods: toOptions(RETURN_REFUND_METHODS),
            nonReturnableReasons: toOptions(NON_RETURNABLE_REASONS),
        };
    });

/**
 * Update return settings
 */
export const updateReturnSettings = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) =>
        z.object({
            windowDays: z.number().int().min(1).max(365),
            windowWarningDays: z.number().int().min(0).max(365),
            autoRejectAfterDays: z.number().int().min(1).max(365).nullable(),
            allowExpiredOverride: z.boolean(),
        }).parse(input)
    )
    .handler(async ({ data, context }): Promise<{ success: boolean }> => {
        const prisma = await getPrisma();
        const userId = context.user.id;

        // Validation: windowWarningDays should be less than windowDays
        if (data.windowWarningDays >= data.windowDays) {
            throw new Error('Warning threshold must be less than return window');
        }

        await prisma.returnSettings.upsert({
            where: { id: 'default' },
            create: {
                id: 'default',
                windowDays: data.windowDays,
                windowWarningDays: data.windowWarningDays,
                autoRejectAfterDays: data.autoRejectAfterDays,
                allowExpiredOverride: data.allowExpiredOverride,
                updatedById: userId,
            },
            update: {
                windowDays: data.windowDays,
                windowWarningDays: data.windowWarningDays,
                autoRejectAfterDays: data.autoRejectAfterDays,
                allowExpiredOverride: data.allowExpiredOverride,
                updatedById: userId,
            },
        });

        return { success: true };
    });

// ============================================
// RETURNS ANALYTICS
// ============================================

export interface ReturnsAnalyticsData {
    period: string;
    summary: {
        totalOrders: number;
        returns: number;
        exchanges: number;
        totalRequests: number;
        returnValue: number;
        exchangeValue: number;
        returnRatePct: number;
    };
    bySize: Array<{
        size: string;
        unitsSold: number;
        returns: number;
        exchanges: number;
        total: number;
        returnRate: number;
    }>;
    byProduct: Array<{
        productName: string;
        returns: number;
        exchanges: number;
        total: number;
        unitsSold: number;
        returnRate: number;
        valueAtRisk: number;
    }>;
    byReason: Array<{
        category: string;
        label: string;
        count: number;
        pct: number;
    }>;
}

const REASON_LABELS: Record<string, string> = {
    fit_size: 'Size/Fit Issue',
    product_quality: 'Quality Issue',
    product_different: 'Different from Listing',
    wrong_item_sent: 'Wrong Item Sent',
    damaged_in_transit: 'Damaged in Transit',
    changed_mind: 'Changed Mind',
    other: 'Other',
};

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

function getPeriodDate(period: string): Date | null {
    const now = new Date();
    switch (period) {
        case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        case '1y': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        case 'all': return null;
        default: return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
}

/**
 * Get returns analytics data for the dashboard
 * Computes summary, by-size, by-product, and by-reason breakdowns
 */
export const getReturnsAnalytics = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) =>
        z.object({
            period: z.enum(['7d', '30d', '90d', '1y', 'all']),
        }).parse(input)
    )
    .handler(async ({ data }): Promise<ReturnsAnalyticsData> => {
        const prisma = await getPrisma();
        const periodDate = getPeriodDate(data.period);

        const dateFilter = periodDate ? { gte: periodDate } : undefined;

        // ── 1. Summary ──────────────────────────────────────────────
        const [totalOrders, returnRequests, exchangeRequests, returnValueAgg, exchangeValueAgg] = await Promise.all([
            // Total orders (non-cancelled) in period
            prisma.order.count({
                where: {
                    status: { not: 'cancelled' },
                    ...(dateFilter ? { orderDate: dateFilter } : {}),
                },
            }),
            // Return requests count
            prisma.returnPrimeRequest.count({
                where: {
                    requestType: 'return',
                    ...(dateFilter ? { rpCreatedAt: dateFilter } : {}),
                },
            }),
            // Exchange requests count
            prisma.returnPrimeRequest.count({
                where: {
                    requestType: 'exchange',
                    ...(dateFilter ? { rpCreatedAt: dateFilter } : {}),
                },
            }),
            // Return value sum
            prisma.returnPrimeRequest.aggregate({
                _sum: { totalValue: true },
                where: {
                    requestType: 'return',
                    ...(dateFilter ? { rpCreatedAt: dateFilter } : {}),
                },
            }),
            // Exchange value sum
            prisma.returnPrimeRequest.aggregate({
                _sum: { totalValue: true },
                where: {
                    requestType: 'exchange',
                    ...(dateFilter ? { rpCreatedAt: dateFilter } : {}),
                },
            }),
        ]);

        const totalRequests = returnRequests + exchangeRequests;
        const returnValue = Number(returnValueAgg._sum.totalValue ?? 0);
        const exchangeValue = Number(exchangeValueAgg._sum.totalValue ?? 0);
        const returnRatePct = totalOrders > 0 ? (totalRequests / totalOrders) * 100 : 0;

        const summary = {
            totalOrders,
            returns: returnRequests,
            exchanges: exchangeRequests,
            totalRequests,
            returnValue,
            exchangeValue,
            returnRatePct: Math.round(returnRatePct * 100) / 100,
        };

        // ── 2. By Size ─────────────────────────────────────────────
        // Extract size from RP lineItems JSON and join with CSV enrichment
        const dateClause = periodDate
            ? `AND rpr."rpCreatedAt" >= $1`
            : '';
        const sizeParams = periodDate ? [periodDate] : [];

        const sizeRows = await prisma.$queryRawUnsafe<
            Array<{ size: string; request_type: string; cnt: string }>
        >(
            `SELECT
                COALESCE(
                    NULLIF(
                        TRIM(
                            SPLIT_PART(
                                rpr."lineItems"->0->'original_product'->>'variant_title',
                                ' / ',
                                GREATEST(
                                    ARRAY_LENGTH(
                                        STRING_TO_ARRAY(rpr."lineItems"->0->'original_product'->>'variant_title', ' / '),
                                        1
                                    ),
                                    1
                                )
                            )
                        ),
                        ''
                    ),
                    'Unknown'
                ) AS size,
                rpr."requestType" AS request_type,
                COUNT(*)::text AS cnt
            FROM "ReturnPrimeRequest" rpr
            WHERE 1=1 ${dateClause}
            GROUP BY size, rpr."requestType"
            ORDER BY size`,
            ...sizeParams
        );

        // Units sold per size in the same period
        const soldDateClause = periodDate
            ? `AND o."orderDate" >= $1`
            : '';
        const soldParams = periodDate ? [periodDate] : [];

        const soldBySize = await prisma.$queryRawUnsafe<
            Array<{ size: string; units_sold: string }>
        >(
            `SELECT
                s.size,
                SUM(ol.qty)::text AS units_sold
            FROM "OrderLine" ol
            JOIN "Sku" s ON s.id = ol."skuId"
            JOIN "Order" o ON o.id = ol."orderId"
            WHERE o.status != 'cancelled'
            ${soldDateClause}
            GROUP BY s.size`,
            ...soldParams
        );

        const soldMap = new Map(soldBySize.map(r => [r.size, parseInt(r.units_sold, 10)]));

        // Aggregate size data
        const sizeMap = new Map<string, { returns: number; exchanges: number }>();
        for (const row of sizeRows) {
            const existing = sizeMap.get(row.size) ?? { returns: 0, exchanges: 0 };
            if (row.request_type === 'return') {
                existing.returns += parseInt(row.cnt, 10);
            } else {
                existing.exchanges += parseInt(row.cnt, 10);
            }
            sizeMap.set(row.size, existing);
        }

        const bySize = Array.from(sizeMap.entries())
            .map(([size, counts]) => {
                const total = counts.returns + counts.exchanges;
                const unitsSold = soldMap.get(size) ?? 0;
                return {
                    size,
                    unitsSold,
                    returns: counts.returns,
                    exchanges: counts.exchanges,
                    total,
                    returnRate: unitsSold > 0 ? Math.round((total / unitsSold) * 10000) / 100 : 0,
                };
            })
            .sort((a, b) => {
                const aIdx = SIZE_ORDER.indexOf(a.size);
                const bIdx = SIZE_ORDER.indexOf(b.size);
                // Unknown sizes go to the end
                return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
            });

        // ── 3. By Product ───────────────────────────────────────────
        const productDateClause = periodDate
            ? `AND rpr."rpCreatedAt" >= $1`
            : '';
        const productParams = periodDate ? [periodDate] : [];

        const productRows = await prisma.$queryRawUnsafe<
            Array<{
                product_name: string;
                request_type: string;
                cnt: string;
                total_value: string;
            }>
        >(
            `SELECT
                COALESCE(
                    NULLIF(
                        TRIM(SPLIT_PART(rpr."lineItems"->0->'original_product'->>'title', ' - ', 1)),
                        ''
                    ),
                    'Unknown'
                ) AS product_name,
                rpr."requestType" AS request_type,
                COUNT(*)::text AS cnt,
                COALESCE(SUM(rpr."totalValue"), 0)::text AS total_value
            FROM "ReturnPrimeRequest" rpr
            WHERE 1=1 ${productDateClause}
            GROUP BY product_name, rpr."requestType"
            ORDER BY product_name`,
            ...productParams
        );

        // Units sold per product
        const soldByProduct = await prisma.$queryRawUnsafe<
            Array<{ product_name: string; units_sold: string }>
        >(
            `SELECT
                p.name AS product_name,
                SUM(ol.qty)::text AS units_sold
            FROM "OrderLine" ol
            JOIN "Sku" s ON s.id = ol."skuId"
            JOIN "Variation" v ON v.id = s."variationId"
            JOIN "Product" p ON p.id = v."productId"
            JOIN "Order" o ON o.id = ol."orderId"
            WHERE o.status != 'cancelled'
            ${soldDateClause}
            GROUP BY p.name`,
            ...soldParams
        );

        const productSoldMap = new Map(soldByProduct.map(r => [r.product_name, parseInt(r.units_sold, 10)]));

        // Aggregate product data
        const productMap = new Map<string, { returns: number; exchanges: number; valueAtRisk: number }>();
        for (const row of productRows) {
            const existing = productMap.get(row.product_name) ?? { returns: 0, exchanges: 0, valueAtRisk: 0 };
            const cnt = parseInt(row.cnt, 10);
            const val = parseFloat(row.total_value);
            if (row.request_type === 'return') {
                existing.returns += cnt;
            } else {
                existing.exchanges += cnt;
            }
            existing.valueAtRisk += val;
            productMap.set(row.product_name, existing);
        }

        const byProduct = Array.from(productMap.entries())
            .map(([productName, counts]) => {
                const total = counts.returns + counts.exchanges;
                const unitsSold = productSoldMap.get(productName) ?? 0;
                return {
                    productName,
                    returns: counts.returns,
                    exchanges: counts.exchanges,
                    total,
                    unitsSold,
                    returnRate: unitsSold > 0 ? Math.round((total / unitsSold) * 10000) / 100 : 0,
                    valueAtRisk: Math.round(counts.valueAtRisk * 100) / 100,
                };
            })
            .filter(p => p.total >= 5)
            .sort((a, b) => b.returnRate - a.returnRate)
            .slice(0, 20);

        // ── 4. By Reason Category ───────────────────────────────────
        const reasonRows = await prisma.orderLine.groupBy({
            by: ['returnReasonCategory'],
            _count: { id: true },
            where: {
                returnStatus: { not: null },
                returnReasonCategory: { not: null },
                ...(dateFilter ? { returnRequestedAt: dateFilter } : {}),
            },
        });

        const totalReasonCount = reasonRows.reduce((sum, r) => sum + r._count.id, 0);

        const byReason = reasonRows
            .map(row => {
                const category = row.returnReasonCategory ?? 'other';
                return {
                    category,
                    label: REASON_LABELS[category] ?? category,
                    count: row._count.id,
                    pct: totalReasonCount > 0
                        ? Math.round((row._count.id / totalReasonCount) * 10000) / 100
                        : 0,
                };
            })
            .sort((a, b) => b.count - a.count);

        return {
            period: data.period,
            summary,
            bySize,
            byProduct,
            byReason,
        };
    });

// ============================================
// INTERNAL RETURNS ANALYTICS (from OrderLine data)
// ============================================

export interface InternalReturnAnalytics {
    summary: {
        totalReturns: number;
        activeReturns: number;
        completedReturns: number;
        cancelledReturns: number;
        refunds: number;
        exchanges: number;
        totalRefundValue: number;
        avgResolutionDays: number;
    };
    byStatus: Array<{ status: string; count: number }>;
    byReason: Array<{ category: string; label: string; count: number; pct: number }>;
    topReturnedSkus: Array<{
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        count: number;
    }>;
    monthlyTrend: Array<{ month: string; returns: number; exchanges: number }>;
}

export const getInternalReturnAnalytics = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) =>
        z.object({
            period: z.enum(['7d', '30d', '90d', '1y', 'all']),
        }).parse(input)
    )
    .handler(async ({ data }): Promise<InternalReturnAnalytics> => {
        const prisma = await getPrisma();
        const periodDate = getPeriodDate(data.period);
        const dateFilter = periodDate ? { gte: periodDate } : undefined;

        const baseWhere = {
            returnStatus: { not: null } as const,
            ...(dateFilter ? { returnRequestedAt: dateFilter } : {}),
        };

        // Summary counts
        const [total, active, completed, cancelled, refunds, exchanges, refundValueAgg] = await Promise.all([
            prisma.orderLine.count({ where: baseWhere }),
            prisma.orderLine.count({
                where: { ...baseWhere, returnStatus: { notIn: ['refunded', 'archived', 'rejected', 'cancelled'] } },
            }),
            prisma.orderLine.count({
                where: { ...baseWhere, returnStatus: { in: ['refunded', 'archived', 'rejected'] } },
            }),
            prisma.orderLine.count({
                where: { ...baseWhere, returnStatus: 'cancelled' },
            }),
            prisma.orderLine.count({
                where: { ...baseWhere, returnResolution: 'refund' },
            }),
            prisma.orderLine.count({
                where: { ...baseWhere, returnResolution: 'exchange' },
            }),
            prisma.orderLine.aggregate({
                _sum: { returnNetAmount: true },
                where: { ...baseWhere, returnNetAmount: { not: null } },
            }),
        ]);

        // Avg resolution days (for completed returns)
        const avgDaysRows = await prisma.$queryRawUnsafe<Array<{ avg_days: string }>>(
            `SELECT COALESCE(AVG(
                EXTRACT(EPOCH FROM ("updatedAt" - "returnRequestedAt")) / 86400
            ), 0)::text AS avg_days
            FROM "OrderLine"
            WHERE "returnStatus" IN ('refunded', 'archived', 'rejected')
            AND "returnRequestedAt" IS NOT NULL
            ${periodDate ? `AND "returnRequestedAt" >= $1` : ''}`,
            ...(periodDate ? [periodDate] : [])
        );
        const avgDays = Math.round(parseFloat(avgDaysRows[0]?.avg_days || '0') * 10) / 10;

        // By status
        const statusGroups = await prisma.orderLine.groupBy({
            by: ['returnStatus'],
            _count: { id: true },
            where: baseWhere,
        });
        const byStatus = statusGroups
            .filter(g => g.returnStatus)
            .map(g => ({ status: g.returnStatus!, count: g._count.id }))
            .sort((a, b) => b.count - a.count);

        // By reason
        const reasonGroups = await prisma.orderLine.groupBy({
            by: ['returnReasonCategory'],
            _count: { id: true },
            where: { ...baseWhere, returnReasonCategory: { not: null } },
        });
        const totalReasonCount = reasonGroups.reduce((s, g) => s + g._count.id, 0);
        const byReason = reasonGroups
            .filter(g => g.returnReasonCategory)
            .map(g => ({
                category: g.returnReasonCategory!,
                label: REASON_LABELS[g.returnReasonCategory!] || g.returnReasonCategory!,
                count: g._count.id,
                pct: totalReasonCount > 0 ? Math.round((g._count.id / totalReasonCount) * 10000) / 100 : 0,
            }))
            .sort((a, b) => b.count - a.count);

        // Top returned SKUs
        const topSkuRows = await prisma.$queryRawUnsafe<
            Array<{ sku_code: string; product_name: string; color_name: string; size: string; cnt: string }>
        >(
            `SELECT s."skuCode" AS sku_code, p.name AS product_name, v."colorName" AS color_name, s.size,
                    COUNT(*)::text AS cnt
            FROM "OrderLine" ol
            JOIN "Sku" s ON s.id = ol."skuId"
            JOIN "Variation" v ON v.id = s."variationId"
            JOIN "Product" p ON p.id = v."productId"
            WHERE ol."returnStatus" IS NOT NULL
            ${periodDate ? `AND ol."returnRequestedAt" >= $1` : ''}
            GROUP BY s."skuCode", p.name, v."colorName", s.size
            ORDER BY COUNT(*) DESC
            LIMIT 10`,
            ...(periodDate ? [periodDate] : [])
        );
        const topReturnedSkus = topSkuRows.map(r => ({
            skuCode: r.sku_code,
            productName: r.product_name,
            colorName: r.color_name,
            size: r.size,
            count: parseInt(r.cnt, 10),
        }));

        // Monthly trend (last 6 months)
        const trendRows = await prisma.$queryRawUnsafe<
            Array<{ month: string; resolution: string; cnt: string }>
        >(
            `SELECT TO_CHAR("returnRequestedAt", 'YYYY-MM') AS month,
                    COALESCE("returnResolution", 'refund') AS resolution,
                    COUNT(*)::text AS cnt
            FROM "OrderLine"
            WHERE "returnStatus" IS NOT NULL
            AND "returnRequestedAt" >= NOW() - INTERVAL '6 months'
            GROUP BY month, resolution
            ORDER BY month`,
        );
        const trendMap = new Map<string, { returns: number; exchanges: number }>();
        for (const r of trendRows) {
            const existing = trendMap.get(r.month) ?? { returns: 0, exchanges: 0 };
            if (r.resolution === 'exchange') {
                existing.exchanges += parseInt(r.cnt, 10);
            } else {
                existing.returns += parseInt(r.cnt, 10);
            }
            trendMap.set(r.month, existing);
        }
        const monthlyTrend = Array.from(trendMap.entries())
            .map(([month, counts]) => ({ month, ...counts }))
            .sort((a, b) => a.month.localeCompare(b.month));

        return {
            summary: {
                totalReturns: total,
                activeReturns: active,
                completedReturns: completed,
                cancelledReturns: cancelled,
                refunds,
                exchanges,
                totalRefundValue: Number(refundValueAgg._sum.returnNetAmount ?? 0),
                avgResolutionDays: avgDays,
            },
            byStatus,
            byReason,
            topReturnedSkus,
            monthlyTrend,
        };
    });
