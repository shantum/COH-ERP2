/**
 * @module routes/returns/receive
 * Item receipt and condition handling
 *
 * Endpoints:
 * - POST /:id/receive-item: Receive a specific line item from a ticket
 * - POST /:id/undo-receive: Undo receive - remove item from QC queue
 * - POST /:id/resolve: Resolve return request (mark as completed)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
    ConflictError,
} from '../../utils/errors.js';
import type {
    ReceiveItemBody,
    ResolveBody,
    ItemCondition,
} from './types.js';
import { isValidStatusTransition } from './types.js';

const router: Router = Router();

// ============================================
// RECEIVE ITEMS (Return Inward)
// ============================================

// Receive a specific line item from a ticket
router.post('/:id/receive-item', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { lineId, condition } = req.body as ReceiveItemBody;

    // Validate condition
    const validConditions: ItemCondition[] = ['good', 'used', 'damaged', 'wrong_product'];
    if (!validConditions.includes(condition)) {
        throw new ValidationError('Invalid condition. Must be: good, used, damaged, or wrong_product');
    }

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            customer: true,
            originalOrder: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    const line = request.lines.find((l) => l.id === lineId);
    if (!line) {
        throw new NotFoundError('Return line not found', 'ReturnRequestLine', lineId);
    }

    if (line.itemCondition) {
        throw new ConflictError('Item already received', 'ALREADY_RECEIVED');
    }

    const result = await req.prisma.$transaction(async (tx) => {
        // CRITICAL FIX: Use optimistic locking - verify line is still unreceived inside transaction
        const freshLine = await tx.returnRequestLine.findUnique({
            where: { id: lineId },
        });

        if (!freshLine) {
            throw new ConflictError('Return line not found', 'LINE_NOT_FOUND');
        }

        if (freshLine.itemCondition !== null) {
            throw new ConflictError('Item already received by another user', 'ALREADY_RECEIVED');
        }

        // Update line with condition
        await tx.returnRequestLine.update({
            where: { id: lineId },
            data: { itemCondition: condition },
        });

        // Check if repacking queue item already exists (prevent duplicate)
        const existingRepackingItem = await tx.repackingQueueItem.findFirst({
            where: { returnLineId: lineId },
        });

        if (existingRepackingItem) {
            throw new ConflictError('Item already in repacking queue', 'ALREADY_IN_QUEUE');
        }

        // Add to repacking queue
        const repackingItem = await tx.repackingQueueItem.create({
            data: {
                skuId: line.skuId,
                qty: line.qty,
                condition,
                returnRequestId: request.id,
                returnLineId: line.id,
                inspectionNotes: `Received from ticket ${request.requestNumber}`,
                status: 'pending',
            },
        });

        // Re-fetch lines inside transaction to avoid race condition
        // (concurrent receives could both see stale data otherwise)
        const updatedLines = await tx.returnRequestLine.findMany({
            where: { requestId: request.id }
        });
        const allLinesReceived = updatedLines.every((l) => l.itemCondition !== null);

        // Build condition summary for notes
        const conditionLabels: Record<ItemCondition, string> = {
            'good': 'Good Condition - Item is in resellable condition',
            'used': 'Used / Worn - Item shows signs of use',
            'damaged': 'Damaged - Item is damaged',
            'wrong_product': 'Wrong Product - Different item than expected',
        };
        const conditionNote = conditionLabels[condition] || condition;

        if (allLinesReceived) {
            // Build update data - mark status received
            const updateData: Record<string, unknown> = { status: 'received' };

            // For exchanges, also mark reverseReceived
            if (request.requestType === 'exchange') {
                updateData.reverseReceived = true;
                updateData.reverseReceivedAt = new Date();
            }

            await tx.returnRequest.update({
                where: { id: request.id },
                data: updateData,
            });

            await tx.returnStatusHistory.create({
                data: {
                    requestId: request.id,
                    fromStatus: request.status,
                    toStatus: 'received',
                    changedById: req.user!.id,
                    notes: `All items received. Condition: ${conditionNote}`,
                },
            });

            // Update shipping status
            await tx.returnShipping.updateMany({
                where: { requestId: request.id, direction: 'reverse' },
                data: { status: 'delivered', receivedAt: new Date(), notes: conditionNote },
            });

            // Check auto-resolve for exchanges
            if (request.requestType === 'exchange' && request.forwardDelivered) {
                await tx.returnRequest.update({
                    where: { id: request.id },
                    data: { status: 'resolved' },
                });
                await tx.returnStatusHistory.create({
                    data: {
                        requestId: request.id,
                        fromStatus: 'received',
                        toStatus: 'resolved',
                        changedById: req.user!.id,
                        notes: 'Exchange auto-resolved: both reverse received and forward delivered',
                    },
                });
            }
        }

        // Update customer stats
        if (request.customer) {
            if (request.requestType === 'return') {
                await tx.customer.update({
                    where: { id: request.customer.id },
                    data: { returnCount: { increment: 1 } },
                });
            } else {
                await tx.customer.update({
                    where: { id: request.customer.id },
                    data: { exchangeCount: { increment: 1 } },
                });
            }
        }

        // Update SKU/product stats
        const sku = line.sku;
        if (sku) {
            if (request.requestType === 'return') {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { returnCount: { increment: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { returnCount: { increment: line.qty } },
                    });
                }
            } else {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { exchangeCount: { increment: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { exchangeCount: { increment: line.qty } },
                    });
                }
            }
        }

        return { repackingItem, allReceived: allLinesReceived };
    });

    res.json({
        success: true,
        message: `${line.sku?.skuCode} received and added to QC queue`,
        repackingItem: result.repackingItem,
        allItemsReceived: result.allReceived,
        sku: {
            id: line.sku?.id,
            skuCode: line.sku?.skuCode,
            productName: line.sku?.variation?.product?.name,
            colorName: line.sku?.variation?.colorName,
            size: line.sku?.size,
        },
    });
}));

// Undo receive - remove item from QC queue and clear received status
router.post('/:id/undo-receive', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { lineId } = req.body as { lineId: string };

    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: {
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            customer: true,
        },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    const line = request.lines.find((l) => l.id === lineId);
    if (!line) {
        throw new NotFoundError('Return line not found', 'ReturnRequestLine', lineId);
    }

    if (!line.itemCondition) {
        throw new BusinessLogicError('Item has not been received yet', 'NOT_RECEIVED');
    }

    // Find the repacking queue item for this line
    const repackingItem = await req.prisma.repackingQueueItem.findFirst({
        where: { returnLineId: lineId },
    });

    if (repackingItem && (repackingItem.status === 'ready' || repackingItem.status === 'write_off')) {
        throw new BusinessLogicError(
            'Cannot undo - item has already been processed (added to stock or written off)',
            'ALREADY_PROCESSED'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        // CRITICAL FIX: Delete any inventory transactions created for this repacking item
        // This handles the case where the item was processed (added to stock) but we still need to undo
        if (repackingItem) {
            // Delete inventory transactions that reference this repacking queue item
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: repackingItem.id,
                    reason: 'return_receipt',
                },
            });

            // Also delete any write-off logs if the item was written off
            await tx.writeOffLog.deleteMany({
                where: { sourceId: repackingItem.id },
            });

            // Delete the repacking queue item
            await tx.repackingQueueItem.delete({
                where: { id: repackingItem.id },
            });
        }

        // Clear the item condition on the line
        await tx.returnRequestLine.update({
            where: { id: lineId },
            data: { itemCondition: null },
        });

        // If ticket status is "received", revert it to previous status
        if (request.status === 'received') {
            // Check shipping to determine appropriate status
            const shipping = await tx.returnShipping.findFirst({
                where: { requestId: request.id, direction: 'reverse' },
            });

            let newStatus = 'requested';
            if (shipping?.awbNumber) {
                newStatus = 'reverse_initiated';
            }

            await tx.returnRequest.update({
                where: { id: request.id },
                data: { status: newStatus },
            });

            await tx.returnStatusHistory.create({
                data: {
                    requestId: request.id,
                    fromStatus: 'received',
                    toStatus: newStatus,
                    changedById: req.user!.id,
                    notes: `Undid receive for ${line.sku?.skuCode}`,
                },
            });

            // Revert shipping status
            if (shipping) {
                await tx.returnShipping.update({
                    where: { id: shipping.id },
                    data: { status: 'in_transit', receivedAt: null },
                });
            }
        }

        // Decrement customer stats
        if (request.customer) {
            if (request.requestType === 'return') {
                await tx.customer.update({
                    where: { id: request.customer.id },
                    data: { returnCount: { decrement: 1 } },
                });
            } else {
                await tx.customer.update({
                    where: { id: request.customer.id },
                    data: { exchangeCount: { decrement: 1 } },
                });
            }
        }

        // Decrement SKU/product stats
        const sku = line.sku;
        if (sku) {
            if (request.requestType === 'return') {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { returnCount: { decrement: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { returnCount: { decrement: line.qty } },
                    });
                }
            } else {
                await tx.sku.update({
                    where: { id: sku.id },
                    data: { exchangeCount: { decrement: line.qty } },
                });
                if (sku.variation?.product?.id) {
                    await tx.product.update({
                        where: { id: sku.variation.product.id },
                        data: { exchangeCount: { decrement: line.qty } },
                    });
                }
            }
        }
    });

    // Fetch updated request
    const updated = await req.prisma.returnRequest.findUnique({
        where: { id: request.id },
        include: {
            lines: { include: { sku: { include: { variation: { include: { product: true } } } } } },
            originalOrder: true,
            customer: true,
            shipping: true,
        },
    });

    res.json({
        success: true,
        message: `Undid receive for ${line.sku?.skuCode}`,
        request: updated,
    });
}));

// ============================================
// RESOLVE OPERATION
// ============================================

router.post('/:id/resolve', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { resolutionType, resolutionNotes, refundAmount } = req.body as ResolveBody;
    const request = await req.prisma.returnRequest.findUnique({
        where: { id },
        include: { lines: true },
    });

    if (!request) {
        throw new NotFoundError('Return request not found', 'ReturnRequest', id);
    }

    // CRITICAL FIX: Validate status transition
    if (!isValidStatusTransition(request.status, 'resolved')) {
        throw new BusinessLogicError(
            `Cannot resolve from status '${request.status}'. Must be in 'received' or 'processing' status first.`,
            'INVALID_STATUS_TRANSITION'
        );
    }

    // CRITICAL FIX: Validate all lines are received (have itemCondition set)
    const unreceivedLines = request.lines.filter((l) => l.itemCondition === null);
    if (unreceivedLines.length > 0) {
        throw new BusinessLogicError(
            `Cannot resolve - ${unreceivedLines.length} item(s) have not been received yet. All items must be received before resolving.`,
            'UNRECEIVED_ITEMS'
        );
    }

    // CRITICAL FIX: Validate refund amount doesn't exceed original value
    if (refundAmount !== undefined && refundAmount !== null) {
        const maxRefundAmount = request.lines.reduce((sum, line) => {
            const linePrice = Number(line.unitPrice) || 0;
            return sum + (linePrice * line.qty);
        }, 0);

        if (refundAmount > maxRefundAmount) {
            throw new ValidationError(
                `Refund amount (${refundAmount}) exceeds maximum allowed (${maxRefundAmount})`
            );
        }
    }

    await req.prisma.$transaction(async (tx) => {
        const updateData: Record<string, unknown> = {
            status: 'resolved',
            resolutionType,
            resolutionNotes,
        };

        // Set refund amount if provided
        if (refundAmount !== undefined) {
            updateData.refundAmount = refundAmount;
            updateData.refundProcessedAt = new Date();
        }

        await tx.returnRequest.update({
            where: { id },
            data: updateData,
        });

        // Add status history
        await tx.returnStatusHistory.create({
            data: {
                requestId: id,
                fromStatus: request.status,
                toStatus: 'resolved',
                changedById: req.user!.id,
                notes: resolutionNotes || `Resolved with type: ${resolutionType || 'none'}`,
            },
        });

        // Note: Inventory transactions are now handled by the repacking queue process
        // This legacy code is kept for backward compatibility with old tickets
        // that may not have gone through the repacking queue
        const processedViaRepacking = await tx.repackingQueueItem.findMany({
            where: { returnRequestId: request.id },
        });

        // Only create inventory transactions if NOT processed via repacking queue
        if (processedViaRepacking.length === 0) {
            for (const line of request.lines) {
                if (line.itemCondition !== 'damaged') {
                    await tx.inventoryTransaction.create({
                        data: {
                            skuId: line.skuId,
                            txnType: 'inward',
                            qty: line.qty,
                            reason: 'return_receipt',
                            referenceId: request.id,
                            createdById: req.user!.id,
                        },
                    });
                }
            }
        }
    });
    res.json({ success: true });
}));

export default router;
