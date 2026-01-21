/**
 * Inventory Mutations Server Functions
 *
 * TanStack Start Server Functions for inventory transaction mutations.
 * Phase 4 implementation with Prisma, cache invalidation, and SSE broadcasting.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * (pg, Buffer) from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// INPUT SCHEMAS
// ============================================

const inwardSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID'),
    qty: z.number().int().positive('Quantity must be a positive integer'),
    reason: z.string().min(1, 'Reason is required'),
    referenceId: z.string().optional(),
    notes: z.string().optional(),
    warehouseLocation: z.string().optional(),
    adjustmentReason: z.string().optional(),
});

const outwardSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID'),
    qty: z.number().int().positive('Quantity must be a positive integer'),
    reason: z.string().min(1, 'Reason is required'),
    referenceId: z.string().optional(),
    notes: z.string().optional(),
    warehouseLocation: z.string().optional(),
    adjustmentReason: z.string().optional(),
});

const quickInwardSchema = z.object({
    items: z.array(
        z.object({
            skuId: z.string().uuid('Invalid SKU ID'),
            qty: z.number().int().positive('Quantity must be a positive integer'),
        })
    ).min(1, 'At least one item is required'),
    reason: z.string().optional().default('production'),
    notes: z.string().optional(),
});

const instantInwardSchema = z.object({
    batchId: z.string().uuid('Invalid batch ID').optional(),
    skuId: z.string().uuid('Invalid SKU ID'),
    quantity: z.number().int().positive('Quantity must be a positive integer'),
});

const editInwardSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
    quantity: z.number().int().positive().optional(),
    notes: z.string().optional(),
});

const deleteInwardSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
    force: z.boolean().optional().default(false),
});

const undoInwardSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID'),
});

const adjustSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID'),
    adjustedQuantity: z.number().int().refine((val) => val !== 0, { message: 'Quantity cannot be zero' }),
    reason: z.string().min(1, 'Reason is required'),
    notes: z.string().optional(),
});

const deleteTransactionSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
    force: z.boolean().optional().default(false),
});

const allocateTransactionSchema = z.object({
    skuId: z.string().uuid('Invalid SKU ID'),
    quantity: z.number().int().positive('Quantity must be a positive integer'),
    reason: z.string().optional(),
});

const rtoInwardLineSchema = z.object({
    lineId: z.string().uuid('Invalid line ID'),
    condition: z.enum(['good', 'unopened', 'damaged', 'wrong_product']),
    notes: z.string().optional(),
});

// ============================================
// RESULT TYPES
// ============================================

export interface MutationResult<T> {
    success: boolean;
    data?: T;
    error?: {
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN';
        message: string;
    };
}

export interface InwardResult {
    transactionId: string;
    skuId: string;
    qty: number;
    newBalance: number;
    availableBalance: number;
}

export interface OutwardResult {
    transactionId: string;
    skuId: string;
    qty: number;
    newBalance: number;
    availableBalance: number;
}

export interface QuickInwardResult {
    transactions: Array<{
        skuId: string;
        qty: number;
        transactionId: string;
    }>;
    totalQty: number;
}

export interface InstantInwardResult {
    transactionId: string;
    skuId: string;
    skuCode: string;
    qty: number;
    newBalance: number;
    batchId?: string;
}

export interface EditInwardResult {
    transactionId: string;
    updated: boolean;
}

export interface DeleteInwardResult {
    transactionId: string;
    deleted: boolean;
    newBalance: number;
}

export interface UndoInwardResult {
    transactionId: string;
    skuId: string;
    qty: number;
    newBalance: number;
    revertedToQueue: boolean;
}

export interface AdjustResult {
    transactionId: string;
    skuId: string;
    adjustmentType: 'increase' | 'decrease';
    qty: number;
    newBalance: number;
}

export interface DeleteTransactionResult {
    transactionId: string;
    deleted: boolean;
    newBalance: number;
    message: string;
}

export interface AllocateTransactionResult {
    transactionId: string;
    skuId: string;
    qty: number;
    newBalance: number;
}

export interface RtoInwardLineResult {
    lineId: string;
    transactionId: string;
    skuId: string;
    qty: number;
    condition: string;
    newBalance: number;
}

// ============================================
// CONSTANTS
// ============================================

const TXN_TYPE = {
    INWARD: 'inward',
    OUTWARD: 'outward',
} as const;

const TXN_REASON = {
    ORDER_ALLOCATION: 'order_allocation',
    PRODUCTION: 'production',
    RTO_RECEIVED: 'rto_received',
    ADJUSTMENT: 'adjustment',
} as const;

// ============================================
// PRISMA HELPER
// ============================================

interface PrismaGlobal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClientType = any;

async function getPrisma(): Promise<PrismaClientType> {
    const { PrismaClient } = await import('@prisma/client');
    const globalForPrisma = globalThis as unknown as PrismaGlobal;
    const prisma = globalForPrisma.prisma ?? new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = prisma;
    }
    return prisma;
}

// ============================================
// BALANCE CALCULATION HELPER
// ============================================

async function calculateInventoryBalance(
    prisma: PrismaClientType,
    skuId: string
): Promise<{ currentBalance: number; availableBalance: number; totalInward: number; totalOutward: number }> {
    const aggregations = await prisma.inventoryTransaction.groupBy({
        by: ['txnType'],
        where: { skuId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;

    for (const agg of aggregations) {
        if (agg.txnType === 'inward') {
            totalInward = agg._sum.qty || 0;
        } else if (agg.txnType === 'outward') {
            totalOutward = agg._sum.qty || 0;
        }
    }

    const currentBalance = totalInward - totalOutward;
    return {
        currentBalance,
        availableBalance: currentBalance, // Same as current (no reserved type)
        totalInward,
        totalOutward,
    };
}

// ============================================
// SSE BROADCAST HELPER
// ============================================

interface InventoryUpdateEvent {
    type: string;
    skuId?: string;
    changes?: Record<string, unknown>;
}

async function broadcastUpdate(event: InventoryUpdateEvent): Promise<void> {
    try {
        const baseUrl = process.env.VITE_API_URL || 'http://localhost:3001';
        await fetch(`${baseUrl}/api/internal/sse-broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, excludeUserId: null }),
        }).catch(() => {
            console.log('[Server Function] SSE broadcast failed (non-critical)');
        });
    } catch {
        // Silently fail
    }
}

// ============================================
// CACHE INVALIDATION HELPER
// ============================================

async function invalidateCache(skuIds: string[]): Promise<void> {
    try {
        // Import dynamically to avoid bundling server code
        const { inventoryBalanceCache } = await import('../../../../server/src/services/inventoryBalanceCache.js');
        inventoryBalanceCache.invalidate(skuIds);
    } catch {
        // Cache invalidation is best-effort in Server Functions
        // The Express server's tRPC endpoints will still work with fresh data
        console.log('[Server Function] Cache invalidation skipped (server module not available)');
    }
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Create inward transaction (add stock)
 */
export const inward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => inwardSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<InwardResult>> => {
        const prisma = await getPrisma();
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = data;

        // Validate SKU exists and is active
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'SKU not found' },
            };
        }

        if (!sku.isActive) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot add inventory to inactive SKU' },
            };
        }

        // Build enhanced notes for audit trail
        let auditNotes = notes || '';
        if (reason === 'adjustment') {
            const timestamp = new Date().toISOString();
            auditNotes = `[MANUAL ADJUSTMENT by ${context.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
        }

        const transaction = await prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.INWARD,
                qty,
                reason,
                referenceId: referenceId || null,
                notes: auditNotes || null,
                warehouseLocation: warehouseLocation || null,
                createdById: context.user.id,
            },
        });

        await invalidateCache([skuId]);

        const balance = await calculateInventoryBalance(prisma, skuId);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId,
            changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
        });

        return {
            success: true,
            data: {
                transactionId: transaction.id,
                skuId,
                qty,
                newBalance: balance.currentBalance,
                availableBalance: balance.availableBalance,
            },
        };
    });

/**
 * Create outward transaction (remove stock)
 */
export const outward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => outwardSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<OutwardResult>> => {
        const prisma = await getPrisma();
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'SKU not found' },
            };
        }

        // Check balance
        const currentBalance = await calculateInventoryBalance(prisma, skuId);

        if (currentBalance.currentBalance < 0) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Cannot create outward: inventory balance is already negative. Please reconcile inventory first.',
                },
            };
        }

        if (currentBalance.availableBalance < qty) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Insufficient stock: available ${currentBalance.availableBalance}, requested ${qty}`,
                },
            };
        }

        // Build enhanced notes for audit trail
        let auditNotes = notes || '';
        if (reason === 'adjustment' || reason === 'damage') {
            const timestamp = new Date().toISOString();
            auditNotes = `[MANUAL ${reason.toUpperCase()} by ${context.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
        }

        const transaction = await prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty,
                reason,
                referenceId: referenceId || null,
                notes: auditNotes || null,
                warehouseLocation: warehouseLocation || null,
                createdById: context.user.id,
            },
        });

        await invalidateCache([skuId]);

        const newBalance = await calculateInventoryBalance(prisma, skuId);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId,
            changes: { availableBalance: newBalance.availableBalance, currentBalance: newBalance.currentBalance },
        });

        return {
            success: true,
            data: {
                transactionId: transaction.id,
                skuId,
                qty,
                newBalance: newBalance.currentBalance,
                availableBalance: newBalance.availableBalance,
            },
        };
    });

/**
 * Quick inward for multiple SKUs (batch operation)
 */
export const quickInward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => quickInwardSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<QuickInwardResult>> => {
        const prisma = await getPrisma();
        const { items, reason, notes } = data;

        // Validate all SKUs exist
        const skuIds = items.map(item => item.skuId);
        const skus = await prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: { id: true, skuCode: true, isActive: true },
        });

        const foundSkuIds = new Set(skus.map((s: { id: string }) => s.id));
        const missingSkuIds = skuIds.filter(id => !foundSkuIds.has(id));

        if (missingSkuIds.length > 0) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: `SKUs not found: ${missingSkuIds.join(', ')}` },
            };
        }

        // Create transactions in batch
        const transactions: Array<{ skuId: string; qty: number; transactionId: string }> = [];

        await prisma.$transaction(async (tx: PrismaClientType) => {
            for (const item of items) {
                const txn = await tx.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        txnType: TXN_TYPE.INWARD,
                        qty: item.qty,
                        reason,
                        notes: notes || null,
                        createdById: context.user.id,
                    },
                });
                transactions.push({
                    skuId: item.skuId,
                    qty: item.qty,
                    transactionId: txn.id,
                });
            }
        });

        await invalidateCache(skuIds);

        // Broadcast update for each SKU
        for (const skuId of skuIds) {
            broadcastUpdate({
                type: 'inventory_updated',
                skuId,
                changes: {},
            });
        }

        return {
            success: true,
            data: {
                transactions,
                totalQty: items.reduce((sum, item) => sum + item.qty, 0),
            },
        };
    });

/**
 * Instant inward - single unit inward from production batch
 */
export const instantInward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => instantInwardSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<InstantInwardResult>> => {
        const prisma = await getPrisma();
        const { batchId, skuId, quantity } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
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

        if (!sku) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'SKU not found' },
            };
        }

        // If batch provided, validate it
        if (batchId) {
            const batch = await prisma.productionBatch.findUnique({
                where: { id: batchId },
                select: { id: true, skuId: true, status: true },
            });

            if (!batch) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Production batch not found' },
                };
            }

            if (batch.skuId !== skuId) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'SKU does not match production batch' },
                };
            }
        }

        const result = await prisma.$transaction(async (tx: PrismaClientType) => {
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: quantity,
                    reason: TXN_REASON.PRODUCTION,
                    referenceId: batchId || null,
                    createdById: context.user.id,
                },
            });

            const balance = await calculateInventoryBalance(tx, skuId);

            return { transaction, balance };
        });

        await invalidateCache([skuId]);

        return {
            success: true,
            data: {
                transactionId: result.transaction.id,
                skuId,
                skuCode: sku.skuCode,
                qty: quantity,
                newBalance: result.balance.currentBalance,
                ...(batchId && { batchId }),
            },
        };
    });

/**
 * Edit inward transaction
 */
export const editInward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => editInwardSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<EditInwardResult>> => {
        const prisma = await getPrisma();
        const { transactionId, quantity, notes } = data;

        const existing = await prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
        });

        if (!existing) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Transaction not found' },
            };
        }

        if (existing.txnType !== 'inward') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Can only edit inward transactions' },
            };
        }

        await prisma.inventoryTransaction.update({
            where: { id: transactionId },
            data: {
                qty: quantity !== undefined ? quantity : existing.qty,
                notes: notes !== undefined ? notes : existing.notes,
            },
        });

        await invalidateCache([existing.skuId]);

        if (quantity !== undefined && quantity !== existing.qty) {
            const balance = await calculateInventoryBalance(prisma, existing.skuId);
            broadcastUpdate({
                type: 'inventory_updated',
                skuId: existing.skuId,
                changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
            });
        }

        return {
            success: true,
            data: {
                transactionId,
                updated: true,
            },
        };
    });

/**
 * Delete inward transaction
 */
export const deleteInward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteInwardSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<DeleteInwardResult>> => {
        const prisma = await getPrisma();
        const { transactionId, force } = data;

        const existing = await prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        if (!existing) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Transaction not found' },
            };
        }

        if (existing.txnType !== 'inward') {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Can only delete inward transactions' },
            };
        }

        // Check for dependencies (production batch, etc.)
        if (existing.reason === TXN_REASON.PRODUCTION && existing.referenceId) {
            const batch = await prisma.productionBatch.findUnique({
                where: { id: existing.referenceId },
            });

            if (batch && batch.status === 'completed' && !force) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST',
                        message: 'Cannot delete: transaction linked to completed production batch. Use force=true to override.',
                    },
                };
            }
        }

        // Check if admin for force delete
        if (force && context.user.role !== 'admin') {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Force delete requires admin role' },
            };
        }

        await prisma.inventoryTransaction.delete({ where: { id: transactionId } });

        await invalidateCache([existing.skuId]);

        const balance = await calculateInventoryBalance(prisma, existing.skuId);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId: existing.skuId,
            changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
        });

        return {
            success: true,
            data: {
                transactionId,
                deleted: true,
                newBalance: balance.currentBalance,
            },
        };
    });

/**
 * Undo most recent inward for SKU (24-hour window)
 */
export const undoInward = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => undoInwardSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UndoInwardResult>> => {
        const prisma = await getPrisma();
        const { skuId } = data;

        // Find most recent inward transaction for this SKU
        const transaction = await prisma.inventoryTransaction.findFirst({
            where: {
                skuId,
                txnType: TXN_TYPE.INWARD,
            },
            orderBy: { createdAt: 'desc' },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        if (!transaction) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'No inward transaction found for this SKU' },
            };
        }

        // Check 24-hour window
        const hoursSinceCreated = (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreated > 24) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Transaction is too old to undo (${Math.round(hoursSinceCreated)} hours ago, max 24 hours)`,
                },
            };
        }

        // Handle return_receipt reversion
        let revertedQueueItem = false;
        if (transaction.reason === 'return_receipt' && transaction.referenceId) {
            const queueItem = await prisma.repackingQueueItem.findUnique({
                where: { id: transaction.referenceId },
            });

            if (queueItem && queueItem.status === 'ready') {
                await prisma.repackingQueueItem.update({
                    where: { id: transaction.referenceId },
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

        await prisma.inventoryTransaction.delete({ where: { id: transaction.id } });

        await invalidateCache([skuId]);

        const balance = await calculateInventoryBalance(prisma, skuId);

        return {
            success: true,
            data: {
                transactionId: transaction.id,
                skuId,
                qty: transaction.qty,
                newBalance: balance.currentBalance,
                revertedToQueue: revertedQueueItem,
            },
        };
    });

/**
 * Adjust inventory (positive or negative)
 */
export const adjust = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => adjustSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AdjustResult>> => {
        const prisma = await getPrisma();
        const { skuId, adjustedQuantity, reason, notes } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'SKU not found' },
            };
        }

        const txnType = adjustedQuantity > 0 ? TXN_TYPE.INWARD : TXN_TYPE.OUTWARD;
        const absQuantity = Math.abs(adjustedQuantity);

        // Check balance for outward adjustments
        if (txnType === TXN_TYPE.OUTWARD) {
            const currentBalance = await calculateInventoryBalance(prisma, skuId);

            if (currentBalance.availableBalance < absQuantity) {
                return {
                    success: false,
                    error: {
                        code: 'BAD_REQUEST',
                        message: `Insufficient stock for adjustment: available=${currentBalance.availableBalance}, requested=${absQuantity}`,
                    },
                };
            }
        }

        const transaction = await prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType,
                qty: absQuantity,
                reason: TXN_REASON.ADJUSTMENT,
                notes: notes ? `${reason}: ${notes}` : reason,
                createdById: context.user.id,
            },
        });

        await invalidateCache([skuId]);

        const balance = await calculateInventoryBalance(prisma, skuId);

        return {
            success: true,
            data: {
                transactionId: transaction.id,
                skuId,
                adjustmentType: txnType === TXN_TYPE.INWARD ? 'increase' : 'decrease',
                qty: absQuantity,
                newBalance: balance.currentBalance,
            },
        };
    });

/**
 * Delete any transaction (admin only with full side effect handling)
 */
export const deleteTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => deleteTransactionSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<DeleteTransactionResult>> => {
        const prisma = await getPrisma();
        const { transactionId, force } = data;

        // Admin check
        if (context.user.role !== 'admin') {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin role required' },
            };
        }

        const existing = await prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
            },
        });

        if (!existing) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Transaction not found' },
            };
        }

        let message = 'Transaction deleted';

        // Handle production transaction reversion
        if ((existing.reason === TXN_REASON.PRODUCTION || existing.reason === 'production_custom') && existing.referenceId) {
            const productionBatch = await prisma.productionBatch.findUnique({
                where: { id: existing.referenceId },
                include: { sku: { include: { variation: true } } },
            });

            if (productionBatch && (productionBatch.status === 'completed' || productionBatch.status === 'in_progress')) {
                if (!force) {
                    return {
                        success: false,
                        error: {
                            code: 'BAD_REQUEST',
                            message: 'Transaction linked to production batch. Use force=true to override and revert batch.',
                        },
                    };
                }

                // Revert production batch
                const newQtyCompleted = Math.max(0, productionBatch.qtyCompleted - existing.qty);
                const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';

                await prisma.productionBatch.update({
                    where: { id: existing.referenceId },
                    data: {
                        qtyCompleted: newQtyCompleted,
                        status: newStatus,
                        completedAt: null,
                    },
                });

                // Delete fabric outward if exists
                await prisma.fabricTransaction.deleteMany({
                    where: {
                        referenceId: existing.referenceId,
                        reason: TXN_REASON.PRODUCTION,
                        txnType: 'outward',
                    },
                });

                message = 'Transaction deleted, production batch reverted';
            }
        }

        // Handle return_receipt reversion
        if (existing.reason === 'return_receipt' && existing.referenceId) {
            const queueItem = await prisma.repackingQueueItem.findUnique({
                where: { id: existing.referenceId },
            });

            if (queueItem && queueItem.status === 'ready') {
                await prisma.repackingQueueItem.update({
                    where: { id: existing.referenceId },
                    data: {
                        status: 'pending',
                        qcComments: null,
                        processedAt: null,
                        processedById: null,
                    },
                });
                message = 'Transaction deleted and item returned to QC queue';
            }
        }

        await prisma.inventoryTransaction.delete({ where: { id: transactionId } });

        await invalidateCache([existing.skuId]);

        const balance = await calculateInventoryBalance(prisma, existing.skuId);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId: existing.skuId,
            changes: { availableBalance: balance.availableBalance, currentBalance: balance.currentBalance },
        });

        return {
            success: true,
            data: {
                transactionId,
                deleted: true,
                newBalance: balance.currentBalance,
                message,
            },
        };
    });

/**
 * Manual allocation (create outward/reserved)
 */
export const allocateTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => allocateTransactionSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AllocateTransactionResult>> => {
        const prisma = await getPrisma();
        const { skuId, quantity, reason } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'SKU not found' },
            };
        }

        // Check balance
        const currentBalance = await calculateInventoryBalance(prisma, skuId);

        if (currentBalance.availableBalance < quantity) {
            return {
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: `Insufficient stock for allocation: available=${currentBalance.availableBalance}, requested=${quantity}`,
                },
            };
        }

        // Create outward transaction (allocation creates outward directly)
        const transaction = await prisma.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty: quantity,
                reason: reason || TXN_REASON.ORDER_ALLOCATION,
                createdById: context.user.id,
            },
        });

        await invalidateCache([skuId]);

        const newBalance = await calculateInventoryBalance(prisma, skuId);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId,
            changes: { availableBalance: newBalance.availableBalance, currentBalance: newBalance.currentBalance },
        });

        return {
            success: true,
            data: {
                transactionId: transaction.id,
                skuId,
                qty: quantity,
                newBalance: newBalance.currentBalance,
            },
        };
    });

/**
 * RTO return to stock (create inward from RTO line)
 */
export const rtoInwardLine = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => rtoInwardLineSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<RtoInwardLineResult>> => {
        const prisma = await getPrisma();
        const { lineId, condition, notes } = data;

        // Fetch order line
        const line = await prisma.orderLine.findUnique({
            where: { id: lineId },
            select: {
                id: true,
                skuId: true,
                qty: true,
                rtoInitiatedAt: true,
                rtoReceivedAt: true,
                rtoCondition: true,
            },
        });

        if (!line) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Order line not found' },
            };
        }

        // Validate RTO was initiated
        if (!line.rtoInitiatedAt) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'RTO has not been initiated for this line' },
            };
        }

        // Check if already received (idempotent)
        if (line.rtoReceivedAt && line.rtoCondition) {
            // Check if inward already exists
            const existingInward = await prisma.inventoryTransaction.findFirst({
                where: {
                    referenceId: lineId,
                    reason: TXN_REASON.RTO_RECEIVED,
                    txnType: TXN_TYPE.INWARD,
                },
            });

            if (existingInward) {
                const balance = await calculateInventoryBalance(prisma, line.skuId);
                return {
                    success: true,
                    data: {
                        lineId,
                        transactionId: existingInward.id,
                        skuId: line.skuId,
                        qty: line.qty,
                        condition: line.rtoCondition,
                        newBalance: balance.currentBalance,
                    },
                };
            }
        }

        const now = new Date();

        const result = await prisma.$transaction(async (tx: PrismaClientType) => {
            // Update order line
            await tx.orderLine.update({
                where: { id: lineId },
                data: {
                    rtoReceivedAt: now,
                    rtoCondition: condition,
                    rtoNotes: notes || null,
                    trackingStatus: 'rto_delivered',
                },
            });

            // Create inventory inward
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    skuId: line.skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: line.qty,
                    reason: TXN_REASON.RTO_RECEIVED,
                    referenceId: lineId,
                    notes: `RTO received - condition: ${condition}${notes ? ' | ' + notes : ''}`,
                    createdById: context.user.id,
                },
            });

            const balance = await calculateInventoryBalance(tx, line.skuId);

            return { transaction, balance };
        });

        await invalidateCache([line.skuId]);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId: line.skuId,
            changes: {
                availableBalance: result.balance.availableBalance,
                currentBalance: result.balance.currentBalance,
            },
        });

        return {
            success: true,
            data: {
                lineId,
                transactionId: result.transaction.id,
                skuId: line.skuId,
                qty: line.qty,
                condition,
                newBalance: result.balance.currentBalance,
            },
        };
    });
