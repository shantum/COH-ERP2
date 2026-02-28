/**
 * Inventory Reconciliation Mutations Server Functions
 *
 * TanStack Start Server Functions for physical inventory count reconciliation.
 * Phase 4 implementation with Prisma, cache invalidation.
 *
 * Workflow:
 * 1. Start count - creates reconciliation with all active SKUs + system balances
 * 2. Enter physical quantities (manual or CSV upload - CSV stays in Express)
 * 3. Save progress
 * 4. Submit - creates InventoryTransaction for each variance
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { serverLog } from './serverLog';
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

// ============================================
// INPUT SCHEMAS
// ============================================

const startReconciliationSchema = z.object({
    skuIds: z.array(z.string().uuid()).optional(),
});

const updateReconciliationItemsSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
    items: z.array(
        z.object({
            id: z.string().uuid('Invalid item ID'),
            physicalQty: z.number().int().nullable(),
            systemQty: z.number().int(),
            adjustmentReason: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
        })
    ),
});

const submitReconciliationSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
    applyAdjustments: z.boolean().default(true),
});

const deleteReconciliationSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL';
        message: string;
    };
}

export interface ReconciliationItem {
    id: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    systemQty: number;
    physicalQty: number | null;
    variance: number | null;
    adjustmentReason: string | null;
    notes: string | null;
}

export interface StartReconciliationResult {
    reconciliationId: string;
    status: string;
    createdAt: string;
    itemCount: number;
    items: ReconciliationItem[];
}

export interface UpdateReconciliationItemsResult {
    reconciliationId: string;
    status: string;
    itemsUpdated: number;
}

export interface SubmitReconciliationResult {
    reconciliationId: string;
    status: string;
    adjustmentsMade: number;
    transactions: Array<{
        skuId: string;
        skuCode: string;
        txnType: string;
        qty: number;
        reason: string;
    }>;
}

export interface DeleteReconciliationResult {
    reconciliationId: string;
    deleted: boolean;
}

// ============================================
// QUERY RESULT TYPES
// ============================================

export interface ReconciliationHistoryItem {
    id: string;
    date: string;
    status: string;
    itemsCount: number;
    adjustments: number;
}

export interface GetReconciliationHistoryResult {
    reconciliations: ReconciliationHistoryItem[];
}

export interface GetReconciliationResult {
    id: string;
    status: string;
    createdAt: string;
    items: ReconciliationItem[];
}

/** Type alias for Prisma client instance */
type PrismaClientInstance = Awaited<ReturnType<typeof getPrisma>>;

// ============================================
// BALANCE CALCULATION HELPER
// ============================================

async function calculateAllInventoryBalances(
    prisma: PrismaClientInstance,
    skuIds: string[]
): Promise<Map<string, { currentBalance: number }>> {
    const aggregations = await prisma.inventoryTransaction.groupBy({
        by: ['skuId', 'txnType'],
        where: { skuId: { in: skuIds } },
        _sum: { qty: true },
    });

    const balanceMap = new Map<string, { currentBalance: number }>();

    // Initialize all SKUs with zero balance
    for (const skuId of skuIds) {
        balanceMap.set(skuId, { currentBalance: 0 });
    }

    // Calculate balances from aggregations
    const skuTotals = new Map<string, { inward: number; outward: number }>();
    for (const agg of aggregations) {
        if (!skuTotals.has(agg.skuId)) {
            skuTotals.set(agg.skuId, { inward: 0, outward: 0 });
        }
        const totals = skuTotals.get(agg.skuId)!;
        if (agg.txnType === 'inward') {
            totals.inward = agg._sum.qty || 0;
        } else if (agg.txnType === 'outward') {
            totals.outward = agg._sum.qty || 0;
        }
    }

    for (const [skuId, totals] of skuTotals) {
        balanceMap.set(skuId, { currentBalance: totals.inward - totals.outward });
    }

    return balanceMap;
}

// ============================================
// CACHE INVALIDATION HELPER
// ============================================

async function invalidateAllCache(): Promise<void> {
    try {
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
        inventoryBalanceCache.invalidateAll();
    } catch {
        serverLog.warn({ domain: 'inventory', fn: 'reconciliationCacheInvalidation' }, 'Cache invalidation skipped (server module not available)');
    }
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Start a new reconciliation with all active, non-custom SKUs
 */
export const startReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => startReconciliationSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<StartReconciliationResult>> => {
        const prisma = await getPrisma();
        const { skuIds: providedSkuIds } = data;

        // Get SKUs - either provided or all active non-custom
        let skus;
        if (providedSkuIds && providedSkuIds.length > 0) {
            skus = await prisma.sku.findMany({
                where: {
                    id: { in: providedSkuIds },
                    isActive: true,
                },
                select: {
                    id: true,
                    skuCode: true,
                    size: true,
                    variation: {
                        select: {
                            colorName: true,
                            product: { select: { name: true } },
                        },
                    },
                },
            });
        } else {
            skus = await prisma.sku.findMany({
                where: {
                    isActive: true,
                    isCustomSku: false,
                },
                select: {
                    id: true,
                    skuCode: true,
                    size: true,
                    variation: {
                        select: {
                            colorName: true,
                            product: { select: { name: true } },
                        },
                    },
                },
            });
        }

        if (skus.length === 0) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'No active SKUs found for reconciliation' },
            };
        }

        // Calculate all balances efficiently
        const skuIds = skus.map((s: { id: string }) => s.id);
        const balanceMap = await calculateAllInventoryBalances(prisma, skuIds);

        // Create reconciliation with items
        const reconciliation = await prisma.inventoryReconciliation.create({
            data: {
                createdBy: context.user.id,
                status: 'draft',
                items: {
                    create: skus.map((sku: { id: string }) => ({
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

        const items: ReconciliationItem[] = reconciliation.items.map(
            (item: {
                id: string;
                skuId: string;
                systemQty: number;
                physicalQty: number | null;
                variance: number | null;
                adjustmentReason: string | null;
                notes: string | null;
                sku: {
                    skuCode: string;
                    size: string;
                    variation?: {
                        colorName: string;
                        product?: { name: string } | null;
                    } | null;
                };
            }) => ({
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
            })
        );

        return {
            success: true,
            data: {
                reconciliationId: reconciliation.id,
                status: reconciliation.status,
                createdAt: reconciliation.createdAt.toISOString(),
                itemCount: items.length,
                items,
            },
        };
    });

/**
 * Update reconciliation items (physical quantities, reasons, notes)
 */
export const updateReconciliationItems = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateReconciliationItemsSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UpdateReconciliationItemsResult>> => {
        const prisma = await getPrisma();
        const { reconciliationId, items } = data;

        const reconciliation = await prisma.inventoryReconciliation.findUnique({
            where: { id: reconciliationId },
        });

        if (!reconciliation) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Reconciliation not found' },
            };
        }

        if (reconciliation.status !== 'draft') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot update submitted reconciliation' },
            };
        }

        // Batch update all items in a single transaction
        const updates = items.map((item) => {
            const variance =
                item.physicalQty !== null && item.physicalQty !== undefined
                    ? item.physicalQty - item.systemQty
                    : null;

            return prisma.inventoryReconciliationItem.update({
                where: { id: item.id },
                data: {
                    physicalQty: item.physicalQty,
                    variance,
                    adjustmentReason: item.adjustmentReason || null,
                    notes: item.notes || null,
                },
            });
        });
        await prisma.$transaction(updates);
        const updatedCount = items.length;

        return {
            success: true,
            data: {
                reconciliationId,
                status: reconciliation.status,
                itemsUpdated: updatedCount,
            },
        };
    });

/**
 * Submit reconciliation and create adjustment transactions
 */
export const submitReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => submitReconciliationSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<SubmitReconciliationResult>> => {
        const prisma = await getPrisma();
        const { reconciliationId, applyAdjustments } = data;

        try {
            const result = await prisma.$transaction(
                async (tx: PrismaTransaction) => {
                    // Read fresh state INSIDE transaction to prevent TOCTOU race
                    const reconciliation = await tx.inventoryReconciliation.findUnique({
                        where: { id: reconciliationId },
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

                    if (!reconciliation) throw new Error('NOT_FOUND:Reconciliation not found');
                    if (reconciliation.status !== 'draft') throw new Error('BAD_REQUEST:Reconciliation already submitted');

                    // Collect all items with variances for processing
                    interface ItemToProcess {
                        itemId: string;
                        skuId: string;
                        skuCode: string;
                        txnType: 'inward' | 'outward';
                        qty: number;
                        reason: string;
                        notes: string;
                        adjustmentReason: string;
                    }

                    const itemsToProcess: ItemToProcess[] = [];

                    for (const item of reconciliation.items) {
                        if (item.variance === null || item.variance === 0) continue;

                        if (item.physicalQty === null) {
                            throw new Error(`BAD_REQUEST:Physical quantity not entered for ${item.sku.skuCode}`);
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

                    const transactions: Array<{
                        skuId: string;
                        skuCode: string;
                        txnType: string;
                        qty: number;
                        reason: string;
                    }> = [];

                    // Create adjustment transactions inside the same atomic transaction
                    if (applyAdjustments && itemsToProcess.length > 0) {
                        for (const item of itemsToProcess) {
                            const txn = await tx.inventoryTransaction.create({
                                data: {
                                    skuId: item.skuId,
                                    txnType: item.txnType,
                                    qty: item.qty,
                                    reason: item.reason,
                                    referenceId: reconciliationId,
                                    notes: item.notes,
                                    createdById: context.user.id,
                                },
                            });

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
                    }

                    // Mark reconciliation as submitted atomically
                    await tx.inventoryReconciliation.update({
                        where: { id: reconciliationId },
                        data: { status: 'submitted' },
                    });

                    return transactions;
                },
                { timeout: 60000 }
            );

            // Invalidate cache after successful transaction
            if (applyAdjustments && result.length > 0) {
                await invalidateAllCache();
            }

            return {
                success: true,
                data: {
                    reconciliationId,
                    status: 'submitted',
                    adjustmentsMade: result.length,
                    transactions: result.slice(0, 50),
                },
            };
        } catch (error: unknown) {
            serverLog.error({ domain: 'inventory', fn: 'submitReconciliation' }, 'Failed', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return {
                success: false,
                error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL', message: msg as string },
            };
        }
    });

/**
 * Delete a draft reconciliation
 */
export const deleteReconciliation = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteReconciliationSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<DeleteReconciliationResult>> => {
        const prisma = await getPrisma();
        const { reconciliationId } = data;

        const reconciliation = await prisma.inventoryReconciliation.findUnique({
            where: { id: reconciliationId },
        });

        if (!reconciliation) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Reconciliation not found' },
            };
        }

        if (reconciliation.status !== 'draft') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot delete submitted reconciliation' },
            };
        }

        // Delete reconciliation and cascade to items
        await prisma.inventoryReconciliation.delete({
            where: { id: reconciliationId },
        });

        return {
            success: true,
            data: {
                reconciliationId,
                deleted: true,
            },
        };
    });

// ============================================
// QUERY SCHEMAS
// ============================================

const getReconciliationHistorySchema = z.object({
    limit: z.number().int().positive().optional().default(50),
});

const getReconciliationByIdSchema = z.object({
    reconciliationId: z.string().uuid('Invalid reconciliation ID'),
});

// ============================================
// QUERY SERVER FUNCTIONS
// ============================================

/**
 * Get reconciliation history
 */
export const getReconciliationHistory = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationHistorySchema.parse(input || {}))
    .handler(async ({ data }): Promise<MutationResult<GetReconciliationHistoryResult>> => {
        const prisma = await getPrisma();
        const { limit } = data;

        const reconciliations = await prisma.inventoryReconciliation.findMany({
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                items: {
                    select: { variance: true },
                },
            },
        });

        const result: ReconciliationHistoryItem[] = reconciliations.map(
            (r: {
                id: string;
                createdAt: Date;
                status: string;
                items: Array<{ variance: number | null }>;
            }) => ({
                id: r.id,
                date: r.createdAt.toISOString(),
                status: r.status,
                itemsCount: r.items.length,
                adjustments: r.items.filter((i) => i.variance !== null && i.variance !== 0).length,
            })
        );

        return {
            success: true,
            data: { reconciliations: result },
        };
    });

/**
 * Get reconciliation by ID with all items
 */
export const getReconciliationById = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getReconciliationByIdSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<GetReconciliationResult>> => {
        const prisma = await getPrisma();
        const { reconciliationId } = data;

        const reconciliation = await prisma.inventoryReconciliation.findUnique({
            where: { id: reconciliationId },
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
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Reconciliation not found' },
            };
        }

        const items: ReconciliationItem[] = reconciliation.items.map(
            (item: {
                id: string;
                skuId: string;
                systemQty: number;
                physicalQty: number | null;
                variance: number | null;
                adjustmentReason: string | null;
                notes: string | null;
                sku: {
                    skuCode: string;
                    size: string;
                    variation?: {
                        colorName: string;
                        product?: { name: string } | null;
                    } | null;
                };
            }) => ({
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
            })
        );

        return {
            success: true,
            data: {
                id: reconciliation.id,
                status: reconciliation.status,
                createdAt: reconciliation.createdAt.toISOString(),
                items,
            },
        };
    });
