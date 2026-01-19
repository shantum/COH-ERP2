/**
 * Inventory tRPC Router
 * Comprehensive ledger-based inventory tracking procedures
 *
 * Migrated from Express routes:
 * - /routes/inventory/balance.ts
 * - /routes/inventory/transactions.ts
 * - /routes/inventory/pending.ts
 *
 * Balance Formulas:
 * - Balance = SUM(inward) - SUM(outward)
 * - Available = Balance - SUM(reserved)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../index.js';
import {
    calculateInventoryBalance,
    calculateAllInventoryBalances,
    calculateAllFabricBalances,
    getEffectiveFabricConsumption,
    validateSku,
    validateTransactionDeletion,
    findExistingRtoInward,
    TXN_TYPE,
    TXN_REASON,
    type PrismaTransactionClient,
} from '../../utils/queryPatterns.js';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import { broadcastOrderUpdate } from '../../routes/sse.js';

// ============================================
// SHARED TYPES
// ============================================

const RtoConditionSchema = z.enum(['good', 'unopened', 'damaged', 'wrong_product']);
const AllocationTypeSchema = z.enum(['production', 'rto', 'adjustment']);
const PendingSourceSchema = z.enum(['rto', 'production', 'returns', 'repacking']);

// ============================================
// BALANCE QUERIES
// ============================================

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

        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            include: {
                variation: {
                    include: {
                        product: true,
                        fabric: true,
                    },
                },
            },
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
            sku,
            ...balance,
            targetStockQty: sku.targetStockQty,
            status: balance.currentBalance < (sku.targetStockQty || 0) ? 'below_target' : 'ok',
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

        const balanceMap = await inventoryBalanceCache.get(ctx.prisma, skuIds);
        const skuCodeMap = new Map(skus.map((s) => [s.id, s.skuCode]));

        return skuIds.map((skuId) => {
            const balance = balanceMap.get(skuId);

            return {
                skuId,
                skuCode: skuCodeMap.get(skuId) || '',
                totalInward: balance?.totalInward ?? 0,
                totalOutward: balance?.totalOutward ?? 0,
                totalReserved: 0,
                currentBalance: balance?.currentBalance ?? 0,
                availableBalance: balance?.availableBalance ?? 0,
                hasDataIntegrityIssue: balance?.hasDataIntegrityIssue ?? false,
            };
        });
    });

/**
 * Get balances for all active SKUs with filtering
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const skuWhere: any = {
            isActive: true,
            ...(includeCustomSkus ? {} : { isCustomSku: false }),
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

        const skuIds = skus.map(sku => sku.id);
        const balanceMap = await inventoryBalanceCache.get(ctx.prisma, skuIds);

        const balances = skus.map((sku) => {
            const balance = balanceMap.get(sku.id) || {
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
                availableBalance: 0
            };

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
                reservedBalance: 0,
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

        let filteredBalances = balances;
        if (belowTarget === true) {
            filteredBalances = balances.filter((b) => b.status === 'below_target');
        }

        filteredBalances.sort((a, b) => {
            if (a.status === 'below_target' && b.status !== 'below_target') return -1;
            if (a.status !== 'below_target' && b.status === 'below_target') return 1;
            return a.skuCode.localeCompare(b.skuCode);
        });

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
 * Get stock alerts for SKUs below target
 */
const getAlerts = protectedProcedure
    .query(async ({ ctx }) => {
        const skus = await ctx.prisma.sku.findMany({
            where: {
                isActive: true,
                isCustomSku: false
            },
            include: {
                variation: {
                    include: {
                        product: true,
                        fabric: true,
                    },
                },
            },
        });

        const skuIds = skus.map(sku => sku.id);
        const inventoryBalanceMap = await calculateAllInventoryBalances(ctx.prisma, skuIds, {
            excludeCustomSkus: true
        });
        const fabricBalanceMap = await calculateAllFabricBalances(ctx.prisma);

        interface AlertItem {
            skuId: string;
            skuCode: string;
            productName: string;
            colorName: string;
            size: string;
            currentBalance: number;
            targetStockQty: number;
            shortage: number;
            fabricNeeded: string;
            fabricAvailable: string;
            canProduce: number;
            consumptionPerUnit: string;
            status: string;
        }

        const alerts: AlertItem[] = [];

        for (const sku of skus) {
            const balance = inventoryBalanceMap.get(sku.id) || { currentBalance: 0 };
            const targetStockQty = sku.targetStockQty || 0;

            if (balance.currentBalance < targetStockQty) {
                const shortage = targetStockQty - balance.currentBalance;
                const consumptionPerUnit = getEffectiveFabricConsumption(sku);
                const fabricNeeded = shortage * consumptionPerUnit;

                const fabricId = sku.variation.fabricId;
                const fabricBalance = fabricId ? (fabricBalanceMap.get(fabricId) || { currentBalance: 0 }) : { currentBalance: 0 };
                const fabricAvailable = fabricBalance.currentBalance;

                const canProduce = Math.floor(fabricAvailable / consumptionPerUnit);

                alerts.push({
                    skuId: sku.id,
                    skuCode: sku.skuCode,
                    productName: sku.variation.product.name,
                    colorName: sku.variation.colorName,
                    size: sku.size,
                    currentBalance: balance.currentBalance,
                    targetStockQty,
                    shortage,
                    fabricNeeded: fabricNeeded.toFixed(2),
                    fabricAvailable: fabricAvailable.toFixed(2),
                    canProduce,
                    consumptionPerUnit: consumptionPerUnit.toFixed(2),
                    status: canProduce >= shortage ? 'can_produce' : 'fabric_needed',
                });
            }
        }

        alerts.sort((a, b) => b.shortage - a.shortage);

        return alerts;
    });

// ============================================
// TRANSACTION QUERIES
// ============================================

/**
 * Get transactions with filters
 */
const getTransactions = protectedProcedure
    .input(
        z.object({
            skuId: z.string().optional(),
            txnType: z.enum(['inward', 'outward']).optional(),
            reason: z.string().optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
            limit: z.number().int().positive().optional().default(100),
            offset: z.number().int().nonnegative().optional().default(0),
        })
    )
    .query(async ({ input, ctx }) => {
        const { skuId, txnType, reason, startDate, endDate, limit, offset } = input;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {};
        if (skuId) where.skuId = skuId;
        if (txnType) where.txnType = txnType;
        if (reason) where.reason = reason;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate);
        }

        const transactions = await ctx.prisma.inventoryTransaction.findMany({
            where,
            include: {
                sku: {
                    include: {
                        variation: {
                            include: { product: true },
                        },
                    },
                },
                createdBy: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });

        return transactions;
    });

/**
 * Get inward history for Production Inward page
 */
const getInwardHistory = protectedProcedure
    .input(
        z.object({
            date: z.string().optional(),
            limit: z.number().int().positive().optional().default(50),
        })
    )
    .query(async ({ input, ctx }) => {
        const { date, limit } = input;

        let startDate: Date, endDate: Date;
        if (!date || date === 'today') {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else {
            startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
        }

        const transactions = await ctx.prisma.inventoryTransaction.findMany({
            where: {
                txnType: 'inward',
                createdAt: { gte: startDate, lte: endDate },
            },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
                createdBy: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        const skuIds = [...new Set(transactions.map(t => t.skuId))];
        const batches = await ctx.prisma.productionBatch.findMany({
            where: {
                skuId: { in: skuIds },
                status: { in: ['in_progress', 'completed'] },
            },
            orderBy: { batchDate: 'desc' },
            select: { skuId: true, batchCode: true },
        });

        const batchMap = new Map<string, string | null>();
        for (const batch of batches) {
            if (batch.skuId && !batchMap.has(batch.skuId)) {
                batchMap.set(batch.skuId, batch.batchCode);
            }
        }

        return transactions.map(txn => ({
            ...txn,
            productName: txn.sku?.variation?.product?.name,
            colorName: txn.sku?.variation?.colorName,
            size: txn.sku?.size,
            imageUrl: txn.sku?.variation?.imageUrl || txn.sku?.variation?.product?.imageUrl,
            batchCode: batchMap.get(txn.skuId) || null,
        }));
    });

/**
 * Get recent inward transactions for activity feed
 */
const getRecentInwards = protectedProcedure
    .input(
        z.object({
            limit: z.number().int().positive().optional().default(50),
            source: z.enum(['production', 'returns', 'rto', 'repacking', 'adjustments']).optional(),
        })
    )
    .query(async ({ input, ctx }) => {
        const { limit, source } = input;

        const reasonMap: Record<string, string[]> = {
            production: ['production'],
            returns: ['return_receipt'],
            rto: ['rto_received'],
            repacking: ['repack_complete'],
            adjustments: ['adjustment', 'found_stock', 'correction', 'received']
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {
            txnType: 'inward',
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        };

        if (source && reasonMap[source]) {
            where.reason = { in: reasonMap[source] };
        }

        const transactions = await ctx.prisma.inventoryTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                skuId: true,
                qty: true,
                reason: true,
                referenceId: true,
                notes: true,
                createdAt: true,
                sku: {
                    select: {
                        skuCode: true,
                        size: true,
                        variation: {
                            select: {
                                colorName: true,
                                product: { select: { name: true } }
                            }
                        }
                    }
                },
                createdBy: { select: { name: true } }
            }
        });

        const mapReasonToSource = (reason: string | null): string => {
            const mapping: Record<string, string> = {
                'production': 'production',
                'return_receipt': 'return',
                'rto_received': 'rto',
                'repack_complete': 'repacking',
                'adjustment': 'adjustment',
                'received': 'received'
            };
            return mapping[reason || ''] || 'adjustment';
        };

        return transactions.map(t => ({
            id: t.id,
            skuId: t.skuId,
            skuCode: t.sku?.skuCode,
            productName: t.sku?.variation?.product?.name,
            colorName: t.sku?.variation?.colorName,
            size: t.sku?.size,
            qty: t.qty,
            reason: t.reason,
            referenceId: t.referenceId,
            notes: t.notes,
            createdAt: t.createdAt,
            createdBy: t.createdBy?.name || 'System',
            source: mapReasonToSource(t.reason),
            isAllocated: t.reason !== 'received'
        }));
    });

// ============================================
// TRANSACTION MUTATIONS
// ============================================

/**
 * Create inward transaction
 */
const inward = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
            qty: z.number().int().positive('Quantity must be a positive integer'),
            reason: z.string().min(1, 'Reason is required'),
            referenceId: z.string().optional(),
            notes: z.string().optional(),
            warehouseLocation: z.string().optional(),
            adjustmentReason: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = input;

        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'SKU not found' });
        }

        if (!sku.isActive) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot add inventory to inactive SKU' });
        }

        // Build enhanced notes for audit trail
        let auditNotes = notes || '';
        if (reason === 'adjustment') {
            const timestamp = new Date().toISOString();
            auditNotes = `[MANUAL ADJUSTMENT by ${ctx.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
        }

        const transaction = await ctx.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.INWARD,
                qty,
                reason,
                referenceId: referenceId || null,
                notes: auditNotes || null,
                warehouseLocation: warehouseLocation || null,
                createdById: ctx.user.id,
            },
            include: {
                sku: true,
                createdBy: { select: { id: true, name: true } },
            },
        });

        inventoryBalanceCache.invalidate([skuId]);

        const balance = await calculateInventoryBalance(ctx.prisma, skuId, { allowNegative: true });

        broadcastOrderUpdate({
            type: 'inventory_updated',
            skuId,
            changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
        });

        return {
            transaction,
            newBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
        };
    });

/**
 * Create outward transaction
 */
const outward = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
            qty: z.number().int().positive('Quantity must be a positive integer'),
            reason: z.string().min(1, 'Reason is required'),
            referenceId: z.string().optional(),
            notes: z.string().optional(),
            warehouseLocation: z.string().optional(),
            adjustmentReason: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = input;

        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'SKU not found' });
        }

        const balance = await calculateInventoryBalance(ctx.prisma, skuId, { allowNegative: true });

        if (balance.currentBalance < 0) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot create outward: inventory balance is already negative. Please reconcile inventory first.',
            });
        }

        if (balance.availableBalance < qty) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Insufficient stock: available ${balance.availableBalance}, requested ${qty}`,
            });
        }

        let auditNotes = notes || '';
        if (reason === 'adjustment' || reason === 'damage') {
            const timestamp = new Date().toISOString();
            auditNotes = `[MANUAL ${reason.toUpperCase()} by ${ctx.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
        }

        const transaction = await ctx.prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty,
                reason,
                referenceId: referenceId || null,
                notes: auditNotes || null,
                warehouseLocation: warehouseLocation || null,
                createdById: ctx.user.id,
            },
            include: {
                sku: true,
                createdBy: { select: { id: true, name: true } },
            },
        });

        inventoryBalanceCache.invalidate([skuId]);

        const newBalance = await calculateInventoryBalance(ctx.prisma, skuId, { allowNegative: true });

        broadcastOrderUpdate({
            type: 'inventory_updated',
            skuId,
            changes: { availableBalance: newBalance.availableBalance, currentBalance: newBalance.currentBalance },
        });

        return {
            transaction,
            newBalance: newBalance.currentBalance,
            availableBalance: newBalance.availableBalance,
        };
    });

/**
 * Quick inward for barcode scanning with production batch matching
 */
const quickInward = protectedProcedure
    .input(
        z.object({
            skuCode: z.string().optional(),
            barcode: z.string().optional(),
            qty: z.number().int().positive('Quantity must be a positive integer'),
            reason: z.string().optional().default('production'),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuCode, barcode, qty, reason, notes } = input;

        const skuValidation = await validateSku(ctx.prisma, { skuCode, barcode });
        if (!skuValidation.valid) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: skuValidation.error || 'Invalid SKU' });
        }

        const sku = skuValidation.sku!;

        const result = await ctx.prisma.$transaction(async (tx) => {
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    skuId: sku.id,
                    txnType: 'inward',
                    qty,
                    reason,
                    notes: notes || null,
                    createdById: ctx.user.id,
                },
                include: {
                    sku: {
                        include: {
                            variation: { include: { product: true } },
                        },
                    },
                },
            });

            let matchedBatch = null;
            let updatedTransaction = transaction;
            if (reason === 'production') {
                matchedBatch = await matchProductionBatchInTransaction(tx as PrismaTransactionClient, sku.id, qty);

                if (matchedBatch) {
                    updatedTransaction = await tx.inventoryTransaction.update({
                        where: { id: transaction.id },
                        data: { referenceId: matchedBatch.id },
                        include: {
                            sku: {
                                include: {
                                    variation: { include: { product: true } },
                                },
                            },
                        },
                    });
                }
            }

            const balance = await calculateInventoryBalance(tx, sku.id);

            return { transaction: updatedTransaction, matchedBatch, balance };
        });

        inventoryBalanceCache.invalidate([sku.id]);

        broadcastOrderUpdate({
            type: 'inventory_updated',
            skuId: sku.id,
            changes: { availableBalance: result.balance.availableBalance, currentBalance: result.balance.currentBalance },
        });

        return {
            transaction: result.transaction,
            newBalance: result.balance.currentBalance,
            matchedBatch: result.matchedBatch ? {
                id: result.matchedBatch.id,
                batchCode: result.matchedBatch.batchCode,
                qtyCompleted: result.matchedBatch.qtyCompleted,
                qtyPlanned: result.matchedBatch.qtyPlanned,
                status: result.matchedBatch.status,
            } : null,
        };
    });

/**
 * Instant inward - ultra-fast single unit inward for scanning
 */
const instantInward = protectedProcedure
    .input(
        z.object({
            skuCode: z.string().min(1, 'SKU code is required'),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuCode } = input;

        const sku = await ctx.prisma.sku.findFirst({
            where: { skuCode },
            select: {
                id: true,
                skuCode: true,
                size: true,
                variation: {
                    select: {
                        colorName: true,
                        imageUrl: true,
                        product: { select: { name: true, imageUrl: true } }
                    }
                }
            }
        });

        if (!sku) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'SKU not found' });
        }

        const result = await ctx.prisma.$transaction(async (tx) => {
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    skuId: sku.id,
                    txnType: 'inward',
                    qty: 1,
                    reason: 'received',
                    createdById: ctx.user.id,
                }
            });

            const balance = await calculateInventoryBalance(tx, sku.id);

            return { transaction, balance };
        });

        inventoryBalanceCache.invalidate([sku.id]);

        return {
            success: true,
            transaction: {
                id: result.transaction.id,
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: 1,
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl,
            },
            newBalance: result.balance.currentBalance,
        };
    });

/**
 * Edit inward transaction
 */
const editInward = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
            qty: z.number().int().positive().optional(),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, qty, notes } = input;

        const existing = await ctx.prisma.inventoryTransaction.findUnique({
            where: { id },
        });

        if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
        }

        if (existing.txnType !== 'inward') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only edit inward transactions' });
        }

        const updated = await ctx.prisma.inventoryTransaction.update({
            where: { id },
            data: {
                qty: qty !== undefined ? qty : existing.qty,
                notes: notes !== undefined ? notes : existing.notes,
            },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        inventoryBalanceCache.invalidate([existing.skuId]);

        if (qty !== undefined && qty !== existing.qty) {
            const balance = await calculateInventoryBalance(ctx.prisma, existing.skuId);
            broadcastOrderUpdate({
                type: 'inventory_updated',
                skuId: existing.skuId,
                changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
            });
        }

        return updated;
    });

/**
 * Delete inward transaction
 */
const deleteInward = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
            force: z.boolean().optional().default(false),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, force } = input;

        const existing = await ctx.prisma.inventoryTransaction.findUnique({
            where: { id },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
        }

        if (existing.txnType !== 'inward') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only delete inward transactions' });
        }

        const validation = await validateTransactionDeletion(ctx.prisma, id);
        if (!validation.canDelete) {
            if (force && ctx.user.role === 'admin') {
                console.warn(`Admin ${ctx.user.id} force-deleting transaction ${id} with dependencies:`, validation.dependencies);
            } else {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Cannot delete transaction: ${validation.reason}`,
                });
            }
        }

        await ctx.prisma.inventoryTransaction.delete({ where: { id } });

        inventoryBalanceCache.invalidate([existing.skuId]);

        const balance = await calculateInventoryBalance(ctx.prisma, existing.skuId);

        broadcastOrderUpdate({
            type: 'inventory_updated',
            skuId: existing.skuId,
            changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
        });

        return {
            success: true,
            message: 'Transaction deleted',
            deleted: {
                id: existing.id,
                skuCode: existing.sku?.skuCode,
                qty: existing.qty,
                reason: existing.reason
            },
            newBalance: balance.currentBalance
        };
    });

/**
 * Delete any transaction (with full side effect handling)
 */
const deleteTransaction = adminProcedure
    .input(
        z.object({
            id: z.string().min(1),
            force: z.boolean().optional().default(false),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, force } = input;

        const existing = await ctx.prisma.inventoryTransaction.findUnique({
            where: { id },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
        }

        const validation = await validateTransactionDeletion(ctx.prisma, id);
        if (!validation.canDelete && !force) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Cannot delete transaction: ${validation.reason}`,
            });
        }

        if (!validation.canDelete && force) {
            console.warn(`Admin ${ctx.user.id} (${ctx.user.email}) force-deleting transaction ${id} with dependencies:`, {
                transaction: validation.transaction,
                dependencies: validation.dependencies
            });
        }

        let revertedQueueItem = false;
        let revertedProductionBatch: { id: string; skuCode?: string; isCustomSku?: boolean } | null = null;
        let deletedFabricTxn = false;
        let revertedAllocation: string | null = null;

        await ctx.prisma.$transaction(async (tx) => {
            // Handle return_receipt reversion
            if (existing.reason === 'return_receipt' && existing.referenceId) {
                const queueItem = await tx.repackingQueueItem.findUnique({
                    where: { id: existing.referenceId },
                });

                if (queueItem && queueItem.status === 'ready') {
                    await tx.repackingQueueItem.update({
                        where: { id: existing.referenceId },
                        data: {
                            status: 'pending',
                            qcComments: null,
                            processedAt: null,
                            processedById: null,
                        },
                    });
                    revertedQueueItem = true;
                }
            }

            // Handle production transaction reversion
            if ((existing.reason === TXN_REASON.PRODUCTION || existing.reason === 'production_custom') && existing.referenceId) {
                const productionBatch = await tx.productionBatch.findUnique({
                    where: { id: existing.referenceId },
                    include: { sku: { include: { variation: true } } }
                });

                if (productionBatch && (productionBatch.status === 'completed' || productionBatch.status === 'in_progress')) {
                    const isCustomSkuBatch = productionBatch.sku?.isCustomSku && productionBatch.sourceOrderLineId;

                    if (isCustomSkuBatch && productionBatch.status === 'completed') {
                        const orderLine = await tx.orderLine.findUnique({
                            where: { id: productionBatch.sourceOrderLineId! }
                        });

                        if (orderLine && ['picked', 'packed', 'shipped'].includes(orderLine.lineStatus)) {
                            throw new TRPCError({
                                code: 'BAD_REQUEST',
                                message: `Cannot delete - order line has progressed to ${orderLine.lineStatus}. Unship or unpick first.`,
                            });
                        }

                        if (productionBatch.skuId) {
                            await tx.inventoryTransaction.deleteMany({
                                where: {
                                    skuId: productionBatch.skuId,
                                    referenceId: productionBatch.sourceOrderLineId,
                                    txnType: TXN_TYPE.OUTWARD,
                                    reason: TXN_REASON.ORDER_ALLOCATION
                                }
                            });
                        }

                        await tx.orderLine.update({
                            where: { id: productionBatch.sourceOrderLineId! },
                            data: {
                                lineStatus: 'pending',
                                allocatedAt: null
                            }
                        });

                        revertedAllocation = productionBatch.sourceOrderLineId ?? null;
                    }

                    const newQtyCompleted = Math.max(0, productionBatch.qtyCompleted - existing.qty);
                    const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';

                    await tx.productionBatch.update({
                        where: { id: existing.referenceId },
                        data: {
                            qtyCompleted: newQtyCompleted,
                            status: newStatus,
                            completedAt: null
                        }
                    });

                    let deletedFabric = { count: 0 };
                    if (productionBatch.status === 'completed') {
                        deletedFabric = await tx.fabricTransaction.deleteMany({
                            where: {
                                referenceId: existing.referenceId,
                                reason: TXN_REASON.PRODUCTION,
                                txnType: 'outward'
                            }
                        });
                    }

                    revertedProductionBatch = {
                        id: productionBatch.id,
                        skuCode: productionBatch.sku?.skuCode,
                        isCustomSku: productionBatch.sku?.isCustomSku
                    };
                    deletedFabricTxn = deletedFabric.count > 0;
                }
            }

            await tx.inventoryTransaction.delete({ where: { id } });
        });

        inventoryBalanceCache.invalidate([existing.skuId]);

        const balance = await calculateInventoryBalance(ctx.prisma, existing.skuId);

        broadcastOrderUpdate({
            type: 'inventory_updated',
            skuId: existing.skuId,
            changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
        });

        let message = 'Transaction deleted';
        if (revertedQueueItem) {
            message = 'Transaction deleted and item returned to QC queue';
        } else if (revertedProductionBatch) {
            message = `Transaction deleted, production batch reverted to planned${deletedFabricTxn ? ', fabric usage reversed' : ''}${revertedAllocation ? ', order allocation reversed' : ''}`;
        }

        return {
            success: true,
            message,
            deleted: {
                id: existing.id,
                txnType: existing.txnType,
                qty: existing.qty,
                skuCode: existing.sku?.skuCode,
                productName: existing.sku?.variation?.product?.name,
            },
            revertedToQueue: revertedQueueItem,
            revertedProductionBatch,
            revertedAllocation: !!revertedAllocation,
            newBalance: balance.currentBalance,
            forcedDeletion: !validation.canDelete && force,
        };
    });

/**
 * Undo inward transaction (24-hour window)
 */
const undoInward = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id } = input;

        const transaction = await ctx.prisma.inventoryTransaction.findUnique({
            where: { id },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } }
                    }
                }
            }
        });

        if (!transaction) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
        }

        if (transaction.txnType !== 'inward') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only undo inward transactions' });
        }

        const hoursSinceCreated = (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreated > 24) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Transaction is too old to undo (${Math.round(hoursSinceCreated)} hours ago, max 24 hours)`,
            });
        }

        let revertedQueueItem = false;
        if (transaction.reason === 'return_receipt' && transaction.referenceId) {
            const queueItem = await ctx.prisma.repackingQueueItem.findUnique({
                where: { id: transaction.referenceId }
            });

            if (queueItem && queueItem.status === 'ready') {
                await ctx.prisma.repackingQueueItem.update({
                    where: { id: transaction.referenceId },
                    data: {
                        status: 'pending',
                        qcComments: null,
                        processedAt: null,
                        processedById: null
                    }
                });
                revertedQueueItem = true;
            }
        }

        await ctx.prisma.inventoryTransaction.delete({ where: { id } });

        inventoryBalanceCache.invalidate([transaction.skuId]);

        const balance = await calculateInventoryBalance(ctx.prisma, transaction.skuId);

        return {
            success: true,
            message: revertedQueueItem
                ? 'Transaction undone and item returned to QC queue'
                : 'Transaction undone',
            undone: {
                id: transaction.id,
                skuCode: transaction.sku?.skuCode,
                productName: transaction.sku?.variation?.product?.name,
                qty: transaction.qty,
                reason: transaction.reason
            },
            newBalance: balance.currentBalance,
            revertedToQueue: revertedQueueItem
        };
    });

/**
 * Adjust inventory (positive or negative)
 */
const adjust = protectedProcedure
    .input(
        z.object({
            skuId: z.string().min(1, 'SKU ID is required'),
            quantity: z.number().int().refine((val) => val !== 0, { message: 'Quantity cannot be zero' }),
            reason: z.string().min(1, 'Reason is required'),
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { skuId, quantity, reason, notes } = input;

        const sku = await ctx.prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'SKU not found' });
        }

        const txnType = quantity > 0 ? TXN_TYPE.INWARD : TXN_TYPE.OUTWARD;
        const absQuantity = Math.abs(quantity);

        if (txnType === TXN_TYPE.OUTWARD) {
            const currentBalance = await calculateInventoryBalance(ctx.prisma, skuId, { allowNegative: true });

            if (currentBalance.availableBalance < absQuantity) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Insufficient stock for adjustment: available=${currentBalance.availableBalance}, requested=${absQuantity}`,
                });
            }
        }

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

        inventoryBalanceCache.invalidate([skuId]);

        const balance = await calculateInventoryBalance(ctx.prisma, skuId, { allowNegative: true });

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

// ============================================
// PENDING QUEUE QUERIES
// ============================================

/**
 * Get counts from all pending inward sources
 */
const getPendingSources = protectedProcedure
    .query(async ({ ctx }) => {
        const [productionCount, returnsCount, rtoData, repackingCount] = await Promise.all([
            ctx.prisma.productionBatch.count({
                where: { status: { in: ['planned', 'in_progress'] } }
            }),
            ctx.prisma.returnRequestLine.count({
                where: {
                    request: { status: { in: ['in_transit', 'received'] } },
                    itemCondition: null
                }
            }),
            ctx.prisma.orderLine.findMany({
                where: {
                    order: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                        isArchived: false
                    },
                    rtoCondition: null
                },
                select: {
                    id: true,
                    order: { select: { rtoInitiatedAt: true } }
                }
            }),
            ctx.prisma.repackingQueueItem.count({
                where: { status: { in: ['pending', 'inspecting'] } }
            })
        ]);

        const now = Date.now();
        let rtoUrgent = 0;
        let rtoWarning = 0;

        for (const line of rtoData) {
            if (line.order.rtoInitiatedAt) {
                const daysInRto = Math.floor((now - new Date(line.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24));
                if (daysInRto > 14) rtoUrgent++;
                else if (daysInRto > 7) rtoWarning++;
            }
        }

        return {
            counts: {
                production: productionCount,
                returns: returnsCount,
                rto: rtoData.length,
                rtoUrgent,
                rtoWarning,
                repacking: repackingCount
            }
        };
    });

/**
 * Scan lookup - find SKU and matching pending sources
 */
const scanLookup = protectedProcedure
    .input(
        z.object({
            code: z.string().min(1, 'Code is required'),
        })
    )
    .query(async ({ input, ctx }) => {
        const { code } = input;

        const sku = await ctx.prisma.sku.findFirst({
            where: { skuCode: code },
            include: {
                variation: {
                    include: {
                        product: true,
                        fabric: true
                    }
                }
            }
        });

        if (!sku) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'SKU not found' });
        }

        const [balance, repackingItem, returnLine, rtoLine, productionBatch] = await Promise.all([
            calculateInventoryBalance(ctx.prisma, sku.id),
            ctx.prisma.repackingQueueItem.findFirst({
                where: { skuId: sku.id, status: { in: ['pending', 'inspecting'] } },
                include: { returnRequest: { select: { requestNumber: true } } }
            }),
            ctx.prisma.returnRequestLine.findFirst({
                where: {
                    skuId: sku.id,
                    itemCondition: null,
                    request: { status: { in: ['in_transit', 'received'] } }
                },
                include: { request: { select: { id: true, requestNumber: true, reasonCategory: true } } }
            }),
            ctx.prisma.orderLine.findFirst({
                where: {
                    skuId: sku.id,
                    rtoCondition: null,
                    order: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                        isArchived: false
                    }
                },
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                            trackingStatus: true,
                            rtoInitiatedAt: true,
                            _count: { select: { orderLines: true } },
                            orderLines: {
                                where: { rtoCondition: { not: null } },
                                select: { id: true }
                            }
                        }
                    }
                }
            }),
            ctx.prisma.productionBatch.findFirst({
                where: {
                    skuId: sku.id,
                    status: { in: ['planned', 'in_progress'] }
                },
                select: {
                    id: true,
                    batchCode: true,
                    batchDate: true,
                    qtyPlanned: true,
                    qtyCompleted: true
                }
            })
        ]);

        const matches: Array<{
            source: string;
            priority: number;
            data: Record<string, unknown>;
        }> = [];

        if (repackingItem) {
            matches.push({
                source: 'repacking',
                priority: 1,
                data: {
                    queueItemId: repackingItem.id,
                    condition: repackingItem.condition,
                    qty: repackingItem.qty,
                    returnRequestNumber: repackingItem.returnRequest?.requestNumber,
                    notes: repackingItem.inspectionNotes
                }
            });
        }

        if (returnLine) {
            matches.push({
                source: 'return',
                priority: 2,
                data: {
                    lineId: returnLine.id,
                    requestId: returnLine.requestId,
                    requestNumber: returnLine.request.requestNumber,
                    qty: returnLine.qty,
                    reasonCategory: returnLine.request.reasonCategory,
                    customerName: null
                }
            });
        }

        if (rtoLine) {
            const totalLines = rtoLine.order._count?.orderLines || 0;
            const processedCount = rtoLine.order.orderLines?.length || 0;

            matches.push({
                source: 'rto',
                priority: 3,
                data: {
                    lineId: rtoLine.id,
                    orderId: rtoLine.orderId,
                    orderNumber: rtoLine.order.orderNumber,
                    customerName: rtoLine.order.customerName,
                    trackingStatus: rtoLine.order.trackingStatus,
                    atWarehouse: rtoLine.order.trackingStatus === 'rto_delivered',
                    rtoInitiatedAt: rtoLine.order.rtoInitiatedAt,
                    qty: rtoLine.qty,
                    progress: {
                        total: totalLines,
                        processed: processedCount,
                        remaining: totalLines - processedCount
                    }
                }
            });
        }

        if (productionBatch) {
            matches.push({
                source: 'production',
                priority: 4,
                data: {
                    batchId: productionBatch.id,
                    batchCode: productionBatch.batchCode,
                    batchDate: productionBatch.batchDate,
                    qtyPlanned: productionBatch.qtyPlanned,
                    qtyCompleted: productionBatch.qtyCompleted || 0,
                    qtyPending: productionBatch.qtyPlanned - (productionBatch.qtyCompleted || 0)
                }
            });
        }

        return {
            sku: {
                id: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                mrp: sku.mrp,
                imageUrl: sku.variation.imageUrl || sku.variation.product.imageUrl
            },
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
            matches: matches.sort((a, b) => a.priority - b.priority),
            recommendedSource: matches.length > 0 ? matches[0].source : 'adjustment'
        };
    });

/**
 * Get transaction allocation matches
 */
const getTransactionMatches = protectedProcedure
    .input(
        z.object({
            transactionId: z.string().min(1),
        })
    )
    .query(async ({ input, ctx }) => {
        const { transactionId } = input;

        const transaction = await ctx.prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
            select: {
                id: true,
                skuId: true,
                reason: true,
                referenceId: true,
                sku: { select: { skuCode: true } }
            }
        });

        if (!transaction) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
        }

        const isAllocated = transaction.reason !== 'received';
        const currentAllocation = isAllocated ? {
            type: transaction.reason,
            referenceId: transaction.referenceId
        } : null;

        const [productionBatches, rtoLines] = await Promise.all([
            ctx.prisma.productionBatch.findMany({
                where: {
                    skuId: transaction.skuId,
                    status: { in: ['planned', 'in_progress'] }
                },
                select: {
                    id: true,
                    batchCode: true,
                    batchDate: true,
                    qtyPlanned: true,
                    qtyCompleted: true
                },
                orderBy: { batchDate: 'asc' },
                take: 5
            }),
            ctx.prisma.orderLine.findMany({
                where: {
                    skuId: transaction.skuId,
                    rtoCondition: null,
                    order: {
                        trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                        isArchived: false
                    }
                },
                select: {
                    id: true,
                    qty: true,
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                            trackingStatus: true,
                            rtoInitiatedAt: true
                        }
                    }
                },
                take: 5
            })
        ]);

        interface TransactionMatch {
            type: 'production' | 'rto';
            id: string;
            label: string;
            detail: string;
            date?: Date | null;
            pending?: number;
            orderId?: string;
            atWarehouse?: boolean;
        }

        const matches: TransactionMatch[] = [];

        for (const batch of productionBatches) {
            const pending = batch.qtyPlanned - (batch.qtyCompleted || 0);
            if (pending > 0) {
                matches.push({
                    type: 'production',
                    id: batch.id,
                    label: batch.batchCode || `Batch ${batch.id.slice(0, 8)}`,
                    detail: `${batch.qtyCompleted || 0}/${batch.qtyPlanned} completed`,
                    date: batch.batchDate,
                    pending
                });
            }
        }

        for (const line of rtoLines) {
            matches.push({
                type: 'rto',
                id: line.id,
                orderId: line.order.id,
                label: `RTO #${line.order.orderNumber}`,
                detail: line.order.customerName || '',
                date: line.order.rtoInitiatedAt,
                atWarehouse: line.order.trackingStatus === 'rto_delivered'
            });
        }

        return {
            transactionId,
            skuCode: transaction.sku?.skuCode,
            isAllocated,
            currentAllocation,
            matches
        };
    });

/**
 * Get pending queue items by source
 */
const getPendingQueue = protectedProcedure
    .input(
        z.object({
            source: PendingSourceSchema,
            search: z.string().optional(),
            limit: z.number().int().positive().optional().default(50),
            offset: z.number().int().nonnegative().optional().default(0),
        })
    )
    .query(async ({ input, ctx }) => {
        const { source, search, limit, offset } = input;
        const searchLower = search?.toLowerCase();

        const skuSelect = {
            id: true,
            skuCode: true,
            size: true,
            variation: {
                select: {
                    colorName: true,
                    imageUrl: true,
                    product: { select: { name: true, imageUrl: true } }
                }
            }
        };

        if (source === 'rto') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const baseWhere: any = {
                order: {
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                    isArchived: false
                },
                rtoCondition: null
            };

            const searchWhere = searchLower ? {
                OR: [
                    { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                    { order: { orderNumber: { contains: searchLower, mode: 'insensitive' as const } } },
                    { order: { customerName: { contains: searchLower, mode: 'insensitive' as const } } },
                    { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } }
                ]
            } : {};

            const where = { ...baseWhere, ...searchWhere };

            const [totalCount, rtoPending] = await Promise.all([
                ctx.prisma.orderLine.count({ where }),
                ctx.prisma.orderLine.findMany({
                    where,
                    select: {
                        id: true,
                        skuId: true,
                        qty: true,
                        sku: { select: skuSelect },
                        order: {
                            select: {
                                id: true,
                                orderNumber: true,
                                customerName: true,
                                trackingStatus: true,
                                rtoInitiatedAt: true
                            }
                        }
                    },
                    orderBy: [{ order: { rtoInitiatedAt: 'asc' } }],
                    skip: offset,
                    take: limit
                })
            ]);

            const items = rtoPending.map(l => {
                const daysInRto = l.order.rtoInitiatedAt
                    ? Math.floor((Date.now() - new Date(l.order.rtoInitiatedAt).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;

                return {
                    id: l.id,
                    skuId: l.skuId,
                    skuCode: l.sku.skuCode,
                    productName: l.sku.variation.product.name,
                    colorName: l.sku.variation.colorName,
                    size: l.sku.size,
                    qty: l.qty,
                    imageUrl: l.sku.variation.imageUrl || l.sku.variation.product.imageUrl || null,
                    contextLabel: 'Order',
                    contextValue: l.order.orderNumber,
                    source: 'rto' as const,
                    lineId: l.id,
                    orderId: l.order.id,
                    orderNumber: l.order.orderNumber,
                    customerName: l.order.customerName,
                    trackingStatus: l.order.trackingStatus,
                    atWarehouse: l.order.trackingStatus === 'rto_delivered',
                    rtoInitiatedAt: l.order.rtoInitiatedAt,
                    daysInRto,
                    urgency: daysInRto > 14 ? 'urgent' : daysInRto > 7 ? 'warning' : 'normal'
                };
            });

            return {
                source: 'rto',
                items,
                total: totalCount,
                pagination: { total: totalCount, limit, offset, hasMore: offset + items.length < totalCount }
            };
        }

        if (source === 'production') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const baseWhere: any = { status: { in: ['planned', 'in_progress'] } };

            const searchWhere = searchLower ? {
                OR: [
                    { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                    { batchCode: { contains: searchLower, mode: 'insensitive' as const } },
                    { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } }
                ]
            } : {};

            const where = { ...baseWhere, ...searchWhere };

            const [totalCount, productionPending] = await Promise.all([
                ctx.prisma.productionBatch.count({ where }),
                ctx.prisma.productionBatch.findMany({
                    where,
                    select: {
                        id: true,
                        skuId: true,
                        batchCode: true,
                        batchDate: true,
                        qtyPlanned: true,
                        qtyCompleted: true,
                        sku: { select: skuSelect }
                    },
                    orderBy: { batchDate: 'asc' },
                    skip: offset,
                    take: limit
                })
            ]);

            const items = productionPending.map(b => ({
                id: b.id,
                skuId: b.skuId,
                skuCode: b.sku?.skuCode ?? '',
                productName: b.sku?.variation.product.name ?? '',
                colorName: b.sku?.variation.colorName ?? '',
                size: b.sku?.size ?? '',
                qty: b.qtyPlanned - (b.qtyCompleted || 0),
                imageUrl: b.sku?.variation.imageUrl || b.sku?.variation.product.imageUrl || null,
                contextLabel: 'Batch',
                contextValue: b.batchCode || `Batch ${b.id.slice(0, 8)}`,
                source: 'production' as const,
                batchId: b.id,
                batchCode: b.batchCode,
                qtyPlanned: b.qtyPlanned,
                qtyCompleted: b.qtyCompleted || 0,
                qtyPending: b.qtyPlanned - (b.qtyCompleted || 0),
                batchDate: b.batchDate
            }));

            return {
                source: 'production',
                items,
                total: totalCount,
                pagination: { total: totalCount, limit, offset, hasMore: offset + items.length < totalCount }
            };
        }

        if (source === 'returns') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const baseWhere: any = {
                request: { status: { in: ['in_transit', 'received'] } },
                itemCondition: null
            };

            const searchWhere = searchLower ? {
                OR: [
                    { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                    { request: { requestNumber: { contains: searchLower, mode: 'insensitive' as const } } },
                    { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } }
                ]
            } : {};

            const where = { ...baseWhere, ...searchWhere };

            const [totalCount, returnsPending] = await Promise.all([
                ctx.prisma.returnRequestLine.count({ where }),
                ctx.prisma.returnRequestLine.findMany({
                    where,
                    select: {
                        id: true,
                        skuId: true,
                        qty: true,
                        requestId: true,
                        sku: { select: skuSelect },
                        request: {
                            select: {
                                requestNumber: true,
                                reasonCategory: true,
                                customer: { select: { firstName: true } }
                            }
                        }
                    },
                    skip: offset,
                    take: limit
                })
            ]);

            const items = returnsPending.map(l => ({
                id: l.id,
                skuId: l.skuId,
                skuCode: l.sku.skuCode,
                productName: l.sku.variation.product.name,
                colorName: l.sku.variation.colorName,
                size: l.sku.size,
                qty: l.qty,
                imageUrl: l.sku.variation.imageUrl || l.sku.variation.product.imageUrl || null,
                contextLabel: 'Ticket',
                contextValue: l.request.requestNumber,
                source: 'return' as const,
                lineId: l.id,
                requestId: l.requestId,
                requestNumber: l.request.requestNumber,
                reasonCategory: l.request.reasonCategory,
                customerName: l.request.customer?.firstName || 'Unknown'
            }));

            return {
                source: 'returns',
                items,
                total: totalCount,
                pagination: { total: totalCount, limit, offset, hasMore: offset + items.length < totalCount }
            };
        }

        // repacking
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const baseWhere: any = { status: { in: ['pending', 'inspecting'] } };

        const searchWhere = searchLower ? {
            OR: [
                { sku: { skuCode: { contains: searchLower, mode: 'insensitive' as const } } },
                { sku: { variation: { product: { name: { contains: searchLower, mode: 'insensitive' as const } } } } },
                { returnRequest: { requestNumber: { contains: searchLower, mode: 'insensitive' as const } } }
            ]
        } : {};

        const where = { ...baseWhere, ...searchWhere };

        const [totalCount, repackingPending] = await Promise.all([
            ctx.prisma.repackingQueueItem.count({ where }),
            ctx.prisma.repackingQueueItem.findMany({
                where,
                select: {
                    id: true,
                    skuId: true,
                    qty: true,
                    condition: true,
                    inspectionNotes: true,
                    orderLineId: true,
                    sku: { select: skuSelect },
                    returnRequest: { select: { requestNumber: true } },
                    orderLine: {
                        select: {
                            order: { select: { orderNumber: true } }
                        }
                    }
                },
                skip: offset,
                take: limit
            })
        ]);

        const items = repackingPending.map(r => ({
            id: r.id,
            skuId: r.skuId,
            skuCode: r.sku.skuCode,
            productName: r.sku.variation.product.name,
            colorName: r.sku.variation.colorName,
            size: r.sku.size,
            qty: r.qty,
            imageUrl: r.sku.variation.imageUrl || r.sku.variation.product.imageUrl || null,
            contextLabel: 'Return',
            contextValue: r.returnRequest?.requestNumber || 'N/A',
            source: 'repacking' as const,
            queueItemId: r.id,
            condition: r.condition,
            inspectionNotes: r.inspectionNotes,
            returnRequestNumber: r.returnRequest?.requestNumber,
            orderLineId: r.orderLineId,
            rtoOrderNumber: r.orderLine?.order?.orderNumber
        }));

        return {
            source: 'repacking',
            items,
            total: totalCount,
            pagination: { total: totalCount, limit, offset, hasMore: offset + items.length < totalCount }
        };
    });

// ============================================
// ALLOCATION MUTATIONS
// ============================================

/**
 * Allocate transaction to a source
 */
const allocateTransaction = protectedProcedure
    .input(
        z.object({
            transactionId: z.string().min(1),
            allocationType: AllocationTypeSchema,
            allocationId: z.string().optional(),
            rtoCondition: RtoConditionSchema.optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { transactionId, allocationType, allocationId, rtoCondition } = input;

        const transaction = await ctx.prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
            include: {
                sku: {
                    include: { variation: { include: { product: true } } }
                }
            }
        });

        if (!transaction) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
        }

        interface PreviousAllocation {
            type: string;
            referenceId: string | null;
        }

        const previousAllocation: PreviousAllocation | null = transaction.reason !== 'received' ? {
            type: transaction.reason || '',
            referenceId: transaction.referenceId || null
        } : null;

        if (allocationType === 'production') {
            if (!allocationId) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'allocationId (batchId) is required for production allocation' });
            }

            await ctx.prisma.$transaction(async (tx) => {
                // Revert previous allocations
                if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                    const prevBatch = await tx.productionBatch.findUnique({
                        where: { id: previousAllocation.referenceId }
                    });
                    if (prevBatch) {
                        const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                        const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                        await tx.productionBatch.update({
                            where: { id: previousAllocation.referenceId },
                            data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null }
                        });
                    }
                }

                if (previousAllocation?.type === 'return_receipt' && previousAllocation.referenceId) {
                    await tx.returnRequestLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { itemCondition: null }
                    });
                }

                if (previousAllocation?.type === 'repack_complete' && previousAllocation.referenceId) {
                    await tx.repackingQueueItem.update({
                        where: { id: previousAllocation.referenceId },
                        data: { status: 'pending', processedAt: null, processedById: null }
                    });
                }

                if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                    const orderLine = await tx.orderLine.findUnique({
                        where: { id: previousAllocation.referenceId },
                        include: { order: true }
                    });
                    if (orderLine) {
                        await tx.orderLine.update({
                            where: { id: previousAllocation.referenceId },
                            data: { rtoCondition: null, rtoInwardedAt: null, rtoInwardedById: null }
                        });
                        if (orderLine.order.terminalStatus === 'rto_received') {
                            await tx.order.update({
                                where: { id: orderLine.orderId },
                                data: { rtoReceivedAt: null, terminalStatus: null, terminalAt: null }
                            });
                        }
                    }
                }

                await tx.inventoryTransaction.update({
                    where: { id: transactionId },
                    data: { reason: 'production', referenceId: allocationId }
                });

                const batch = await tx.productionBatch.findUnique({ where: { id: allocationId } });

                if (!batch) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Production batch not found' });
                }

                if (batch.skuId !== transaction.skuId) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch SKU does not match transaction SKU' });
                }

                const newCompleted = Math.min(batch.qtyCompleted + transaction.qty, batch.qtyPlanned);
                const isComplete = newCompleted >= batch.qtyPlanned;

                await tx.productionBatch.update({
                    where: { id: allocationId },
                    data: {
                        qtyCompleted: newCompleted,
                        status: isComplete ? 'completed' : 'in_progress',
                        completedAt: isComplete ? new Date() : null
                    }
                });
            });

            return {
                success: true,
                message: previousAllocation ? 'Allocation changed' : 'Transaction allocated to production batch',
                allocation: { type: 'production', referenceId: allocationId }
            };
        }

        if (allocationType === 'rto') {
            if (!allocationId) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'allocationId (lineId) is required for RTO allocation' });
            }

            const condition = rtoCondition || 'good';

            await ctx.prisma.$transaction(async (tx) => {
                // Revert previous allocations
                if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                    const prevBatch = await tx.productionBatch.findUnique({
                        where: { id: previousAllocation.referenceId }
                    });
                    if (prevBatch) {
                        const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                        const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                        await tx.productionBatch.update({
                            where: { id: previousAllocation.referenceId },
                            data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null }
                        });
                    }
                }
                if (previousAllocation?.type === 'return_receipt' && previousAllocation.referenceId) {
                    await tx.returnRequestLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { itemCondition: null }
                    });
                }
                if (previousAllocation?.type === 'repack_complete' && previousAllocation.referenceId) {
                    await tx.repackingQueueItem.update({
                        where: { id: previousAllocation.referenceId },
                        data: { status: 'pending', processedAt: null, processedById: null }
                    });
                }

                const orderLine = await tx.orderLine.findUnique({
                    where: { id: allocationId },
                    include: { order: { select: { id: true, orderNumber: true } } }
                });

                if (!orderLine) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Order line not found' });
                }

                if (orderLine.skuId !== transaction.skuId) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order line SKU does not match transaction SKU' });
                }

                if (orderLine.rtoCondition) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'RTO line already processed' });
                }

                if (condition === 'damaged' || condition === 'wrong_product') {
                    await tx.inventoryTransaction.delete({ where: { id: transactionId } });

                    await tx.writeOffLog.create({
                        data: {
                            skuId: transaction.skuId,
                            qty: transaction.qty,
                            reason: condition === 'damaged' ? 'defective' : 'wrong_product',
                            sourceType: 'rto',
                            sourceId: allocationId,
                            notes: `RTO write-off (${condition}) - Order ${orderLine.order.orderNumber}`,
                            createdById: ctx.user.id
                        }
                    });

                    await tx.sku.update({
                        where: { id: transaction.skuId },
                        data: { writeOffCount: { increment: transaction.qty } }
                    });
                } else {
                    await tx.inventoryTransaction.update({
                        where: { id: transactionId },
                        data: {
                            reason: 'rto_received',
                            referenceId: allocationId,
                            notes: `RTO from order ${orderLine.order.orderNumber}`
                        }
                    });
                }

                await tx.orderLine.update({
                    where: { id: allocationId },
                    data: {
                        rtoCondition: condition,
                        rtoInwardedAt: new Date(),
                        rtoInwardedById: ctx.user.id
                    }
                });

                const allLines = await tx.orderLine.findMany({ where: { orderId: orderLine.orderId } });
                const allProcessed = allLines.every(l => l.rtoCondition !== null);

                if (allProcessed) {
                    await tx.order.update({
                        where: { id: orderLine.orderId },
                        data: {
                            rtoReceivedAt: new Date(),
                            terminalStatus: 'rto_received',
                            terminalAt: new Date()
                        }
                    });
                }
            });

            return {
                success: true,
                message: condition === 'damaged' || condition === 'wrong_product'
                    ? `Transaction converted to write-off (${condition})`
                    : 'Transaction allocated to RTO order',
                allocation: { type: 'rto', referenceId: allocationId, condition }
            };
        }

        // adjustment - revert previous allocation
        await ctx.prisma.$transaction(async (tx) => {
            if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                const prevBatch = await tx.productionBatch.findUnique({
                    where: { id: previousAllocation.referenceId }
                });
                if (prevBatch) {
                    const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                    const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                    await tx.productionBatch.update({
                        where: { id: previousAllocation.referenceId },
                        data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null }
                    });
                }
            }

            if (previousAllocation?.type === 'return_receipt' && previousAllocation.referenceId) {
                await tx.returnRequestLine.update({
                    where: { id: previousAllocation.referenceId },
                    data: { itemCondition: null }
                });
            }

            if (previousAllocation?.type === 'repack_complete' && previousAllocation.referenceId) {
                await tx.repackingQueueItem.update({
                    where: { id: previousAllocation.referenceId },
                    data: { status: 'pending', processedAt: null, processedById: null }
                });
            }

            if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                const orderLine = await tx.orderLine.findUnique({
                    where: { id: previousAllocation.referenceId },
                    include: { order: true }
                });
                if (orderLine) {
                    await tx.orderLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { rtoCondition: null, rtoInwardedAt: null, rtoInwardedById: null }
                    });
                    if (orderLine.order.terminalStatus === 'rto_received') {
                        await tx.order.update({
                            where: { id: orderLine.orderId },
                            data: { rtoReceivedAt: null, terminalStatus: null, terminalAt: null }
                        });
                    }
                }
            }

            await tx.inventoryTransaction.update({
                where: { id: transactionId },
                data: { reason: 'adjustment', referenceId: null }
            });
        });

        return {
            success: true,
            message: previousAllocation ? 'Allocation removed' : 'Transaction marked as adjustment',
            allocation: { type: 'adjustment', referenceId: null }
        };
    });

/**
 * Process RTO order line with condition marking
 */
const rtoInwardLine = protectedProcedure
    .input(
        z.object({
            lineId: z.string().min(1),
            condition: RtoConditionSchema,
            notes: z.string().optional(),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { lineId, condition, notes } = input;

        const orderLine = await ctx.prisma.orderLine.findUnique({
            where: { id: lineId },
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        trackingStatus: true,
                        isArchived: true
                    }
                },
                sku: {
                    include: {
                        variation: { include: { product: true } }
                    }
                }
            }
        });

        if (!orderLine) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Order line not found' });
        }

        if (orderLine.rtoCondition) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Line already processed',
            });
        }

        // Idempotency check
        const existingTxn = await findExistingRtoInward(ctx.prisma, lineId);
        const existingWriteOff = await ctx.prisma.writeOffLog.findFirst({
            where: { sourceId: lineId, sourceType: 'rto' }
        });

        if (existingTxn || existingWriteOff) {
            const balance = await calculateInventoryBalance(ctx.prisma, orderLine.skuId);
            return {
                success: true,
                idempotent: true,
                message: 'RTO line already processed',
                inventoryAdded: !!existingTxn,
                writtenOff: !!existingWriteOff,
                condition: orderLine.rtoCondition,
                line: {
                    lineId: orderLine.id,
                    orderId: orderLine.orderId,
                    orderNumber: orderLine.order.orderNumber,
                    skuCode: orderLine.sku?.skuCode,
                    qty: orderLine.qty,
                    condition: orderLine.rtoCondition || condition
                },
                newBalance: balance.currentBalance
            };
        }

        if (!orderLine.order.trackingStatus || !['rto_in_transit', 'rto_delivered'].includes(orderLine.order.trackingStatus)) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Order is not in RTO status. Current status: ${orderLine.order.trackingStatus || 'unknown'}`,
            });
        }

        const result = await ctx.prisma.$transaction(async (tx) => {
            const currentLine = await tx.orderLine.findUnique({
                where: { id: lineId },
                select: { rtoCondition: true }
            });

            if (currentLine?.rtoCondition) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Line already processed (concurrent request)' });
            }

            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    rtoCondition: condition,
                    rtoInwardedAt: new Date(),
                    rtoInwardedById: ctx.user.id,
                    rtoNotes: notes || null
                }
            });

            let inventoryTxn = null;
            let writeOffRecord = null;

            if (condition === 'good' || condition === 'unopened') {
                inventoryTxn = await tx.inventoryTransaction.create({
                    data: {
                        skuId: orderLine.skuId,
                        txnType: 'inward',
                        qty: orderLine.qty,
                        reason: 'rto_received',
                        referenceId: lineId,
                        notes: `RTO from order ${orderLine.order.orderNumber}${notes ? ` - ${notes}` : ''}`,
                        createdById: ctx.user.id
                    }
                });
            } else {
                writeOffRecord = await tx.writeOffLog.create({
                    data: {
                        skuId: orderLine.skuId,
                        qty: orderLine.qty,
                        reason: condition === 'damaged' ? 'defective' : 'wrong_product',
                        sourceType: 'rto',
                        sourceId: lineId,
                        notes: `RTO write-off (${condition}) - Order ${orderLine.order.orderNumber}${notes ? ': ' + notes : ''}`,
                        createdById: ctx.user.id
                    }
                });

                await tx.sku.update({
                    where: { id: orderLine.skuId },
                    data: { writeOffCount: { increment: orderLine.qty } }
                });
            }

            const allLines = await tx.orderLine.findMany({ where: { orderId: orderLine.orderId } });
            const pendingLines = allLines.filter(l => l.rtoCondition === null);
            const allLinesProcessed = pendingLines.length === 0;

            if (allLinesProcessed) {
                const now = new Date();
                await tx.order.update({
                    where: { id: orderLine.orderId },
                    data: {
                        rtoReceivedAt: now,
                        terminalStatus: 'rto_received',
                        terminalAt: now,
                    }
                });
            }

            return {
                inventoryTxn,
                writeOffRecord,
                allLinesProcessed,
                totalLines: allLines.length,
                processedLines: allLines.filter(l => l.rtoCondition !== null).length
            };
        });

        if (result.inventoryTxn) {
            inventoryBalanceCache.invalidate([orderLine.skuId]);
        }

        const balance = await calculateInventoryBalance(ctx.prisma, orderLine.skuId);

        return {
            success: true,
            message: result.inventoryTxn
                ? `RTO line processed - ${orderLine.qty} units added to inventory`
                : result.writeOffRecord
                    ? `RTO line written off as ${condition}`
                    : `RTO line processed as ${condition} - no inventory added`,
            line: {
                lineId: orderLine.id,
                orderId: orderLine.orderId,
                orderNumber: orderLine.order.orderNumber,
                skuCode: orderLine.sku?.skuCode,
                productName: orderLine.sku?.variation.product.name,
                colorName: orderLine.sku?.variation.colorName,
                size: orderLine.sku?.size,
                qty: orderLine.qty,
                condition,
                notes: notes || null
            },
            inventoryAdded: result.inventoryTxn !== null,
            writtenOff: result.writeOffRecord !== null,
            newBalance: balance.currentBalance,
            orderProgress: {
                orderId: orderLine.orderId,
                orderNumber: orderLine.order.orderNumber,
                total: result.totalLines,
                processed: result.processedLines,
                remaining: result.totalLines - result.processedLines,
                allComplete: result.allLinesProcessed
            }
        };
    });

// ============================================
// HELPER FUNCTIONS
// ============================================

interface ProductionBatch {
    id: string;
    batchCode: string | null;
    qtyCompleted: number;
    qtyPlanned: number;
    status: string;
}

async function matchProductionBatchInTransaction(
    tx: PrismaTransactionClient,
    skuId: string,
    quantity: number
): Promise<ProductionBatch | null> {
    const batch = await tx.productionBatch.findFirst({
        where: {
            skuId,
            status: { in: ['planned', 'in_progress'] },
        },
        orderBy: { batchDate: 'asc' },
    });

    if (batch && batch.qtyCompleted < batch.qtyPlanned) {
        const newCompleted = Math.min(batch.qtyCompleted + quantity, batch.qtyPlanned);
        const isComplete = newCompleted >= batch.qtyPlanned;

        const updated = await tx.productionBatch.update({
            where: { id: batch.id },
            data: {
                qtyCompleted: newCompleted,
                status: isComplete ? 'completed' : 'in_progress',
                completedAt: isComplete ? new Date() : null,
            },
        });

        return updated;
    }

    return null;
}

// ============================================
// ROUTER EXPORT
// ============================================

export const inventoryRouter = router({
    // Balance queries
    getBalance,
    getBalances,
    getAllBalances,
    getAlerts,

    // Transaction queries
    getTransactions,
    getInwardHistory,
    getRecentInwards,

    // Transaction mutations
    inward,
    outward,
    quickInward,
    instantInward,
    editInward,
    deleteInward,
    deleteTransaction,
    undoInward,
    adjust,

    // Pending queue queries
    getPendingSources,
    scanLookup,
    getTransactionMatches,
    getPendingQueue,

    // Allocation mutations
    allocateTransaction,
    rtoInwardLine,
});
