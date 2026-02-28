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
import { getInternalApiBaseUrl } from '../utils';

// Dynamic import helper for the shared mutation service (prevents bundling server code into client)
async function getMutationService() {
    return import('@coh/shared/services/inventory/inventoryMutationService');
}

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

const outwardSchema = inwardSchema;

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
        code: 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL';
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

export type OutwardResult = InwardResult;

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
// SHARED SERVICE HELPERS
// ============================================

/**
 * Invalidate caches + broadcast SSE + push to Sheets for affected SKUs.
 * Delegates to the shared inventoryMutationService.
 */
async function postMutationInvalidate(
    skuIds: string[],
    balancesBySkuId?: Map<string, { currentBalance: number; availableBalance: number }>,
): Promise<void> {
    const { invalidateInventoryCaches } = await getMutationService();
    await invalidateInventoryCaches(skuIds, getInternalApiBaseUrl(), balancesBySkuId);
}

/**
 * Recalculate balance for a single SKU via shared service.
 */
async function recalcBalance(prisma: PrismaTransaction | Awaited<ReturnType<typeof getPrisma>>, skuId: string) {
    const { recalculateBalance } = await getMutationService();
    return recalculateBalance(prisma, skuId);
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
        const { createInwardTransaction } = await getMutationService();
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = data;

        // Validate SKU exists and is active
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return { success: false, error: { code: 'NOT_FOUND', message: 'SKU not found' } };
        }

        if (!sku.isActive) {
            return { success: false, error: { code: 'BAD_REQUEST', message: 'Cannot add inventory to inactive SKU' } };
        }

        // Build enhanced notes for audit trail
        let auditNotes = notes || '';
        if (reason === 'adjustment') {
            const timestamp = new Date().toISOString();
            auditNotes = `[MANUAL ADJUSTMENT by ${context.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
        }

        const txn = await createInwardTransaction(prisma, {
            skuId, qty, reason,
            referenceId: referenceId || null,
            notes: auditNotes || null,
            warehouseLocation: warehouseLocation || null,
            createdById: context.user.id,
        });

        const balance = await recalcBalance(prisma, skuId);
        await postMutationInvalidate([skuId], new Map([[skuId, balance]]));

        return {
            success: true,
            data: {
                transactionId: txn.id,
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
        const { createOutwardTransaction, InsufficientStockError, NegativeBalanceError } = await getMutationService();
        const { skuId, qty, reason, referenceId, notes, warehouseLocation, adjustmentReason } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return { success: false, error: { code: 'NOT_FOUND', message: 'SKU not found' } };
        }

        // Build enhanced notes for audit trail
        let auditNotes = notes || '';
        if (reason === 'adjustment' || reason === 'damage') {
            const timestamp = new Date().toISOString();
            auditNotes = `[MANUAL ${reason.toUpperCase()} by ${context.user.email} at ${timestamp}] ${adjustmentReason || ''} ${notes ? '| ' + notes : ''}`.trim();
        }

        // Atomic: balance check + create + recalculate inside transaction
        let result: Awaited<ReturnType<typeof createOutwardTransaction>>;
        try {
            result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                return createOutwardTransaction(tx, {
                    skuId, qty, reason,
                    referenceId: referenceId || null,
                    notes: auditNotes || null,
                    warehouseLocation: warehouseLocation || null,
                    createdById: context.user.id,
                });
            });
        } catch (error: unknown) {
            if (error instanceof InsufficientStockError || error instanceof NegativeBalanceError) {
                return { success: false, error: { code: 'BAD_REQUEST' as const, message: error.message } };
            }
            throw error;
        }

        await postMutationInvalidate([skuId], new Map([[skuId, result.balance]]));

        return {
            success: true,
            data: {
                transactionId: result.id,
                skuId,
                qty,
                newBalance: result.balance.currentBalance,
                availableBalance: result.balance.availableBalance,
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
        const { createInwardTransaction } = await getMutationService();
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
            return { success: false, error: { code: 'NOT_FOUND', message: `SKUs not found: ${missingSkuIds.join(', ')}` } };
        }

        // Create transactions in batch via shared service
        const transactions: Array<{ skuId: string; qty: number; transactionId: string }> = [];

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            for (const item of items) {
                const txn = await createInwardTransaction(tx, {
                    skuId: item.skuId,
                    qty: item.qty,
                    reason,
                    notes: notes || null,
                    createdById: context.user.id,
                });
                transactions.push({ skuId: item.skuId, qty: item.qty, transactionId: txn.id });
            }
        });

        await postMutationInvalidate(skuIds);

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
        const { createInwardTransaction } = await getMutationService();
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
            return { success: false, error: { code: 'NOT_FOUND', message: 'SKU not found' } };
        }

        // If batch provided, validate it
        if (batchId) {
            const batch = await prisma.productionBatch.findUnique({
                where: { id: batchId },
                select: { id: true, skuId: true, status: true },
            });

            if (!batch) {
                return { success: false, error: { code: 'NOT_FOUND', message: 'Production batch not found' } };
            }

            if (batch.skuId !== skuId) {
                return { success: false, error: { code: 'BAD_REQUEST', message: 'SKU does not match production batch' } };
            }
        }

        let txn: Awaited<ReturnType<typeof createInwardTransaction>>;
        let balance: { currentBalance: number; availableBalance: number };

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            txn = await createInwardTransaction(tx, {
                skuId,
                qty: quantity,
                reason: TXN_REASON.PRODUCTION,
                referenceId: batchId || null,
                createdById: context.user.id,
            });
            balance = await recalcBalance(tx, skuId);
        });

        await postMutationInvalidate([skuId], new Map([[skuId, balance!]]));

        return {
            success: true,
            data: {
                transactionId: txn!.id,
                skuId,
                skuCode: sku.skuCode,
                qty: quantity,
                newBalance: balance!.currentBalance,
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

        let skuId: string;
        let qtyChanged = false;

        try {
            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Read inside transaction to prevent TOCTOU race
                const existing = await tx.inventoryTransaction.findUnique({
                    where: { id: transactionId },
                });

                if (!existing) throw new Error('NOT_FOUND:Transaction not found');
                if (existing.txnType !== 'inward') throw new Error('BAD_REQUEST:Can only edit inward transactions');

                await tx.inventoryTransaction.update({
                    where: { id: transactionId },
                    data: {
                        qty: quantity !== undefined ? quantity : existing.qty,
                        notes: notes !== undefined ? notes : existing.notes,
                    },
                });

                return { skuId: existing.skuId, qtyChanged: quantity !== undefined && quantity !== existing.qty };
            });

            skuId = result.skuId;
            qtyChanged = result.qtyChanged;
        } catch (error: unknown) {
            console.error('[inventory] editInward failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL', message: msg as string } };
        }

        if (qtyChanged) {
            const balance = await recalcBalance(prisma, skuId);
            await postMutationInvalidate([skuId], new Map([[skuId, balance]]));
        } else {
            await postMutationInvalidate([skuId]);
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

        // Check admin for force delete before transaction (reads auth context, not DB)
        if (force && context.user.role !== 'admin') {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Force delete requires admin role' },
            };
        }

        let skuId: string;
        try {
            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Read inside transaction to prevent TOCTOU race
                const existing = await tx.inventoryTransaction.findUnique({
                    where: { id: transactionId },
                });

                if (!existing) throw new Error('NOT_FOUND:Transaction not found');
                if (existing.txnType !== 'inward') throw new Error('BAD_REQUEST:Can only delete inward transactions');

                // Check for dependencies (production batch, etc.)
                if (existing.reason === TXN_REASON.PRODUCTION && existing.referenceId) {
                    const batch = await tx.productionBatch.findUnique({
                        where: { id: existing.referenceId },
                    });

                    if (batch && batch.status === 'completed' && !force) {
                        throw new Error('BAD_REQUEST:Cannot delete: transaction linked to completed production batch. Use force=true to override.');
                    }
                }

                await tx.inventoryTransaction.delete({ where: { id: transactionId } });
                return { skuId: existing.skuId };
            });
            skuId = result.skuId;
        } catch (error: unknown) {
            console.error('[inventory] deleteInward failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL', message: msg as string } };
        }

        const balance = await recalcBalance(prisma, skuId);
        await postMutationInvalidate([skuId], new Map([[skuId, balance]]));

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

        let txnId: string;
        let txnQty: number;
        let revertedQueueItem = false;

        try {
            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Find most recent inward transaction for this SKU
                const transaction = await tx.inventoryTransaction.findFirst({
                    where: {
                        skuId,
                        txnType: TXN_TYPE.INWARD,
                    },
                    orderBy: { createdAt: 'desc' },
                });

                if (!transaction) throw new Error('NOT_FOUND:No inward transaction found for this SKU');

                // Check 24-hour window
                const hoursSinceCreated = (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60);
                if (hoursSinceCreated > 24) {
                    throw new Error(`BAD_REQUEST:Transaction is too old to undo (${Math.round(hoursSinceCreated)} hours ago, max 24 hours)`);
                }

                // Handle return_receipt reversion
                let reverted = false;
                if (transaction.reason === 'return_receipt' && transaction.referenceId) {
                    const queueItem = await tx.repackingQueueItem.findUnique({
                        where: { id: transaction.referenceId },
                    });

                    if (queueItem && queueItem.status === 'ready') {
                        await tx.repackingQueueItem.update({
                            where: { id: transaction.referenceId },
                            data: {
                                status: 'pending',
                                qcComments: null,
                                processedAt: null,
                                processedById: null,
                            },
                        });
                        reverted = true;
                    }
                }

                await tx.inventoryTransaction.delete({ where: { id: transaction.id } });
                return { txnId: transaction.id, txnQty: transaction.qty, reverted };
            });

            txnId = result.txnId;
            txnQty = result.txnQty;
            revertedQueueItem = result.reverted;
        } catch (error: unknown) {
            console.error('[inventory] undoInward failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = message.includes(':') ? message.split(':', 2) : ['INTERNAL', message];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL', message: msg as string } };
        }

        const balance = await recalcBalance(prisma, skuId);
        await postMutationInvalidate([skuId], new Map([[skuId, balance]]));

        return {
            success: true,
            data: {
                transactionId: txnId,
                skuId,
                qty: txnQty,
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
        const { createInwardTransaction, createOutwardTransaction, InsufficientStockError } = await getMutationService();
        const { skuId, adjustedQuantity, reason, notes } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return { success: false, error: { code: 'NOT_FOUND', message: 'SKU not found' } };
        }

        const isInward = adjustedQuantity > 0;
        const absQuantity = Math.abs(adjustedQuantity);
        const adjustNotes = notes ? `${reason}: ${notes}` : reason;

        let transactionId: string;
        let newBalance: { currentBalance: number; availableBalance: number };

        try {
            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                if (isInward) {
                    const txn = await createInwardTransaction(tx, {
                        skuId, qty: absQuantity, reason: TXN_REASON.ADJUSTMENT,
                        notes: adjustNotes, createdById: context.user.id,
                    });
                    const bal = await recalcBalance(tx, skuId);
                    return { id: txn.id, balance: bal };
                } else {
                    const outResult = await createOutwardTransaction(tx, {
                        skuId, qty: absQuantity, reason: TXN_REASON.ADJUSTMENT,
                        notes: adjustNotes, createdById: context.user.id,
                    });
                    return { id: outResult.id, balance: outResult.balance };
                }
            });
            transactionId = result.id;
            newBalance = result.balance;
        } catch (error: unknown) {
            if (error instanceof InsufficientStockError) {
                return { success: false, error: { code: 'BAD_REQUEST' as const, message: `Insufficient stock for adjustment: available=${error.available}, requested=${error.requested}` } };
            }
            throw error;
        }

        await postMutationInvalidate([skuId], new Map([[skuId, newBalance]]));

        return {
            success: true,
            data: {
                transactionId,
                skuId,
                adjustmentType: isInward ? 'increase' : 'decrease',
                qty: absQuantity,
                newBalance: newBalance.currentBalance,
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

        // Admin check (stateless — no TOCTOU risk)
        if (context.user.role !== 'admin') {
            return {
                success: false,
                error: { code: 'FORBIDDEN', message: 'Admin role required' },
            };
        }

        let skuId: string;
        let message: string;

        try {
            const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                // Read inside transaction to prevent TOCTOU race
                const existing = await tx.inventoryTransaction.findUnique({
                    where: { id: transactionId },
                    include: {
                        sku: {
                            include: {
                                variation: { include: { product: true } },
                            },
                        },
                    },
                });

                if (!existing) throw new Error('NOT_FOUND:Transaction not found');

                let msg = 'Transaction deleted';

                // Handle production transaction reversion
                if ((existing.reason === TXN_REASON.PRODUCTION || existing.reason === 'production_custom') && existing.referenceId) {
                    const productionBatch = await tx.productionBatch.findUnique({
                        where: { id: existing.referenceId },
                        include: { sku: { include: { variation: true } } },
                    });

                    if (productionBatch && (productionBatch.status === 'completed' || productionBatch.status === 'in_progress')) {
                        if (!force) {
                            throw new Error('BAD_REQUEST:Transaction linked to production batch. Use force=true to override and revert batch.');
                        }

                        const newQtyCompleted = Math.max(0, productionBatch.qtyCompleted - existing.qty);
                        const newStatus = newQtyCompleted === 0 ? 'planned' : 'in_progress';

                        await tx.productionBatch.update({
                            where: { id: existing.referenceId },
                            data: {
                                qtyCompleted: newQtyCompleted,
                                status: newStatus,
                                completedAt: null,
                            },
                        });

                        msg = 'Transaction deleted, production batch reverted';
                    }
                }

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
                        msg = 'Transaction deleted and item returned to QC queue';
                    }
                }

                await tx.inventoryTransaction.delete({ where: { id: transactionId } });

                return { skuId: existing.skuId, message: msg };
            });

            skuId = result.skuId;
            message = result.message;
        } catch (error: unknown) {
            console.error('[inventory] deleteTransaction failed:', error);
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            const [code, msg] = errMsg.includes(':') ? errMsg.split(':', 2) : ['INTERNAL', errMsg];
            return { success: false, error: { code: code as 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL', message: msg as string } };
        }

        const balance = await recalcBalance(prisma, skuId);
        await postMutationInvalidate([skuId], new Map([[skuId, balance]]));

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
        const { createOutwardTransaction, InsufficientStockError, NegativeBalanceError } = await getMutationService();
        const { skuId, quantity, reason } = data;

        // Validate SKU exists
        const sku = await prisma.sku.findUnique({
            where: { id: skuId },
            select: { id: true, skuCode: true, isActive: true },
        });

        if (!sku) {
            return { success: false, error: { code: 'NOT_FOUND', message: 'SKU not found' } };
        }

        let result: Awaited<ReturnType<typeof createOutwardTransaction>>;
        try {
            result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                return createOutwardTransaction(tx, {
                    skuId, qty: quantity,
                    reason: reason || TXN_REASON.ORDER_ALLOCATION,
                    createdById: context.user.id,
                });
            });
        } catch (error: unknown) {
            if (error instanceof InsufficientStockError) {
                return { success: false, error: { code: 'BAD_REQUEST' as const, message: `Insufficient stock for allocation: available=${error.available}, requested=${error.requested}` } };
            }
            if (error instanceof NegativeBalanceError) {
                return { success: false, error: { code: 'BAD_REQUEST' as const, message: error.message } };
            }
            throw error;
        }

        await postMutationInvalidate([skuId], new Map([[skuId, result.balance]]));

        return {
            success: true,
            data: {
                transactionId: result.id,
                skuId,
                qty: quantity,
                newBalance: result.balance.currentBalance,
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
                const balance = await recalcBalance(prisma, line.skuId);
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

            // Create inventory inward via shared service
            const { createInwardTransaction } = await getMutationService();
            const transaction = await createInwardTransaction(tx, {
                skuId: line.skuId,
                qty: line.qty,
                reason: TXN_REASON.RTO_RECEIVED,
                referenceId: lineId,
                notes: `RTO received - condition: ${condition}${notes ? ' | ' + notes : ''}`,
                createdById: context.user.id,
            });

            const balance = await recalcBalance(tx, line.skuId);

            return { transaction, balance };
        });

        await postMutationInvalidate(
            [line.skuId],
            new Map([[line.skuId, result.balance]]),
        );

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
        const { createInwardTransaction } = await getMutationService();

        let txn: Awaited<ReturnType<typeof createInwardTransaction>>;
        let balance: { currentBalance: number; availableBalance: number };

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            txn = await createInwardTransaction(tx, {
                skuId: sku.id,
                qty: 1,
                reason: 'received', // Unallocated - can be linked to source later
                createdById: context.user.id,
            });
            balance = await recalcBalance(tx, sku.id);
        });

        await postMutationInvalidate([sku.id], new Map([[sku.id, balance!]]));

        return {
            success: true,
            data: {
                transactionId: txn!.id,
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty: 1,
                newBalance: balance!.currentBalance,
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

            await postMutationInvalidate([transaction.skuId]);

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

                // Revert previous RTO allocation
                if (previousAllocation?.type === 'rto_received' && previousAllocation.referenceId) {
                    await tx.orderLine.update({
                        where: { id: previousAllocation.referenceId },
                        data: { rtoCondition: null, rtoInwardedAt: null, rtoInwardedById: null, rtoReceivedAt: null },
                    });
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

            await postMutationInvalidate([transaction.skuId]);

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

            await postMutationInvalidate([transaction.skuId]);

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

        const { deleteInventoryTransaction } = await getMutationService();
        await deleteInventoryTransaction(prisma, transactionId);

        const balance = await recalcBalance(prisma, transaction.skuId);
        await postMutationInvalidate([transaction.skuId], new Map([[transaction.skuId, balance]]));

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
        const { createInwardTransaction } = await getMutationService();

        let txn: Awaited<ReturnType<typeof createInwardTransaction>>;
        let balance: { currentBalance: number; availableBalance: number };

        await prisma.$transaction(async (tx: PrismaTransaction) => {
            txn = await createInwardTransaction(tx, {
                skuId: sku.id, qty,
                reason: reason || 'production',
                notes: notes || null,
                createdById: context.user.id,
            });
            balance = await recalcBalance(tx, sku.id);
        });

        await postMutationInvalidate([sku.id], new Map([[sku.id, balance!]]));

        return {
            success: true,
            data: {
                transactionId: txn!.id,
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty,
                newBalance: balance!.currentBalance,
            },
        };
    });

// ============================================
// UPDATE TRANSACTION TAILOR
// ============================================

const updateTransactionTailorSchema = z.object({
    transactionId: z.string().uuid('Invalid transaction ID'),
    tailorNumber: z.string().nullable(),
});

export interface UpdateTransactionTailorResult {
    transactionId: string;
    tailorNumber: string | null;
}

/**
 * Update the tailor number on an inventory transaction.
 * Used by the Inventory Inward page to assign/change tailor info inline.
 */
export const updateTransactionTailor = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateTransactionTailorSchema.parse(input))
    .handler(async ({ data }): Promise<MutationResult<UpdateTransactionTailorResult>> => {
        const prisma = await getPrisma();
        const { transactionId, tailorNumber } = data;

        try {
            const existing = await prisma.inventoryTransaction.findUnique({
                where: { id: transactionId },
                select: { id: true },
            });

            if (!existing) {
                return {
                    success: false,
                    error: { code: 'NOT_FOUND', message: 'Transaction not found' },
                };
            }

            await prisma.inventoryTransaction.update({
                where: { id: transactionId },
                data: { tailorNumber: tailorNumber || null },
            });

            return {
                success: true,
                data: { transactionId, tailorNumber: tailorNumber || null },
            };
        } catch (error: unknown) {
            console.error('[inventory] updateTransactionTailor failed:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: { code: 'INTERNAL', message },
            };
        }
    });

// ============================================
// INVENTORY ADJUSTMENTS
// ============================================

const adjustInventorySchema = z.object({
    skuCode: z.string().min(1, 'SKU code is required'),
    qty: z.number().int().positive('Quantity must be positive'),
    direction: z.enum(['add', 'remove']),
    reason: z.string().min(1, 'Reason is required'),
    notes: z.string().optional(),
});

export interface AdjustInventoryResult {
    transactionId: string;
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    direction: 'add' | 'remove';
    newBalance: number;
}

/**
 * Adjust inventory up or down by SKU code.
 * Used by the Inventory Adjustments page for manual stock corrections.
 */
export const adjustInventory = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => adjustInventorySchema.parse(input))
    .handler(async ({ data, context }): Promise<MutationResult<AdjustInventoryResult>> => {
        const prisma = await getPrisma();
        const { skuCode, qty, direction, reason, notes } = data;

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
                error: { code: 'BAD_REQUEST', message: 'Cannot adjust inactive SKU' },
            };
        }

        const { createInwardTransaction, createOutwardTransaction, InsufficientStockError } = await getMutationService();

        let balance: { currentBalance: number; availableBalance: number };

        if (direction === 'add') {
            await prisma.$transaction(async (tx: PrismaTransaction) => {
                await createInwardTransaction(tx, {
                    skuId: sku.id,
                    qty,
                    reason,
                    notes: notes || null,
                    createdById: context.user.id,
                });
                balance = await recalcBalance(tx, sku.id);
            });
        } else {
            try {
                const result = await prisma.$transaction(async (tx: PrismaTransaction) => {
                    return createOutwardTransaction(tx, {
                        skuId: sku.id,
                        qty,
                        reason,
                        notes: notes || null,
                        warehouseLocation: null,
                        createdById: context.user.id,
                    });
                });
                balance = result.balance;
            } catch (error: unknown) {
                if (error instanceof InsufficientStockError) {
                    return {
                        success: false,
                        error: { code: 'BAD_REQUEST', message: error.message },
                    };
                }
                throw error;
            }
        }

        await postMutationInvalidate([sku.id], new Map([[sku.id, balance!]]));

        return {
            success: true,
            data: {
                transactionId: sku.id, // transaction created inside $transaction
                skuId: sku.id,
                skuCode: sku.skuCode,
                productName: sku.variation.product.name,
                colorName: sku.variation.colorName,
                size: sku.size,
                qty,
                direction,
                newBalance: balance!.currentBalance,
            },
        };
    });

// ============================================
// RECENT ADJUSTMENTS QUERY
// ============================================

const ADJUSTMENT_REASONS = [
    'adjustment', 'found_stock', 'correction', 'return_unlinked',
    'damaged', 'shrinkage', 'theft_loss', 'sample', 'other', 'write_off',
] as const;

const getRecentAdjustmentsSchema = z.object({
    type: z.enum(['sku', 'fabric']),
    limit: z.number().int().positive().default(20),
});

export interface RecentSkuAdjustment {
    id: string;
    txnType: string;
    qty: number;
    reason: string;
    notes: string | null;
    createdAt: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
}

export interface RecentFabricAdjustment {
    id: string;
    txnType: string;
    qty: number;
    unit: string;
    reason: string;
    notes: string | null;
    createdAt: string;
    materialName: string;
    fabricName: string;
    colourName: string;
}

export type RecentAdjustmentsResult =
    | { type: 'sku'; items: RecentSkuAdjustment[] }
    | { type: 'fabric'; items: RecentFabricAdjustment[] };

/**
 * Get recent inventory adjustment transactions for SKU or fabric.
 */
export const getRecentAdjustments = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getRecentAdjustmentsSchema.parse(input))
    .handler(async ({ data }): Promise<RecentAdjustmentsResult> => {
        const prisma = await getPrisma();
        const { type, limit } = data;

        if (type === 'sku') {
            const transactions = await prisma.inventoryTransaction.findMany({
                where: { reason: { in: [...ADJUSTMENT_REASONS] } },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: {
                    id: true,
                    txnType: true,
                    qty: true,
                    reason: true,
                    notes: true,
                    createdAt: true,
                    sku: {
                        select: {
                            skuCode: true,
                            size: true,
                            variation: {
                                select: {
                                    colorName: true,
                                    product: { select: { name: true } },
                                },
                            },
                        },
                    },
                },
            });

            return {
                type: 'sku',
                items: transactions.map((t) => ({
                    id: t.id,
                    txnType: t.txnType,
                    qty: t.qty,
                    reason: t.reason,
                    notes: t.notes,
                    createdAt: t.createdAt.toISOString(),
                    skuCode: t.sku.skuCode,
                    productName: t.sku.variation.product.name,
                    colorName: t.sku.variation.colorName,
                    size: t.sku.size,
                })),
            };
        } else {
            const transactions = await prisma.fabricColourTransaction.findMany({
                where: { reason: { in: [...ADJUSTMENT_REASONS] } },
                orderBy: { createdAt: 'desc' },
                take: limit,
                select: {
                    id: true,
                    txnType: true,
                    qty: true,
                    unit: true,
                    reason: true,
                    notes: true,
                    createdAt: true,
                    fabricColour: {
                        select: {
                            colourName: true,
                            fabric: {
                                select: {
                                    name: true,
                                    material: { select: { name: true } },
                                },
                            },
                        },
                    },
                },
            });

            return {
                type: 'fabric',
                items: transactions.map((t) => ({
                    id: t.id,
                    txnType: t.txnType,
                    qty: t.qty,
                    unit: t.unit,
                    reason: t.reason,
                    notes: t.notes,
                    createdAt: t.createdAt.toISOString(),
                    materialName: t.fabricColour.fabric.material?.name ?? 'Unknown',
                    fabricName: t.fabricColour.fabric.name,
                    colourName: t.fabricColour.colourName,
                })),
            };
        }
    });
