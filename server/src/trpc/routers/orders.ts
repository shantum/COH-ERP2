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
    flattenOrdersToRows,
    LINE_SSE_SELECT,
    flattenLineForSSE,
} from '../../utils/orderViews.js';
import { findOrCreateCustomerByContact } from '../../utils/customerUtils.js';
import { updateCustomerTier, incrementCustomerOrderCount, decrementCustomerOrderCount } from '../../utils/tierUtils.js';
import {
    calculateInventoryBalance,
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
} from '../../utils/queryPatterns.js';
import {
    isValidTransition,
    executeTransition,
    buildTransitionError,
    hasAllocatedInventory,
    type LineStatus,
} from '../../utils/orderStateMachine.js';
import { shipOrderLines } from '../../services/shipOrderService.js';
import { adminShipOrderLines, isAdminShipEnabled } from '../../services/adminShipService.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import { broadcastOrderUpdate } from '../../routes/sse.js';
import { deferredExecutor } from '../../services/deferredExecutor.js';
import { enforceRulesInTrpc } from '../../rules/index.js';

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
});
