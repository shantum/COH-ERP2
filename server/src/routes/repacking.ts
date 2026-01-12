/**
 * @module routes/repacking
 * @description Repacking queue & write-off management for returned items
 *
 * Status Flow:
 * - pending -> inspecting -> repacking -> ready (adds to inventory) | write_off (logged, no inventory)
 *
 * Process Endpoint (/process):
 * - action='ready': Creates inventory inward txn (reason='return_receipt'), updates status='ready'
 * - action='write_off': Creates WriteOffLog, increments SKU/Product.writeOffCount, updates status='write_off'
 * - Both use optimistic locking (re-check status inside transaction to prevent double-processing)
 *
 * Write-Off Sources: 'return', 'production', 'inventory_audit', 'damage'
 * Write-Off Reasons: 'damaged', 'defective', 'expired', 'lost', 'quality_fail', etc.
 *
 * Undo Logic: Reverses inventory txn or write-off log, reverts to 'pending'
 * Delete: Only allowed for pending/inspecting/repacking (not processed items)
 *
 * @see routes/inventory.js - RTO inward per-line endpoint uses similar condition-based logic
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors.js';
import { calculateInventoryBalance } from '../utils/queryPatterns.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

type RepackingStatus = 'pending' | 'inspecting' | 'repacking' | 'ready' | 'write_off';

interface RepackingQueueStats {
    pending: { count: number; qty: number };
    inspecting: { count: number; qty: number };
    repacking: { count: number; qty: number };
    ready: { count: number; qty: number };
    write_off: { count: number; qty: number };
}

interface WriteOffByReason {
    reason: string;
    count: number;
    qty: number;
    costValue: number;
}

interface WriteOffBySource {
    sourceType: string;
    count: number;
    qty: number;
}

interface WriteOffStats {
    byReason: WriteOffByReason[];
    bySource: WriteOffBySource[];
    total: {
        count: number;
        qty: number;
        costValue: number;
    };
}

// ============================================
// REPACKING QUEUE
// ============================================

/**
 * Get repacking queue items
 * @route GET /api/repacking/queue?status=pending&limit=100
 * @param {string} [query.status] - Filter by status (default: pending/inspecting/repacking)
 * @param {number} [query.limit=100] - Max items
 * @returns {Object[]} items - [{ id, skuId, qty, condition, status, returnRequestId, inspectionNotes, createdAt, sku, returnRequest, processedBy, productName, colorName, size, skuCode, imageUrl }]
 */
router.get('/queue', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const limit = req.query.limit as string | undefined;
    const limitNum = limit ? Number(limit) : 100;

    const where: Record<string, unknown> = {};
    if (status) {
        where.status = status;
    } else {
        // Default: show pending, inspecting, repacking items
        where.status = { in: ['pending', 'inspecting', 'repacking'] };
    }

    const items = await req.prisma.repackingQueueItem.findMany({
        where,
        include: {
            sku: {
                include: {
                    variation: {
                        include: { product: true },
                    },
                },
            },
            returnRequest: {
                select: {
                    requestNumber: true,
                    requestType: true,
                    reasonCategory: true,
                },
            },
            processedBy: {
                select: { id: true, name: true },
            },
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
    });

    // Enrich with additional info
    const enrichedItems = items.map((item) => ({
        ...item,
        productName: item.sku?.variation?.product?.name,
        colorName: item.sku?.variation?.colorName,
        size: item.sku?.size,
        skuCode: item.sku?.skuCode,
        imageUrl: item.sku?.variation?.imageUrl || item.sku?.variation?.product?.imageUrl,
    }));

    res.json(enrichedItems);
}));

// Get repacking queue stats
router.get('/queue/stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const stats = await req.prisma.repackingQueueItem.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { qty: true },
    });

    const result: RepackingQueueStats = {
        pending: { count: 0, qty: 0 },
        inspecting: { count: 0, qty: 0 },
        repacking: { count: 0, qty: 0 },
        ready: { count: 0, qty: 0 },
        write_off: { count: 0, qty: 0 },
    };

    for (const stat of stats) {
        const statusKey = stat.status as RepackingStatus;
        if (result[statusKey]) {
            result[statusKey] = {
                count: stat._count.id,
                qty: stat._sum.qty || 0,
            };
        }
    }

    res.json(result);
}));

/**
 * Add item to repacking queue (typically from return inward flow)
 * @route POST /api/repacking/queue
 * @param {string} [body.skuId] - SKU UUID
 * @param {string} [body.skuCode] - SKU code (alternative to skuId)
 * @param {string} [body.barcode] - Barcode (alternative to skuId/skuCode)
 * @param {number} [body.qty=1] - Quantity
 * @param {string} [body.condition] - 'used', 'damaged', 'defective', etc.
 * @param {string} [body.returnRequestId] - Associated return UUID
 * @param {string} [body.returnLineId] - Associated return line UUID
 * @param {string} [body.inspectionNotes] - Notes from inspection
 * @returns {Object} item - Created queue item
 */
router.post('/queue', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { skuId, skuCode, barcode, qty = 1, condition, returnRequestId, returnLineId, inspectionNotes } = req.body;

    // Find SKU by ID, code, or barcode
    let sku;
    if (skuId) {
        sku = await req.prisma.sku.findUnique({ where: { id: skuId } });
    } else if (barcode) {
        sku = await req.prisma.sku.findFirst({ where: { skuCode: barcode } });
    } else if (skuCode) {
        sku = await req.prisma.sku.findUnique({ where: { skuCode } });
    }

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', skuId || skuCode || barcode);
    }

    const item = await req.prisma.repackingQueueItem.create({
        data: {
            skuId: sku.id,
            qty,
            condition: condition || 'used',
            returnRequestId,
            returnLineId,
            inspectionNotes,
            status: 'pending',
        },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

    res.status(201).json({
        ...item,
        productName: item.sku?.variation?.product?.name,
        colorName: item.sku?.variation?.colorName,
        size: item.sku?.size,
        skuCode: item.sku?.skuCode,
    });
}));

// Update repacking queue item status
router.put('/queue/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { status, condition, inspectionNotes } = req.body;

    const item = await req.prisma.repackingQueueItem.update({
        where: { id },
        data: {
            ...(status && { status }),
            ...(condition && { condition }),
            ...(inspectionNotes !== undefined && { inspectionNotes }),
        },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

    res.json(item);
}));

// Get processed items history (accepted/rejected)
router.get('/queue/history', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const limit = req.query.limit as string | undefined;
    const limitNum = limit ? Number(limit) : 100;

    const where: Record<string, unknown> = {};
    if (status === 'ready' || status === 'write_off') {
        where.status = status;
    } else {
        // Default: show all processed items
        where.status = { in: ['ready', 'write_off'] };
    }

    const items = await req.prisma.repackingQueueItem.findMany({
        where,
        include: {
            sku: {
                include: {
                    variation: {
                        include: { product: true },
                    },
                },
            },
            returnRequest: {
                select: {
                    requestNumber: true,
                    requestType: true,
                    reasonCategory: true,
                },
            },
            processedBy: {
                select: { id: true, name: true },
            },
        },
        orderBy: { processedAt: 'desc' },
        take: limitNum,
    });

    // Enrich with additional info
    const enrichedItems = items.map((item) => ({
        ...item,
        productName: item.sku?.variation?.product?.name,
        colorName: item.sku?.variation?.colorName,
        size: item.sku?.size,
        skuCode: item.sku?.skuCode,
        imageUrl: item.sku?.variation?.imageUrl || item.sku?.variation?.product?.imageUrl,
    }));

    res.json(enrichedItems);
}));

/**
 * Process repacking item: add to inventory or write-off
 * @route POST /api/repacking/process
 * @param {string} body.itemId - RepackingQueueItem UUID
 * @param {string} body.action - 'ready' (add to stock) or 'write_off'
 * @param {string} [body.writeOffReason] - Required if action='write_off' ('damaged', 'defective', 'lost', etc.)
 * @param {string} [body.qcComments] - QC notes
 * @param {string} [body.notes] - Additional notes
 * @returns {Object} { success, action, message, newBalance? }
 * @description Uses optimistic locking to prevent double-processing. Creates inventory txn or write-off log.
 */
router.post('/process', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { itemId, action, writeOffReason, qcComments, notes } = req.body;
    // action: 'ready' (add to stock) or 'write_off'

    const item = await req.prisma.repackingQueueItem.findUnique({
        where: { id: itemId },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

    if (!item) {
        throw new NotFoundError('Repacking item not found', 'RepackingQueueItem', itemId);
    }

    if (item.status === 'ready' || item.status === 'write_off') {
        throw new ValidationError('Item already processed');
    }

    if (action === 'ready') {
        // Add to inventory
        await req.prisma.$transaction(async (prisma) => {
            // CRITICAL FIX: Optimistic locking - re-check status inside transaction
            const freshItem = await prisma.repackingQueueItem.findUnique({
                where: { id: itemId },
            });

            if (!freshItem) {
                throw new ConflictError('Item not found', 'item_not_found');
            }

            if (freshItem.status === 'ready' || freshItem.status === 'write_off') {
                throw new ConflictError('Item already processed by another user', 'already_processed');
            }

            // Check if inventory transaction already exists (duplicate prevention)
            const existingTxn = await prisma.inventoryTransaction.findFirst({
                where: {
                    referenceId: item.id,
                    reason: 'return_receipt',
                },
            });

            if (existingTxn) {
                throw new ConflictError('Inventory transaction already exists', 'duplicate_transaction');
            }

            // Create inventory inward transaction
            await prisma.inventoryTransaction.create({
                data: {
                    skuId: item.skuId,
                    txnType: 'inward',
                    qty: item.qty,
                    reason: 'return_receipt',
                    referenceId: item.id,
                    notes: qcComments || notes || 'From repacking queue - repacked and QC passed',
                    createdById: req.user!.id,
                },
            });

            // Update repacking item status
            await prisma.repackingQueueItem.update({
                where: { id: itemId },
                data: {
                    status: 'ready',
                    qcComments: qcComments || null,
                    processedAt: new Date(),
                    processedById: req.user!.id,
                },
            });
        });

        const balance = await calculateInventoryBalance(req.prisma, item.skuId);

        res.json({
            success: true,
            action: 'ready',
            message: `+${item.qty} ${item.sku?.skuCode} added to inventory`,
            newBalance: balance.currentBalance,
        });
    } else if (action === 'write_off') {
        if (!writeOffReason) {
            throw new ValidationError('Write-off reason required');
        }

        await req.prisma.$transaction(async (prisma) => {
            // CRITICAL FIX: Optimistic locking - re-check status inside transaction
            const freshItem = await prisma.repackingQueueItem.findUnique({
                where: { id: itemId },
            });

            if (!freshItem) {
                throw new ConflictError('Item not found', 'item_not_found');
            }

            if (freshItem.status === 'ready' || freshItem.status === 'write_off') {
                throw new ConflictError('Item already processed by another user', 'already_processed');
            }

            // Check if write-off log already exists (duplicate prevention)
            const existingWriteOff = await prisma.writeOffLog.findFirst({
                where: { sourceId: item.id },
            });

            if (existingWriteOff) {
                throw new ConflictError('Write-off already exists for this item', 'duplicate_writeoff');
            }

            // Create write-off log
            await prisma.writeOffLog.create({
                data: {
                    skuId: item.skuId,
                    qty: item.qty,
                    reason: writeOffReason,
                    sourceType: 'return',
                    sourceId: item.id,
                    notes: qcComments || notes,
                    createdById: req.user!.id,
                },
            });

            // Update repacking item status
            await prisma.repackingQueueItem.update({
                where: { id: itemId },
                data: {
                    status: 'write_off',
                    writeOffReason,
                    qcComments: qcComments || null,
                    processedAt: new Date(),
                    processedById: req.user!.id,
                },
            });

            // Update SKU write-off count
            await prisma.sku.update({
                where: { id: item.skuId },
                data: { writeOffCount: { increment: item.qty } },
            });

            // Update Product write-off count
            if (item.sku?.variation?.product?.id) {
                await prisma.product.update({
                    where: { id: item.sku.variation.product.id },
                    data: { writeOffCount: { increment: item.qty } },
                });
            }
        });

        res.json({
            success: true,
            action: 'write_off',
            message: `${item.qty} ${item.sku?.skuCode} written off - ${writeOffReason}`,
        });
    } else {
        throw new ValidationError('Invalid action. Use "ready" or "write_off"');
    }
}));

/**
 * Undo processed item (revert ready/write_off -> pending)
 * @route POST /api/repacking/queue/:id/undo
 * @param {string} id - RepackingQueueItem UUID
 * @returns {Object} { success, message, previousStatus }
 * @description Deletes inventory txn or write-off log, decrements SKU/Product.writeOffCount if needed.
 */
router.post('/queue/:id/undo', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const item = await req.prisma.repackingQueueItem.findUnique({
        where: { id },
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
        },
    });

    if (!item) {
        throw new NotFoundError('Repacking item not found', 'RepackingQueueItem', id);
    }

    if (item.status !== 'ready' && item.status !== 'write_off') {
        throw new ValidationError('Can only undo processed items');
    }

    const previousStatus = item.status;

    await req.prisma.$transaction(async (prisma) => {
        if (previousStatus === 'ready') {
            // Remove the inventory inward transaction
            await prisma.inventoryTransaction.deleteMany({
                where: {
                    referenceId: item.id,
                    reason: 'return_receipt',
                },
            });
        } else if (previousStatus === 'write_off') {
            // Remove write-off log
            await prisma.writeOffLog.deleteMany({
                where: { sourceId: item.id },
            });

            // Decrement SKU write-off count
            await prisma.sku.update({
                where: { id: item.skuId },
                data: { writeOffCount: { decrement: item.qty } },
            });

            // Decrement Product write-off count
            if (item.sku?.variation?.product?.id) {
                await prisma.product.update({
                    where: { id: item.sku.variation.product.id },
                    data: { writeOffCount: { decrement: item.qty } },
                });
            }
        }

        // Revert item to pending status
        await prisma.repackingQueueItem.update({
            where: { id },
            data: {
                status: 'pending',
                qcComments: null,
                writeOffReason: null,
                processedAt: null,
                processedById: null,
            },
        });
    });

    res.json({
        success: true,
        message: `Undo successful - ${item.sku?.skuCode} moved back to pending`,
        previousStatus,
    });
}));

/**
 * Delete repacking queue item (only if not processed)
 * @route DELETE /api/repacking/queue/:id
 * @param {string} id - RepackingQueueItem UUID
 * @returns {Object} { success, message }
 * @description Cannot delete ready/write_off items. If from return, restores return line and ticket status.
 */
router.delete('/queue/:id', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const item = await req.prisma.repackingQueueItem.findUnique({
        where: { id },
        include: {
            returnRequest: true,
        },
    });

    if (!item) {
        throw new NotFoundError('Repacking item not found', 'RepackingQueueItem', id);
    }

    if (item.status === 'ready' || item.status === 'write_off') {
        throw new ValidationError('Cannot delete processed items');
    }

    await req.prisma.$transaction(async (tx) => {
        // If this item came from a return, restore the original ticket line
        if (item.returnLineId) {
            // Clear the itemCondition on the return line
            await tx.returnRequestLine.update({
                where: { id: item.returnLineId },
                data: { itemCondition: null },
            });

            // If ticket status is "received", revert it to previous status
            if (item.returnRequest && item.returnRequest.status === 'received') {
                // Check shipping to determine appropriate status
                const shipping = await tx.returnShipping.findFirst({
                    where: { requestId: item.returnRequestId as string, direction: 'reverse' },
                });

                let newStatus = 'requested';
                if (shipping) {
                    if (shipping.pickedUpAt) {
                        newStatus = 'in_transit';
                    } else {
                        newStatus = 'reverse_initiated';
                    }
                }

                await tx.returnRequest.update({
                    where: { id: item.returnRequestId as string },
                    data: { status: newStatus },
                });
            }
        }

        // Delete the queue item
        await tx.repackingQueueItem.delete({ where: { id } });
    });

    res.json({
        success: true,
        message: item.returnLineId
            ? 'Item removed from queue and return ticket restored'
            : 'Item deleted from queue',
    });
}));

// ============================================
// WRITE-OFFS
// ============================================

/**
 * Get write-off history
 * @route GET /api/repacking/write-offs?reason=damaged&sourceType=return&startDate=2024-01-01&endDate=2024-12-31&limit=100
 * @param {string} [query.reason] - Filter by reason
 * @param {string} [query.sourceType] - Filter by source ('return', 'production', 'inventory_audit', 'damage')
 * @param {string} [query.startDate] - Filter by date range (ISO string)
 * @param {string} [query.endDate] - Filter by date range (ISO string)
 * @param {number} [query.limit=100] - Max write-offs
 * @returns {Object[]} writeOffs - [{ id, skuId, qty, reason, sourceType, sourceId, notes, costValue, createdAt, createdBy, sku, productName, colorName, size, skuCode }]
 */
router.get('/write-offs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const reason = req.query.reason as string | undefined;
    const sourceType = req.query.sourceType as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const limit = req.query.limit as string | undefined;
    const limitNum = limit ? Number(limit) : 100;

    const where: Record<string, unknown> = {};
    if (reason) where.reason = reason;
    if (sourceType) where.sourceType = sourceType;
    if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) createdAt.gte = new Date(startDate);
        if (endDate) createdAt.lte = new Date(endDate);
        where.createdAt = createdAt;
    }

    const writeOffs = await req.prisma.writeOffLog.findMany({
        where,
        include: {
            sku: {
                include: {
                    variation: { include: { product: true } },
                },
            },
            createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
    });

    const enrichedWriteOffs = writeOffs.map((wo) => ({
        ...wo,
        productName: wo.sku?.variation?.product?.name,
        colorName: wo.sku?.variation?.colorName,
        size: wo.sku?.size,
        skuCode: wo.sku?.skuCode,
    }));

    res.json(enrichedWriteOffs);
}));

/**
 * Get write-off statistics
 * @route GET /api/repacking/write-offs/stats?startDate=2024-01-01&endDate=2024-12-31
 * @param {string} [query.startDate] - Filter by date range (ISO string)
 * @param {string} [query.endDate] - Filter by date range (ISO string)
 * @returns {Object} { byReason: [{ reason, count, qty, costValue }], bySource: [{ sourceType, count, qty }], total: { count, qty, costValue } }
 */
router.get('/write-offs/stats', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const where: Record<string, unknown> = {};
    if (startDate || endDate) {
        const createdAt: Record<string, Date> = {};
        if (startDate) createdAt.gte = new Date(startDate);
        if (endDate) createdAt.lte = new Date(endDate);
        where.createdAt = createdAt;
    }

    // By reason
    const byReason = await req.prisma.writeOffLog.groupBy({
        by: ['reason'],
        where,
        _count: { id: true },
        _sum: { qty: true, costValue: true },
    });

    // By source type
    const bySource = await req.prisma.writeOffLog.groupBy({
        by: ['sourceType'],
        where,
        _count: { id: true },
        _sum: { qty: true },
    });

    // Total
    const total = await req.prisma.writeOffLog.aggregate({
        where,
        _count: { id: true },
        _sum: { qty: true, costValue: true },
    });

    const stats: WriteOffStats = {
        byReason: byReason.map((r) => ({
            reason: r.reason,
            count: r._count.id,
            qty: r._sum.qty || 0,
            costValue: r._sum.costValue || 0,
        })),
        bySource: bySource.map((s) => ({
            sourceType: s.sourceType,
            count: s._count.id,
            qty: s._sum.qty || 0,
        })),
        total: {
            count: total._count.id,
            qty: total._sum.qty || 0,
            costValue: total._sum.costValue || 0,
        },
    };

    res.json(stats);
}));

/**
 * Create direct write-off (bypasses repacking queue)
 * @route POST /api/repacking/write-offs
 * @param {string} [body.skuId] - SKU UUID
 * @param {string} [body.skuCode] - SKU code (alternative to skuId)
 * @param {number} body.qty - Quantity to write off
 * @param {string} body.reason - Write-off reason ('damaged', 'defective', 'lost', etc.)
 * @param {string} [body.sourceType='inventory_audit'] - Source type
 * @param {string} [body.notes] - Additional notes
 * @param {number} [body.costValue] - Cost value of write-off
 * @returns {Object} { success, message }
 * @description Creates write-off log, increments SKU/Product.writeOffCount, creates inventory outward txn (reason='damage').
 */
router.post('/write-offs', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { skuId, skuCode, qty, reason, sourceType = 'inventory_audit', notes, costValue } = req.body;

    // Find SKU
    let sku;
    if (skuId) {
        sku = await req.prisma.sku.findUnique({
            where: { id: skuId },
            include: { variation: { include: { product: true } } },
        });
    } else if (skuCode) {
        sku = await req.prisma.sku.findUnique({
            where: { skuCode },
            include: { variation: { include: { product: true } } },
        });
    }

    if (!sku) {
        throw new NotFoundError('SKU not found', 'SKU', skuId || skuCode);
    }

    await req.prisma.$transaction(async (prisma) => {
        // Create write-off log
        await prisma.writeOffLog.create({
            data: {
                skuId: sku.id,
                qty,
                reason,
                sourceType,
                notes,
                costValue,
                createdById: req.user!.id,
            },
        });

        // Update SKU write-off count
        await prisma.sku.update({
            where: { id: sku.id },
            data: { writeOffCount: { increment: qty } },
        });

        // Update Product write-off count
        if (sku.variation?.product?.id) {
            await prisma.product.update({
                where: { id: sku.variation.product.id },
                data: { writeOffCount: { increment: qty } },
            });
        }

        // Create inventory outward transaction
        await prisma.inventoryTransaction.create({
            data: {
                skuId: sku.id,
                txnType: 'outward',
                qty,
                reason: 'damage',
                notes: `Write-off: ${reason} - ${notes || ''}`,
                createdById: req.user!.id,
            },
        });
    });

    res.status(201).json({
        success: true,
        message: `${qty} ${sku.skuCode} written off - ${reason}`,
    });
}));

export default router;
