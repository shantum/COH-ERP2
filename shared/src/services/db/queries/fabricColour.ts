/**
 * Fabric Colour Balance Queries
 *
 * Balance and consumption calculations for FabricColour entities.
 * Uses Prisma aggregation queries — no raw SQL needed.
 *
 * Pattern: All functions accept `prisma` as first parameter (same as inventory.ts).
 */

import type { PrismaInstance } from '../prisma.js';

// ============================================
// OUTPUT TYPES
// ============================================

export interface FabricColourBalance {
    currentBalance: number;
    totalInward: number;
    totalOutward: number;
}

export interface FabricColourBalanceBatch {
    currentBalance: number;
}

// ============================================
// BALANCE QUERIES
// ============================================

/**
 * Calculate fabric colour balance from transactions (single ID)
 *
 * Aggregates inward/outward FabricColourTransaction rows.
 */
export async function calculateFabricColourBalance(
    prisma: PrismaInstance,
    fabricColourId: string
): Promise<FabricColourBalance> {
    const [inwardSum, outwardSum] = await Promise.all([
        prisma.fabricColourTransaction.aggregate({
            where: { fabricColourId, txnType: 'inward' },
            _sum: { qty: true },
        }),
        prisma.fabricColourTransaction.aggregate({
            where: { fabricColourId, txnType: 'outward' },
            _sum: { qty: true },
        }),
    ]);

    const totalInward = Number(inwardSum._sum.qty) || 0;
    const totalOutward = Number(outwardSum._sum.qty) || 0;

    return {
        currentBalance: totalInward - totalOutward,
        totalInward,
        totalOutward,
    };
}

/**
 * Calculate average daily fabric colour consumption over 28 days
 *
 * Sums outward transactions in the last 28 days and divides by 28.
 */
export async function calculateAvgDailyConsumption(
    prisma: PrismaInstance,
    fabricColourId: string
): Promise<number> {
    const twentyEightDaysAgo = new Date();
    twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);

    const result = await prisma.fabricColourTransaction.aggregate({
        where: {
            fabricColourId,
            txnType: 'outward',
            createdAt: { gte: twentyEightDaysAgo },
        },
        _sum: { qty: true },
    });

    const totalConsumption = Number(result._sum.qty) || 0;
    return totalConsumption / 28;
}

/**
 * Calculate fabric colour balances in batch (multiple IDs)
 *
 * Uses Prisma groupBy for a single efficient query.
 */
export async function calculateAllFabricColourBalances(
    prisma: PrismaInstance,
    fabricColourIds: string[]
): Promise<Map<string, FabricColourBalanceBatch>> {
    const aggregations = await prisma.fabricColourTransaction.groupBy({
        by: ['fabricColourId', 'txnType'],
        where: { fabricColourId: { in: fabricColourIds } },
        _sum: { qty: true },
    });

    const balanceMap = new Map<string, FabricColourBalanceBatch>();

    // Initialize all colours with zero balance
    for (const colourId of fabricColourIds) {
        balanceMap.set(colourId, { currentBalance: 0 });
    }

    // Calculate balances from aggregations
    const colourTotals = new Map<string, { inward: number; outward: number }>();
    for (const agg of aggregations) {
        if (!colourTotals.has(agg.fabricColourId)) {
            colourTotals.set(agg.fabricColourId, { inward: 0, outward: 0 });
        }
        const totals = colourTotals.get(agg.fabricColourId)!;
        if (agg.txnType === 'inward') {
            totals.inward = Number(agg._sum.qty) || 0;
        } else if (agg.txnType === 'outward') {
            totals.outward = Number(agg._sum.qty) || 0;
        }
    }

    for (const [colourId, totals] of colourTotals) {
        balanceMap.set(colourId, { currentBalance: totals.inward - totals.outward });
    }

    return balanceMap;
}
