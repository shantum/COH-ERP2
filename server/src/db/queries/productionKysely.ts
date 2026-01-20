/**
 * Kysely Production Queries
 *
 * High-performance queries for production batch management.
 * Replaces Prisma nested includes with efficient JOINs.
 *
 * All public exports are validated against Zod schemas to catch schema drift.
 */

import { kysely } from '../index.js';
import {
    tailorRowArraySchema,
    batchRowArraySchema,
    batchOrderLineRowArraySchema,
    capacityRowArraySchema,
    pendingBySkuResultSchema,
    type TailorRow,
    type BatchRow,
    type BatchOrderLineRow,
    type CapacityRow,
    type PendingBySkuResult,
} from '@coh/shared';

// ============================================
// INPUT TYPES (not validated - internal use)
// ============================================

export interface BatchListParams {
    status?: string;
    tailorId?: string;
    startDate?: string;
    endDate?: string;
    customOnly?: boolean;
}

export interface CapacityParams {
    date?: string;
}

// Re-export output types from schemas
export type { TailorRow, BatchRow, BatchOrderLineRow, CapacityRow, PendingBySkuResult };

// ============================================
// QUERIES
// ============================================

/**
 * Get all active tailors
 */
export async function getTailorsKysely(): Promise<TailorRow[]> {
    const rows = await kysely
        .selectFrom('Tailor')
        .select([
            'Tailor.id',
            'Tailor.name',
            'Tailor.specializations',
            'Tailor.dailyCapacityMins',
            'Tailor.isActive',
        ])
        .where('Tailor.isActive', '=', true)
        .orderBy('Tailor.name', 'asc')
        .execute();

    // Validate output against Zod schema
    return tailorRowArraySchema.parse(rows);
}

/**
 * Get production batches with filters
 */
export async function getBatchesKysely(params: BatchListParams): Promise<BatchRow[]> {
    let query = kysely
        .selectFrom('ProductionBatch')
        .leftJoin('Tailor', 'Tailor.id', 'ProductionBatch.tailorId')
        .leftJoin('Sku', 'Sku.id', 'ProductionBatch.skuId')
        .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
        .leftJoin('Product', 'Product.id', 'Variation.productId')
        .leftJoin('Fabric', 'Fabric.id', 'Variation.fabricId')
        .select([
            'ProductionBatch.id',
            'ProductionBatch.batchCode',
            'ProductionBatch.batchDate',
            'ProductionBatch.status',
            'ProductionBatch.qtyPlanned',
            'ProductionBatch.qtyCompleted',
            'ProductionBatch.priority',
            'ProductionBatch.notes',
            'ProductionBatch.sourceOrderLineId',
            'ProductionBatch.sampleCode',
            'ProductionBatch.sampleName',
            'ProductionBatch.sampleColour',
            'ProductionBatch.sampleSize',
            'ProductionBatch.tailorId',
            'Tailor.name as tailorName',
            'ProductionBatch.skuId',
            'Sku.skuCode',
            'Sku.size as skuSize',
            'Sku.isCustomSku',
            'Sku.customizationType',
            'Sku.customizationValue',
            'Sku.customizationNotes',
            'Variation.id as variationId',
            'Variation.colorName',
            'Product.id as productId',
            'Product.name as productName',
            'Variation.fabricId',
            'Fabric.name as fabricName',
        ]);

    // Apply filters
    if (params.status) {
        query = query.where('ProductionBatch.status', '=', params.status) as typeof query;
    }
    if (params.tailorId) {
        query = query.where('ProductionBatch.tailorId', '=', params.tailorId) as typeof query;
    }
    if (params.startDate) {
        query = query.where('ProductionBatch.batchDate', '>=', new Date(params.startDate)) as typeof query;
    }
    if (params.endDate) {
        query = query.where('ProductionBatch.batchDate', '<=', new Date(params.endDate)) as typeof query;
    }
    if (params.customOnly) {
        query = query.where('Sku.isCustomSku', '=', true) as typeof query;
    }

    const rows = await query.orderBy('ProductionBatch.batchDate', 'desc').execute();

    const result = rows.map((r) => ({
        id: r.id,
        batchCode: r.batchCode,
        batchDate: r.batchDate as Date,
        status: r.status,
        qtyPlanned: r.qtyPlanned,
        qtyCompleted: r.qtyCompleted,
        priority: r.priority,
        notes: r.notes,
        sourceOrderLineId: r.sourceOrderLineId,
        sampleCode: r.sampleCode,
        sampleName: r.sampleName,
        sampleColour: r.sampleColour,
        sampleSize: r.sampleSize,
        tailorId: r.tailorId,
        tailorName: r.tailorName,
        skuId: r.skuId,
        skuCode: r.skuCode,
        skuSize: r.skuSize,
        isCustomSku: r.isCustomSku ?? false,
        customizationType: r.customizationType,
        customizationValue: r.customizationValue,
        customizationNotes: r.customizationNotes,
        variationId: r.variationId,
        colorName: r.colorName,
        productId: r.productId,
        productName: r.productName,
        fabricId: r.fabricId,
        fabricName: r.fabricName,
    }));

    // Validate output against Zod schema
    return batchRowArraySchema.parse(result);
}

/**
 * Get order lines linked to batches
 */
export async function getBatchOrderLinesKysely(batchIds: string[]): Promise<BatchOrderLineRow[]> {
    if (batchIds.length === 0) return [];

    const rows = await kysely
        .selectFrom('OrderLine')
        .innerJoin('Order', 'Order.id', 'OrderLine.orderId')
        .select([
            'OrderLine.productionBatchId as batchId',
            'OrderLine.id as orderLineId',
            'Order.id as orderId',
            'Order.orderNumber',
            'Order.customerName',
        ])
        .where('OrderLine.productionBatchId', 'in', batchIds)
        .execute();

    const result = rows.map((r) => ({
        batchId: r.batchId!,
        orderLineId: r.orderLineId,
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        customerName: r.customerName,
    }));

    // Validate output against Zod schema
    return batchOrderLineRowArraySchema.parse(result);
}

/**
 * Get capacity data for a specific date
 */
export async function getCapacityKysely(params: CapacityParams): Promise<CapacityRow[]> {
    const targetDate = params.date ? new Date(params.date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get tailors
    const tailors = await kysely
        .selectFrom('Tailor')
        .select(['Tailor.id', 'Tailor.name', 'Tailor.dailyCapacityMins'])
        .where('Tailor.isActive', '=', true)
        .execute();

    // Get batches for the day with production time
    const batches = await kysely
        .selectFrom('ProductionBatch')
        .leftJoin('Sku', 'Sku.id', 'ProductionBatch.skuId')
        .leftJoin('Variation', 'Variation.id', 'Sku.variationId')
        .leftJoin('Product', 'Product.id', 'Variation.productId')
        .select([
            'ProductionBatch.tailorId',
            'ProductionBatch.qtyPlanned',
            'Product.baseProductionTimeMins',
        ])
        .where('ProductionBatch.batchDate', '>=', startOfDay)
        .where('ProductionBatch.batchDate', '<=', endOfDay)
        .where('ProductionBatch.status', '!=', 'cancelled')
        .execute();

    // Calculate capacity for each tailor
    const result = tailors.map((tailor) => {
        const tailorBatches = batches.filter((b) => b.tailorId === tailor.id);
        const allocatedMins = tailorBatches.reduce((sum, b) => {
            const timePer = b.baseProductionTimeMins || 0;
            return sum + timePer * b.qtyPlanned;
        }, 0);

        return {
            tailorId: tailor.id,
            tailorName: tailor.name,
            dailyCapacityMins: tailor.dailyCapacityMins,
            allocatedMins,
            availableMins: Math.max(0, tailor.dailyCapacityMins - allocatedMins),
            utilizationPct: ((allocatedMins / tailor.dailyCapacityMins) * 100).toFixed(0),
        };
    });

    // Validate output against Zod schema
    return capacityRowArraySchema.parse(result);
}

/**
 * Get pending batches for a specific SKU
 */
export async function getPendingBySkuKysely(
    skuId: string
): Promise<PendingBySkuResult> {
    const rows = await kysely
        .selectFrom('ProductionBatch')
        .leftJoin('Tailor', 'Tailor.id', 'ProductionBatch.tailorId')
        .select([
            'ProductionBatch.id',
            'ProductionBatch.batchCode',
            'ProductionBatch.batchDate',
            'ProductionBatch.qtyPlanned',
            'ProductionBatch.qtyCompleted',
            'ProductionBatch.status',
            'Tailor.id as tailorId',
            'Tailor.name as tailorName',
        ])
        .where('ProductionBatch.skuId', '=', skuId)
        .where('ProductionBatch.status', 'in', ['planned', 'in_progress'])
        .orderBy('ProductionBatch.batchDate', 'asc')
        .execute();

    const batches = rows.map((r) => ({
        id: r.id,
        batchCode: r.batchCode,
        batchDate: r.batchDate,
        qtyPlanned: r.qtyPlanned,
        qtyCompleted: r.qtyCompleted,
        qtyPending: r.qtyPlanned - r.qtyCompleted,
        status: r.status,
        tailor: r.tailorId ? { id: r.tailorId, name: r.tailorName } : null,
    }));

    const result = {
        batches,
        totalPending: batches.reduce((sum, b) => sum + b.qtyPending, 0),
    };

    // Validate output against Zod schema
    return pendingBySkuResultSchema.parse(result);
}
