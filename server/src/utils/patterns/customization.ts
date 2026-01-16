/**
 * Custom SKU Workflow
 * Create and remove custom SKUs for order lines
 */

import type { PrismaClient } from '@prisma/client';
import type {
    CustomizationData,
    CreateCustomSkuResult,
    RemoveCustomizationOptions,
    RemoveCustomizationResult,
} from './types.js';

/**
 * Create a custom SKU for an order line
 * Generates a unique custom SKU code in format {BASE_SKU}-C{XX}
 */
export async function createCustomSku(
    prisma: PrismaClient,
    baseSkuId: string,
    customizationData: CustomizationData,
    orderLineId: string,
    userId: string
): Promise<CreateCustomSkuResult> {
    return prisma.$transaction(async (tx) => {
        // 1. Validate order line exists and is in pending status
        const orderLine = await tx.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                order: { select: { status: true, orderNumber: true } },
                sku: true,
            },
        });

        if (!orderLine) {
            throw new Error('ORDER_LINE_NOT_FOUND');
        }

        if (orderLine.lineStatus !== 'pending') {
            throw new Error('LINE_NOT_PENDING');
        }

        if (orderLine.isCustomized) {
            throw new Error('ALREADY_CUSTOMIZED');
        }

        // 2. Get base SKU and atomically increment counter
        const baseSku = await tx.sku.update({
            where: { id: baseSkuId },
            data: { customizationCount: { increment: 1 } },
            include: { variation: true },
        });

        // 3. Generate custom SKU code
        const count = baseSku.customizationCount;
        const customCode = `${baseSku.skuCode}-C${String(count).padStart(2, '0')}`;

        // 4. Create new Sku record for custom piece
        const customSku = await tx.sku.create({
            data: {
                skuCode: customCode,
                variationId: baseSku.variationId,
                size: baseSku.size,
                mrp: baseSku.mrp,
                isActive: true,
                isCustomSku: true,
                parentSkuId: baseSkuId,
                customizationType: customizationData.type,
                customizationValue: customizationData.value,
                customizationNotes: customizationData.notes || null,
                linkedOrderLineId: orderLineId,
                fabricConsumption: baseSku.fabricConsumption,
            },
        });

        // 5. Update order line to point to custom SKU
        const updatedLine = await tx.orderLine.update({
            where: { id: orderLineId },
            data: {
                skuId: customSku.id,
                originalSkuId: baseSkuId,
                isCustomized: true,
                isNonReturnable: true,
                customizedAt: new Date(),
                customizedById: userId,
            },
            include: {
                sku: {
                    include: {
                        parentSku: true,
                        variation: { include: { product: true } },
                    },
                },
                order: { select: { orderNumber: true } },
            },
        });

        return {
            customSku,
            orderLine: updatedLine,
            originalSkuCode: baseSku.skuCode,
        };
    }, {
        maxWait: 15000,
        timeout: 15000,
    });
}

/**
 * Remove customization from an order line
 * Reverts the line to original SKU and deletes the custom SKU
 */
export async function removeCustomization(
    prisma: PrismaClient,
    orderLineId: string,
    options: RemoveCustomizationOptions = {}
): Promise<RemoveCustomizationResult> {
    const { force = false } = options;

    return prisma.$transaction(async (tx) => {
        // 1. Get order line with custom SKU
        const orderLine = await tx.orderLine.findUnique({
            where: { id: orderLineId },
            include: {
                sku: true,
                order: { select: { orderNumber: true } },
            },
        });

        if (!orderLine) {
            throw new Error('ORDER_LINE_NOT_FOUND');
        }

        if (!orderLine.isCustomized || !orderLine.originalSkuId) {
            throw new Error('NOT_CUSTOMIZED');
        }

        const customSkuId = orderLine.skuId;

        // 2. Check if custom SKU has inventory transactions
        const txnCount = await tx.inventoryTransaction.count({
            where: { skuId: customSkuId },
        });

        if (txnCount > 0) {
            if (!force) {
                throw new Error('CANNOT_UNDO_HAS_INVENTORY');
            }
            await tx.inventoryTransaction.deleteMany({
                where: { skuId: customSkuId },
            });
        }

        // 3. Check if production batch exists for this custom SKU
        const batchCount = await tx.productionBatch.count({
            where: { skuId: customSkuId },
        });

        if (batchCount > 0) {
            if (!force) {
                throw new Error('CANNOT_UNDO_HAS_PRODUCTION');
            }
            await tx.productionBatch.deleteMany({
                where: { skuId: customSkuId },
            });
        }

        // 4. Revert order line to original SKU
        const updatedLine = await tx.orderLine.update({
            where: { id: orderLineId },
            data: {
                skuId: orderLine.originalSkuId,
                originalSkuId: null,
                isCustomized: false,
                isNonReturnable: false,
                customizedAt: null,
                customizedById: null,
            },
            include: {
                sku: {
                    include: {
                        variation: { include: { product: true } },
                    },
                },
                order: { select: { orderNumber: true } },
            },
        });

        // 5. Delete the custom SKU record
        await tx.sku.delete({ where: { id: customSkuId } });

        return {
            success: true,
            orderLine: updatedLine,
            deletedCustomSkuCode: orderLine.sku.skuCode,
            forcedCleanup: force && (txnCount > 0 || batchCount > 0),
            deletedTransactions: force ? txnCount : 0,
            deletedBatches: force ? batchCount : 0,
        };
    }, {
        maxWait: 15000,
        timeout: 15000,
    });
}
