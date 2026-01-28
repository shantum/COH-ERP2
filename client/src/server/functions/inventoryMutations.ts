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
import { getPrisma, type PrismaTransaction } from '@coh/shared/services/db';

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

const instantInwardBySkuCodeSchema = z.object({
    skuCode: z.string().min(1, 'SKU code is required'),
});

const quickInwardBySkuCodeSchema = z.object({
    skuCode: z.string().min(1, 'SKU code is required'),
    qty: z.number().int().positive('Quantity must be a positive integer'),
    reason: z.string().optional().default('production'),
    notes: z.string().optional(),
});

const getTransactionMatchesSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
});

const allocateTransactionFnSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
    allocationType: z.enum(['production', 'rto', 'adjustment']),
    allocationId: z.string().uuid('Invalid allocation ID').optional(),
    rtoCondition: z.enum(['good', 'unopened', 'damaged', 'wrong_product']).optional(),
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

export interface InstantInwardBySkuCodeResult {
    transactionId: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    newBalance: number;
}

export interface QuickInwardBySkuCodeResult {
    transactionId: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    newBalance: number;
}

export interface TransactionMatch {
    type: 'production' | 'rto';
    id: string;
    label: string;
    detail: string;
    date?: Date | string | null;
    pending?: number;
    orderId?: string;
    atWarehouse?: boolean;
}

export interface TransactionMatchesResult {
    transactionId: string;
    skuCode: string;
    isAllocated: boolean;
    currentAllocation: {
        type: string;
        referenceId: string | null;
    } | null;
    matches: TransactionMatch[];
}

export interface AssignSourceResult {
    type: string;
    referenceId: string | null;
    condition?: string;
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
// BALANCE CALCULATION HELPER
// ============================================

async function calculateInventoryBalance(
    prisma: PrismaTransaction,
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
        const { inventoryBalanceCache } = await import('@coh/shared/services/inventory');
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

        await prisma.$transaction(async (tx: PrismaTransaction) => {
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

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
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

        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
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

/**
 * Instant inward by SKU code - ultra-fast scan workflow
 *
 * Looks up SKU by code and creates +1 inward transaction.
 * Transaction is marked as 'received' (unallocated) and can be
 * linked to a source later via allocateTransactionFn.
 */
export const instantInwardBySkuCode = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => instantInwardBySkuCodeSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<InstantInwardBySkuCodeResult>> => {
        const prisma = await getPrisma();
        const { skuCode } = data;

        // Find SKU by code - minimal query for speed
        const sku = await prisma.sku.findFirst({
            where: { skuCode },
            select: {
                id: true,
                skuCode: true,
                size: true,
                isActive: true,
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
                error: { code: 'NOT_FOUND', message: `SKU not found: ${skuCode}` },
            };
        }

        if (!sku.isActive) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot inward to inactive SKU' },
            };
        }

        // Create transaction and calculate balance in single DB transaction
        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    skuId: sku.id,
                    txnType: TXN_TYPE.INWARD,
                    qty: 1,
                    reason: 'received', // Unallocated - can be linked to source later
                    createdById: context.user.id,
                },
            });

            const balance = await calculateInventoryBalance(tx, sku.id);
            return { transaction, balance };
        });

        await invalidateCache([sku.id]);

        return {
            success: true,
            data: {
                transactionId: result.transaction.id,
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: 1,
                newBalance: result.balance.currentBalance,
            },
        };
    });

/**
 * Get transaction matches for allocation dropdown
 *
 * Returns available production batches and RTO orders that can
 * be linked to an unallocated inward transaction.
 */
export const getTransactionMatches = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getTransactionMatchesSchema.parse(input))
    .handler(async ({ data }): Promise<TransactionMatchesResult> => {
        const prisma = await getPrisma();
        const { transactionId } = data;

        // Get transaction with SKU info
        const transaction = await prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
            select: {
                id: true,
                skuId: true,
                reason: true,
                referenceId: true,
                sku: { select: { skuCode: true } },
            },
        });

        if (!transaction) {
            throw new Error('Transaction not found');
        }

        const isAllocated = transaction.reason !== 'received';
        const currentAllocation = isAllocated
            ? { type: transaction.reason || '', referenceId: transaction.referenceId }
            : null;

        // Find available matches for this SKU
        const [productionBatches, rtoLines] = await Promise.all([
            // Production batches with pending quantity
            prisma.productionBatch.findMany({
                where: {
                    skuId: transaction.skuId,
                    status: { in: ['planned', 'in_progress'] },
                },
                select: {
                    id: true,
                    batchCode: true,
                    batchDate: true,
                    qtyPlanned: true,
                    qtyCompleted: true,
                },
                orderBy: { batchDate: 'asc' },
                take: 5,
            }),

            // RTO order lines pending processing
            prisma.orderLine.findMany({
                where: {
                    skuId: transaction.skuId,
                    rtoCondition: null,
                    trackingStatus: { in: ['rto_in_transit', 'rto_delivered'] },
                    order: { isArchived: false },
                },
                select: {
                    id: true,
                    qty: true,
                    trackingStatus: true,
                    rtoInitiatedAt: true,
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true,
                        },
                    },
                },
                take: 5,
            }),
        ]);

        const matches: TransactionMatch[] = [];

        // Add production batch matches
        for (const batch of productionBatches) {
            const pending = batch.qtyPlanned - (batch.qtyCompleted || 0);
            if (pending > 0) {
                matches.push({
                    type: 'production',
                    id: batch.id,
                    label: batch.batchCode || `Batch ${batch.id.slice(0, 8)}`,
                    detail: `${batch.qtyCompleted || 0}/${batch.qtyPlanned} completed`,
                    date: batch.batchDate,
                    pending,
                });
            }
        }

        // Add RTO matches
        for (const line of rtoLines) {
            matches.push({
                type: 'rto',
                id: line.id,
                orderId: line.order.id,
                label: `RTO #${line.order.orderNumber}`,
                detail: line.order.customerName || '',
                date: line.rtoInitiatedAt,
                atWarehouse: line.trackingStatus === 'rto_delivered',
            });
        }

        return {
            transactionId,
            skuCode: transaction.sku?.skuCode || '',
            isAllocated,
            currentAllocation,
            matches,
        };
    });

/**
 * Allocate transaction to a source
 *
 * Links an inward transaction to a production batch, RTO order,
 * or marks it as a manual adjustment.
 */
export const allocateTransactionFn = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => allocateTransactionFnSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AssignSourceResult>> => {
        const prisma = await getPrisma();
        const { transactionId, allocationType, allocationId, rtoCondition } = data;

        // Get transaction
        const transaction = await prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
            include: {
                sku: {
                    include: { variation: { include: { product: true } } },
                },
            },
        });

        if (!transaction) {
            return {
                success: false,
                error: { code: 'NOT_FOUND', message: 'Transaction not found' },
            };
        }

        // Track previous allocation for reversion
        const previousAllocation =
            transaction.reason !== 'received'
                ? { type: transaction.reason || '', referenceId: transaction.referenceId }
                : null;

        // Handle allocation based on type
        if (allocationType === 'production') {
            if (!allocationId) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'allocationId (batchId) is required for production allocation' },
                };
            }

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Revert previous production allocation
                if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                    const prevBatch = await tx.productionBatch.findUnique({
                        where: { id: previousAllocation.referenceId },
                    });
                    if (prevBatch) {
                        const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                        const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                        await tx.productionBatch.update({
                            where: { id: previousAllocation.referenceId },
                            data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null },
                        });
                    }
                }

                // Revert previous RTO allocation
                if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                    await tx.orderLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { rtoCondition: null, rtoInwardedAt: null, rtoInwardedById: null, rtoReceivedAt: null },
                    });
                }

                // Update transaction
                await tx.inventoryTransaction.update({
                    where: { id: transactionId },
                    data: { reason: 'production', referenceId: allocationId },
                });

                // Update production batch
                const batch = await tx.productionBatch.findUnique({
                    where: { id: allocationId },
                });

                if (!batch) {
                    throw new Error('Production batch not found');
                }

                if (batch.skuId !== transaction.skuId) {
                    throw new Error('Batch SKU does not match transaction SKU');
                }

                const newCompleted = Math.min(batch.qtyCompleted + transaction.qty, batch.qtyPlanned);
                const isComplete = newCompleted >= batch.qtyPlanned;

                await tx.productionBatch.update({
                    where: { id: allocationId },
                    data: {
                        qtyCompleted: newCompleted,
                        status: isComplete ? 'completed' : 'in_progress',
                        completedAt: isComplete ? new Date() : null,
                    },
                });
            });

            await invalidateCache([transaction.skuId]);

            return {
                success: true,
                data: { type: 'production', referenceId: allocationId },
            };

        } else if (allocationType === 'rto') {
            if (!allocationId) {
                return {
                    success: false,
                    error: { code: 'BAD_REQUEST', message: 'allocationId (lineId) is required for RTO allocation' },
                };
            }

            const condition = rtoCondition || 'good';

            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Revert previous allocations
                if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                    const prevBatch = await tx.productionBatch.findUnique({
                        where: { id: previousAllocation.referenceId },
                    });
                    if (prevBatch) {
                        const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                        const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                        await tx.productionBatch.update({
                            where: { id: previousAllocation.referenceId },
                            data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null },
                        });
                    }
                }

                // Get order line
                const orderLine = await tx.orderLine.findUnique({
                    where: { id: allocationId },
                    include: { order: { select: { id: true, orderNumber: true } } },
                });

                if (!orderLine) {
                    throw new Error('Order line not found');
                }

                if (orderLine.skuId !== transaction.skuId) {
                    throw new Error('Order line SKU does not match transaction SKU');
                }

                if (orderLine.rtoCondition) {
                    throw new Error('RTO line already processed');
                }

                // For damaged/wrong_product, delete inward and create write-off
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
                            createdById: context.user.id,
                        },
                    });

                    await tx.sku.update({
                        where: { id: transaction.skuId },
                        data: { writeOffCount: { increment: transaction.qty } },
                    });
                } else {
                    // For good/unopened, just update the transaction
                    await tx.inventoryTransaction.update({
                        where: { id: transactionId },
                        data: {
                            reason: 'rto_received',
                            referenceId: allocationId,
                            notes: `RTO from order ${orderLine.order.orderNumber}`,
                        },
                    });
                }

                // Mark order line as processed
                await tx.orderLine.update({
                    where: { id: allocationId },
                    data: {
                        rtoCondition: condition,
                        rtoInwardedAt: new Date(),
                        rtoInwardedById: context.user.id,
                    },
                });

                // Check if all lines processed
                const allLines = await tx.orderLine.findMany({
                    where: { orderId: orderLine.orderId },
                    select: { rtoCondition: true },
                });
                const allProcessed = allLines.every((l: { rtoCondition: string | null }) => l.rtoCondition !== null);

                if (allProcessed) {
                    const now = new Date();
                    await tx.orderLine.updateMany({
                        where: { orderId: orderLine.orderId, rtoReceivedAt: null },
                        data: { rtoReceivedAt: now },
                    });
                }
            });

            await invalidateCache([transaction.skuId]);

            return {
                success: true,
                data: { type: 'rto', referenceId: allocationId, condition },
            };

        } else {
            // adjustment - revert previous allocation if needed
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Revert previous production allocation
                if (previousAllocation?.type === 'production' && previousAllocation.referenceId) {
                    const prevBatch = await tx.productionBatch.findUnique({
                        where: { id: previousAllocation.referenceId },
                    });
                    if (prevBatch) {
                        const newQtyCompleted = Math.max(0, prevBatch.qtyCompleted - transaction.qty);
                        const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';
                        await tx.productionBatch.update({
                            where: { id: previousAllocation.referenceId },
                            data: { qtyCompleted: newQtyCompleted, status: newStatus, completedAt: null },
                        });
                    }
                }

                // Revert previous RTO allocation
                if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                    await tx.orderLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { rtoCondition: null, rtoInwardedAt: null, rtoInwardedById: null, rtoReceivedAt: null },
                    });
                }

                await tx.inventoryTransaction.update({
                    where: { id: transactionId },
                    data: { reason: 'adjustment', referenceId: null },
                });
            });

            await invalidateCache([transaction.skuId]);

            return {
                success: true,
                data: { type: 'adjustment', referenceId: null },
            };
        }
    });

// ============================================
// UNDO TRANSACTION (By ID)
// ============================================

const undoTransactionSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
});

export interface UndoTransactionResult {
    transactionId: string;
    skuId: string;
    qty: number;
    newBalance: number;
}

/**
 * Undo a specific transaction by ID
 *
 * Deletes the transaction and recalculates balance.
 * Used by RecentInwardsTable for undo functionality.
 * Validates that the transaction is recent (24 hours).
 */
export const undoTransaction = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => undoTransactionSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UndoTransactionResult>> => {
        const prisma = await getPrisma();
        const { transactionId } = data;

        // Find transaction
        const transaction = await prisma.inventoryTransaction.findUnique({
            where: { id: transactionId },
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
                error: { code: 'NOT_FOUND', message: 'Transaction not found' },
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
            }
        }

        await prisma.inventoryTransaction.delete({ where: { id: transactionId } });

        await invalidateCache([transaction.skuId]);

        const balance = await calculateInventoryBalance(prisma, transaction.skuId);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId: transaction.skuId,
            changes: {
                availableBalance: balance.availableBalance,
                currentBalance: balance.currentBalance,
            },
        });

        return {
            success: true,
            data: {
                transactionId,
                skuId: transaction.skuId,
                qty: transaction.qty,
                newBalance: balance.currentBalance,
            },
        };
    });

/**
 * Quick inward by SKU code - fast scan workflow with custom quantity
 *
 * Looks up SKU by code and creates inward transaction with specified quantity.
 * Used by Production Inward and Adjustments Inward components.
 */
export const quickInwardBySkuCode = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => quickInwardBySkuCodeSchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<QuickInwardBySkuCodeResult>> => {
        const prisma = await getPrisma();
        const { skuCode, qty, reason, notes } = data;

        // Find SKU by code
        const sku = await prisma.sku.findFirst({
            where: { skuCode },
            select: {
                id: true,
                skuCode: true,
                size: true,
                isActive: true,
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
                error: { code: 'NOT_FOUND', message: `SKU not found: ${skuCode}` },
            };
        }

        if (!sku.isActive) {
            return {
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Cannot inward to inactive SKU' },
            };
        }

        // Create transaction and calculate balance in single DB transaction
        const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    skuId: sku.id,
                    txnType: TXN_TYPE.INWARD,
                    qty,
                    reason: reason || 'production',
                    notes: notes || null,
                    createdById: context.user.id,
                },
            });

            const balance = await calculateInventoryBalance(tx, sku.id);
            return { transaction, balance };
        });

        await invalidateCache([sku.id]);

        broadcastUpdate({
            type: 'inventory_updated',
            skuId: sku.id,
            changes: {
                availableBalance: result.balance.availableBalance,
                currentBalance: result.balance.currentBalance,
            },
        });

        return {
            success: true,
            data: {
                transactionId: result.transaction.id,
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty,
                newBalance: result.balance.currentBalance,
            },
        };
    });
