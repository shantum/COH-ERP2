/**
 * Return Prime Outbound Sync Helper
 *
 * Fire-and-forget helper that pushes ERP status changes to Return Prime.
 * Called from lifecycle/resolution server functions after status transitions.
 *
 * Design: async, non-blocking. On failure, stores error in returnPrimeSyncError
 * for the background retry worker to pick up.
 */

import logger from './logger.js';

const log = logger.child({ module: 'rp-sync' });

/**
 * ERP status → Return Prime status mapping
 *
 * ERP "inspected" = warehouse received + QC'd → RP "received"
 * ERP "refunded"  = complete (refund or exchange done) → RP "refunded"
 * ERP "cancelled" = staff cancelled → RP "rejected"
 * ERP "rejected"  = staff rejected → RP "rejected"
 * ERP "archived"  = manually closed → RP "archived"
 */
const STATUS_MAP: Record<string, string> = {
    inspected: 'received',
    refunded: 'refunded',
    cancelled: 'rejected',
    rejected: 'rejected',
};

/**
 * Push a status change to Return Prime for a single order line.
 *
 * Fire-and-forget: never throws, never blocks the caller.
 * On failure, writes the error to returnPrimeSyncError for retry worker.
 *
 * @param orderLineId - The order line that changed status
 * @param erpStatus - The new ERP status (inspected, refunded, cancelled, etc.)
 * @param extraData - Optional data to send with the status update (condition, notes, etc.)
 */
export function syncReturnPrimeStatus(
    orderLineId: string,
    erpStatus: string,
    extraData?: Record<string, unknown>,
): void {
    // Map ERP status to RP status
    const rpStatus = STATUS_MAP[erpStatus];
    if (!rpStatus) {
        // No RP mapping for this status (e.g., 'requested', 'approved') — skip
        return;
    }

    // Fire-and-forget — run async without awaiting
    doSync(orderLineId, rpStatus, extraData).catch((err) => {
        log.error({ orderLineId, erpStatus, rpStatus, err: String(err) }, 'Sync dispatch failed');
    });
}

/**
 * Push status for all RP-linked lines in a batch.
 */
export function syncReturnPrimeBatchStatus(
    batchNumber: string,
    erpStatus: string,
    extraData?: Record<string, unknown>,
): void {
    const rpStatus = STATUS_MAP[erpStatus];
    if (!rpStatus) return;

    doBatchSync(batchNumber, rpStatus, extraData).catch((err) => {
        log.error({ batchNumber, erpStatus, rpStatus, err: String(err) }, 'Batch sync dispatch failed');
    });
}

// ============================================
// INTERNAL
// ============================================

async function doSync(
    orderLineId: string,
    rpStatus: string,
    extraData?: Record<string, unknown>,
): Promise<void> {
    const { default: prisma } = await import('../lib/prisma.js');
    const { getReturnPrimeClient } = await import('../services/returnPrime.js');

    const line = await prisma.orderLine.findUnique({
        where: { id: orderLineId },
        select: {
            id: true,
            returnPrimeRequestId: true,
            returnCondition: true,
            returnConditionNotes: true,
            returnReceivedAt: true,
            returnNetAmount: true,
            returnRefundMethod: true,
            returnRefundCompletedAt: true,
            returnRefundReference: true,
            returnClosedReason: true,
        },
    });

    if (!line?.returnPrimeRequestId) return;

    const rpClient = await getReturnPrimeClient();
    if (!rpClient.isConfigured()) {
        log.debug({ orderLineId }, 'RP client not configured, skipping sync');
        return;
    }

    try {
        const payload = buildPayload(rpStatus, line, extraData);
        await rpClient.updateRequestStatus(line.returnPrimeRequestId, rpStatus, payload);

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnPrimeSyncedAt: new Date(),
                returnPrimeSyncError: null,
            },
        });

        log.info({ orderLineId, rpStatus }, 'Synced to Return Prime');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn({ orderLineId, rpStatus, error: message }, 'Sync failed, marking for retry');

        await prisma.orderLine.update({
            where: { id: orderLineId },
            data: {
                returnPrimeSyncError: `${rpStatus}: ${message}`.slice(0, 500),
            },
        });
    }
}

async function doBatchSync(
    batchNumber: string,
    rpStatus: string,
    extraData?: Record<string, unknown>,
): Promise<void> {
    const { default: prisma } = await import('../lib/prisma.js');

    const lines = await prisma.orderLine.findMany({
        where: {
            returnBatchNumber: batchNumber,
            returnPrimeRequestId: { not: null },
        },
        select: { id: true },
    });

    for (const line of lines) {
        await doSync(line.id, rpStatus, extraData).catch(() => {});
    }
}

function buildPayload(
    rpStatus: string,
    line: {
        returnCondition: string | null;
        returnConditionNotes: string | null;
        returnReceivedAt: Date | null;
        returnNetAmount: import('@prisma/client').Prisma.Decimal | null;
        returnRefundMethod: string | null;
        returnRefundCompletedAt: Date | null;
        returnRefundReference: string | null;
        returnClosedReason: string | null;
    },
    extraData?: Record<string, unknown>,
): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...extraData };

    if (rpStatus === 'received') {
        payload.received_at = line.returnReceivedAt?.toISOString() ?? new Date().toISOString();
        if (line.returnCondition) payload.condition = line.returnCondition;
        if (line.returnConditionNotes) payload.notes = line.returnConditionNotes;
    }

    if (rpStatus === 'refunded') {
        if (line.returnRefundCompletedAt) {
            payload.refunded_at = line.returnRefundCompletedAt.toISOString();
        }
        if (line.returnNetAmount) {
            payload.amount = Number(line.returnNetAmount);
        }
        if (line.returnRefundMethod) payload.method = line.returnRefundMethod;
        if (line.returnRefundReference) payload.reference = line.returnRefundReference;
    }

    if (rpStatus === 'rejected') {
        if (line.returnClosedReason) payload.comment = line.returnClosedReason;
    }

    return payload;
}
