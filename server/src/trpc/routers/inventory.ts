/**
 * Inventory tRPC Router
 * Ledger-based inventory tracking procedures
 *
 * Procedures:
 * - getBalance: Get inventory balance for a single SKU
 * - getBalances: Get inventory balances for multiple SKUs
 * - getAllBalances: Get inventory balances for all active SKUs with filtering
 * - inward: Create inward transaction (adds inventory)
 * - outward: Create outward transaction (removes inventory)
 * - adjust: Adjust inventory (positive or negative)
 *
 * Balance Formulas:
 * - Balance = SUM(inward) - SUM(outward)
 * - Available = Balance - SUM(reserved)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import {
    calculateInventoryBalance,
    TXN_TYPE,
    TXN_REASON,
} from '../../utils/queryPatterns.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';

/**
 * Get balance for a single SKU
 */
const getBalance = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
        })
    )
    .query(async ({ input, ctx }) => {
        const { skuId } = input;

        // Verify SKU exists
        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'SKU not found',
            });
        }

        const balance = await calculateInventoryBalance(ctx.prisma, skuId, {
            allowNegative: true,
        });

        return {
            skuId,
            skuCode: sku.skuCode,
            ...balance,
        };
    });

/**
 * Get balances for multiple SKUs
 */
const getBalances = protectedProcedure
    .input(
        z.object({
            skuIds: z.array(z.string().min(1)).min(1, 'At least one SKU ID is required'),
        })
    )
    .query(async ({ input, ctx }) => {
        const { skuIds } = input;

        // Verify all SKUs exist
        const skus = await ctx.prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: { id: true, skuCode: true, isActive: true },
        });

        const foundSkuIds = new Set(skus.map((s) => s.id));
        const missingSkuIds = skuIds.filter((id) => !foundSkuIds.has(id));

        if (missingSkuIds.length > 0) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: `SKUs not found: ${missingSkuIds.join(', ')}`,
            });
        }

        // Use cached balance lookup for better performance
        const balanceMap = await inventoryBalanceCache.get(ctx.prisma, skuIds);

        // Build response with SKU codes
        const skuCodeMap = new Map(skus.map((s) => [s.id, s.skuCode]));

        return skuIds.map((skuId) => {
            const balance = balanceMap.get(skuId) || {
                skuId,
                totalInward: 0,
                totalOutward: 0,
                totalReserved: 0,
                currentBalance: 0,
                availableBalance: 0,
                hasDataIntegrityIssue: false,
            };

            return {
                ...balance,
                skuCode: skuCodeMap.get(skuId) || '',
            };
        });
    });

/**
 * Get balances for all active SKUs with filtering
 * Matches REST endpoint GET /inventory/balance with includeCustomSkus support
 */
const getAllBalances = protectedProcedure
    .input(
        z.object({
            includeCustomSkus: z.boolean().optional().default(false),
            belowTarget: z.boolean().optional(),
            search: z.string().optional(),
            limit: z.number().int().positive().optional().default(10000),
            offset: z.number().int().nonnegative().optional().default(0),
        })
    )
    .query(async ({ input, ctx }) => {
        const { includeCustomSkus, belowTarget, search, limit, offset } = input;

        // Build SKU filter - by default exclude custom SKUs from standard inventory view
        const skuWhere: any = {
            isActive: true,
            ...(includeCustomSkus ? {} : { isCustomSku: false }),
            // Server-side search on SKU code and product name
            ...(search && {
                OR: [
                    { skuCode: { contains: search, mode: 'insensitive' } },
                    { variation: { product: { name: { contains: search, mode: 'insensitive' } } } }
                ]
            })
        };

        const skus = await ctx.prisma.sku.findMany({
            where: skuWhere,
            include: {
                variation: {
                    include: {
                        product: true,
                        fabric: true,
                    },
                },
                shopifyInventoryCache: true,
            },
        });

        // Calculate all balances in a single query (fixes N+1)
        // Use cached balance lookup for better performance
        const skuIds = skus.map(sku => sku.id);
        const balanceMap = await inventoryBalanceCache.get(ctx.prisma, skuIds);

        // Build response with full SKU details
        const balances = skus.map((sku) => {
            const balance = balanceMap.get(sku.id) || {
                totalInward: 0,
                totalOutward: 0,
                totalReserved: 0,
                currentBalance: 0,
                availableBalance: 0
            };

            // Get image URL from variation or product
            const imageUrl = sku.variation.imageUrl || sku.variation.product.imageUrl || null;

            return {
                skuId: sku.id,
                skuCode: sku.skuCode,
                productId: sku.variation.product.id,
                productName: sku.variation.product.name,
                productType: sku.variation.product.productType,
                gender: sku.variation.product.gender,
                colorName: sku.variation.colorName,
                variationId: sku.variation.id,
                size: sku.size,
                category: sku.variation.product.category,
                imageUrl,
                currentBalance: balance.currentBalance,
                reservedBalance: balance.totalReserved,
                availableBalance: balance.availableBalance,
                totalInward: balance.totalInward,
                totalOutward: balance.totalOutward,
                targetStockQty: sku.targetStockQty,
                status: balance.availableBalance < (sku.targetStockQty || 0) ? 'below_target' : 'ok',
                mrp: sku.mrp,
                shopifyQty: sku.shopifyInventoryCache?.availableQty ?? null,
                isCustomSku: sku.isCustomSku || false,
            };
        });

        // Filter by below target status (done in memory since it requires calculated balance)
        let filteredBalances = balances;
        if (belowTarget === true) {
            filteredBalances = balances.filter((b) => b.status === 'below_target');
        }

        // Sort by status (below_target first)
        filteredBalances.sort((a, b) => {
            if (a.status === 'below_target' && b.status !== 'below_target') return -1;
            if (a.status !== 'below_target' && b.status === 'below_target') return 1;
            return a.skuCode.localeCompare(b.skuCode);
        });

        // Apply pagination after filtering and sorting
        const totalCount = filteredBalances.length;
        const paginatedBalances = filteredBalances.slice(offset, offset + limit);

        return {
            items: paginatedBalances,
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: offset + paginatedBalances.length < totalCount,
            }
        };
    });

/**
 * Create inward transaction (adds inventory)
 */
const inward = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
            quantity: z.number().int().positive('Quantity must be a positive integer'),
            reason: z.string().min(1, 'Reason is required'),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuId, quantity, reason, notes } = input;

        // Verify SKU exists and is active
        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'SKU not found',
            });
        }

        if (!sku.isActive) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot add inventory to inactive SKU',
            });
        }

        // Create inward transaction
        const transaction = await ctx.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.INWARD,
                qty: quantity,
                reason,
                notes: notes || null,
                createdById: ctx.user.id,
            },
        });

        // Get updated balance
        const balance = await calculateInventoryBalance(ctx.prisma, skuId, {
            allowNegative: true,
        });

        return {
            transaction: {
                id: transaction.id,
                skuId: transaction.skuId,
                txnType: transaction.txnType,
                qty: transaction.qty,
                reason: transaction.reason,
                notes: transaction.notes,
                createdAt: transaction.createdAt,
            },
            balance: {
                skuId,
                skuCode: sku.skuCode,
                ...balance,
            },
        };
    });

/**
 * Create outward transaction (removes inventory)
 */
const outward = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
            quantity: z.number().int().positive('Quantity must be a positive integer'),
            reason: z.string().min(1, 'Reason is required'),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuId, quantity, reason, notes } = input;

        // Verify SKU exists
        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'SKU not found',
            });
        }

        // Check current balance before creating outward
        const currentBalance = await calculateInventoryBalance(ctx.prisma, skuId, {
            allowNegative: true,
        });

        if (currentBalance.availableBalance < quantity) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Insufficient stock: available=${currentBalance.availableBalance}, requested=${quantity}`,
            });
        }

        // Create outward transaction
        const transaction = await ctx.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty: quantity,
                reason,
                notes: notes || null,
                createdById: ctx.user.id,
            },
        });

        // Get updated balance
        const balance = await calculateInventoryBalance(ctx.prisma, skuId, {
            allowNegative: true,
        });

        return {
            transaction: {
                id: transaction.id,
                skuId: transaction.skuId,
                txnType: transaction.txnType,
                qty: transaction.qty,
                reason: transaction.reason,
                notes: transaction.notes,
                createdAt: transaction.createdAt,
            },
            balance: {
                skuId,
                skuCode: sku.skuCode,
                ...balance,
            },
        };
    });

/**
 * Adjust inventory (can be positive or negative)
 * Positive = inward adjustment, Negative = outward adjustment
 */
const adjust = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
            quantity: z.number().int().refine((val) => val !== 0, {
                message: 'Quantity cannot be zero',
            }),
            reason: z.string().min(1, 'Reason is required'),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuId, quantity, reason, notes } = input;

        // Verify SKU exists
        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'SKU not found',
            });
        }

        // Determine transaction type based on quantity sign
        const txnType = quantity > 0 ? TXN_TYPE.INWARD : TXN_TYPE.OUTWARD;
        const absQuantity = Math.abs(quantity);

        // For outward adjustments, verify sufficient stock
        if (txnType === TXN_TYPE.OUTWARD) {
            const currentBalance = await calculateInventoryBalance(ctx.prisma, skuId, {
                allowNegative: true,
            });

            if (currentBalance.availableBalance < absQuantity) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Insufficient stock for adjustment: available=${currentBalance.availableBalance}, requested=${absQuantity}`,
                });
            }
        }

        // Create adjustment transaction
        const transaction = await ctx.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType,
                qty: absQuantity,
                reason: TXN_REASON.ADJUSTMENT,
                notes: notes ? `${reason}: ${notes}` : reason,
                createdById: ctx.user.id,
            },
        });

        // Get updated balance
        const balance = await calculateInventoryBalance(ctx.prisma, skuId, {
            allowNegative: true,
        });

        return {
            transaction: {
                id: transaction.id,
                skuId: transaction.skuId,
                txnType: transaction.txnType,
                qty: transaction.qty,
                reason: transaction.reason,
                notes: transaction.notes,
                createdAt: transaction.createdAt,
            },
            adjustmentType: txnType === TXN_TYPE.INWARD ? 'increase' : 'decrease',
            balance: {
                skuId,
                skuCode: sku.skuCode,
                ...balance,
            },
        };
    });

/**
 * Inventory router - combines all inventory procedures
 */
export const inventoryRouter = router({
    getBalance,
    getBalances,
    getAllBalances,
    inward,
    outward,
    adjust,
});
