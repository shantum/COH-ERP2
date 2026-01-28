/**
 * Order Line Status State Machine
 * Re-exports pure logic from @coh/shared, provides DB-dependent execution.
 */

// Re-export all pure logic from shared
export type {
    LineStatus,
    InventoryEffect,
    TimestampField,
    TimestampAction,
    TransitionDefinition,
    TransitionContext,
    TransitionResult,
} from '@coh/shared/domain';

export {
    LINE_STATUS_TRANSITIONS,
    LINE_STATUSES,
    STATUSES_WITH_ALLOCATED_INVENTORY,
    isValidTransition,
    getTransitionDefinition,
    getValidTargetStatuses,
    isValidLineStatus,
    transitionAffectsInventory,
    releasesInventory,
    allocatesInventory,
    hasAllocatedInventory,
    buildTransitionError,
    calculateInventoryDelta,
} from '@coh/shared/domain';

// Server-only imports for executeTransition
import type { PrismaOrTransaction } from './patterns/types.js';
import { TXN_TYPE, TXN_REASON } from './patterns/types.js';
import { calculateInventoryBalance } from './patterns/inventory.js';
import { releaseReservedInventory } from './patterns/transactions.js';
import { inventoryBalanceCache } from '../services/inventoryBalanceCache.js';

// Import shared types for internal use in executeTransition
import type {
    LineStatus as SharedLineStatus,
    TransitionContext as SharedContext,
    TransitionResult as SharedResult,
    TimestampField as SharedTimestampField,
} from '@coh/shared/domain';

import {
    getTransitionDefinition as sharedGetDef,
    buildTransitionError as sharedBuildError,
} from '@coh/shared/domain';

// ============================================
// TRANSITION EXECUTION (DB-dependent)
// ============================================

/**
 * Execute a line status transition with all side effects
 *
 * This is the unified function that handles:
 * 1. Transition validation
 * 2. Inventory side effects (create/delete transactions)
 * 3. Timestamp updates
 * 4. Line status update
 *
 * MUST be called within a Prisma transaction for atomicity.
 *
 * @param tx - Prisma transaction client
 * @param from - Current line status
 * @param to - Target line status
 * @param context - Context with lineId, skuId, qty, userId, shipData
 * @returns Transition result
 *
 * @example
 * ```typescript
 * const result = await prisma.$transaction(async (tx) => {
 *     return await executeTransition(tx, 'pending', 'allocated', {
 *         lineId: 'line123',
 *         skuId: 'sku456',
 *         qty: 2,
 *         userId: 'user789',
 *     });
 * });
 * ```
 */
export async function executeTransition(
    tx: PrismaOrTransaction,
    from: SharedLineStatus,
    to: SharedLineStatus,
    context: SharedContext
): Promise<SharedResult> {
    const { lineId, skuId, qty, userId, shipData } = context;

    // 1. Get transition definition
    const definition = sharedGetDef(from, to);
    if (!definition) {
        return {
            success: false,
            lineId,
            previousStatus: from,
            newStatus: from,
            inventoryUpdated: false,
            timestampsUpdated: [],
            error: sharedBuildError(from, to),
        };
    }

    // 2. Validate ship data if required
    if (definition.requiresShipData && !shipData?.awbNumber) {
        return {
            success: false,
            lineId,
            previousStatus: from,
            newStatus: from,
            inventoryUpdated: false,
            timestampsUpdated: [],
            error: 'AWB number is required for shipping',
        };
    }

    // 3. Check stock if required (for allocation)
    if (definition.requiresStockCheck) {
        const balance = await calculateInventoryBalance(tx, skuId);
        if (balance.availableBalance < qty) {
            return {
                success: false,
                lineId,
                previousStatus: from,
                newStatus: from,
                inventoryUpdated: false,
                timestampsUpdated: [],
                error: `Insufficient stock: ${balance.availableBalance} available, ${qty} required`,
            };
        }
    }

    // 4. Execute inventory side effect
    let inventoryUpdated = false;
    if (definition.inventoryEffect === 'create_outward') {
        await tx.inventoryTransaction.create({
            data: {
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty,
                reason: TXN_REASON.ORDER_ALLOCATION,
                referenceId: lineId,
                createdById: userId,
            },
        });
        inventoryBalanceCache.invalidate([skuId]);
        inventoryUpdated = true;
    } else if (definition.inventoryEffect === 'delete_outward') {
        await releaseReservedInventory(tx, lineId);
        // Note: releaseReservedInventory already invalidates cache
        inventoryUpdated = true;
    }

    // 5. Build update data with timestamps
    const updateData: Record<string, unknown> = { lineStatus: to };
    const timestampsUpdated: SharedTimestampField[] = [];

    for (const { field, action } of definition.timestamps) {
        if (action === 'set') {
            updateData[field] = new Date();
        } else {
            updateData[field] = null;
        }
        timestampsUpdated.push(field);
    }

    // 6. Add ship data if shipping
    if (to === 'shipped' && shipData) {
        updateData.awbNumber = shipData.awbNumber;
        updateData.courier = shipData.courier;
        updateData.trackingStatus = 'in_transit';
    }

    // 6b. Clear ship data if unshipping
    if (from === 'shipped' && to === 'packed') {
        updateData.awbNumber = null;
        updateData.courier = null;
        updateData.trackingStatus = null;
    }

    // 7. Update the line
    await tx.orderLine.update({
        where: { id: lineId },
        data: updateData,
    });

    return {
        success: true,
        lineId,
        previousStatus: from,
        newStatus: to,
        inventoryUpdated,
        timestampsUpdated,
    };
}
