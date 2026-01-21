/**
 * Inventory Balance Calculations
 * SKU and fabric balance functions
 *
 * Uses pure functions from shared domain layer for balance calculations.
 * This module handles the Prisma-specific data fetching.
 */

import type { Prisma } from '@prisma/client';
import {
    calculateBalance,
    calculateFabricBalance as calculateFabricBalancePure,
    createEmptyBalanceWithId,
    type InventoryBalance,
    type InventoryBalanceWithSkuId,
    type FabricBalance,
    type FabricBalanceWithId,
} from '@coh/shared/domain';
import type {
    PrismaOrTransaction,
    PrismaTransactionClient,
    InventoryBalanceOptions,
} from './types.js';

// Re-export types from shared for backwards compatibility
export type { InventoryBalance, InventoryBalanceWithSkuId, FabricBalance, FabricBalanceWithId };

// ============================================
// SKU INVENTORY BALANCE
// ============================================

/**
 * Calculate inventory balance for a SKU
 * Fetches transaction data from database and uses shared pure function for calculation.
 */
export async function calculateInventoryBalance(
    prisma: PrismaOrTransaction,
    skuId: string,
    options: Pick<InventoryBalanceOptions, 'allowNegative'> = {}
): Promise<InventoryBalance> {
    const result = await prisma.inventoryTransaction.groupBy({
        by: ['txnType'],
        where: { skuId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;

    result.forEach((r) => {
        if (r.txnType === 'inward') totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') totalOutward = r._sum.qty || 0;
    });

    // Use shared pure function for balance calculation
    return calculateBalance({ totalInward, totalOutward }, options);
}

/**
 * Calculate inventory balances for all SKUs efficiently
 * Uses single aggregation query - O(1) instead of O(N)
 */
export async function calculateAllInventoryBalances(
    prisma: PrismaOrTransaction,
    skuIds: string[] | null = null,
    options: InventoryBalanceOptions = {}
): Promise<Map<string, InventoryBalanceWithSkuId>> {
    const { allowNegative = true, excludeCustomSkus = false } = options;

    const where: Prisma.InventoryTransactionWhereInput = {};

    if (skuIds) {
        where.skuId = { in: skuIds };
    }

    if (excludeCustomSkus) {
        where.sku = { isCustomSku: false };
    }

    const result = await prisma.inventoryTransaction.groupBy({
        by: ['skuId', 'txnType'],
        where,
        _sum: { qty: true },
    });

    // Aggregate transaction totals by SKU
    const summaryMap = new Map<string, { totalInward: number; totalOutward: number }>();

    result.forEach((r) => {
        if (!summaryMap.has(r.skuId)) {
            summaryMap.set(r.skuId, { totalInward: 0, totalOutward: 0 });
        }

        const summary = summaryMap.get(r.skuId)!;
        if (r.txnType === 'inward') summary.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') summary.totalOutward = r._sum.qty || 0;
    });

    // Calculate balances using shared pure function
    const balanceMap = new Map<string, InventoryBalanceWithSkuId>();

    for (const [skuId, summary] of summaryMap) {
        const balance = calculateBalance(summary, { allowNegative });
        balanceMap.set(skuId, { skuId, ...balance });
    }

    return balanceMap;
}

/**
 * Calculate inventory balances with row-level locking for allocation
 * Uses FOR UPDATE to prevent race conditions during concurrent allocations
 *
 * CRITICAL: This function MUST be called inside a transaction to be effective.
 * The FOR UPDATE lock is held until the transaction commits/rolls back.
 *
 * @param tx - Prisma transaction client (NOT regular PrismaClient)
 * @param skuIds - Array of SKU IDs to check and lock
 * @returns Map of skuId to balance with locking guarantee
 */
export async function calculateInventoryBalancesWithLock(
    tx: PrismaTransactionClient,
    skuIds: string[]
): Promise<Map<string, InventoryBalanceWithSkuId>> {
    if (skuIds.length === 0) {
        return new Map();
    }

    // Use raw SQL with FOR UPDATE to lock inventory transaction rows
    // This prevents concurrent allocations from reading stale data
    const result = await tx.$queryRaw<Array<{
        skuId: string;
        totalInward: bigint;
        totalOutward: bigint;
    }>>`
        SELECT
            "skuId",
            COALESCE(SUM(CASE WHEN "txnType" = 'inward' THEN qty ELSE 0 END), 0) as "totalInward",
            COALESCE(SUM(CASE WHEN "txnType" = 'outward' THEN qty ELSE 0 END), 0) as "totalOutward"
        FROM "InventoryTransaction"
        WHERE "skuId" = ANY(${skuIds}::uuid[])
        GROUP BY "skuId"
        FOR UPDATE
    `;

    const balanceMap = new Map<string, InventoryBalanceWithSkuId>();

    // Initialize all requested SKUs using shared helper (some may have no transactions yet)
    for (const skuId of skuIds) {
        balanceMap.set(skuId, createEmptyBalanceWithId(skuId));
    }

    // Populate with actual data from locked rows using shared pure function
    for (const row of result) {
        const totalInward = Number(row.totalInward);
        const totalOutward = Number(row.totalOutward);
        const balance = calculateBalance({ totalInward, totalOutward });
        balanceMap.set(row.skuId, { skuId: row.skuId, ...balance });
    }

    return balanceMap;
}

// ============================================
// FABRIC BALANCE
// ============================================

/**
 * Calculate fabric balance for a fabric
 * Fetches transaction data from database and uses shared pure function for calculation.
 */
export async function calculateFabricBalance(
    prisma: PrismaOrTransaction,
    fabricId: string
): Promise<FabricBalance> {
    const result = await prisma.fabricTransaction.groupBy({
        by: ['txnType'],
        where: { fabricId },
        _sum: { qty: true },
    });

    let totalInward = 0;
    let totalOutward = 0;

    result.forEach((r) => {
        if (r.txnType === 'inward') totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') totalOutward = r._sum.qty || 0;
    });

    // Use shared pure function for balance calculation
    return calculateFabricBalancePure({ totalInward, totalOutward });
}

/**
 * Calculate fabric balances for all fabrics efficiently
 */
export async function calculateAllFabricBalances(
    prisma: PrismaOrTransaction
): Promise<Map<string, FabricBalanceWithId>> {
    const result = await prisma.fabricTransaction.groupBy({
        by: ['fabricId', 'txnType'],
        _sum: { qty: true },
    });

    // Aggregate transaction totals by fabric
    const summaryMap = new Map<string, { totalInward: number; totalOutward: number }>();

    result.forEach((r) => {
        if (!summaryMap.has(r.fabricId)) {
            summaryMap.set(r.fabricId, { totalInward: 0, totalOutward: 0 });
        }

        const summary = summaryMap.get(r.fabricId)!;
        if (r.txnType === 'inward') summary.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') summary.totalOutward = r._sum.qty || 0;
    });

    // Calculate balances using shared pure function
    const balanceMap = new Map<string, FabricBalanceWithId>();

    for (const [fabricId, summary] of summaryMap) {
        const balance = calculateFabricBalancePure(summary);
        balanceMap.set(fabricId, { fabricId, ...balance });
    }

    return balanceMap;
}

// ============================================
// FABRIC CONSUMPTION
// ============================================

/**
 * Get effective fabric consumption for a SKU
 * Cascade priority: SKU.fabricConsumption -> Product.defaultFabricConsumption -> 1.5
 */
export function getEffectiveFabricConsumption(sku: {
    fabricConsumption?: number | null;
    variation?: {
        product?: {
            defaultFabricConsumption?: number | null;
        } | null;
    } | null;
}): number {
    if (sku.fabricConsumption && sku.fabricConsumption > 0) {
        return sku.fabricConsumption;
    }

    const productDefault = sku.variation?.product?.defaultFabricConsumption;
    if (productDefault && productDefault > 0) {
        return productDefault;
    }

    return 1.5;
}
