/**
 * @module routes/returns/types
 * Type definitions and shared utilities for returns module
 */

import type { PrismaClient } from '@prisma/client';

// ============================================
// TYPE DEFINITIONS
// ============================================

export type ReturnStatus =
    | 'requested'
    | 'reverse_initiated'
    | 'in_transit'
    | 'received'
    | 'processing'
    | 'resolved'
    | 'cancelled'
    | 'completed';

export type ItemCondition = 'good' | 'used' | 'damaged' | 'wrong_product';

export interface ReturnLineInput {
    skuId: string;
    qty?: number;
    exchangeSkuId?: string;
    unitPrice?: number;
}

export interface CreateReturnBody {
    requestType: string;
    resolution?: string;
    originalOrderId: string;
    reasonCategory?: string;
    reasonDetails?: string;
    lines: ReturnLineInput[];
    returnValue?: number;
    replacementValue?: number;
    valueDifference?: number;
    courier?: string;
    awbNumber?: string;
}

export interface UpdateReturnBody {
    courier?: string;
    awbNumber?: string;
    reasonCategory?: string;
    reasonDetails?: string;
}

export interface ReceiveItemBody {
    lineId: string;
    condition: ItemCondition;
}

export interface ResolveBody {
    resolutionType?: string;
    resolutionNotes?: string;
    refundAmount?: number;
}

export interface ShipReplacementBody {
    courier: string;
    awbNumber: string;
    notes?: string;
}

// ============================================
// STATUS TRANSITION VALIDATION (State Machine)
// ============================================

/**
 * Valid status transitions for return requests (state machine)
 * Key = current status, Value = array of allowed next statuses
 *
 * Terminal states (no transitions allowed):
 * - resolved: Return fully processed
 * - cancelled: Return cancelled
 * - completed: Legacy terminal state
 *
 * Special transitions:
 * - received -> reverse_initiated: Undo receive (reverts status)
 * - Any non-terminal -> cancelled: Soft cancel (keeps data)
 *
 * GOTCHA: 'new' is pseudo-state during creation - allows any first status.
 */
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    'requested': ['reverse_initiated', 'in_transit', 'cancelled'],
    'reverse_initiated': ['in_transit', 'received', 'cancelled'],
    'in_transit': ['received', 'cancelled'],
    'received': ['processing', 'resolved', 'cancelled', 'reverse_initiated'], // reverse_initiated for undo
    'processing': ['resolved', 'cancelled'],
    'resolved': [], // Terminal state - no transitions allowed
    'cancelled': [], // Terminal state - no transitions allowed
    'completed': [], // Terminal state - no transitions allowed
};

/**
 * Validates if a status transition is allowed
 */
export function isValidStatusTransition(fromStatus: string, toStatus: string): boolean {
    // Allow same status (no-op)
    if (fromStatus === toStatus) return true;

    // Special case for 'new' (initial state during creation)
    if (fromStatus === 'new') return true;

    const allowedTransitions = VALID_STATUS_TRANSITIONS[fromStatus];
    if (!allowedTransitions) return false;

    return allowedTransitions.includes(toStatus);
}

/**
 * Sanitize search input to prevent SQL injection
 * Removes SQL special characters and limits length.
 */
export function sanitizeSearchInput(input: string | undefined): string {
    if (!input || typeof input !== 'string') return '';
    // Remove SQL special characters and escape sequences
    return input
        .replace(/['"\\;%_]/g, '') // Remove quotes, backslash, semicolon, wildcards
        .replace(/--/g, '') // Remove SQL comments
        .trim()
        .slice(0, 100); // Limit length
}

// ============================================
// HELPERS
// ============================================

/**
 * Update return request status with state machine validation
 * Creates status history entry in transaction.
 */
export async function updateStatus(
    prisma: PrismaClient,
    requestId: string,
    newStatus: string,
    userId: string,
    notes: string | null = null
): Promise<void> {
    const request = await prisma.returnRequest.findUnique({ where: { id: requestId } });

    if (!request) {
        throw new Error('Return request not found');
    }

    // Validate status transition
    if (!isValidStatusTransition(request.status, newStatus)) {
        throw new Error(`Invalid status transition from '${request.status}' to '${newStatus}'`);
    }

    await prisma.$transaction(async (tx) => {
        await tx.returnRequest.update({ where: { id: requestId }, data: { status: newStatus } });
        await tx.returnStatusHistory.create({
            data: { requestId, fromStatus: request.status, toStatus: newStatus, changedById: userId, notes },
        });
    });
}

/**
 * Helper to check auto-resolution for exchanges
 * Resolves ticket when both reverse received and forward delivered
 */
export async function checkAutoResolve(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    requestId: string,
    userId: string
): Promise<boolean> {
    const request = await tx.returnRequest.findUnique({
        where: { id: requestId },
    });

    if (!request) return false;

    if (request.reverseReceived && request.forwardDelivered && request.status !== 'resolved') {
        await tx.returnRequest.update({
            where: { id: requestId },
            data: { status: 'resolved', resolution: 'exchange_same' },
        });

        await tx.returnStatusHistory.create({
            data: {
                requestId,
                fromStatus: request.status,
                toStatus: 'resolved',
                changedById: userId,
                notes: 'Auto-resolved: both reverse received and forward delivered',
            },
        });

        return true;
    }
    return false;
}
