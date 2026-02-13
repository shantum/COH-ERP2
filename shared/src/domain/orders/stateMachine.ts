/**
 * Order Line Status State Machine - Pure Domain Logic
 * Single source of truth for all line status transitions.
 * NO DATABASE DEPENDENCIES - pure functions only.
 *
 * STATUS FLOW:
 * pending → allocated → picked → packed → shipped
 *    ↓         ↓          ↓        ↓
 * cancelled  cancelled  cancelled cancelled
 *    ↓
 * pending (uncancel)
 *
 * Backward corrections: Each status can go back one step.
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

export type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'shipped' | 'delivered' | 'cancelled';

export type InventoryEffect = 'none' | 'create_outward' | 'delete_outward';

export type TimestampField = 'allocatedAt' | 'pickedAt' | 'packedAt' | 'shippedAt' | 'deliveredAt';

export interface TimestampAction {
    field: TimestampField;
    action: 'set' | 'clear';
}

export interface TransitionDefinition {
    to: LineStatus;
    inventoryEffect: InventoryEffect;
    timestamps: TimestampAction[];
    requiresStockCheck?: boolean;
    requiresShipData?: boolean;
    description: string;
}

export interface TransitionContext {
    lineId: string;
    skuId: string;
    qty: number;
    userId: string;
    shipData?: { awbNumber: string; courier: string };
}

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
            to: 'pending',
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
            to: 'allocated',
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
            to: 'picked',
            inventoryEffect: 'none',
            timestamps: [{ field: 'packedAt', action: 'clear' }],
            description: 'Unpack (return to picked)',
        },
        {
            to: 'shipped',
            inventoryEffect: 'none',
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
        {
            to: 'packed',
            inventoryEffect: 'none',
            timestamps: [{ field: 'shippedAt', action: 'clear' }],
            description: 'Unship (return to packed, clear AWB)',
        },
        {
            to: 'delivered',
            inventoryEffect: 'none',
            timestamps: [{ field: 'deliveredAt', action: 'set' }],
            description: 'Mark as delivered (confirmed by tracking or channel)',
        },
    ],

    delivered: [
        {
            to: 'shipped',
            inventoryEffect: 'none',
            timestamps: [{ field: 'deliveredAt', action: 'clear' }],
            description: 'Revert to shipped (delivery was incorrect)',
        },
    ],

    cancelled: [
        {
            to: 'pending',
            inventoryEffect: 'none',
            timestamps: [],
            description: 'Uncancel (restore to pending)',
        },
    ],
};

export const LINE_STATUSES: readonly LineStatus[] = [
    'pending', 'allocated', 'picked', 'packed', 'shipped', 'delivered', 'cancelled',
] as const;

/**
 * Statuses with allocated inventory (have an OUTWARD transaction).
 * Does NOT include 'shipped' - once shipped, inventory is already deducted.
 */
export const STATUSES_WITH_ALLOCATED_INVENTORY: readonly LineStatus[] = [
    'allocated', 'picked', 'packed',
] as const;

// ============================================
// VALIDATION FUNCTIONS
// ============================================

export function isValidTransition(from: LineStatus, to: LineStatus): boolean {
    const transitions = LINE_STATUS_TRANSITIONS[from];
    if (!transitions) return false;
    return transitions.some(t => t.to === to);
}

export function getTransitionDefinition(
    from: LineStatus,
    to: LineStatus
): TransitionDefinition | null {
    const transitions = LINE_STATUS_TRANSITIONS[from];
    if (!transitions) return null;
    return transitions.find(t => t.to === to) || null;
}

export function getValidTargetStatuses(from: LineStatus): LineStatus[] {
    const transitions = LINE_STATUS_TRANSITIONS[from];
    if (!transitions) return [];
    return transitions.map(t => t.to);
}

export function isValidLineStatus(status: string): status is LineStatus {
    return (LINE_STATUSES as readonly string[]).includes(status);
}

export function transitionAffectsInventory(from: LineStatus, to: LineStatus): boolean {
    const def = getTransitionDefinition(from, to);
    if (!def) return false;
    return def.inventoryEffect !== 'none';
}

export function releasesInventory(from: LineStatus, to: LineStatus): boolean {
    const def = getTransitionDefinition(from, to);
    return def?.inventoryEffect === 'delete_outward';
}

export function allocatesInventory(from: LineStatus, to: LineStatus): boolean {
    const def = getTransitionDefinition(from, to);
    return def?.inventoryEffect === 'create_outward';
}

/**
 * Check if a status has allocated inventory (OUTWARD transaction exists).
 * Used for both server cleanup and client optimistic updates.
 */
export function hasAllocatedInventory(status: string | undefined | null): boolean {
    if (!status) return false;
    return (STATUSES_WITH_ALLOCATED_INVENTORY as readonly string[]).includes(status);
}

export function buildTransitionError(from: string, to: string): string {
    const validFrom = isValidLineStatus(from) ? from : 'unknown';
    const allowed = isValidLineStatus(from) ? getValidTargetStatuses(from) : [];
    return `Cannot transition from '${validFrom}' to '${to}'. Allowed: ${allowed.join(', ') || 'none'}`;
}

// ============================================
// INVENTORY DELTA (for optimistic updates)
// ============================================

/**
 * Calculate inventory change for a status transition.
 * Uses the state machine's inventoryEffect as the source of truth.
 */
export function calculateInventoryDelta(fromStatus: string, toStatus: string, qty: number): number {
    if (!isValidLineStatus(fromStatus) || !isValidLineStatus(toStatus)) return 0;

    const def = getTransitionDefinition(fromStatus, toStatus);
    if (!def) return 0;  // Invalid transition = no change

    if (def.inventoryEffect === 'create_outward') return -qty;  // Allocating (deduct)
    if (def.inventoryEffect === 'delete_outward') return qty;   // Releasing (restore)
    return 0;  // No inventory effect
}

// ============================================
// ORDER STATUS COMPUTATION
// ============================================

export type OrderStatus =
    | 'open'
    | 'delivered'
    | 'shipped'
    | 'partially_shipped'
    | 'returned'
    | 'cancelled'
    | 'archived';

export const SHIPPED_OR_BEYOND = ['shipped', 'delivered'] as const;

export interface OrderLineForStatus {
    lineStatus: string;
    trackingStatus?: string | null;
}

export interface OrderForStatusComputation {
    isArchived?: boolean;
    orderLines: OrderLineForStatus[];
}

/**
 * Compute order status from line states (pure function).
 * Order status is derived, never set independently.
 *
 * Priority: archived > cancelled > returned > delivered > shipped > partially_shipped > open
 */
export function computeOrderStatus(order: OrderForStatusComputation): OrderStatus {
    if (!order?.orderLines) {
        throw new Error('Order with orderLines is required');
    }

    if (order.isArchived) return 'archived';

    const activeLines = order.orderLines.filter((l) => l.lineStatus !== 'cancelled');

    if (activeLines.length === 0) return 'cancelled';

    // Returned: all active lines are shipped/delivered AND have RTO tracking
    const allShippedOrDelivered = activeLines.every((l) =>
        (SHIPPED_OR_BEYOND as readonly string[]).includes(l.lineStatus)
    );
    if (allShippedOrDelivered) {
        const allRtoDelivered = activeLines.every((l) => l.trackingStatus === 'rto_delivered');
        if (allRtoDelivered) return 'returned';
    }

    const deliveredLines = activeLines.filter((l) => l.lineStatus === 'delivered');
    if (deliveredLines.length === activeLines.length) return 'delivered';

    const shippedOrBeyond = activeLines.filter((l) =>
        (SHIPPED_OR_BEYOND as readonly string[]).includes(l.lineStatus)
    );
    if (shippedOrBeyond.length === activeLines.length) return 'shipped';
    if (shippedOrBeyond.length > 0) return 'partially_shipped';

    return 'open';
}
