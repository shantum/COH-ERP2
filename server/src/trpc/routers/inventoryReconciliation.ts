/**
 * Inventory Reconciliation tRPC Router
 * Physical inventory count reconciliation workflow
 *
 * Migrated from Express: /routes/inventory-reconciliation.ts
 *
 * Workflow:
 * 1. Start count - creates reconciliation with all active SKUs + system balances
 * 2. Enter physical quantities (manual or CSV upload - CSV stays in Express)
 * 3. Save progress
 * 4. Submit - creates InventoryTransaction for each variance
 *
 * NOTE: CSV upload endpoint remains in Express due to multer file handling
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../index.js';
import { calculateAllInventoryBalances } from '../../utils/queryPatterns.js';
import { reconciliationLogger } from '../../utils/logger.js';

// ============================================
// QUERIES
// ============================================

/**
 * Get history of past reconciliations
 */
const getHistory = protectedProcedure
    .input(
        z.object({
            limit: z.number().int().positive().optional().default(10),
        })
    )
    .query(async ({ input, ctx }) => {
        const { limit } = input;

        const reconciliations = await ctx.prisma.inventoryReconciliation.findMany({
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return reconciliations.map(r => ({
            id: r.id,
            date: r.reconcileDate,
            status: r.status,
            itemsCount: r.items.length,
            adjustments: r.items.filter(i => i.variance !== 0 && i.variance !== null).length,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
        }));
    });

/**
 * Get a specific reconciliation with items
 */
const getById = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
        })
    )
    .query(async ({ input, ctx }) => {
        const { id } = input;

        const reconciliation = await ctx.prisma.inventoryReconciliation.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!reconciliation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found' });
        }

        return {
            id: reconciliation.id,
            status: reconciliation.status,
            notes: reconciliation.notes,
            createdAt: reconciliation.createdAt,
            items: reconciliation.items.map(item => ({
                id: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                productName: item.sku.variation?.product?.name || '',
                colorName: item.sku.variation?.colorName || '',
                size: item.sku.size,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };
    });

// ============================================
// MUTATIONS
// ============================================

/**
 * Start a new reconciliation with all active, non-custom SKUs
 */
const start = protectedProcedure
    .mutation(async ({ ctx }) => {
        // Get all active, non-custom SKUs
        const skus = await ctx.prisma.sku.findMany({
            where: {
                isActive: true,
                isCustomSku: false,
            },
            include: {
                variation: {
                    include: { product: true },
                },
            },
            orderBy: { skuCode: 'asc' },
        });

        // Calculate all balances efficiently in one query
        const balanceMap = await calculateAllInventoryBalances(
            ctx.prisma,
            skus.map(s => s.id),
            { excludeCustomSkus: true }
        );

        // Create reconciliation with items
        const reconciliation = await ctx.prisma.inventoryReconciliation.create({
            data: {
                createdBy: ctx.user?.id || null,
                items: {
                    create: skus.map(sku => ({
                        skuId: sku.id,
                        systemQty: balanceMap.get(sku.id)?.currentBalance || 0,
                    })),
                },
            },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        return {
            id: reconciliation.id,
            status: reconciliation.status,
            createdAt: reconciliation.createdAt,
            items: reconciliation.items.map(item => ({
                id: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                productName: item.sku.variation?.product?.name || '',
                colorName: item.sku.variation?.colorName || '',
                size: item.sku.size,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };
    });

/**
 * Update reconciliation items (physical quantities, reasons, notes)
 */
const updateItems = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
            items: z.array(z.object({
                id: z.string().min(1),
                physicalQty: z.number().int().nullable(),
                systemQty: z.number().int(),
                adjustmentReason: z.string().nullable().optional(),
                notes: z.string().nullable().optional(),
            })),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id, items } = input;

        const reconciliation = await ctx.prisma.inventoryReconciliation.findUnique({
            where: { id },
        });

        if (!reconciliation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot update submitted reconciliation' });
        }

        // Update each item
        for (const item of items) {
            const variance = item.physicalQty !== null && item.physicalQty !== undefined
                ? item.physicalQty - item.systemQty
                : null;

            await ctx.prisma.inventoryReconciliationItem.update({
                where: { id: item.id },
                data: {
                    physicalQty: item.physicalQty,
                    variance,
                    adjustmentReason: item.adjustmentReason || null,
                    notes: item.notes || null,
                },
            });
        }

        // Return updated reconciliation
        const updated = await ctx.prisma.inventoryReconciliation.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!updated) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found after update' });
        }

        return {
            id: updated.id,
            status: updated.status,
            items: updated.items.map(item => ({
                id: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                productName: item.sku.variation?.product?.name || '',
                colorName: item.sku.variation?.colorName || '',
                size: item.sku.size,
                systemQty: item.systemQty,
                physicalQty: item.physicalQty,
                variance: item.variance,
                adjustmentReason: item.adjustmentReason,
                notes: item.notes,
            })),
        };
    });

/**
 * Submit reconciliation and create adjustment transactions
 */
const submit = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id } = input;

        const reconciliation = await ctx.prisma.inventoryReconciliation.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!reconciliation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reconciliation already submitted' });
        }

        // Collect all items with variances for batch processing
        const itemsToProcess: Array<{
            itemId: string;
            skuId: string;
            skuCode: string;
            txnType: 'inward' | 'outward';
            qty: number;
            reason: string;
            notes: string;
            adjustmentReason: string;
        }> = [];

        for (const item of reconciliation.items) {
            if (item.variance === null || item.variance === 0) continue;

            if (item.physicalQty === null) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: `Physical quantity not entered for ${item.sku.skuCode}`,
                });
            }

            const adjustmentReason = item.adjustmentReason || 'count_adjustment';
            const txnType = item.variance > 0 ? 'inward' : 'outward';
            const qty = Math.abs(item.variance);

            itemsToProcess.push({
                itemId: item.id,
                skuId: item.skuId,
                skuCode: item.sku.skuCode,
                txnType,
                qty,
                reason: `reconciliation_${adjustmentReason}`,
                notes: item.notes || `Reconciliation adjustment: ${adjustmentReason}`,
                adjustmentReason,
            });
        }

        reconciliationLogger.info({ count: itemsToProcess.length }, 'Processing adjustments');

        // Batch create all transactions in a single database transaction
        const transactions: Array<{
            skuId: string;
            skuCode: string;
            txnType: string;
            qty: number;
            reason: string;
        }> = [];
        const BATCH_SIZE = 100;

        for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
            const batch = itemsToProcess.slice(i, i + BATCH_SIZE);

            await ctx.prisma.$transaction(async (tx) => {
                for (const item of batch) {
                    const txn = await tx.inventoryTransaction.create({
                        data: {
                            skuId: item.skuId,
                            txnType: item.txnType,
                            qty: item.qty,
                            reason: item.reason,
                            referenceId: reconciliation.id,
                            notes: item.notes,
                            createdById: ctx.user.id,
                        },
                    });

                    // Link transaction to reconciliation item
                    await tx.inventoryReconciliationItem.update({
                        where: { id: item.itemId },
                        data: { txnId: txn.id },
                    });

                    transactions.push({
                        skuId: item.skuId,
                        skuCode: item.skuCode,
                        txnType: item.txnType,
                        qty: item.qty,
                        reason: item.adjustmentReason,
                    });
                }
            }, { timeout: 60000 });

            reconciliationLogger.debug({
                batch: Math.floor(i / BATCH_SIZE) + 1,
                totalBatches: Math.ceil(itemsToProcess.length / BATCH_SIZE)
            }, 'Batch complete');
        }

        // Mark reconciliation as submitted
        await ctx.prisma.inventoryReconciliation.update({
            where: { id },
            data: { status: 'submitted' },
        });

        reconciliationLogger.info({ count: transactions.length }, 'Reconciliation adjustments created');

        return {
            id: reconciliation.id,
            status: 'submitted',
            adjustmentsMade: transactions.length,
            // Limit response size - only return first 50 transactions
            transactions: transactions.slice(0, 50),
        };
    });

/**
 * Delete a draft reconciliation
 */
const deleteReconciliation = protectedProcedure
    .input(
        z.object({
            id: z.string().min(1),
        })
    )
    .mutation(async ({ input, ctx }) => {
        const { id } = input;

        const reconciliation = await ctx.prisma.inventoryReconciliation.findUnique({
            where: { id },
        });

        if (!reconciliation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found' });
        }

        if (reconciliation.status !== 'draft') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete submitted reconciliation' });
        }

        await ctx.prisma.inventoryReconciliation.delete({
            where: { id },
        });

        return { message: 'Reconciliation deleted' };
    });

// ============================================
// ROUTER EXPORT
// ============================================

export const inventoryReconciliationRouter = router({
    getHistory,
    getById,
    start,
    updateItems,
    submit,
    delete: deleteReconciliation,
});
