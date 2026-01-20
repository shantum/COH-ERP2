/**
 * Kysely Inventory Reconciliation Queries
 *
 * High-performance queries for inventory reconciliation.
 * Replaces Prisma nested includes with efficient JOINs.
 *
 * All public exports are validated against Zod schemas to catch schema drift.
 */

import { sql } from 'kysely';
import { kysely } from '../index.js';
import {
    reconciliationHistoryArraySchema,
    reconciliationDetailResultSchema,
    skuForReconciliationArraySchema,
    type ReconciliationHistoryRow,
    type ReconciliationDetailResult,
    type SkuForReconciliationRow,
} from '@coh/shared';

// Re-export output types from schemas
export type { ReconciliationHistoryRow, ReconciliationDetailResult, SkuForReconciliationRow };

// ============================================
// QUERIES
// ============================================

/**
 * Get history of past reconciliations with counts
 */
export async function getReconciliationHistoryKysely(
    limit: number = 10
): Promise<ReconciliationHistoryRow[]> {
    // Get reconciliations with item counts using subquery
    const reconciliations = await kysely
        .selectFrom('InventoryReconciliation')
        .select([
            'InventoryReconciliation.id',
            'InventoryReconciliation.reconcileDate as date',
            'InventoryReconciliation.status',
            'InventoryReconciliation.createdBy',
            'InventoryReconciliation.createdAt',
        ])
        .orderBy('InventoryReconciliation.createdAt', 'desc')
        .limit(limit)
        .execute();

    if (reconciliations.length === 0) return [];

    // Get item counts and adjustment counts for each reconciliation
    const recIds = reconciliations.map((r) => r.id);

    const itemCounts = await kysely
        .selectFrom('InventoryReconciliationItem')
        .select([
            'InventoryReconciliationItem.reconciliationId',
            sql<number>`count(*)::int`.as('itemsCount'),
            sql<number>`count(*) FILTER (WHERE "variance" != 0 AND "variance" IS NOT NULL)::int`.as(
                'adjustments'
            ),
        ])
        .where('InventoryReconciliationItem.reconciliationId', 'in', recIds)
        .groupBy('InventoryReconciliationItem.reconciliationId')
        .execute();

    // Build lookup
    const countsMap = new Map<string, { itemsCount: number; adjustments: number }>();
    for (const c of itemCounts) {
        countsMap.set(c.reconciliationId, {
            itemsCount: c.itemsCount,
            adjustments: c.adjustments,
        });
    }

    const result = reconciliations.map((r) => ({
        id: r.id,
        date: r.date as Date,
        status: r.status,
        itemsCount: countsMap.get(r.id)?.itemsCount ?? 0,
        adjustments: countsMap.get(r.id)?.adjustments ?? 0,
        createdBy: r.createdBy,
        createdAt: r.createdAt as Date,
    }));

    // Validate output against Zod schema
    return reconciliationHistoryArraySchema.parse(result);
}

/**
 * Get single reconciliation by ID with items and SKU details
 */
export async function getReconciliationByIdKysely(
    id: string
): Promise<ReconciliationDetailResult | null> {
    // Get reconciliation
    const reconciliation = await kysely
        .selectFrom('InventoryReconciliation')
        .select([
            'InventoryReconciliation.id',
            'InventoryReconciliation.status',
            'InventoryReconciliation.notes',
            'InventoryReconciliation.createdAt',
        ])
        .where('InventoryReconciliation.id', '=', id)
        .executeTakeFirst();

    if (!reconciliation) return null;

    // Get items with SKU/product info
    const items = await kysely
        .selectFrom('InventoryReconciliationItem')
        .innerJoin('Sku', 'Sku.id', 'InventoryReconciliationItem.skuId')
        .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
        .leftJoin('Product', 'Product.id', 'Variation.productId')
        .select([
            'InventoryReconciliationItem.id',
            'InventoryReconciliationItem.skuId',
            'Sku.skuCode',
            'Sku.size',
            'Product.name as productName',
            'Variation.colorName',
            'InventoryReconciliationItem.systemQty',
            'InventoryReconciliationItem.physicalQty',
            'InventoryReconciliationItem.variance',
            'InventoryReconciliationItem.adjustmentReason',
            'InventoryReconciliationItem.notes',
        ])
        .where('InventoryReconciliationItem.reconciliationId', '=', id)
        .execute();

    const result = {
        id: reconciliation.id,
        status: reconciliation.status,
        notes: reconciliation.notes,
        createdAt: reconciliation.createdAt as Date,
        items: items.map((i) => ({
            id: i.id,
            skuId: i.skuId,
            skuCode: i.skuCode,
            productName: i.productName ?? '',
            colorName: i.colorName ?? '',
            size: i.size,
            systemQty: i.systemQty,
            physicalQty: i.physicalQty,
            variance: i.variance,
            adjustmentReason: i.adjustmentReason,
            notes: i.notes,
        })),
    };

    // Validate output against Zod schema
    return reconciliationDetailResultSchema.parse(result);
}

/**
 * Get all active non-custom SKUs for starting a new reconciliation
 */
export async function getSkusForReconciliationKysely(): Promise<SkuForReconciliationRow[]> {
    const rows = await kysely
        .selectFrom('Sku')
        .innerJoin('Variation', 'Variation.id', 'Sku.variationId')
        .innerJoin('Product', 'Product.id', 'Variation.productId')
        .select([
            'Sku.id',
            'Sku.skuCode',
            'Sku.size',
            'Product.name as productName',
            'Variation.colorName',
        ])
        .where('Sku.isActive', '=', true)
        .where('Sku.isCustomSku', '=', false)
        .orderBy('Sku.skuCode', 'asc')
        .execute();

    const result = rows.map((r) => ({
        id: r.id,
        skuCode: r.skuCode,
        size: r.size,
        productName: r.productName ?? '',
        colorName: r.colorName ?? '',
    }));

    // Validate output against Zod schema
    return skuForReconciliationArraySchema.parse(result);
}
