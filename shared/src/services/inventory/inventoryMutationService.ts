/**
 * Inventory Mutation Service
 *
 * Core domain operations for inventory transactions, extracted from server functions.
 * These functions accept a Prisma client/transaction context as first parameter,
 * keeping them usable from both Server Functions and Express routes.
 *
 * IMPORTANT: All imports are dynamic to prevent Node.js code from being bundled
 * into the client. This module is in @coh/shared/services/ which is imported
 * by both client-side server functions and the Express server.
 */

import type { PrismaInstance, PrismaTransaction } from '../db/prisma.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrismaContext = PrismaInstance | PrismaTransaction;

export interface CreateInwardParams {
    skuId: string;
    qty: number;
    reason: string;
    referenceId?: string | null;
    notes?: string | null;
    warehouseLocation?: string | null;
    createdById: string;
}

export interface CreateOutwardParams {
    skuId: string;
    qty: number;
    reason: string;
    referenceId?: string | null;
    notes?: string | null;
    warehouseLocation?: string | null;
    createdById: string;
}

export interface InwardTransactionResult {
    id: string;
    skuId: string;
    qty: number;
}

export interface OutwardTransactionResult {
    id: string;
    skuId: string;
    qty: number;
    balance: { currentBalance: number; availableBalance: number };
}

export interface DeleteTransactionInfo {
    id: string;
    skuId: string;
    qty: number;
    reason: string | null;
    referenceId: string | null;
    txnType: string;
}

export class InsufficientStockError extends Error {
    available: number;
    requested: number;

    constructor(available: number, requested: number) {
        super(`Insufficient stock: available ${available}, requested ${requested}`);
        this.name = 'InsufficientStockError';
        this.available = available;
        this.requested = requested;
    }
}

export class NegativeBalanceError extends Error {
    constructor() {
        super('Cannot create outward: inventory balance is already negative. Please reconcile inventory first.');
        this.name = 'NegativeBalanceError';
    }
}

// ---------------------------------------------------------------------------
// Balance helper (dynamic import)
// ---------------------------------------------------------------------------

async function calcBalance(prisma: PrismaContext, skuId: string) {
    const { calculateInventoryBalanceWithTotals } = await import('../db/queries/inventory.js');
    return calculateInventoryBalanceWithTotals(prisma, skuId, { allowNegative: true });
}

// ---------------------------------------------------------------------------
// Core Domain Operations
// ---------------------------------------------------------------------------

/**
 * Create an inward (add stock) inventory transaction.
 *
 * Does NOT wrap in $transaction — caller can pass either a PrismaInstance
 * or an active PrismaTransaction context. This allows batching multiple
 * inwards in a single transaction (e.g. quickInward).
 *
 * @returns The created transaction record (id, skuId, qty).
 */
export async function createInwardTransaction(
    prisma: PrismaContext,
    params: CreateInwardParams,
): Promise<InwardTransactionResult> {
    const txn = await (prisma as PrismaTransaction).inventoryTransaction.create({
        data: {
            skuId: params.skuId,
            txnType: 'inward',
            qty: params.qty,
            reason: params.reason,
            referenceId: params.referenceId ?? null,
            notes: params.notes ?? null,
            warehouseLocation: params.warehouseLocation ?? null,
            createdById: params.createdById,
        },
    });

    return { id: txn.id, skuId: txn.skuId, qty: txn.qty };
}

/**
 * Create an outward (remove stock) inventory transaction with balance check.
 *
 * MUST be called inside an active $transaction to ensure atomicity of the
 * balance check + create. Throws InsufficientStockError or NegativeBalanceError
 * if the balance is insufficient.
 *
 * @returns The created transaction + recalculated balance.
 */
export async function createOutwardTransaction(
    tx: PrismaTransaction,
    params: CreateOutwardParams,
): Promise<OutwardTransactionResult> {
    const bal = await calcBalance(tx, params.skuId);

    if (bal.currentBalance < 0) {
        throw new NegativeBalanceError();
    }

    if (bal.availableBalance < params.qty) {
        throw new InsufficientStockError(bal.availableBalance, params.qty);
    }

    const txn = await tx.inventoryTransaction.create({
        data: {
            skuId: params.skuId,
            txnType: 'outward',
            qty: params.qty,
            reason: params.reason,
            referenceId: params.referenceId ?? null,
            notes: params.notes ?? null,
            warehouseLocation: params.warehouseLocation ?? null,
            createdById: params.createdById,
        },
    });

    const balance = await calcBalance(tx, params.skuId);

    return {
        id: txn.id,
        skuId: txn.skuId,
        qty: txn.qty,
        balance: {
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
        },
    };
}

/**
 * Delete an inventory transaction by ID.
 *
 * Returns info about the deleted transaction so the caller can handle
 * side effects (production batch reversion, etc.).
 * Throws if the transaction is not found.
 */
export async function deleteInventoryTransaction(
    prisma: PrismaContext,
    transactionId: string,
): Promise<DeleteTransactionInfo> {
    const existing = await (prisma as PrismaTransaction).inventoryTransaction.findUnique({
        where: { id: transactionId },
    });

    if (!existing) {
        throw new Error('Transaction not found');
    }

    await (prisma as PrismaTransaction).inventoryTransaction.delete({
        where: { id: transactionId },
    });

    return {
        id: existing.id,
        skuId: existing.skuId,
        qty: existing.qty,
        reason: existing.reason,
        referenceId: existing.referenceId,
        txnType: existing.txnType,
    };
}

/**
 * Invalidate inventory balance caches and broadcast SSE update.
 *
 * Combines three post-mutation steps that are repeated after every mutation:
 * 1. Invalidate the in-memory balance cache
 * 2. Push updated balances to Google Sheets (fire-and-forget)
 * 3. Broadcast SSE update for each affected SKU
 *
 * @param skuIds - SKU IDs whose caches need invalidation
 * @param internalApiBaseUrl - Base URL for internal API calls (e.g. http://127.0.0.1:3001)
 * @param balancesBySkuId - Optional pre-calculated balances to include in SSE broadcast.
 *                          If not provided, SSE is broadcast without balance details.
 */
export async function invalidateInventoryCaches(
    skuIds: string[],
    internalApiBaseUrl: string,
    balancesBySkuId?: Map<string, { currentBalance: number; availableBalance: number }>,
    internalHeaders?: Record<string, string>,
): Promise<void> {
    // 1. Invalidate cache
    try {
        const { inventoryBalanceCache } = await import('./balanceCache.js');
        inventoryBalanceCache.invalidate(skuIds);
    } catch {
        console.warn('[inventoryMutationService] Cache invalidation skipped (server module not available)');
    }

    // 2. Push to Google Sheets (fire-and-forget)
    fetch(`${internalApiBaseUrl}/api/internal/push-sku-balances`, {
        method: 'POST',
        headers: internalHeaders ?? { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuIds }),
    }).catch(() => {
        console.warn('[inventoryMutationService] Sheet balance push failed (non-critical)');
    });

    // 3. SSE broadcast for each SKU (via Postgres NOTIFY — no HTTP hop)
    const { notifySSE } = await import('../sseBroadcast.js');
    for (const skuId of skuIds) {
        const changes = balancesBySkuId?.get(skuId) ?? {};
        await notifySSE({ type: 'inventory_updated', skuId, changes });
    }
}

/**
 * Recalculate balance for a SKU (convenience re-export for server functions).
 */
export async function recalculateBalance(
    prisma: PrismaContext,
    skuId: string,
): Promise<{ currentBalance: number; availableBalance: number }> {
    const bal = await calcBalance(prisma, skuId);
    return { currentBalance: bal.currentBalance, availableBalance: bal.availableBalance };
}
