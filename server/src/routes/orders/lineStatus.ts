/**
 * Unified Line Status Endpoint
 * Single endpoint for all order line status transitions
 *
 * STATUS FLOW:
 * pending → allocated → picked → packed → shipped
 *     ↓         ↓          ↓        ↓
 * cancelled  cancelled  cancelled  cancelled
 *
 * INVENTORY MODEL:
 * - Allocate: Creates OUTWARD transaction (stock deducted immediately)
 * - Unallocate (→ pending): Deletes OUTWARD transaction (stock restored)
 * - All other transitions: Status only, no inventory changes
 *
 * @module routes/orders/lineStatus
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import { deprecated } from '../../middleware/deprecation.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessLogicError,
} from '../../utils/errors.js';
import { broadcastOrderUpdate } from '../sse.js';
import { calculateInventoryBalance } from '../../utils/queryPatterns.js';
import {
    isValidTransition,
    isValidLineStatus,
    executeTransition,
    buildTransitionError,
    getTransitionDefinition,
    type LineStatus,
} from '../../utils/orderStateMachine.js';

const router: Router = Router();

// ============================================
// VALID STATUS TRANSITIONS
// ============================================

// Note: Transition matrix is now in orderStateMachine.ts (single source of truth)
// Permissions are checked via middleware, not at runtime
// The unified endpoint uses 'orders:allocate' permission for all transitions
// Shipping (packed → shipped) requires additional AWB validation

// ============================================
// UNIFIED STATUS ENDPOINT
// ============================================

/**
 * POST /lines/:lineId/status
 * Set the status of an order line with validation
 *
 * @param {string} req.params.lineId - Order line ID
 * @param {LineStatus} req.body.status - Target status
 * @param {object} req.body.shipData - Required when status='shipped': { awbNumber, courier }
 * @returns {Object} Updated orderLine record
 *
 * @example
 * // Allocate a line
 * POST /orders/lines/abc123/status
 * Body: { status: 'allocated' }
 *
 * @example
 * // Ship a line (requires AWB)
 * POST /orders/lines/abc123/status
 * Body: { status: 'shipped', shipData: { awbNumber: 'AWB123', courier: 'Delhivery' } }
 *
 * @example
 * // Cancel a line
 * POST /orders/lines/abc123/status
 * Body: { status: 'cancelled' }
 */
router.post('/lines/:lineId/status', authenticateToken, deprecated({
    endpoint: 'POST /orders/lines/:lineId/status',
    trpcAlternative: 'orders.setLineStatus',
    deprecatedSince: '2026-01-16',
}), asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;
    const { status, shipData } = req.body as {
        status: string;
        shipData?: { awbNumber?: string; courier?: string };
    };

    // Validate status is a known value using state machine
    if (!status || !isValidLineStatus(status)) {
        throw new ValidationError(`Invalid status: ${status}. Must be a valid line status.`);
    }

    // Fetch current line state
    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
        select: {
            id: true,
            skuId: true,
            qty: true,
            lineStatus: true,
            orderId: true,
            order: {
                select: {
                    shopifyCache: {
                        select: { trackingNumber: true, trackingCompany: true }
                    }
                }
            }
        },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    const currentStatus = line.lineStatus as LineStatus;

    // Check if transition is valid using state machine
    if (!isValidTransition(currentStatus, status)) {
        throw new BusinessLogicError(
            buildTransitionError(currentStatus, status),
            'INVALID_TRANSITION'
        );
    }

    // Shipping requires AWB data - use separate shipLine helper
    if (status === 'shipped') {
        // Try to get AWB from Shopify if not provided
        const awbNumber = shipData?.awbNumber || line.order?.shopifyCache?.trackingNumber;
        const courier = shipData?.courier || line.order?.shopifyCache?.trackingCompany || 'Unknown';

        if (!awbNumber) {
            throw new ValidationError('AWB number is required for shipping. Provide shipData.awbNumber or sync from Shopify.');
        }

        // Ship with AWB data (uses separate helper due to order-level updates)
        const updated = await shipLine(req, lineId, line.skuId, awbNumber, courier);
        return res.json(updated);
    }

    // Execute transition using state machine
    const result = await req.prisma.$transaction(async (tx) => {
        // Re-check status inside transaction (race condition prevention)
        const currentLine = await tx.orderLine.findUnique({
            where: { id: lineId },
            select: { lineStatus: true, skuId: true, qty: true },
        });

        if (!currentLine) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        if (currentLine.lineStatus !== currentStatus) {
            throw new ConflictError(
                `Line status changed by another request (expected: ${currentStatus}, found: ${currentLine.lineStatus})`,
                'RACE_CONDITION'
            );
        }

        // Execute transition with all side effects (inventory, timestamps)
        return executeTransition(tx, currentStatus, status, {
            lineId,
            skuId: currentLine.skuId,
            qty: currentLine.qty,
            userId: req.user!.id,
        });
    });

    if (!result.success) {
        throw new BusinessLogicError(result.error || 'Transition failed', 'TRANSITION_FAILED');
    }

    // Broadcast SSE update to other users (excludes the user who made the change)
    broadcastOrderUpdate({
        type: 'line_status',
        view: 'open',
        lineId,
        orderId: line.orderId,
        changes: { lineStatus: status },
    }, req.user?.id);

    res.json({ id: lineId, lineStatus: status, orderId: line.orderId });
}));

/**
 * Ship a line (internal helper)
 * Sets shipped status, AWB, courier, and timestamps
 */
async function shipLine(
    req: Request,
    lineId: string,
    skuId: string,
    awbNumber: string,
    courier: string
) {
    const updated = await req.prisma.$transaction(async (tx) => {
        // Re-check status
        const line = await tx.orderLine.findUnique({
            where: { id: lineId },
            select: { lineStatus: true, orderId: true },
        });

        if (!line) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        if (line.lineStatus !== 'packed') {
            throw new BusinessLogicError(
                `Line must be packed to ship (current: ${line.lineStatus})`,
                'INVALID_STATUS'
            );
        }

        const now = new Date();

        // Update line to shipped
        const updatedLine = await tx.orderLine.update({
            where: { id: lineId },
            data: {
                lineStatus: 'shipped',
                awbNumber,
                courier,
                shippedAt: now,
            },
        });

        // Check if all lines are now shipped → update order status
        const order = await tx.order.findUnique({
            where: { id: line.orderId },
            include: { orderLines: { select: { lineStatus: true } } },
        });

        if (order) {
            const allShipped = order.orderLines.every(
                l => l.lineStatus === 'shipped' || l.lineStatus === 'cancelled'
            );

            if (allShipped) {
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        status: 'shipped',
                        awbNumber,
                        courier,
                        shippedAt: now,
                    },
                });
            }
        }

        return updatedLine;
    });

    return updated;
}

// ============================================
// BULK STATUS UPDATE
// ============================================

/**
 * POST /lines/bulk-status
 * Update status for multiple lines at once
 *
 * @param {string[]} req.body.lineIds - Array of order line IDs
 * @param {LineStatus} req.body.status - Target status for all lines
 * @returns {Object} { success: number, failed: Array<{lineId, reason}> }
 */
router.post('/lines/bulk-status', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { lineIds, status } = req.body as { lineIds?: string[]; status?: string };

    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }

    if (!status || !isValidLineStatus(status)) {
        throw new ValidationError('status is required and must be a valid line status');
    }

    const uniqueLineIds = [...new Set(lineIds)];
    const results: { success: string[]; failed: Array<{ lineId: string; reason: string }> } = {
        success: [],
        failed: [],
    };

    // Process each line (could be optimized for batch operations)
    for (const lineId of uniqueLineIds) {
        try {
            // Fetch line data including SKU for inventory checks
            const line = await req.prisma.orderLine.findUnique({
                where: { id: lineId },
                select: { lineStatus: true, skuId: true, qty: true },
            });

            if (!line) {
                results.failed.push({ lineId, reason: 'Line not found' });
                continue;
            }

            const currentStatus = line.lineStatus as LineStatus;

            // Validate transition using state machine
            if (!isValidTransition(currentStatus, status)) {
                results.failed.push({
                    lineId,
                    reason: buildTransitionError(currentStatus, status)
                });
                continue;
            }

            // For allocate, check stock
            if (status === 'allocated') {
                const balance = await calculateInventoryBalance(req.prisma, line.skuId);
                if (balance.availableBalance < line.qty) {
                    results.failed.push({
                        lineId,
                        reason: `Insufficient stock: ${balance.availableBalance} available`
                    });
                    continue;
                }
            }

            // Execute transition using state machine
            const transitionResult = await req.prisma.$transaction(async (tx) => {
                return executeTransition(tx, currentStatus, status, {
                    lineId,
                    skuId: line.skuId,
                    qty: line.qty,
                    userId: req.user!.id,
                });
            });

            if (transitionResult.success) {
                results.success.push(lineId);
            } else {
                results.failed.push({
                    lineId,
                    reason: transitionResult.error || 'Transition failed'
                });
            }
        } catch (error) {
            results.failed.push({
                lineId,
                reason: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    res.json({
        success: results.success.length,
        failed: results.failed.length > 0 ? results.failed : undefined,
        lineIds: results.success,
    });
}));

export default router;
