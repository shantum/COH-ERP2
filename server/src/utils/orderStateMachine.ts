/**
 * Order Line Status State Machine
 * Single source of truth for all line status transitions
 *
 * STATUS FLOW:
 * pending → allocated → picked → packed → shipped
 *    ↓         ↓          ↓        ↓
 * cancelled  cancelled  cancelled cancelled
 *    ↓
 * pending (uncancel)
 *
 * Design principles:
 * 1. Forward progression: pending → allocated → picked → packed → shipped
 * 2. Backward corrections: Each status can go back one step (except shipped)
 * 3. Cancellation: Any non-shipped status can be cancelled
 * 4. Uncancellation: cancelled → pending (restores to start)
 *
 * @module utils/orderStateMachine
 */

import type { PrismaOrTransaction } from './patterns/types.js';
import {
    TXN_TYPE,
    TXN_REASON,
    type LineStatus,
} from './patterns/types.js';
import { calculateInventoryBalance } from './patterns/inventory.js';
import { releaseReservedInventory } from './patterns/transactions.js';
import { inventoryBalanceCache } from '../services/inventoryBalanceCache.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Re-export LineStatus for convenience
 */
export type { LineStatus } from './patterns/types.js';

/**
 * Inventory effect to apply during a transition
 */
export type InventoryEffect =
    | 'none'           // No inventory change
    | 'create_outward' // Allocate: Create OUTWARD transaction
    | 'delete_outward'; // Unallocate/Cancel: Delete OUTWARD transaction

/**
 * Timestamp field to update during a transition
 */
export type TimestampField =
    | 'allocatedAt'
    | 'pickedAt'
    | 'packedAt'
    | 'shippedAt';

/**
 * Timestamp action to apply during a transition
 */
export interface TimestampAction {
    field: TimestampField;
    action: 'set' | 'clear';
}

/**
 * Complete definition of a status transition
 */
export interface TransitionDefinition {
    /** Target status after transition */
    to: LineStatus;
    /** Inventory side effect */
    inventoryEffect: InventoryEffect;
    /** Timestamp updates to apply */
    timestamps: TimestampAction[];
    /** Whether stock check is required (for allocate) */
    requiresStockCheck?: boolean;
    /** Whether AWB data is required (for ship) */
    requiresShipData?: boolean;
    /** Human-readable description */
    description: string;
}

/**
 * Context required for executing a transition
 */
export interface TransitionContext {
    lineId: string;
    skuId: string;
    qty: number;
    userId: string;
    /** AWB and courier data (required for shipping) */
    shipData?: {
        awbNumber: string;
        courier: string;
    };
}

/**
 * Result of executing a transition
 */
export interface TransitionResult {
    success: boolean;
    lineId: string;
    previousStatus: LineStatus;
    newStatus: LineStatus;
    inventoryUpdated: boolean;
    timestampsUpdated: TimestampField[];
    error?: string;
}

// ============================================
// STATE MACHINE DEFINITION
// ============================================

/**
 * Valid status transitions matrix
 * Single source of truth for all line status transitions
 */
export const LINE_STATUS_TRANSITIONS: Record<LineStatus, TransitionDefinition[]> = {
    pending: [
        {
            to: 'allocated',
            inventoryEffect: 'create_outward',
            timestamps: [{ field: 'allocatedAt', action: 'set' }],
            requiresStockCheck: true,
            description: 'Allocate inventory for this line',
        },
        {
            to: 'cancelled',
            inventoryEffect: 'none',
            timestamps: [],
            description: 'Cancel line (no inventory to release)',
        },
    ],

    allocated: [
        {
            to: 'pending',  // Unallocate
            inventoryEffect: 'delete_outward',
            timestamps: [{ field: 'allocatedAt', action: 'clear' }],
            description: 'Unallocate (return to pending, restore inventory)',
        },
        {
            to: 'picked',
            inventoryEffect: 'none',
            timestamps: [{ field: 'pickedAt', action: 'set' }],
            description: 'Mark as picked from warehouse',
        },
        {
            to: 'cancelled',
            inventoryEffect: 'delete_outward',
            timestamps: [],
            description: 'Cancel line (release allocated inventory)',
        },
    ],

    picked: [
        {
            to: 'allocated',  // Unpick
            inventoryEffect: 'none',
            timestamps: [{ field: 'pickedAt', action: 'clear' }],
            description: 'Unpick (return to allocated)',
        },
        {
            to: 'packed',
            inventoryEffect: 'none',
            timestamps: [{ field: 'packedAt', action: 'set' }],
            description: 'Mark as packed for shipment',
        },
        {
            to: 'cancelled',
            inventoryEffect: 'delete_outward',
            timestamps: [],
            description: 'Cancel line (release allocated inventory)',
        },
    ],

    packed: [
        {
            to: 'picked',  // Unpack
            inventoryEffect: 'none',
            timestamps: [{ field: 'packedAt', action: 'clear' }],
            description: 'Unpack (return to picked)',
        },
        {
            to: 'shipped',
            inventoryEffect: 'none',  // Inventory already deducted at allocation
            timestamps: [{ field: 'shippedAt', action: 'set' }],
            requiresShipData: true,
            description: 'Mark as shipped (requires AWB)',
        },
        {
            to: 'cancelled',
            inventoryEffect: 'delete_outward',
            timestamps: [],
            description: 'Cancel line (release allocated inventory)',
        },
    ],

    shipped: [
        // No transitions allowed via standard endpoint
        // Post-ship statuses (delivered, RTO) are handled by separate procedures
    ],

    cancelled: [
        {
            to: 'pending',  // Uncancel
            inventoryEffect: 'none',
            timestamps: [],
            description: 'Uncancel (restore to pending)',
        },
    ],
};

/**
 * All valid line statuses (ordered by progression)
 */
export const LINE_STATUSES: readonly LineStatus[] = [
    'pending',
    'allocated',
    'picked',
    'packed',
    'shipped',
    'cancelled',
] as const;

/**
 * Statuses that have allocated inventory (need release on cancel)
 */
export const STATUSES_WITH_ALLOCATED_INVENTORY: readonly LineStatus[] = [
    'allocated',
    'picked',
    'packed',
] as const;

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Check if a status transition is valid
 * This is the SINGLE SOURCE OF TRUTH for transition validation
 *
 * @param from - Current line status
 * @param to - Target line status
 * @returns Whether the transition is valid
 */
export function isValidTransition(from: LineStatus, to: LineStatus): boolean {
    const transitions = LINE_STATUS_TRANSITIONS[from];
    if (!transitions) return false;
    return transitions.some(t => t.to === to);
}

/**
 * Get the transition definition for a specific status change
 *
 * @param from - Current line status
 * @param to - Target line status
 * @returns Transition definition or null if invalid
 */
export function getTransitionDefinition(
    from: LineStatus,
    to: LineStatus
): TransitionDefinition | null {
    const transitions = LINE_STATUS_TRANSITIONS[from];
    if (!transitions) return null;
    return transitions.find(t => t.to === to) || null;
}

/**
 * Get all valid target statuses from a given status
 *
 * @param from - Current line status
 * @returns Array of valid target statuses
 */
export function getValidTargetStatuses(from: LineStatus): LineStatus[] {
    const transitions = LINE_STATUS_TRANSITIONS[from];
    if (!transitions) return [];
    return transitions.map(t => t.to);
}

/**
 * Check if a status is a valid LineStatus
 *
 * @param status - Status string to validate
 * @returns Type guard for LineStatus
 */
export function isValidLineStatus(status: string): status is LineStatus {
    return (LINE_STATUSES as readonly string[]).includes(status);
}

/**
 * Check if a transition requires inventory operations
 *
 * @param from - Current line status
 * @param to - Target line status
 * @returns Whether inventory will be affected
 */
export function transitionAffectsInventory(from: LineStatus, to: LineStatus): boolean {
    const def = getTransitionDefinition(from, to);
    if (!def) return false;
    return def.inventoryEffect !== 'none';
}

/**
 * Check if a status transition releases inventory
 */
export function releasesInventory(from: LineStatus, to: LineStatus): boolean {
    const def = getTransitionDefinition(from, to);
    return def?.inventoryEffect === 'delete_outward';
}

/**
 * Check if a status transition allocates inventory
 */
export function allocatesInventory(from: LineStatus, to: LineStatus): boolean {
    const def = getTransitionDefinition(from, to);
    return def?.inventoryEffect === 'create_outward';
}

/**
 * Check if a status has allocated inventory
 */
export function hasAllocatedInventory(status: LineStatus): boolean {
    return (STATUSES_WITH_ALLOCATED_INVENTORY as readonly string[]).includes(status);
}

/**
 * Build a validation error message for invalid transitions
 * Consistent error format across all endpoints
 */
export function buildTransitionError(from: string, to: string): string {
    const validFrom = isValidLineStatus(from) ? from : 'unknown';
    const allowed = isValidLineStatus(from) ? getValidTargetStatuses(from) : [];
    return `Cannot transition from '${validFrom}' to '${to}'. Allowed: ${allowed.join(', ') || 'none'}`;
}

// ============================================
// TRANSITION EXECUTION
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
    from: LineStatus,
    to: LineStatus,
    context: TransitionContext
): Promise<TransitionResult> {
    const { lineId, skuId, qty, userId, shipData } = context;

    // 1. Get transition definition
    const definition = getTransitionDefinition(from, to);
    if (!definition) {
        return {
            success: false,
            lineId,
            previousStatus: from,
            newStatus: from,
            inventoryUpdated: false,
            timestampsUpdated: [],
            error: buildTransitionError(from, to),
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
    const timestampsUpdated: TimestampField[] = [];

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

// ============================================
// DEFAULT EXPORT
// ============================================

export default {
    // Types are exported separately via `export type`

    // Constants
    LINE_STATUS_TRANSITIONS,
    LINE_STATUSES,
    STATUSES_WITH_ALLOCATED_INVENTORY,

    // Validation functions
    isValidTransition,
    getTransitionDefinition,
    getValidTargetStatuses,
    isValidLineStatus,
    transitionAffectsInventory,
    releasesInventory,
    allocatesInventory,
    hasAllocatedInventory,
    buildTransitionError,

    // Execution
    executeTransition,
};
