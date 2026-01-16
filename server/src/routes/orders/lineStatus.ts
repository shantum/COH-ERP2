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

    // Batch fetch all lines in a single query (optimization)
    const lines = await req.prisma.orderLine.findMany({
        where: { id: { in: uniqueLineIds } },
        select: { id: true, lineStatus: true, skuId: true, qty: true },
    });

    // Build a map for O(1) lookups
    const lineMap = new Map(lines.map(l => [l.id, l]));

    // Find missing lines
    const foundIds = new Set(lines.map(l => l.id));
    for (const lineId of uniqueLineIds) {
        if (!foundIds.has(lineId)) {
            results.failed.push({ lineId, reason: 'Line not found' });
        }
    }

    // Pre-validate all transitions and collect lines to process
    const linesToProcess: Array<{
        lineId: string;
        skuId: string;
        qty: number;
        currentStatus: LineStatus;
    }> = [];

    for (const line of lines) {
        const currentStatus = line.lineStatus as LineStatus;

        // Validate transition using state machine
        if (!isValidTransition(currentStatus, status)) {
            results.failed.push({
                lineId: line.id,
                reason: buildTransitionError(currentStatus, status)
            });
            continue;
        }

        linesToProcess.push({
            lineId: line.id,
            skuId: line.skuId,
            qty: line.qty,
            currentStatus,
        });
    }

    // For allocate, batch check stock availability
    if (status === 'allocated' && linesToProcess.length > 0) {
        // Get unique SKU IDs and their required quantities
        const skuRequirements = new Map<string, number>();
        for (const line of linesToProcess) {
            skuRequirements.set(
                line.skuId,
                (skuRequirements.get(line.skuId) || 0) + line.qty
            );
        }

        // Batch fetch inventory balances
        const skuIds = Array.from(skuRequirements.keys());
        const balances = await req.prisma.inventoryTransaction.groupBy({
            by: ['skuId'],
            where: { skuId: { in: skuIds } },
            _sum: { qty: true },
        });

        const balanceMap = new Map<string, number>();
        for (const b of balances) {
            balanceMap.set(b.skuId, b._sum.qty || 0);
        }

        // Check each line's stock requirement
        const linesToRemove = new Set<string>();
        for (const line of linesToProcess) {
            const available = balanceMap.get(line.skuId) || 0;
            if (available < line.qty) {
                results.failed.push({
                    lineId: line.lineId,
                    reason: `Insufficient stock: ${available} available`,
                });
                linesToRemove.add(line.lineId);
            }
        }

        // Filter out lines that failed stock check
        if (linesToRemove.size > 0) {
            linesToProcess.splice(
                0,
                linesToProcess.length,
                ...linesToProcess.filter(l => !linesToRemove.has(l.lineId))
            );
        }
    }

    // Execute all transitions in a single transaction for consistency
    if (linesToProcess.length > 0) {
        try {
            await req.prisma.$transaction(async (tx) => {
                for (const line of linesToProcess) {
                    const transitionResult = await executeTransition(tx, line.currentStatus, status, {
                        lineId: line.lineId,
                        skuId: line.skuId,
                        qty: line.qty,
                        userId: req.user!.id,
                    });

                    if (transitionResult.success) {
                        results.success.push(line.lineId);
                    } else {
                        results.failed.push({
                            lineId: line.lineId,
                            reason: transitionResult.error || 'Transition failed'
                        });
                    }
                }
            }, { timeout: 30000 }); // 30 second timeout for bulk operations
        } catch (error) {
            // If transaction fails, mark all remaining as failed
            for (const line of linesToProcess) {
                if (!results.success.includes(line.lineId)) {
                    results.failed.push({
                        lineId: line.lineId,
                        reason: error instanceof Error ? error.message : 'Transaction failed'
                    });
                }
            }
        }
    }

    res.json({
        success: results.success.length,
        failed: results.failed.length > 0 ? results.failed : undefined,
        lineIds: results.success,
    });
}));

export default router;
