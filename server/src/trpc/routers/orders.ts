/**
 * Orders tRPC Router
 * Order management procedures matching Express orders endpoints
 *
 * Procedures:
 * - list: Query to list orders with optional view filter and pagination
 * - get: Query to get single order by ID with full details
 * - create: Mutation to create a new order
 * - allocate: Mutation to allocate order lines (reserve inventory)
 * - ship: Mutation to ship order lines
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import { CreateOrderSchema } from '@coh/shared';
import {
    buildViewWhereClause,
    enrichOrdersForView,
    ORDER_UNIFIED_SELECT,
    getValidViewNames,
    getViewConfig,
} from '../../utils/orderViews.js';
import { findOrCreateCustomerByContact } from '../../utils/customerUtils.js';
import { updateCustomerTier } from '../../utils/tierUtils.js';
import {
    calculateInventoryBalance,
    TXN_TYPE,
    TXN_REASON,
} from '../../utils/queryPatterns.js';
import { shipOrderLines } from '../../services/shipOrderService.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrderWithLines {
    orderLines?: Array<{ lineStatus?: string | null }>;
    [key: string]: unknown;
}

// ============================================
// LIST ORDERS PROCEDURE
// ============================================

/**
 * List orders with view filtering and pagination
 * Matches GET /api/orders?view=<viewName>
 */
const list = protectedProcedure
    .input(
        z.object({
            view: z.string().default('open'),
            page: z.number().int().positive().default(1),
            limit: z.number().int().positive().max(2000).default(100),
            days: z.number().int().positive().optional(),
            search: z.string().optional(),
            sortBy: z.enum(['orderDate', 'archivedAt', 'shippedAt', 'createdAt']).optional(),
        })
    )
    .query(async ({ input, ctx }) => {
        const { view, page, limit, days, search, sortBy } = input;

        // Validate view
        const viewConfig = getViewConfig(view);
        if (!viewConfig) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Invalid view: ${view}. Valid views: ${getValidViewNames().join(', ')}`,
            });
        }

        // Calculate offset from page
        const offset = (page - 1) * limit;

        // Build WHERE clause using view config
        const where = buildViewWhereClause(view, {
            days: days?.toString(),
            search,
            additionalFilters: {},
        });

        // Determine sort order
        let orderBy = viewConfig.orderBy;
        if (sortBy) {
            orderBy = { [sortBy]: 'desc' };
        }

        // Execute query with pagination
        const [totalCount, orders] = await Promise.all([
            ctx.prisma.order.count({ where }),
            ctx.prisma.order.findMany({
                where,
                select: ORDER_UNIFIED_SELECT,
                orderBy,
                take: limit,
                skip: offset,
            }),
        ]);

        // Apply view-specific enrichments
        const enriched = await enrichOrdersForView(
            ctx.prisma,
            orders,
            viewConfig.enrichment
        );

        // For open/ready_to_ship views, filter out cancelled lines
        let finalOrders = enriched;
        if (view === 'open' || view === 'ready_to_ship') {
            finalOrders = enriched
                .map((order: OrderWithLines) => ({
                    ...order,
                    orderLines: (order.orderLines || []).filter(
                        (line: { lineStatus?: string | null }) => line.lineStatus !== 'cancelled'
                    ),
                }))
                .filter((order: OrderWithLines) => (order.orderLines?.length ?? 0) > 0);
        }

        return {
            orders: finalOrders,
            view,
            viewName: viewConfig.name,
            pagination: {
                total: totalCount,
                limit,
                offset,
                page,
                totalPages: Math.ceil(totalCount / limit),
                hasMore: offset + orders.length < totalCount,
            },
        };
    });

// ============================================
// GET SINGLE ORDER PROCEDURE
// ============================================

/**
 * Get single order by ID with full details
 * Matches GET /api/orders/:id
 */
const get = protectedProcedure
    .input(z.object({ id: z.string().uuid('Invalid order ID') }))
    .query(async ({ input, ctx }) => {
        const order = await ctx.prisma.order.findUnique({
            where: { id: input.id },
            include: {
                customer: true,
                orderLines: {
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: true,
                                        fabric: true,
                                    },
                                },
                            },
                        },
                        productionBatch: true,
                    },
                },
                returnRequests: true,
                shopifyCache: true,
            },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Build Shopify admin URL if applicable
        let shopifyAdminUrl: string | null = null;
        if (order.shopifyOrderId) {
            const shopDomainSetting = await ctx.prisma.systemSetting.findUnique({
                where: { key: 'shopify_shop_domain' },
            });
            if (shopDomainSetting?.value) {
                const domain = shopDomainSetting.value;
                if (domain.includes('admin.shopify.com')) {
                    shopifyAdminUrl = `https://${domain}/orders/${order.shopifyOrderId}`;
                } else {
                    shopifyAdminUrl = `https://${domain}/admin/orders/${order.shopifyOrderId}`;
                }
            }
        }

        return {
            ...order,
            shopifyAdminUrl,
        };
    });

// ============================================
// CREATE ORDER PROCEDURE
// ============================================

/**
 * Create a new order
 * Matches POST /api/orders
 */
const create = protectedProcedure
    .input(CreateOrderSchema)
    .mutation(async ({ input, ctx }) => {
        const {
            orderNumber: providedOrderNumber,
            channel,
            customerName,
            customerEmail,
            customerPhone,
            customerId: providedCustomerId,
            shippingAddress,
            internalNotes,
            totalAmount,
            lines,
            isExchange,
            originalOrderId,
            shipByDate,
            paymentMethod,
            paymentStatus,
        } = input;

        // Validate originalOrderId exists if provided
        if (originalOrderId) {
            const originalOrder = await ctx.prisma.order.findUnique({
                where: { id: originalOrderId },
                select: { id: true },
            });
            if (!originalOrder) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Original order not found',
                });
            }
        }

        // Generate order number with EXC- prefix for exchanges
        const orderNumber =
            providedOrderNumber ||
            (isExchange
                ? `EXC-${Date.now().toString().slice(-8)}`
                : `COH-${Date.now().toString().slice(-8)}`);

        // Use provided customerId if given, otherwise find or create
        let customerId = providedCustomerId || null;
        if (!customerId && (customerEmail || customerPhone)) {
            const customerData = {
                email: customerEmail ?? undefined,
                phone: customerPhone ?? undefined,
                firstName: customerName?.split(' ')[0],
                lastName: customerName?.split(' ').slice(1).join(' '),
                defaultAddress: shippingAddress ?? undefined,
            };
            const customer = await findOrCreateCustomerByContact(
                ctx.prisma,
                customerData as { email: string; phone: string; firstName: string; lastName: string; defaultAddress: string }
            ) as { id: string };
            customerId = customer.id;
        }

        // Create order with lines in transaction
        const order = await ctx.prisma.$transaction(async (tx) => {
            return await tx.order.create({
                data: {
                    orderNumber,
                    channel: channel || 'offline',
                    customerId,
                    customerName,
                    customerEmail,
                    customerPhone,
                    shippingAddress,
                    internalNotes,
                    totalAmount: totalAmount ?? 0,
                    isExchange: isExchange || false,
                    originalOrderId: originalOrderId || null,
                    shipByDate: shipByDate ? new Date(shipByDate) : null,
                    paymentMethod: paymentMethod || 'Prepaid',
                    paymentStatus: paymentStatus || 'pending',
                    orderLines: {
                        create: lines.map((line: { skuId: string; qty: number; unitPrice?: number; shippingAddress?: string | null }) => ({
                            sku: { connect: { id: line.skuId } },
                            qty: line.qty,
                            unitPrice: line.unitPrice ?? 0,
                            lineStatus: 'pending',
                            shippingAddress: line.shippingAddress || shippingAddress || null,
                        })),
                    },
                },
                include: {
                    orderLines: {
                        include: {
                            sku: { include: { variation: { include: { product: true } } } },
                        },
                    },
                    originalOrder: { select: { id: true, orderNumber: true } },
                },
            });
        });

        // Update customer tier based on new order
        if (order.customerId && totalAmount && totalAmount > 0) {
            await updateCustomerTier(ctx.prisma, order.customerId);
        }

        return order;
    });

// ============================================
// ALLOCATE PROCEDURE
// ============================================

/**
 * Allocate order lines (reserve inventory)
 * Takes an array of lineIds and allocates each
 */
const allocate = protectedProcedure
    .input(
        z.object({
            lineIds: z.array(z.string().uuid()).min(1, 'At least one lineId is required'),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { lineIds } = input;
        const uniqueLineIds = Array.from(new Set(lineIds));

        // Fetch all lines in single query
        const lines = await ctx.prisma.orderLine.findMany({
            where: { id: { in: uniqueLineIds } },
            select: { id: true, skuId: true, qty: true, lineStatus: true },
        });

        if (lines.length === 0) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'No order lines found',
            });
        }

        // Group lines by SKU for efficient balance checking
        const linesBySku = new Map<string, typeof lines>();
        const failed: Array<{ lineId: string; reason: string }> = [];

        for (const line of lines) {
            if (line.lineStatus !== 'pending') {
                failed.push({ lineId: line.id, reason: `Invalid status: ${line.lineStatus}` });
                continue;
            }
            if (!linesBySku.has(line.skuId)) {
                linesBySku.set(line.skuId, []);
            }
            linesBySku.get(line.skuId)!.push(line);
        }

        // Calculate required qty per SKU
        const skuRequirements = new Map<string, { lines: typeof lines; totalQty: number }>();
        Array.from(linesBySku.entries()).forEach(([skuId, skuLines]) => {
            const totalQty = skuLines.reduce((sum, l) => sum + l.qty, 0);
            skuRequirements.set(skuId, { lines: skuLines, totalQty });
        });

        // Allocate inside transaction
        const result = await ctx.prisma.$transaction(async (tx) => {
            const allocated: string[] = [];
            const txnData: Array<{
                skuId: string;
                txnType: string;
                qty: number;
                reason: string;
                referenceId: string;
                createdById: string;
            }> = [];
            const allocatableLineIds: string[] = [];
            const timestamp = new Date();

            // Check balance for each SKU and prepare transactions
            for (const [skuId, { lines: skuLines, totalQty }] of Array.from(skuRequirements.entries())) {
                const balance = await calculateInventoryBalance(tx, skuId);

                if (balance.availableBalance < totalQty) {
                    for (const line of skuLines) {
                        failed.push({
                            lineId: line.id,
                            reason: `Insufficient stock: ${balance.availableBalance} available, ${totalQty} required`,
                        });
                    }
                    continue;
                }

                // Prepare transaction data for all lines of this SKU
                for (const line of skuLines) {
                    txnData.push({
                        skuId: line.skuId,
                        txnType: TXN_TYPE.RESERVED,
                        qty: line.qty,
                        reason: TXN_REASON.ORDER_ALLOCATION,
                        referenceId: line.id,
                        createdById: ctx.user.id,
                    });
                    allocatableLineIds.push(line.id);
                    allocated.push(line.id);
                }
            }

            // Batch create all transactions
            if (txnData.length > 0) {
                await tx.inventoryTransaction.createMany({ data: txnData });

                // Batch update all line statuses
                await tx.orderLine.updateMany({
                    where: { id: { in: allocatableLineIds } },
                    data: { lineStatus: 'allocated', allocatedAt: timestamp },
                });
            }

            return { allocated, failed };
        });

        return {
            allocated: result.allocated.length,
            lineIds: result.allocated,
            failed: result.failed.length > 0 ? result.failed : undefined,
        };
    });

// ============================================
// SHIP PROCEDURE
// ============================================

/**
 * Ship order lines
 * Takes lineIds, awbNumber, and courier to ship specified lines
 */
const ship = protectedProcedure
    .input(
        z.object({
            lineIds: z.array(z.string().uuid()).min(1, 'At least one lineId is required'),
            awbNumber: z
                .string()
                .min(1, 'AWB number is required')
                .trim()
                .transform((val) => val.toUpperCase()),
            courier: z.string().min(1, 'Courier is required').trim(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { lineIds, awbNumber, courier } = input;
        const uniqueLineIds = Array.from(new Set(lineIds));

        // Validate lines exist
        const lines = await ctx.prisma.orderLine.findMany({
            where: { id: { in: uniqueLineIds } },
            select: { id: true, orderId: true, lineStatus: true },
        });

        if (lines.length === 0) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'No order lines found',
            });
        }

        if (lines.length !== uniqueLineIds.length) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Some lineIds not found (found ${lines.length} of ${uniqueLineIds.length})`,
            });
        }

        // Ship using the service
        const result = await ctx.prisma.$transaction(async (tx) => {
            return await shipOrderLines(tx, {
                orderLineIds: uniqueLineIds,
                awbNumber,
                courier,
                userId: ctx.user.id,
            });
        });

        // Check for errors in the result
        if (result.errors && result.errors.length > 0) {
            const firstError = result.errors[0];

            if (firstError.code === 'INVALID_STATUS') {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: firstError.error,
                });
            } else if (firstError.code === 'DUPLICATE_AWB') {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: firstError.error,
                });
            } else {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: firstError.error,
                });
            }
        }

        return {
            shipped: result.shipped.length,
            lineIds: result.shipped.map((l) => l.lineId),
            skipped: result.skipped.length > 0 ? result.skipped : undefined,
            orderId: result.orderId,
            orderUpdated: result.orderUpdated,
        };
    });

// ============================================
// MARK PAYMENT PAID PROCEDURE
// ============================================

/**
 * Mark order payment as paid
 * For offline orders, confirms payment has been received
 */
const markPaid = protectedProcedure
    .input(
        z.object({
            orderId: z.string().uuid('Invalid order ID'),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { orderId, notes } = input;

        // Fetch order to validate it exists
        const existingOrder = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, paymentStatus: true, internalNotes: true },
        });

        if (!existingOrder) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Check if already paid
        if (existingOrder.paymentStatus === 'paid') {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Order payment is already marked as paid',
            });
        }

        // Update order
        const updatedOrder = await ctx.prisma.order.update({
            where: { id: orderId },
            data: {
                paymentStatus: 'paid',
                paymentConfirmedAt: new Date(),
                paymentConfirmedBy: ctx.user.id,
                internalNotes: notes
                    ? `${existingOrder.internalNotes || ''}\n[Payment Confirmed by ${ctx.user.email}] ${notes}`.trim()
                    : existingOrder.internalNotes,
            },
            include: {
                orderLines: true,
            },
        });

        return updatedOrder;
    });

// ============================================
// EXPORT ROUTER
// ============================================

/**
 * Orders router - combines all order procedures
 */
export const ordersRouter = router({
    list,
    get,
    create,
    allocate,
    ship,
    markPaid,
});
