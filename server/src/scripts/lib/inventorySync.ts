/**
 * Inventory Sync Logic for Google Sheets sync
 *
 * Reconciles ERP inventory balances to match the Google Sheet's inventory CSV.
 * Uses Column C (total balance before assignment) as the target.
 * Step 5 handles allocation transactions separately.
 */

import type { PrismaClient } from '@prisma/client';
import type { InventoryRow } from './csvParser.js';

// ============================================
// TYPES
// ============================================

export interface InventoryAdjustment {
    skuCode: string;
    skuId: string;
    currentBalance: number;
    targetBalance: number;
    delta: number;
    txnType: 'inward' | 'outward';
}

export interface InventoryReconcileReport {
    adjustments: InventoryAdjustment[];
    skippedSkus: Array<{ skuCode: string; reason: string }>;
    summary: {
        totalSkus: number;
        adjustmentsNeeded: number;
        skusInBalance: number;
        totalInward: number;
        totalOutward: number;
    };
}

// ============================================
// RECONCILIATION
// ============================================

/**
 * Plan inventory reconciliation
 *
 * For each SKU in the inventory CSV:
 * 1. Look up SKU by code
 * 2. Read currentBalance (materialized by DB trigger, reflects Step 5 allocations)
 * 3. Target = Column C (total balance before assignment)
 * 4. Delta = target - current
 * 5. Create adjustment transaction if delta != 0
 */
export async function planInventoryReconcile(
    prisma: PrismaClient,
    inventoryBySkuCode: Map<string, InventoryRow>
): Promise<InventoryReconcileReport> {
    const adjustments: InventoryAdjustment[] = [];
    const skippedSkus: InventoryReconcileReport['skippedSkus'] = [];

    // Batch lookup all SKUs from the CSV
    // The inventory CSV may use skuCode or shopifyVariantId as the identifier
    const csvSkuCodes = [...inventoryBySkuCode.keys()];
    const BATCH_SIZE = 500;
    const allSkus: Array<{ id: string; skuCode: string; shopifyVariantId: string | null; currentBalance: number }> = [];

    for (let i = 0; i < csvSkuCodes.length; i += BATCH_SIZE) {
        const batch = csvSkuCodes.slice(i, i + BATCH_SIZE);

        // Try matching by skuCode first
        const byCode = await prisma.sku.findMany({
            where: { skuCode: { in: batch } },
            select: { id: true, skuCode: true, shopifyVariantId: true, currentBalance: true },
        });
        allSkus.push(...byCode);

        // For any not found by skuCode, try shopifyVariantId
        const foundCodes = new Set(byCode.map(s => s.skuCode));
        const notFound = batch.filter(code => !foundCodes.has(code));
        if (notFound.length > 0) {
            const byVariant = await prisma.sku.findMany({
                where: { shopifyVariantId: { in: notFound } },
                select: { id: true, skuCode: true, shopifyVariantId: true, currentBalance: true },
            });
            allSkus.push(...byVariant);
        }
    }

    // Build map: CSV identifier -> SKU record
    // Map by skuCode AND shopifyVariantId so we can find by either
    const skuMap = new Map<string, typeof allSkus[number]>();
    for (const sku of allSkus) {
        skuMap.set(sku.skuCode, sku);
        if (sku.shopifyVariantId) {
            skuMap.set(sku.shopifyVariantId, sku);
        }
    }

    for (const [skuCode, csvRow] of inventoryBySkuCode) {
        const sku = skuMap.get(skuCode);

        if (!sku) {
            skippedSkus.push({ skuCode, reason: 'SKU not found in ERP' });
            continue;
        }

        const targetBalance = csvRow.qtyBal;  // Column C (total stock before assignment)
        const currentBalance = sku.currentBalance;
        const delta = targetBalance - currentBalance;

        if (delta === 0) continue;

        adjustments.push({
            skuCode,
            skuId: sku.id,
            currentBalance,
            targetBalance,
            delta,
            txnType: delta > 0 ? 'inward' : 'outward',
        });
    }

    const totalInward = adjustments.filter(a => a.txnType === 'inward').reduce((s, a) => s + a.delta, 0);
    const totalOutward = adjustments.filter(a => a.txnType === 'outward').reduce((s, a) => s + Math.abs(a.delta), 0);

    return {
        adjustments,
        skippedSkus,
        summary: {
            totalSkus: inventoryBySkuCode.size,
            adjustmentsNeeded: adjustments.length,
            skusInBalance: inventoryBySkuCode.size - adjustments.length - skippedSkus.length,
            totalInward,
            totalOutward,
        },
    };
}

/**
 * Execute inventory reconciliation adjustments
 */
export async function executeInventoryReconcile(
    prisma: PrismaClient,
    report: InventoryReconcileReport,
    userId: string
): Promise<{ adjusted: number; errors: string[] }> {
    let adjusted = 0;
    const errors: string[] = [];

    // Process in batches for better performance
    const BATCH_SIZE = 100;
    for (let i = 0; i < report.adjustments.length; i += BATCH_SIZE) {
        const batch = report.adjustments.slice(i, i + BATCH_SIZE);

        try {
            await prisma.$transaction(async (tx) => {
                for (const adj of batch) {
                    // Re-read current balance inside transaction for accuracy
                    const sku = await tx.sku.findUnique({
                        where: { id: adj.skuId },
                        select: { currentBalance: true },
                    });

                    if (!sku) {
                        errors.push(`${adj.skuCode}: SKU not found during execution`);
                        continue;
                    }

                    const currentDelta = adj.targetBalance - sku.currentBalance;
                    if (currentDelta === 0) continue;

                    await tx.inventoryTransaction.create({
                        data: {
                            skuId: adj.skuId,
                            txnType: currentDelta > 0 ? 'inward' : 'outward',
                            qty: Math.abs(currentDelta),
                            reason: 'sheet_reconciliation',
                            notes: `Sheet sync: adjusted from ${sku.currentBalance} to ${adj.targetBalance}`,
                            createdById: userId,
                        },
                    });

                    adjusted++;
                }
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const skuCodes = batch.map(a => a.skuCode).join(', ');
            errors.push(`Batch [${skuCodes}]: ${msg}`);
        }
    }

    return { adjusted, errors };
}
