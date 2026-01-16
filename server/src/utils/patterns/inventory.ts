/**
 * Inventory Balance Calculations
 * SKU and fabric balance functions
 */

import type { Prisma } from '@prisma/client';
import type {
    PrismaOrTransaction,
    InventoryBalance,
    InventoryBalanceWithSkuId,
    InventoryBalanceOptions,
    FabricBalance,
    FabricBalanceWithId,
} from './types.js';

// ============================================
// SKU INVENTORY BALANCE
// ============================================

/**
 * Calculate inventory balance for a SKU
 */
export async function calculateInventoryBalance(
    prisma: PrismaOrTransaction,
    skuId: string,
    options: Pick<InventoryBalanceOptions, 'allowNegative'> = {}
): Promise<InventoryBalance> {
    const { allowNegative = true } = options;

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

    let currentBalance = totalInward - totalOutward;
    let availableBalance = currentBalance;

    const hasDataIntegrityIssue = currentBalance < 0;

    if (!allowNegative) {
        currentBalance = Math.max(0, currentBalance);
        availableBalance = Math.max(0, availableBalance);
    }

    return {
        totalInward,
        totalOutward,
        currentBalance,
        availableBalance,
        hasDataIntegrityIssue
    };
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

    const balanceMap = new Map<string, InventoryBalanceWithSkuId>();

    result.forEach((r) => {
        if (!balanceMap.has(r.skuId)) {
            balanceMap.set(r.skuId, {
                skuId: r.skuId,
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
                availableBalance: 0,
                hasDataIntegrityIssue: false,
            });
        }

        const balance = balanceMap.get(r.skuId)!;
        if (r.txnType === 'inward') balance.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') balance.totalOutward = r._sum.qty || 0;
    });

    // Calculate derived fields
    for (const [skuId, balance] of balanceMap) {
        let currentBalance = balance.totalInward - balance.totalOutward;
        let availableBalance = currentBalance;

        balance.hasDataIntegrityIssue = currentBalance < 0;

        if (!allowNegative) {
            currentBalance = Math.max(0, currentBalance);
            availableBalance = Math.max(0, availableBalance);
        }

        balance.currentBalance = currentBalance;
        balance.availableBalance = availableBalance;
        balance.skuId = skuId;
    }

    return balanceMap;
}

// ============================================
// FABRIC BALANCE
// ============================================

/**
 * Calculate fabric balance for a fabric
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

    const currentBalance = totalInward - totalOutward;

    return { totalInward, totalOutward, currentBalance };
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

    const balanceMap = new Map<string, FabricBalanceWithId>();

    result.forEach((r) => {
        if (!balanceMap.has(r.fabricId)) {
            balanceMap.set(r.fabricId, {
                fabricId: r.fabricId,
                totalInward: 0,
                totalOutward: 0,
                currentBalance: 0,
            });
        }

        const balance = balanceMap.get(r.fabricId)!;
        if (r.txnType === 'inward') balance.totalInward = r._sum.qty || 0;
        else if (r.txnType === 'outward') balance.totalOutward = r._sum.qty || 0;
    });

    // Calculate current balance
    for (const [, balance] of balanceMap) {
        balance.currentBalance = balance.totalInward - balance.totalOutward;
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
