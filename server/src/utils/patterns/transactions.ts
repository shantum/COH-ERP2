/**
 * Inventory Transaction Helpers
 * Create, release, and validate inventory transactions
 */

import type { Prisma } from '@prisma/client';
import { inventoryBalanceCache } from '../../services/inventoryBalanceCache.js';
import { calculateInventoryBalance } from './inventory.js';
import {
    TXN_TYPE,
    TXN_REASON,
    type PrismaOrTransaction,
    type OutwardValidationResult,
    type SkuValidationResult,
    type SkuValidationParams,
    type SkuWithRelations,
    type TransactionDeletionValidation,
    type TransactionDependency,
    type CreateReservedTransactionParams,
    type CreateSaleTransactionParams,
} from './types.js';

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validate if an outward transaction is allowed
 */
export async function validateOutwardTransaction(
    prisma: PrismaOrTransaction,
    skuId: string,
    qty: number
): Promise<OutwardValidationResult> {
    const balance = await calculateInventoryBalance(prisma, skuId, { allowNegative: true });

    if (balance.currentBalance < 0) {
        return {
            allowed: false,
            reason: `Cannot create outward: balance is already negative (${balance.currentBalance}). Fix data integrity issue first.`,
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
        };
    }

    if (balance.availableBalance < qty) {
        return {
            allowed: false,
            reason: `Insufficient stock: available=${balance.availableBalance}, requested=${qty}`,
            currentBalance: balance.currentBalance,
            availableBalance: balance.availableBalance,
        };
    }

    return {
        allowed: true,
        currentBalance: balance.currentBalance,
        availableBalance: balance.availableBalance,
    };
}

/**
 * Check if a SKU exists and is active
 */
export async function validateSku(
    prisma: PrismaOrTransaction,
    { skuId, skuCode, barcode }: SkuValidationParams
): Promise<SkuValidationResult> {
    let sku: SkuWithRelations | null = null;

    if (skuId) {
        sku = await prisma.sku.findUnique({
            where: { id: skuId },
            include: {
                variation: { include: { product: true } },
            },
        }) as SkuWithRelations | null;
    } else if (barcode) {
        sku = await prisma.sku.findFirst({
            where: { skuCode: barcode },
            include: {
                variation: { include: { product: true } },
            },
        }) as SkuWithRelations | null;
    } else if (skuCode) {
        sku = await prisma.sku.findUnique({
            where: { skuCode },
            include: {
                variation: { include: { product: true } },
            },
        }) as SkuWithRelations | null;
    }

    if (!sku) {
        return { valid: false, error: 'SKU not found' };
    }

    if (!sku.isActive) {
        return { valid: false, error: 'SKU is inactive', sku };
    }

    if (!sku.variation?.product?.isActive) {
        return { valid: false, error: 'Product is inactive', sku };
    }

    return { valid: true, sku };
}

// ============================================
// ALLOCATION TRANSACTIONS
// ============================================

/**
 * Release allocated inventory for an order line
 */
export async function releaseReservedInventory(
    prisma: PrismaOrTransaction,
    orderLineId: string
): Promise<number> {
    const affectedTransactions = await prisma.inventoryTransaction.findMany({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.ORDER_ALLOCATION,
        },
        select: { skuId: true },
    });
    const affectedSkuIds = [...new Set(affectedTransactions.map(t => t.skuId))];

    const result = await prisma.inventoryTransaction.deleteMany({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.ORDER_ALLOCATION,
        },
    });

    if (affectedSkuIds.length > 0) {
        inventoryBalanceCache.invalidate(affectedSkuIds);
    }

    return result.count;
}

/**
 * Release allocated inventory for multiple order lines
 */
export async function releaseReservedInventoryBatch(
    prisma: PrismaOrTransaction,
    orderLineIds: string[]
): Promise<number> {
    const affectedTransactions = await prisma.inventoryTransaction.findMany({
        where: {
            referenceId: { in: orderLineIds },
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.ORDER_ALLOCATION,
        },
        select: { skuId: true },
    });
    const affectedSkuIds = [...new Set(affectedTransactions.map(t => t.skuId))];

    const result = await prisma.inventoryTransaction.deleteMany({
        where: {
            referenceId: { in: orderLineIds },
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.ORDER_ALLOCATION,
        },
    });

    if (affectedSkuIds.length > 0) {
        inventoryBalanceCache.invalidate(affectedSkuIds);
    }

    return result.count;
}

/**
 * Create an allocation inventory transaction
 */
export async function createAllocationTransaction(
    prisma: PrismaOrTransaction,
    { skuId, qty, orderLineId, userId }: CreateReservedTransactionParams
): Promise<Prisma.InventoryTransactionGetPayload<object>> {
    const transaction = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: TXN_TYPE.OUTWARD,
            qty,
            reason: TXN_REASON.ORDER_ALLOCATION,
            referenceId: orderLineId,
            createdById: userId,
        },
    });

    inventoryBalanceCache.invalidate([skuId]);

    return transaction;
}

// Backward compatibility alias
export const createReservedTransaction = createAllocationTransaction;

// ============================================
// SALE TRANSACTIONS
// ============================================

/**
 * Create a sale transaction when shipping
 */
export async function createSaleTransaction(
    prisma: PrismaOrTransaction,
    { skuId, qty, orderLineId, userId }: CreateSaleTransactionParams
): Promise<Prisma.InventoryTransactionGetPayload<object>> {
    const transaction = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: TXN_TYPE.OUTWARD,
            qty,
            reason: TXN_REASON.SALE,
            referenceId: orderLineId,
            createdById: userId,
        },
    });

    inventoryBalanceCache.invalidate([skuId]);

    return transaction;
}

/**
 * Delete sale transactions for an order line
 */
export async function deleteSaleTransactions(
    prisma: PrismaOrTransaction,
    orderLineId: string
): Promise<number> {
    const affectedTransactions = await prisma.inventoryTransaction.findMany({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.SALE,
        },
        select: { skuId: true },
    });
    const affectedSkuIds = [...new Set(affectedTransactions.map(t => t.skuId))];

    const result = await prisma.inventoryTransaction.deleteMany({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.OUTWARD,
            reason: TXN_REASON.SALE,
        },
    });

    if (affectedSkuIds.length > 0) {
        inventoryBalanceCache.invalidate(affectedSkuIds);
    }

    return result.count;
}

// ============================================
// IDEMPOTENCY HELPERS
// ============================================

/**
 * Check if an RTO inward transaction already exists
 */
export async function findExistingRtoInward(
    prisma: PrismaOrTransaction,
    orderLineId: string
): Promise<Prisma.InventoryTransactionGetPayload<object> | null> {
    return prisma.inventoryTransaction.findFirst({
        where: {
            referenceId: orderLineId,
            txnType: TXN_TYPE.INWARD,
            reason: TXN_REASON.RTO_RECEIVED,
        },
    });
}

// ============================================
// DELETION VALIDATION
// ============================================

/**
 * Check if an inventory transaction can be safely deleted
 */
export async function validateTransactionDeletion(
    prisma: PrismaOrTransaction,
    transactionId: string
): Promise<TransactionDeletionValidation> {
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
        return { canDelete: false, reason: 'Transaction not found' };
    }

    const dependencies: TransactionDependency[] = [];

    // For inward transactions, check if deleting would cause negative balance
    if (transaction.txnType === TXN_TYPE.INWARD) {
        const balance = await calculateInventoryBalance(prisma, transaction.skuId, { allowNegative: true });
        const balanceAfterDeletion = balance.currentBalance - transaction.qty;

        if (balanceAfterDeletion < 0) {
            dependencies.push({
                type: 'negative_balance',
                message: `Deleting would cause negative balance (${balanceAfterDeletion})`,
                currentBalance: balance.currentBalance,
                transactionQty: transaction.qty,
            });
        }
    }

    // For allocation transactions, check if order line is still allocated
    if (transaction.txnType === TXN_TYPE.OUTWARD &&
        transaction.reason === TXN_REASON.ORDER_ALLOCATION &&
        transaction.referenceId) {
        const orderLine = await prisma.orderLine.findFirst({
            where: { id: transaction.referenceId },
            include: { order: { select: { status: true, orderNumber: true } } },
        });

        if (orderLine && ['allocated', 'picked', 'packed', 'shipped'].includes(orderLine.lineStatus)) {
            dependencies.push({
                type: 'active_allocation',
                message: `Order line ${orderLine.order?.orderNumber} is still allocated/shipped`,
                orderNumber: orderLine.order?.orderNumber,
                lineStatus: orderLine.lineStatus,
            });
        }
    }

    // For return_receipt transactions, check if repacking item would become orphaned
    if (transaction.reason === TXN_REASON.RETURN_RECEIPT && transaction.referenceId) {
        const repackItem = await prisma.repackingQueueItem.findUnique({
            where: { id: transaction.referenceId },
        });

        if (repackItem && repackItem.status === 'ready') {
            dependencies.push({
                type: 'repacking_queue_item',
                message: 'Associated repacking queue item is in ready status',
                repackItemId: repackItem.id,
            });
        }
    }

    // For production transactions, check if the production batch is still completed
    if ((transaction.reason === TXN_REASON.PRODUCTION || transaction.reason === 'production_custom') && transaction.referenceId) {
        const productionBatch = await prisma.productionBatch.findUnique({
            where: { id: transaction.referenceId },
            include: {
                sku: { select: { skuCode: true, isCustomSku: true } },
            },
        });

        if (productionBatch && productionBatch.status === 'completed') {
            if (productionBatch.sku?.isCustomSku && productionBatch.sourceOrderLineId) {
                const sourceOrderLine = await prisma.orderLine.findUnique({
                    where: { id: productionBatch.sourceOrderLineId },
                    select: { lineStatus: true },
                });
                if (sourceOrderLine) {
                    const lineStatus = sourceOrderLine.lineStatus;
                    if (['picked', 'packed', 'shipped'].includes(lineStatus)) {
                        dependencies.push({
                            type: 'order_progression',
                            message: `Cannot delete - linked order line has progressed to ${lineStatus}`,
                            hint: 'Unship or unpick the order line first',
                        });
                    }
                }
            }
        }
    }

    return {
        canDelete: dependencies.length === 0,
        reason: dependencies.length > 0 ? 'Transaction has dependencies that must be resolved first' : null,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
        transaction: {
            id: transaction.id,
            skuCode: transaction.sku?.skuCode,
            txnType: transaction.txnType,
            qty: transaction.qty,
            reason: transaction.reason,
        },
    };
}
