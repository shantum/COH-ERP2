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
import type { Prisma } from '@prisma/client';
import { router, protectedProcedure } from '../index.js';
import { CreateOrderSchema, UpdateOrderSchema } from '@coh/shared';
import {
    buildViewWhereClause,
    enrichOrdersForView,
    ORDER_UNIFIED_SELECT,
    getValidViewNames,
    getViewConfig,
    flattenOrdersToRows,
    LINE_SSE_SELECT,
    flattenLineForSSE,
} from '../../utils/orderViews.js';
import { findOrCreateCustomerByContact } from '../../utils/customerUtils.js';
import { updateCustomerTier, incrementCustomerOrderCount, decrementCustomerOrderCount, adjustCustomerLtv } from '../../utils/tierUtils.js';
import {
    calculateAllInventoryBalances,
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createCustomSku,
    removeCustomization,
} from '../../utils/queryPatterns.js';
import {
    isValidTransition,
    executeTransition,
    buildTransitionError,
    hasAllocatedInventory,
    type LineStatus,
} from '../../utils/orderStateMachine.js';
import { shipOrderLines, shipOrder } from '../../services/shipOrderService.js';
import { adminShipOrderLines, isAdminShipEnabled } from '../../services/adminShipService.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import { broadcastOrderUpdate } from '../../routes/sse.js';
import { deferredExecutor } from '../../services/deferredExecutor.js';
import { enforceRulesInTrpc } from '../../rules/index.js';
import { recomputeOrderStatus } from '../../utils/orderStatus.js';
import { orderLogger } from '../../utils/logger.js';

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
            // Shipped view sub-filters (rto, cod_pending) - replaces separate RTO/COD views
            shippedFilter: z.enum(['rto', 'cod_pending']).optional(),
        })
    )
    .query(async ({ input, ctx }) => {
        const { view, page, limit, days, search, sortBy, shippedFilter } = input;

        // Handle shipped view with sub-filters (rto, cod_pending)
        // When shippedFilter is set, use that view's config instead
        let effectiveView = view;
        if (view === 'shipped' && shippedFilter) {
            effectiveView = shippedFilter; // Use 'rto' or 'cod_pending' view config
        }

        // Validate view
        const viewConfig = getViewConfig(effectiveView);
        if (!viewConfig) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Invalid view: ${effectiveView}. Valid views: ${getValidViewNames().join(', ')}`,
            });
        }

        // Calculate offset from page
        const offset = (page - 1) * limit;

        // Build WHERE clause using effective view config
        const where = buildViewWhereClause(effectiveView, {
            days: days?.toString(),
            search,
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

        // Pre-flatten orders into rows on server
        // This eliminates client-side O(n) transformation on every fetch
        const rows = flattenOrdersToRows(enriched);

        // Batch fetch inventory balances for all SKUs in the response
        // This eliminates client-side round-trip for inventory data
        const skuIds = [...new Set(rows.map(r => r.skuId).filter((id): id is string => Boolean(id)))];
        let inventoryMap = new Map<string, { availableBalance: number }>();

        if (skuIds.length > 0) {
            const balances = await inventoryBalanceCache.get(ctx.prisma, skuIds);
            inventoryMap = new Map(
                Array.from(balances.entries()).map(([id, bal]) => [id, { availableBalance: bal.availableBalance }])
            );
        }

        // Enrich rows with inventory stock (server-side)
        const rowsWithInventory = rows.map(row => {
            const balance = row.skuId ? inventoryMap.get(row.skuId) : null;
            return {
                ...row,
                skuStock: row.skuId ? (balance?.availableBalance ?? 0) : 0,
            };
        });

        return {
            rows: rowsWithInventory,
            // Keep orders for backwards compatibility during transition
            orders: enriched,
            view,
            viewName: viewConfig.name,
            // Flag to tell client inventory is included (skip separate fetch)
            hasInventory: true,
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

        // Update customer stats: increment orderCount and update tier
        if (order.customerId) {
            await incrementCustomerOrderCount(ctx.prisma, order.customerId);
            if (totalAmount && totalAmount > 0) {
                await updateCustomerTier(ctx.prisma, order.customerId);
            }
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

            // Batch fetch all inventory balances in a single query (O(1) instead of O(N))
            const skuIdsToCheck = Array.from(skuRequirements.keys());
            const balancesMap = await calculateAllInventoryBalances(tx, skuIdsToCheck, { allowNegative: true });

            // Check balance for each SKU and prepare transactions
            for (const [skuId, { lines: skuLines, totalQty }] of Array.from(skuRequirements.entries())) {
                const balance = balancesMap.get(skuId) || { availableBalance: 0 };

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
                // OUTWARD transaction created at allocation (immediate deduction)
                for (const line of skuLines) {
                    txnData.push({
                        skuId: line.skuId,
                        txnType: TXN_TYPE.OUTWARD,
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

        // Defer non-critical work: SSE broadcast and cache invalidation
        // Response returns immediately, deferred work runs after
        const affectedSkuIds = Array.from(skuRequirements.keys());
        const allocatedLineIds = result.allocated;
        const userId = ctx.user.id;
        const prisma = ctx.prisma;

        deferredExecutor.enqueue(async () => {
            // Fetch full row data for updated lines and broadcast with complete data
            // This eliminates the need for clients to refetch
            for (const lineId of allocatedLineIds) {
                try {
                    const line = await prisma.orderLine.findUnique({
                        where: { id: lineId },
                        select: LINE_SSE_SELECT,
                    });

                    if (line) {
                        const rowData = flattenLineForSSE(line);
                        broadcastOrderUpdate({
                            type: 'line_status',
                            view: 'open',
                            lineId,
                            changes: { lineStatus: 'allocated' },
                            rowData: rowData as unknown as Record<string, unknown> | undefined,
                        }, userId);
                    }
                } catch (err) {
                    // Fallback to minimal broadcast if fetch fails
                    broadcastOrderUpdate({
                        type: 'line_status',
                        view: 'open',
                        lineId,
                        changes: { lineStatus: 'allocated' },
                    }, userId);
                }
            }

            // Invalidate inventory balance cache
            if (affectedSkuIds.length > 0) {
                inventoryBalanceCache.invalidate(affectedSkuIds);
            }
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

        // Defer SSE broadcast
        if (result.shipped.length > 0) {
            const shippedLineIds = result.shipped.map(l => l.lineId);
            const orderId = result.orderId;
            const userId = ctx.user.id;

            deferredExecutor.enqueue(async () => {
                broadcastOrderUpdate({
                    type: 'order_shipped',
                    orderId: orderId ?? undefined,
                    lineIds: shippedLineIds,
                    affectedViews: ['open', 'shipped'],
                    changes: {
                        lineStatus: 'shipped',
                        awbNumber,
                        courier,
                        shippedAt: new Date().toISOString(),
                    },
                }, userId);
            });
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
// ADMIN SHIP PROCEDURE
// ============================================

/**
 * Admin-only ship procedure that bypasses status validation
 * Used for data migration and correction scenarios
 *
 * Requires admin role. Can be disabled via ENABLE_ADMIN_SHIP=false env var.
 */
const adminShip = protectedProcedure
    .input(
        z.object({
            lineIds: z.array(z.string().uuid()).min(1, 'At least one lineId is required'),
            awbNumber: z
                .string()
                .trim()
                .transform((val) => val.toUpperCase() || 'ADMIN-MANUAL')
                .optional()
                .default('ADMIN-MANUAL'),
            courier: z.string().trim().transform((val) => val || 'Manual').optional().default('Manual'),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { lineIds, awbNumber, courier } = input;
        const uniqueLineIds = Array.from(new Set(lineIds));

        // Check feature flag first
        if (!isAdminShipEnabled()) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Admin ship feature is disabled',
            });
        }

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

        // Use admin ship service (handles auth + status validation skip)
        const result = await ctx.prisma.$transaction(async (tx) => {
            return await adminShipOrderLines(tx, {
                orderLineIds: uniqueLineIds,
                awbNumber,
                courier,
                userId: ctx.user.id,
                userRole: ctx.user.role,
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

        // Defer SSE broadcast
        if (result.shipped.length > 0) {
            const shippedLineIds = result.shipped.map(l => l.lineId);
            const orderId = result.orderId;
            const userId = ctx.user.id;

            deferredExecutor.enqueue(async () => {
                broadcastOrderUpdate({
                    type: 'order_shipped',
                    orderId: orderId ?? undefined,
                    lineIds: shippedLineIds,
                    affectedViews: ['open', 'shipped'],
                    changes: {
                        lineStatus: 'shipped',
                        awbNumber,
                        courier,
                        shippedAt: new Date().toISOString(),
                    },
                }, userId);
            });
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
// SET LINE STATUS PROCEDURE
// ============================================

/**
 * Set line status with validation and inventory handling
 * Uses orderStateMachine as single source of truth for transitions
 * Unified endpoint for all status transitions except shipping (use ship procedure)
 */
const setLineStatus = protectedProcedure
    .input(
        z.object({
            lineId: z.string().uuid('Invalid line ID'),
            status: z.enum(['pending', 'allocated', 'picked', 'packed', 'cancelled']),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { lineId, status } = input;

        // Fetch current line state
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                skuId: true,
                qty: true,
                lineStatus: true,
                orderId: true,
            },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        const currentStatus = line.lineStatus as LineStatus;

        // Check if transition is valid using state machine
        if (!isValidTransition(currentStatus, status)) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: buildTransitionError(currentStatus, status),
            });
        }

        // Execute transition in transaction using state machine
        const result = await ctx.prisma.$transaction(async (tx) => {
            // Re-check status inside transaction (race condition prevention)
            const currentLine = await tx.orderLine.findUnique({
                where: { id: lineId },
                select: { lineStatus: true, skuId: true, qty: true },
            });

            if (!currentLine) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Order line not found',
                });
            }

            if (currentLine.lineStatus !== currentStatus) {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: `Line status changed (expected: ${currentStatus}, found: ${currentLine.lineStatus})`,
                });
            }

            // Execute transition with all side effects (inventory, timestamps)
            return executeTransition(tx, currentStatus, status, {
                lineId,
                skuId: currentLine.skuId,
                qty: currentLine.qty,
                userId: ctx.user.id,
            });
        });

        if (!result.success) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: result.error || 'Transition failed',
            });
        }

        // Defer SSE broadcast with full row data
        const orderIdForBroadcast = line.orderId;
        const userId = ctx.user.id;
        const prisma = ctx.prisma;

        deferredExecutor.enqueue(async () => {
            try {
                // Fetch full row data for SSE broadcast
                const updatedLine = await prisma.orderLine.findUnique({
                    where: { id: lineId },
                    select: LINE_SSE_SELECT,
                });

                if (updatedLine) {
                    const rowData = flattenLineForSSE(updatedLine);
                    broadcastOrderUpdate({
                        type: 'line_status',
                        view: 'open',
                        lineId,
                        orderId: orderIdForBroadcast,
                        changes: { lineStatus: status },
                        rowData: rowData as unknown as Record<string, unknown> | undefined,
                    }, userId);
                }
            } catch (err) {
                // Fallback to minimal broadcast
                broadcastOrderUpdate({
                    type: 'line_status',
                    view: 'open',
                    lineId,
                    orderId: orderIdForBroadcast,
                    changes: { lineStatus: status },
                }, userId);
            }
        });

        return {
            lineId,
            status: result.newStatus,
            orderId: line.orderId,
        };
    });

// ============================================
// CANCEL ORDER PROCEDURE
// ============================================

/**
 * Cancel an order and all its lines
 * Releases any allocated inventory
 */
const cancelOrder = protectedProcedure
    .input(
        z.object({
            orderId: z.string().uuid('Invalid order ID'),
            reason: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { orderId, reason } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce cancellation rules using rules engine
        await enforceRulesInTrpc('cancelOrder', ctx, {
            data: { order },
            phase: 'pre',
        });

        // Collect SKU IDs that may need cache invalidation
        const affectedSkuIds = order.orderLines
            .filter(l => hasAllocatedInventory(l.lineStatus as LineStatus))
            .map(l => l.skuId);

        await ctx.prisma.$transaction(async (tx) => {
            // Re-check status inside transaction using rules engine
            const currentOrder = await tx.order.findUnique({
                where: { id: orderId },
                select: { status: true, isArchived: true },
            });

            if (!currentOrder) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Order not found',
                });
            }

            // Enforce rules again within transaction (race condition prevention)
            await enforceRulesInTrpc('cancelOrder', ctx, {
                prisma: tx,
                data: { order: { id: orderId, status: currentOrder.status, isArchived: currentOrder.isArchived } },
                phase: 'transaction',
            });

            // Release inventory for allocated lines
            for (const line of order.orderLines) {
                if (hasAllocatedInventory(line.lineStatus as LineStatus)) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            // Cancel all lines
            await tx.orderLine.updateMany({
                where: { orderId },
                data: { lineStatus: 'cancelled' },
            });

            // Update order status
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'cancelled',
                    terminalStatus: 'cancelled',
                    terminalAt: new Date(),
                    internalNotes: reason
                        ? order.internalNotes
                            ? `${order.internalNotes}\n\nCancelled: ${reason}`
                            : `Cancelled: ${reason}`
                        : order.internalNotes,
                },
            });
        });

        // Defer non-critical work
        const customerId = order.customerId;
        const userId = ctx.user.id;
        const prisma = ctx.prisma;

        deferredExecutor.enqueue(async () => {
            // Invalidate inventory cache for affected SKUs
            if (affectedSkuIds.length > 0) {
                inventoryBalanceCache.invalidate(affectedSkuIds);
            }

            // Update customer stats: decrement orderCount and update tier
            if (customerId) {
                await decrementCustomerOrderCount(prisma, customerId);
                await updateCustomerTier(prisma, customerId);
            }

            // Broadcast SSE update
            broadcastOrderUpdate({
                type: 'order_cancelled',
                orderId,
                affectedViews: ['open', 'cancelled'],
                changes: { status: 'cancelled', lineStatus: 'cancelled' },
            }, userId);
        });

        return { orderId, status: 'cancelled' };
    });

// ============================================
// UNCANCEL ORDER PROCEDURE
// ============================================

/**
 * Restore a cancelled order to open status
 */
const uncancelOrder = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce uncancel rules using rules engine
        await enforceRulesInTrpc('uncancelOrder', ctx, {
            data: { order },
            phase: 'pre',
        });

        await ctx.prisma.$transaction(async (tx) => {
            // Restore order to open status
            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'open',
                    terminalStatus: null,
                    terminalAt: null,
                },
            });

            // Restore all lines to pending
            await tx.orderLine.updateMany({
                where: { orderId },
                data: { lineStatus: 'pending' },
            });
        });

        // Defer non-critical work
        const customerId = order.customerId;
        const userId = ctx.user.id;
        const prisma = ctx.prisma;

        deferredExecutor.enqueue(async () => {
            // Update customer stats: increment orderCount (restoring from cancelled) and update tier
            if (customerId) {
                await incrementCustomerOrderCount(prisma, customerId);
                await updateCustomerTier(prisma, customerId);
            }

            // Broadcast SSE update
            broadcastOrderUpdate({
                type: 'order_uncancelled',
                orderId,
                affectedViews: ['open', 'cancelled'],
                changes: { status: 'open', lineStatus: 'pending' },
            }, userId);
        });

        return { orderId, status: 'open' };
    });

// ============================================
// LINE-LEVEL DELIVERY/RTO MUTATIONS
// ============================================

/**
 * Mark a single line as delivered
 * Line-level operation - updates OrderLine.deliveredAt
 * If all shipped lines are delivered, sets Order.terminalStatus='delivered'
 */
const markLineDelivered = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
        deliveredAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId, deliveredAt } = input;
        const deliveryTime = deliveredAt ? new Date(deliveredAt) : new Date();

        // Fetch line with order context
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                deliveredAt: true,
                orderId: true,
                order: {
                    select: { id: true, customerId: true },
                },
            },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Validate line is shipped
        if (line.lineStatus !== 'shipped') {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Cannot mark as delivered: line status is '${line.lineStatus}', must be 'shipped'`,
            });
        }

        // Already delivered - idempotent
        if (line.deliveredAt) {
            return { lineId, deliveredAt: line.deliveredAt, orderId: line.orderId };
        }

        const result = await ctx.prisma.$transaction(async (tx) => {
            // Update line-level deliveredAt and trackingStatus
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    deliveredAt: deliveryTime,
                    trackingStatus: 'delivered',
                },
            });

            // Check if ALL shipped lines are now delivered
            const undeliveredShippedLines = await tx.orderLine.count({
                where: {
                    orderId: line.orderId,
                    lineStatus: 'shipped',
                    deliveredAt: null,
                    id: { not: lineId }, // Exclude the line we just updated
                },
            });

            let orderTerminal = false;
            if (undeliveredShippedLines === 0) {
                // All shipped lines are delivered - set order terminal status
                await tx.order.update({
                    where: { id: line.orderId },
                    data: {
                        terminalStatus: 'delivered',
                        terminalAt: deliveryTime,
                        // Also update order-level deliveredAt for backward compat
                        deliveredAt: deliveryTime,
                        status: 'delivered',
                    },
                });
                orderTerminal = true;
            }

            return { orderTerminal };
        });

        // Broadcast SSE update
        broadcastOrderUpdate({
            type: 'line_delivered',
            lineId,
            orderId: line.orderId,
            affectedViews: ['shipped', 'cod_pending'],
            changes: {
                deliveredAt: deliveryTime.toISOString(),
                trackingStatus: 'delivered',
                ...(result.orderTerminal ? { terminalStatus: 'delivered' } : {}),
            },
        }, ctx.user.id);

        return {
            lineId,
            deliveredAt: deliveryTime,
            orderId: line.orderId,
            orderTerminal: result.orderTerminal,
        };
    });

/**
 * Initiate RTO for a single line
 * Line-level operation - updates OrderLine.rtoInitiatedAt
 * Increments customer rtoCount only once per line
 */
const markLineRto = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId } = input;
        const now = new Date();

        // Fetch line with order context
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                rtoInitiatedAt: true,
                orderId: true,
                order: {
                    select: { id: true, customerId: true },
                },
            },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Validate line is shipped
        if (line.lineStatus !== 'shipped') {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Cannot initiate RTO: line status is '${line.lineStatus}', must be 'shipped'`,
            });
        }

        // Already RTO initiated - idempotent
        if (line.rtoInitiatedAt) {
            return { lineId, rtoInitiatedAt: line.rtoInitiatedAt, orderId: line.orderId };
        }

        await ctx.prisma.$transaction(async (tx) => {
            // Update line-level rtoInitiatedAt and trackingStatus
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    rtoInitiatedAt: now,
                    trackingStatus: 'rto_initiated',
                },
            });

            // Increment customer RTO count (only first RTO per line)
            if (line.order?.customerId) {
                await tx.customer.update({
                    where: { id: line.order.customerId },
                    data: { rtoCount: { increment: 1 } },
                });
            }

            // Also update order-level rtoInitiatedAt for backward compat (if not already set)
            await tx.order.update({
                where: { id: line.orderId },
                data: {
                    rtoInitiatedAt: now,
                },
            });
        });

        // Broadcast SSE update
        broadcastOrderUpdate({
            type: 'line_rto',
            lineId,
            orderId: line.orderId,
            affectedViews: ['shipped', 'rto'],
            changes: {
                rtoInitiatedAt: now.toISOString(),
                trackingStatus: 'rto_initiated',
            },
        }, ctx.user.id);

        return {
            lineId,
            rtoInitiatedAt: now,
            orderId: line.orderId,
        };
    });

/**
 * Receive RTO for a single line
 * Line-level operation - updates OrderLine.rtoReceivedAt and creates inventory inward
 * If all RTO lines are received, sets Order.terminalStatus='rto_received'
 */
const receiveLineRto = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
        condition: z.enum(['good', 'damaged', 'missing']).optional(),
        notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId, condition, notes } = input;
        const now = new Date();

        // Fetch line with order context
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                rtoInitiatedAt: true,
                rtoReceivedAt: true,
                skuId: true,
                qty: true,
                orderId: true,
                order: {
                    select: { id: true },
                },
            },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Validate line has RTO initiated
        if (!line.rtoInitiatedAt) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot receive RTO: RTO has not been initiated for this line',
            });
        }

        // Already received - idempotent
        if (line.rtoReceivedAt) {
            return { lineId, rtoReceivedAt: line.rtoReceivedAt, orderId: line.orderId };
        }

        const result = await ctx.prisma.$transaction(async (tx) => {
            // Update line-level rtoReceivedAt, condition, and trackingStatus
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    rtoReceivedAt: now,
                    rtoCondition: condition || 'good',
                    rtoNotes: notes || null,
                    trackingStatus: 'rto_delivered',
                },
            });

            // Create inventory inward transaction for this line only
            await tx.inventoryTransaction.create({
                data: {
                    skuId: line.skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: line.qty,
                    reason: TXN_REASON.RTO_RECEIVED,
                    referenceId: lineId,
                    createdById: ctx.user.id,
                },
            });

            // Check if ALL RTO-initiated lines are now received
            const unreceived = await tx.orderLine.count({
                where: {
                    orderId: line.orderId,
                    rtoInitiatedAt: { not: null },
                    rtoReceivedAt: null,
                    id: { not: lineId }, // Exclude line we just updated
                },
            });

            let orderTerminal = false;
            if (unreceived === 0) {
                // All RTO lines received - set order terminal status
                await tx.order.update({
                    where: { id: line.orderId },
                    data: {
                        terminalStatus: 'rto_received',
                        terminalAt: now,
                        // Also update order-level for backward compat
                        rtoReceivedAt: now,
                    },
                });
                orderTerminal = true;
            }

            return { orderTerminal };
        });

        // Invalidate inventory cache
        inventoryBalanceCache.invalidate([line.skuId]);

        // Broadcast SSE update
        broadcastOrderUpdate({
            type: 'line_rto_received',
            lineId,
            orderId: line.orderId,
            affectedViews: ['rto', 'open'],
            changes: {
                rtoReceivedAt: now.toISOString(),
                rtoCondition: condition || 'good',
                trackingStatus: 'rto_delivered',
                ...(result.orderTerminal ? { terminalStatus: 'rto_received' } : {}),
            },
        }, ctx.user.id);

        return {
            lineId,
            rtoReceivedAt: now,
            rtoCondition: condition || 'good',
            orderId: line.orderId,
            orderTerminal: result.orderTerminal,
        };
    });

// ============================================
// MARK DELIVERED PROCEDURE (ORDER-LEVEL - delegates to line-level)
// ============================================

/**
 * Mark all shipped lines of an order as delivered
 * @deprecated Prefer markLineDelivered for line-level control
 * This procedure delegates to line-level logic for backward compatibility
 */
const markDelivered = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;
        const now = new Date();

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                status: true,
                orderLines: {
                    where: { lineStatus: 'shipped', deliveredAt: null },
                    select: { id: true },
                },
            },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce delivery rules using rules engine
        await enforceRulesInTrpc('markDelivered', ctx, {
            data: { order },
            phase: 'pre',
        });

        const shippedLineIds = order.orderLines.map(l => l.id);

        if (shippedLineIds.length === 0) {
            // No shipped lines to deliver - just update order status for backward compat
            await ctx.prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'delivered',
                    deliveredAt: now,
                    terminalStatus: 'delivered',
                    terminalAt: now,
                },
            });
        } else {
            // Update all shipped lines to delivered
            await ctx.prisma.$transaction(async (tx) => {
                // Update all shipped lines
                await tx.orderLine.updateMany({
                    where: { id: { in: shippedLineIds } },
                    data: {
                        deliveredAt: now,
                        trackingStatus: 'delivered',
                    },
                });

                // Update order status
                await tx.order.update({
                    where: { id: orderId },
                    data: {
                        status: 'delivered',
                        deliveredAt: now,
                        terminalStatus: 'delivered',
                        terminalAt: now,
                    },
                });
            });
        }

        // Broadcast SSE update with new event type
        broadcastOrderUpdate({
            type: 'order_delivered',
            orderId,
            affectedViews: ['shipped', 'cod_pending'],
            changes: { status: 'delivered', deliveredAt: now.toISOString() },
        }, ctx.user.id);

        return { orderId, status: 'delivered', linesDelivered: shippedLineIds.length };
    });

// ============================================
// MARK RTO PROCEDURE (ORDER-LEVEL - delegates to line-level)
// ============================================

/**
 * Initiate RTO for all shipped lines of an order
 * @deprecated Prefer markLineRto for line-level control
 * This procedure delegates to line-level logic for backward compatibility
 */
const markRto = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;
        const now = new Date();

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                status: true,
                customerId: true,
                rtoInitiatedAt: true,
                orderLines: {
                    where: { lineStatus: 'shipped', rtoInitiatedAt: null },
                    select: { id: true },
                },
            },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce RTO initiation rules using rules engine
        await enforceRulesInTrpc('initiateRto', ctx, {
            data: { order },
            phase: 'pre',
        });

        const shippedLineIds = order.orderLines.map(l => l.id);
        const linesInitiated = shippedLineIds.length;

        const updated = await ctx.prisma.$transaction(async (tx) => {
            // Update all shipped lines to RTO initiated
            if (shippedLineIds.length > 0) {
                await tx.orderLine.updateMany({
                    where: { id: { in: shippedLineIds } },
                    data: {
                        rtoInitiatedAt: now,
                        trackingStatus: 'rto_initiated',
                    },
                });
            }

            // Update order-level rtoInitiatedAt
            const updatedOrder = await tx.order.update({
                where: { id: orderId },
                data: { rtoInitiatedAt: now },
            });

            // Increment customer RTO count based on number of lines (not order)
            // Each line counts as one RTO for customer stats
            if (linesInitiated > 0 && order.customerId) {
                await tx.customer.update({
                    where: { id: order.customerId },
                    data: { rtoCount: { increment: linesInitiated } },
                });
            }

            return updatedOrder;
        });

        // Broadcast SSE update with new event type
        broadcastOrderUpdate({
            type: 'order_rto',
            orderId,
            affectedViews: ['shipped', 'rto'],
            changes: { rtoInitiatedAt: now.toISOString() },
        }, ctx.user.id);

        return { orderId, rtoInitiatedAt: updated.rtoInitiatedAt, linesInitiated };
    });

// ============================================
// RECEIVE RTO PROCEDURE (ORDER-LEVEL - delegates to line-level)
// ============================================

/**
 * Receive RTO for all RTO-initiated lines of an order
 * @deprecated Prefer receiveLineRto for line-level control
 * This procedure delegates to line-level logic for backward compatibility
 * Only processes lines that have rtoInitiatedAt set and rtoReceivedAt not set
 */
const receiveRto = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;
        const now = new Date();

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                orderLines: {
                    where: {
                        rtoInitiatedAt: { not: null },
                        rtoReceivedAt: null,
                    },
                    select: { id: true, skuId: true, qty: true },
                },
            },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce RTO receive rules using rules engine
        await enforceRulesInTrpc('receiveRto', ctx, {
            data: { order },
            phase: 'pre',
        });

        // Only process lines with RTO initiated (not all lines)
        const rtoLines = order.orderLines;
        const affectedSkuIds = rtoLines.map(l => l.skuId);
        const lineIds = rtoLines.map(l => l.id);

        if (rtoLines.length === 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'No RTO-initiated lines to receive',
            });
        }

        await ctx.prisma.$transaction(async (tx) => {
            // Update all RTO-initiated lines
            await tx.orderLine.updateMany({
                where: { id: { in: lineIds } },
                data: {
                    rtoReceivedAt: now,
                    rtoCondition: 'good', // Default condition
                    trackingStatus: 'rto_delivered',
                },
            });

            // Update order-level for backward compat
            await tx.order.update({
                where: { id: orderId },
                data: {
                    rtoReceivedAt: now,
                    terminalStatus: 'rto_received',
                    terminalAt: now,
                },
            });

            // Create inward transactions only for RTO lines (not all lines)
            if (rtoLines.length > 0) {
                await tx.inventoryTransaction.createMany({
                    data: rtoLines.map(line => ({
                        skuId: line.skuId,
                        txnType: TXN_TYPE.INWARD,
                        qty: line.qty,
                        reason: TXN_REASON.RTO_RECEIVED,
                        referenceId: line.id,
                        createdById: ctx.user.id,
                    })),
                });
            }
        });

        // Invalidate inventory cache
        if (affectedSkuIds.length > 0) {
            inventoryBalanceCache.invalidate(affectedSkuIds);
        }

        // Broadcast SSE update with new event type
        broadcastOrderUpdate({
            type: 'order_rto_received',
            orderId,
            affectedViews: ['rto', 'open'],
            changes: { rtoReceivedAt: now.toISOString() },
        }, ctx.user.id);

        return { orderId, rtoReceivedAt: now, linesReceived: rtoLines.length };
    });

// ============================================
// CANCEL LINE PROCEDURE
// ============================================

/**
 * Cancel a single order line
 * Releases inventory if allocated
 */
const cancelLine = protectedProcedure
    .input(z.object({ lineId: z.string().uuid('Invalid line ID') }))
    .mutation(async ({ input, ctx }) => {
        const { lineId } = input;

        // Single query to get line with minimal fields
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                skuId: true,
                qty: true,
                unitPrice: true,
                orderId: true,
                order: { select: { customerId: true } },
            },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Soft return for already cancelled (idempotent)
        if (line.lineStatus === 'cancelled') {
            return { lineId, lineStatus: 'cancelled' };
        }

        // Enforce cancel line rules using rules engine (checks shipped status)
        await enforceRulesInTrpc('cancelLine', ctx, {
            data: { line },
            phase: 'pre',
        });

        // If allocated, reverse inventory
        if (hasAllocatedInventory(line.lineStatus as LineStatus)) {
            const txn = await ctx.prisma.inventoryTransaction.findFirst({
                where: { referenceId: lineId, txnType: TXN_TYPE.OUTWARD, reason: TXN_REASON.ORDER_ALLOCATION },
                select: { id: true, skuId: true },
            });
            if (txn) {
                await ctx.prisma.inventoryTransaction.delete({ where: { id: txn.id } });
                inventoryBalanceCache.invalidate([txn.skuId]);
            }
        }

        // Update line status
        await ctx.prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'cancelled' },
        });

        // Background: adjust LTV (fire and forget)
        const customerId = line.order?.customerId;
        const lineAmount = line.qty * line.unitPrice;
        const orderId = line.orderId;
        const userId = ctx.user.id;

        deferredExecutor.enqueue(async () => {
            if (customerId) {
                adjustCustomerLtv(ctx.prisma, customerId, -lineAmount).catch(() => {});
            }

            // Broadcast SSE update to other users
            broadcastOrderUpdate({
                type: 'line_status',
                view: 'open',
                lineId,
                orderId,
                changes: { lineStatus: 'cancelled' },
            }, userId);
        });

        return { lineId, lineStatus: 'cancelled' };
    });

// ============================================
// UNCANCEL LINE PROCEDURE
// ============================================

/**
 * Restore a cancelled order line to pending
 */
const uncancelLine = protectedProcedure
    .input(z.object({ lineId: z.string().uuid('Invalid line ID') }))
    .mutation(async ({ input, ctx }) => {
        const { lineId } = input;

        // Single query with minimal fields
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                lineStatus: true,
                qty: true,
                unitPrice: true,
                orderId: true,
                order: { select: { customerId: true } },
            },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Soft return for not cancelled (idempotent)
        if (line.lineStatus !== 'cancelled') {
            return { lineId, lineStatus: line.lineStatus };
        }

        // Enforce uncancel line rules using rules engine
        await enforceRulesInTrpc('uncancelLine', ctx, {
            data: { line },
            phase: 'pre',
        });

        // Update line status
        await ctx.prisma.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'pending' },
        });

        // Background: adjust LTV (fire and forget)
        const customerId = line.order?.customerId;
        const lineAmount = line.qty * line.unitPrice;
        const orderId = line.orderId;
        const userId = ctx.user.id;

        deferredExecutor.enqueue(async () => {
            if (customerId) {
                adjustCustomerLtv(ctx.prisma, customerId, lineAmount).catch(() => {});
            }

            // Broadcast SSE update to other users
            broadcastOrderUpdate({
                type: 'line_status',
                view: 'open',
                lineId,
                orderId,
                changes: { lineStatus: 'pending' },
            }, userId);
        });

        return { lineId, lineStatus: 'pending' };
    });

// ============================================
// UPDATE LINE PROCEDURE
// ============================================

/**
 * Update order line (change qty, unitPrice, notes, or tracking)
 */
const updateLine = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
        qty: z.number().int().positive().optional(),
        unitPrice: z.number().nonnegative().optional(),
        notes: z.string().optional(),
        awbNumber: z.string().optional(),
        courier: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId, qty, unitPrice, notes, awbNumber, courier } = input;

        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Enforce rules for line editing
        const hasQtyOrPrice = qty !== undefined || unitPrice !== undefined;
        await enforceRulesInTrpc('editLine', ctx, {
            data: {
                line: { id: line.id, lineStatus: line.lineStatus },
                hasQtyOrPriceChange: hasQtyOrPrice,
            },
            phase: 'pre',
        });

        const updateData: Prisma.OrderLineUpdateInput = {};
        if (qty !== undefined) updateData.qty = qty;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (notes !== undefined) updateData.notes = notes;
        if (awbNumber !== undefined) updateData.awbNumber = awbNumber || null;
        if (courier !== undefined) updateData.courier = courier || null;

        // If only updating simple fields (notes, awbNumber, courier), no transaction needed
        if (!hasQtyOrPrice) {
            const updated = await ctx.prisma.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });
            return updated;
        }

        // qty/unitPrice changes need transaction to update order total
        await ctx.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: updateData,
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId: line.orderId },
            });
            const newTotal = allLines.reduce((sum, l) => {
                const lineQty = l.id === lineId ? (qty ?? l.qty) : l.qty;
                const linePrice = l.id === lineId ? (unitPrice ?? l.unitPrice) : l.unitPrice;
                return sum + lineQty * linePrice;
            }, 0);
            await tx.order.update({
                where: { id: line.orderId },
                data: { totalAmount: newTotal },
            });
        });

        const updated = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
        });

        return updated;
    });

// ============================================
// ADD LINE PROCEDURE
// ============================================

/**
 * Add a new line to an existing order
 */
const addLine = protectedProcedure
    .input(z.object({
        orderId: z.string().uuid('Invalid order ID'),
        skuId: z.string().uuid('Invalid SKU ID'),
        qty: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { orderId, skuId, qty, unitPrice } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce rules for adding lines
        await enforceRulesInTrpc('addLine', ctx, {
            data: { order: { id: order.id, status: order.status } },
            phase: 'pre',
        });

        const result = await ctx.prisma.$transaction(async (tx) => {
            const newLine = await tx.orderLine.create({
                data: {
                    orderId,
                    skuId,
                    qty,
                    unitPrice,
                    lineStatus: 'pending',
                },
            });

            const allLines = await tx.orderLine.findMany({
                where: { orderId },
            });
            const newTotal = allLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
            await tx.order.update({
                where: { id: orderId },
                data: { totalAmount: newTotal },
            });

            return newLine;
        });

        const updated = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
            },
        });

        return updated;
    });

// ============================================
// UPDATE ORDER PROCEDURE
// ============================================

/**
 * Update order details (customer info, notes, shipByDate, etc.)
 */
const updateOrder = protectedProcedure
    .input(z.object({
        orderId: z.string().uuid('Invalid order ID'),
        customerName: z.string().optional(),
        customerEmail: z.string().email().nullable().optional(),
        customerPhone: z.string().nullable().optional(),
        shippingAddress: z.string().nullable().optional(),
        internalNotes: z.string().nullable().optional(),
        shipByDate: z.string().nullable().optional(),
        isExchange: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const {
            orderId,
            customerName,
            customerEmail,
            customerPhone,
            shippingAddress,
            internalNotes,
            shipByDate,
            isExchange,
        } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        const updateData: Prisma.OrderUpdateInput = {};
        if (customerName !== undefined) updateData.customerName = customerName;
        if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
        if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress;
        if (internalNotes !== undefined) updateData.internalNotes = internalNotes;
        if (shipByDate !== undefined) updateData.shipByDate = shipByDate ? new Date(shipByDate) : null;
        if (isExchange !== undefined) updateData.isExchange = isExchange;

        const updated = await ctx.prisma.order.update({
            where: { id: orderId },
            data: updateData,
            include: {
                orderLines: {
                    include: {
                        sku: { include: { variation: { include: { product: true } } } },
                    },
                },
            },
        });

        return updated;
    });

// ============================================
// DELETE ORDER PROCEDURE
// ============================================

/**
 * Delete an order (only for manually created orders)
 * Shopify orders cannot be deleted
 */
const deleteOrder = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        if (order.shopifyOrderId && order.orderLines.length > 0) {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Cannot delete Shopify orders with line items. Use cancel instead.',
            });
        }

        await ctx.prisma.$transaction(async (tx) => {
            for (const line of order.orderLines) {
                if (line.productionBatchId) {
                    await tx.productionBatch.update({
                        where: { id: line.productionBatchId },
                        data: { sourceOrderLineId: null },
                    });
                }

                if (hasAllocatedInventory(line.lineStatus as LineStatus)) {
                    await releaseReservedInventory(tx, line.id);
                }
            }

            await tx.orderLine.deleteMany({ where: { orderId: order.id } });
            await tx.order.delete({ where: { id: order.id } });
        });

        return { success: true, message: 'Order deleted successfully' };
    });

// ============================================
// UNSHIP PROCEDURE
// ============================================

/**
 * Unship an order - revert shipped order back to packed status
 */
const unship = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        if (order.status !== 'shipped') {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Order must be shipped to unship (current: ${order.status})`,
            });
        }

        await ctx.prisma.$transaction(async (tx) => {
            // Re-check status inside transaction to prevent race condition
            const currentOrder = await tx.order.findUnique({
                where: { id: orderId },
                select: { status: true },
            });

            if (!currentOrder) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Order not found',
                });
            }

            if (currentOrder.status !== 'shipped') {
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'Order status changed by another request',
                });
            }

            // Note: No inventory action needed on unship
            // In the simplified model, OUTWARD is created at allocation and stays
            // Unshipping only affects status/visibility, not inventory

            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'open',
                    releasedToShipped: false,
                },
            });

            // Revert line statuses and clear tracking fields
            await tx.orderLine.updateMany({
                where: { orderId },
                data: {
                    lineStatus: 'packed',
                    shippedAt: null,
                    awbNumber: null,
                    courier: null,
                    trackingStatus: null,
                },
            });
        });

        const updated = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        // Broadcast SSE - use order_updated for unship operation
        deferredExecutor.enqueue(async () => {
            broadcastOrderUpdate({
                type: 'order_updated',
                orderId,
                affectedViews: ['open', 'shipped'],
                changes: { status: 'open', lineStatus: 'packed' },
            }, ctx.user.id);
        });

        return updated;
    });

// ============================================
// SHIP ORDER (ENTIRE ORDER) PROCEDURE
// ============================================

/**
 * Ship an entire order (wrapper that ships all packed lines)
 */
const shipOrder_ = protectedProcedure
    .input(z.object({
        orderId: z.string().uuid('Invalid order ID'),
        awbNumber: z.string().min(1, 'AWB number is required').trim()
            .transform((val) => val.toUpperCase()),
        courier: z.string().min(1, 'Courier is required').trim(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { orderId, awbNumber, courier } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Idempotency check - if already shipped, return success
        if (order.status === 'shipped') {
            return {
                ...order,
                message: 'Order is already shipped',
            };
        }

        // Ship using the service
        const result = await ctx.prisma.$transaction(async (tx) => {
            return await shipOrder(tx, {
                orderId,
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

        // Fetch updated order
        const updated = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        // Defer SSE broadcast
        if (result.shipped.length > 0) {
            const shippedLineIds = result.shipped.map(l => l.lineId);
            const userId = ctx.user.id;

            deferredExecutor.enqueue(async () => {
                broadcastOrderUpdate({
                    type: 'order_shipped',
                    orderId,
                    lineIds: shippedLineIds,
                    affectedViews: ['open', 'shipped'],
                    changes: {
                        lineStatus: 'shipped',
                        awbNumber,
                        courier,
                        shippedAt: new Date().toISOString(),
                    },
                }, userId);
            });
        }

        return updated;
    });

// ============================================
// RELEASE OPERATIONS
// ============================================

/**
 * Release shipped orders to the shipped view
 * Shipped orders stay in open view until explicitly released
 */
const releaseToShipped = protectedProcedure
    .input(z.object({
        orderIds: z.array(z.string().uuid()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { orderIds } = input;

        // Build where clause - either specific orders or all unreleased shipped orders
        const whereClause: Prisma.OrderWhereInput = {
            releasedToShipped: false,
            // Only release orders where all non-cancelled lines are shipped
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
        };

        if (orderIds && orderIds.length > 0) {
            whereClause.id = { in: orderIds };
        }

        const result = await ctx.prisma.order.updateMany({
            where: whereClause,
            data: { releasedToShipped: true },
        });

        orderLogger.info({ orderIds, count: result.count }, 'Released orders to shipped');

        return {
            message: `Released ${result.count} orders to shipped view`,
            count: result.count,
        };
    });

/**
 * Release cancelled orders to the cancelled view
 * Cancelled orders stay in open view until explicitly released
 */
const releaseToCancelled = protectedProcedure
    .input(z.object({
        orderIds: z.array(z.string().uuid()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { orderIds } = input;

        // Build where clause - either specific orders or all unreleased cancelled orders
        const whereClause: Prisma.OrderWhereInput = {
            releasedToCancelled: false,
            // Only release orders where all lines are cancelled
            NOT: {
                orderLines: {
                    some: {
                        lineStatus: { not: 'cancelled' },
                    },
                },
            },
            // Must have at least one cancelled line
            orderLines: {
                some: { lineStatus: 'cancelled' },
            },
        };

        if (orderIds && orderIds.length > 0) {
            whereClause.id = { in: orderIds };
        }

        const result = await ctx.prisma.order.updateMany({
            where: whereClause,
            data: { releasedToCancelled: true },
        });

        orderLogger.info({ orderIds, count: result.count }, 'Released orders to cancelled');

        return {
            message: `Released ${result.count} orders to cancelled view`,
            count: result.count,
        };
    });

// ============================================
// HOLD OPERATIONS
// ============================================

/**
 * Hold entire order (blocks all lines from fulfillment)
 */
const holdOrder = protectedProcedure
    .input(z.object({
        orderId: z.string().uuid('Invalid order ID'),
        reason: z.string().min(1, 'Reason is required'),
        notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { orderId, reason, notes } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce hold rules using rules engine
        await enforceRulesInTrpc('holdOrder', ctx, {
            data: { order, reason },
            phase: 'pre',
        });

        const updated = await ctx.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date(),
                },
            });

            // Recompute order status
            await recomputeOrderStatus(orderId, tx);

            return tx.order.findUnique({
                where: { id: orderId },
                include: { orderLines: true },
            });
        });

        orderLogger.info({ orderNumber: order.orderNumber, reason }, 'Order placed on hold');
        return updated;
    });

/**
 * Release order from hold
 */
const releaseOrderHold = protectedProcedure
    .input(z.object({ orderId: z.string().uuid('Invalid order ID') }))
    .mutation(async ({ input, ctx }) => {
        const { orderId } = input;

        const order = await ctx.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: true },
        });

        if (!order) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order not found',
            });
        }

        // Enforce release rules using rules engine
        await enforceRulesInTrpc('releaseOrderHold', ctx, {
            data: { order },
            phase: 'pre',
        });

        const updated = await ctx.prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null,
                },
            });

            // Recompute order status
            await recomputeOrderStatus(orderId, tx);

            return tx.order.findUnique({
                where: { id: orderId },
                include: { orderLines: true },
            });
        });

        orderLogger.info({ orderNumber: order.orderNumber }, 'Order released from hold');
        return updated;
    });

/**
 * Hold a single order line
 */
const holdLine = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
        reason: z.string().min(1, 'Reason is required'),
        notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId, reason, notes } = input;

        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Enforce hold line rules using rules engine
        await enforceRulesInTrpc('holdLine', ctx, {
            data: { line, order: line.order, reason },
            phase: 'pre',
        });

        const updated = await ctx.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    isOnHold: true,
                    holdReason: reason,
                    holdNotes: notes || null,
                    holdAt: new Date(),
                },
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: lineId },
                include: { order: true },
            });
        });

        orderLogger.info({ lineId, reason }, 'Line placed on hold');
        return updated;
    });

/**
 * Release a single order line from hold
 */
const releaseLineHold = protectedProcedure
    .input(z.object({ lineId: z.string().uuid('Invalid line ID') }))
    .mutation(async ({ input, ctx }) => {
        const { lineId } = input;

        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { order: true },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Enforce release line rules using rules engine
        await enforceRulesInTrpc('releaseLineHold', ctx, {
            data: { line },
            phase: 'pre',
        });

        const updated = await ctx.prisma.$transaction(async (tx) => {
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    isOnHold: false,
                    holdReason: null,
                    holdNotes: null,
                    holdAt: null,
                },
            });

            // Recompute order status
            await recomputeOrderStatus(line.orderId, tx);

            return tx.orderLine.findUnique({
                where: { id: lineId },
                include: { order: true },
            });
        });

        orderLogger.info({ lineId }, 'Line released from hold');
        return updated;
    });

// ============================================
// CUSTOMIZATION OPERATIONS
// ============================================

/**
 * Customize an order line - create custom SKU
 */
const customizeLine = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
        type: z.enum(['length', 'size', 'measurements', 'other']),
        value: z.string().min(1, 'Value is required'),
        notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId, type, value, notes } = input;

        // Get order line to find the base SKU
        const line = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: { sku: true, order: { select: { orderNumber: true, status: true } } },
        });

        if (!line) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Order line not found',
            });
        }

        // Use the current SKU as the base SKU
        const baseSkuId = line.skuId;

        try {
            const result = await createCustomSku(
                ctx.prisma,
                baseSkuId,
                { type, value, notes },
                lineId,
                ctx.user.id
            );

            // Access nested properties with type assertions
            const orderLine = result.orderLine as { id: string; qty: number; order: { orderNumber: string } };
            const customSku = result.customSku as {
                id: string;
                skuCode: string;
                customizationType: string;
                customizationValue: string;
                customizationNotes: string | null;
            };

            orderLogger.info({
                orderNumber: orderLine.order.orderNumber,
                customSkuCode: customSku.skuCode,
                lineId
            }, 'Custom SKU created for order line');

            return {
                id: orderLine.id,
                customSkuCode: customSku.skuCode,
                customSkuId: customSku.id,
                isCustomized: true,
                isNonReturnable: true,
                originalSkuCode: result.originalSkuCode,
                qty: orderLine.qty,
                customizationType: customSku.customizationType,
                customizationValue: customSku.customizationValue,
                customizationNotes: customSku.customizationNotes,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage === 'ORDER_LINE_NOT_FOUND') {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Order line not found',
                });
            }
            if (errorMessage === 'LINE_NOT_PENDING') {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Cannot customize an allocated/picked/packed line. Unallocate first.',
                });
            }
            if (errorMessage === 'ALREADY_CUSTOMIZED') {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Order line is already customized',
                });
            }
            throw error;
        }
    });

/**
 * Remove customization from an order line
 */
const removeLineCustomization = protectedProcedure
    .input(z.object({
        lineId: z.string().uuid('Invalid line ID'),
        force: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
        const { lineId, force } = input;

        try {
            const result = await removeCustomization(ctx.prisma, lineId, { force });

            // Access nested properties with type assertions
            const orderLine = result.orderLine as {
                id: string;
                order: { orderNumber: string };
                sku: { id: string; skuCode: string };
            };

            orderLogger.info({
                orderNumber: orderLine.order.orderNumber,
                deletedCustomSkuCode: result.deletedCustomSkuCode,
                lineId,
                forcedCleanup: result.forcedCleanup,
                deletedTransactions: result.deletedTransactions,
                deletedBatches: result.deletedBatches
            }, 'Custom SKU removed from order line');

            return {
                id: orderLine.id,
                skuCode: orderLine.sku.skuCode,
                skuId: orderLine.sku.id,
                isCustomized: false,
                deletedCustomSkuCode: result.deletedCustomSkuCode,
                forcedCleanup: result.forcedCleanup,
                deletedTransactions: result.deletedTransactions,
                deletedBatches: result.deletedBatches,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage === 'ORDER_LINE_NOT_FOUND') {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Order line not found',
                });
            }
            if (errorMessage === 'NOT_CUSTOMIZED') {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Order line is not customized',
                });
            }
            if (errorMessage === 'CANNOT_UNDO_HAS_INVENTORY') {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Cannot undo customization - inventory transactions exist for custom SKU',
                });
            }
            if (errorMessage === 'CANNOT_UNDO_HAS_PRODUCTION') {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Cannot undo customization - production batch exists for custom SKU',
                });
            }
            throw error;
        }
    });

// ============================================
// MIGRATE SHOPIFY FULFILLED
// ============================================

/**
 * Migrate Shopify fulfilled orders
 * One-click migration for orders fulfilled on Shopify
 * Marks as shipped without inventory transactions
 */
const migrateShopifyFulfilled = protectedProcedure
    .input(z.object({
        limit: z.number().int().positive().max(500).optional().default(50),
    }))
    .mutation(async ({ input, ctx }) => {
        const { limit } = input;

        // Admin only for safety
        if (ctx.user.role !== 'admin') {
            throw new TRPCError({
                code: 'FORBIDDEN',
                message: 'Migration requires admin role',
            });
        }

        // Only migrate OPEN orders (not delivered, archived, etc.)
        const whereClause = {
            status: 'open',
            shopifyCache: {
                fulfillmentStatus: 'fulfilled',
                trackingNumber: { not: null },
                trackingCompany: { not: null },
            },
        };

        // Count total eligible first
        const totalEligible = await ctx.prisma.order.count({ where: whereClause });

        if (totalEligible === 0) {
            return {
                migrated: 0,
                remaining: 0,
                message: 'No eligible open orders found - migration complete!',
            };
        }

        // Fetch batch of eligible orders (oldest first for consistent ordering)
        const eligibleOrders = await ctx.prisma.order.findMany({
            where: whereClause,
            include: {
                orderLines: { select: { id: true } },
                shopifyCache: {
                    select: { trackingNumber: true, trackingCompany: true },
                },
            },
            orderBy: { orderDate: 'asc' },
            take: limit,
        });

        interface MigrationResults {
            migrated: Array<{ orderNumber: string; linesShipped: number }>;
            skipped: Array<{ orderNumber: string; reason: string }>;
            errors: Array<{ orderNumber: string; error: string }>;
        }
        const results: MigrationResults = { migrated: [], skipped: [], errors: [] };

        for (const order of eligibleOrders) {
            try {
                const lineIds = order.orderLines.map(l => l.id);
                const awb = order.shopifyCache?.trackingNumber || 'MANUAL';
                const courier = order.shopifyCache?.trackingCompany || 'Manual';

                // Each order gets its own transaction
                const result = await ctx.prisma.$transaction(async (tx) => {
                    return await shipOrderLines(tx, {
                        orderLineIds: lineIds,
                        awbNumber: awb,
                        courier: courier,
                        userId: ctx.user.id,
                        skipStatusValidation: true,
                        skipInventory: true,
                    });
                });

                if (result.shipped.length > 0) {
                    results.migrated.push({
                        orderNumber: order.orderNumber,
                        linesShipped: result.shipped.length,
                    });
                } else if (result.skipped.length > 0) {
                    results.skipped.push({
                        orderNumber: order.orderNumber,
                        reason: result.skipped[0]?.reason || 'Already shipped',
                    });
                }
            } catch (error) {
                results.errors.push({
                    orderNumber: order.orderNumber,
                    error: (error as Error).message,
                });
            }
        }

        const remaining = totalEligible - results.migrated.length;

        return {
            migrated: results.migrated.length,
            skipped: results.skipped.length,
            remaining: remaining,
            errors: results.errors.length > 0 ? results.errors : undefined,
            message: remaining > 0
                ? `Migrated ${results.migrated.length} orders. ${remaining} remaining - click again to continue.`
                : `Migrated ${results.migrated.length} orders. Migration complete!`,
        };
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
    adminShip,
    markPaid,
    setLineStatus,
    cancelOrder,
    uncancelOrder,
    // Line-level delivery/RTO mutations (preferred)
    markLineDelivered,
    markLineRto,
    receiveLineRto,
    // Order-level mutations (backward compat - delegate to line-level)
    markDelivered,
    markRto,
    receiveRto,
    // Line operations (new)
    cancelLine,
    uncancelLine,
    updateLine,
    addLine,
    // Order CRUD
    updateOrder,
    deleteOrder,
    // Ship/Unship
    shipOrder: shipOrder_,
    unship,
    // Release operations
    releaseToShipped,
    releaseToCancelled,
    // Hold operations
    holdOrder,
    releaseOrderHold,
    holdLine,
    releaseLineHold,
    // Customization
    customizeLine,
    removeCustomization: removeLineCustomization,
    // Migration
    migrateShopifyFulfilled,
});
