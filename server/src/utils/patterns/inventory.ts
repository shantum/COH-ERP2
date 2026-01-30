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
 * Get inventory balance for a SKU
 * Reads directly from Sku.currentBalance column (maintained by DB trigger).
 * O(1) lookup - no aggregation needed.
 */
export async function calculateInventoryBalance(
    prisma: PrismaOrTransaction,
    skuId: string,
    options: Pick<InventoryBalanceOptions, 'allowNegative'> = {}
): Promise<InventoryBalance> {
    // Fast path: read materialized balance from Sku table
    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { currentBalance: true },
    });

    const currentBalance = sku?.currentBalance ?? 0;

    // Use shared pure function for balance calculation
    // Note: totalInward/totalOutward are not tracked in materialized column
    return calculateBalance({ totalInward: 0, totalOutward: 0 }, {
        ...options,
        // Override the calculated balance with the materialized one
    }).currentBalance !== undefined
        ? {
            totalInward: 0,
            totalOutward: 0,
            currentBalance,
            availableBalance: currentBalance,
            hasDataIntegrityIssue: !options.allowNegative && currentBalance < 0,
        }
        : {
            totalInward: 0,
            totalOutward: 0,
            currentBalance,
            availableBalance: currentBalance,
            hasDataIntegrityIssue: !options.allowNegative && currentBalance < 0,
        };
}

/**
 * Calculate inventory balance with inward/outward totals
 * Use this when you need to display totalInward/totalOutward.
 * For just currentBalance, use calculateInventoryBalance() instead (faster).
 */
export async function calculateInventoryBalanceWithTotals(
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
 * Get inventory balances for multiple SKUs efficiently
 * Reads directly from Sku.currentBalance column (maintained by DB trigger).
 * Single query, O(1) per SKU.
 */
export async function calculateAllInventoryBalances(
    prisma: PrismaOrTransaction,
    skuIds: string[] | null = null,
    options: InventoryBalanceOptions = {}
): Promise<Map<string, InventoryBalanceWithSkuId>> {
    const { allowNegative = true, excludeCustomSkus = false } = options;

    const where: Prisma.SkuWhereInput = {};

    if (skuIds) {
        where.id = { in: skuIds };
    }

    if (excludeCustomSkus) {
        where.isCustomSku = false;
    }

    // Fast path: read materialized balances from Sku table
    const skus = await prisma.sku.findMany({
        where,
        select: { id: true, currentBalance: true },
    });

    const balanceMap = new Map<string, InventoryBalanceWithSkuId>();

    for (const sku of skus) {
        balanceMap.set(sku.id, {
            skuId: sku.id,
            totalInward: 0, // Not tracked - use calculateAllInventoryBalancesWithTotals if needed
            totalOutward: 0, // Not tracked - use calculateAllInventoryBalancesWithTotals if needed
            currentBalance: sku.currentBalance,
            availableBalance: sku.currentBalance,
            hasDataIntegrityIssue: !allowNegative && sku.currentBalance < 0,
        });
    }

    return balanceMap;
}

/**
 * Calculate inventory balances with inward/outward totals for multiple SKUs
 * Use this when you need to display totalInward/totalOutward.
 * For just currentBalance, use calculateAllInventoryBalances() instead (faster).
 */
export async function calculateAllInventoryBalancesWithTotals(
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
 * Get inventory balances with row-level locking for allocation
 * Uses FOR UPDATE on Sku rows to prevent race conditions during concurrent allocations.
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

    // Use raw SQL with FOR UPDATE to lock Sku rows
    // This prevents concurrent allocations from reading stale balance
    const result = await tx.$queryRaw<Array<{
        id: string;
        currentBalance: number;
    }>>`
        SELECT "id", "currentBalance"
        FROM "Sku"
        WHERE "id" = ANY(${skuIds}::uuid[])
        FOR UPDATE
    `;

    const balanceMap = new Map<string, InventoryBalanceWithSkuId>();

    // Initialize all requested SKUs using shared helper (some may not exist)
    for (const skuId of skuIds) {
        balanceMap.set(skuId, createEmptyBalanceWithId(skuId));
    }

    // Populate with actual data from locked rows
    for (const row of result) {
        balanceMap.set(row.id, {
            skuId: row.id,
            totalInward: 0, // Not tracked in materialized column
            totalOutward: 0, // Not tracked in materialized column
            currentBalance: row.currentBalance,
            availableBalance: row.currentBalance,
            hasDataIntegrityIssue: row.currentBalance < 0,
        });
    }

    return balanceMap;
}

// ============================================
// FABRIC BALANCE
// ============================================

// NOTE: FabricTransaction table removed - fabric balance now tracked via FabricColourTransaction
// These functions have been deprecated. Use FabricColour.currentBalance (materialized) instead.

/**
 * @deprecated FabricTransaction removed - use FabricColour.currentBalance instead
 */
export async function calculateFabricBalance(
    _prisma: PrismaOrTransaction,
    _fabricId: string
): Promise<FabricBalance> {
    // Return zero balance - FabricTransaction no longer exists
    return calculateFabricBalancePure({ totalInward: 0, totalOutward: 0 });
}

/**
 * @deprecated FabricTransaction removed - use FabricColour.currentBalance instead
 */
export async function calculateAllFabricBalances(
    _prisma: PrismaOrTransaction
): Promise<Map<string, FabricBalanceWithId>> {
    // Return empty map - FabricTransaction no longer exists
    return new Map();
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
