/**
 * Repacking Queue & Write-Off Routes
 * Handles repacking queue management, processing, and write-offs
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateInventoryBalance } from '../utils/queryPatterns.js';

const router = Router();

// ============================================
// REPACKING QUEUE
// ============================================

// Get repacking queue items
router.get('/queue', authenticateToken, async (req, res) => {
    try {
        const { status, limit = 100 } = req.query;

        const where = {};
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
            take: Number(limit),
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
    } catch (error) {
        console.error('Get repacking queue error:', error);
        res.status(500).json({ error: 'Failed to fetch repacking queue' });
    }
});

// Get repacking queue stats
router.get('/queue/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await req.prisma.repackingQueueItem.groupBy({
            by: ['status'],
            _count: { id: true },
            _sum: { qty: true },
        });

        const result = {
            pending: { count: 0, qty: 0 },
            inspecting: { count: 0, qty: 0 },
            repacking: { count: 0, qty: 0 },
            ready: { count: 0, qty: 0 },
            write_off: { count: 0, qty: 0 },
        };

        for (const stat of stats) {
            if (result[stat.status]) {
                result[stat.status] = {
                    count: stat._count.id,
                    qty: stat._sum.qty || 0,
                };
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Get repacking stats error:', error);
        res.status(500).json({ error: 'Failed to fetch repacking stats' });
    }
});

// Add item to repacking queue (from return inward)
router.post('/queue', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'SKU not found' });
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
    } catch (error) {
        console.error('Add to repacking queue error:', error);
        res.status(500).json({ error: 'Failed to add to repacking queue' });
    }
});

// Update repacking queue item status
router.put('/queue/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
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
    } catch (error) {
        console.error('Update repacking item error:', error);
        res.status(500).json({ error: 'Failed to update repacking item' });
    }
});

// Get processed items history (accepted/rejected)
router.get('/queue/history', authenticateToken, async (req, res) => {
    try {
        const { status, limit = 100 } = req.query;

        const where = {};
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
            take: Number(limit),
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
    } catch (error) {
        console.error('Get queue history error:', error);
        res.status(500).json({ error: 'Failed to fetch queue history' });
    }
});

// Process repacking item (move to stock or write-off)
router.post('/process', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'Repacking item not found' });
        }

        if (item.status === 'ready' || item.status === 'write_off') {
            return res.status(400).json({ error: 'Item already processed' });
        }

        if (action === 'ready') {
            // Add to inventory
            await req.prisma.$transaction(async (prisma) => {
                // Create inventory inward transaction
                await prisma.inventoryTransaction.create({
                    data: {
                        skuId: item.skuId,
                        txnType: 'inward',
                        qty: item.qty,
                        reason: 'return_receipt',
                        referenceId: item.id,
                        notes: qcComments || notes || 'From repacking queue - repacked and QC passed',
                        createdById: req.user.id,
                    },
                });

                // Update repacking item status
                await prisma.repackingQueueItem.update({
                    where: { id: itemId },
                    data: {
                        status: 'ready',
                        qcComments: qcComments || null,
                        processedAt: new Date(),
                        processedById: req.user.id,
                    },
                });
            });

            const balance = await calculateInventoryBalance(req.prisma, item.skuId);

            res.json({
                success: true,
                action: 'ready',
                message: `+${item.qty} ${item.sku.skuCode} added to inventory`,
                newBalance: balance.currentBalance,
            });
        } else if (action === 'write_off') {
            if (!writeOffReason) {
                return res.status(400).json({ error: 'Write-off reason required' });
            }

            await req.prisma.$transaction(async (prisma) => {
                // Create write-off log
                await prisma.writeOffLog.create({
                    data: {
                        skuId: item.skuId,
                        qty: item.qty,
                        reason: writeOffReason,
                        sourceType: 'return',
                        sourceId: item.id,
                        notes: qcComments || notes,
                        createdById: req.user.id,
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
                        processedById: req.user.id,
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
                message: `${item.qty} ${item.sku.skuCode} written off - ${writeOffReason}`,
            });
        } else {
            return res.status(400).json({ error: 'Invalid action. Use "ready" or "write_off"' });
        }
    } catch (error) {
        console.error('Process repacking item error:', error);
        res.status(500).json({ error: 'Failed to process repacking item' });
    }
});

// Undo a processed QC item (revert to pending)
router.post('/queue/:id/undo', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

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
            return res.status(404).json({ error: 'Item not found' });
        }

        if (item.status !== 'ready' && item.status !== 'write_off') {
            return res.status(400).json({ error: 'Can only undo processed items' });
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
            message: `Undo successful - ${item.sku.skuCode} moved back to pending`,
            previousStatus,
        });
    } catch (error) {
        console.error('Undo QC process error:', error);
        res.status(500).json({ error: 'Failed to undo QC process' });
    }
});

// Delete repacking queue item (undo receive)
router.delete('/queue/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const item = await req.prisma.repackingQueueItem.findUnique({
            where: { id },
            include: {
                returnRequest: true,
            },
        });
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        if (item.status === 'ready' || item.status === 'write_off') {
            return res.status(400).json({ error: 'Cannot delete processed items' });
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
                        where: { requestId: item.returnRequestId, direction: 'reverse' },
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
                        where: { id: item.returnRequestId },
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
    } catch (error) {
        console.error('Delete repacking item error:', error);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// ============================================
// WRITE-OFFS
// ============================================

// Get write-off history
router.get('/write-offs', authenticateToken, async (req, res) => {
    try {
        const { reason, sourceType, startDate, endDate, limit = 100 } = req.query;

        const where = {};
        if (reason) where.reason = reason;
        if (sourceType) where.sourceType = sourceType;
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate);
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
            take: Number(limit),
        });

        const enrichedWriteOffs = writeOffs.map((wo) => ({
            ...wo,
            productName: wo.sku?.variation?.product?.name,
            colorName: wo.sku?.variation?.colorName,
            size: wo.sku?.size,
            skuCode: wo.sku?.skuCode,
        }));

        res.json(enrichedWriteOffs);
    } catch (error) {
        console.error('Get write-offs error:', error);
        res.status(500).json({ error: 'Failed to fetch write-offs' });
    }
});

// Get write-off stats
router.get('/write-offs/stats', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const where = {};
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate);
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

        res.json({
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
        });
    } catch (error) {
        console.error('Get write-off stats error:', error);
        res.status(500).json({ error: 'Failed to fetch write-off stats' });
    }
});

// Create direct write-off (not from repacking queue)
router.post('/write-offs', authenticateToken, async (req, res) => {
    try {
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
            return res.status(404).json({ error: 'SKU not found' });
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
                    createdById: req.user.id,
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
                    createdById: req.user.id,
                },
            });
        });

        res.status(201).json({
            success: true,
            message: `${qty} ${sku.skuCode} written off - ${reason}`,
        });
    } catch (error) {
        console.error('Create write-off error:', error);
        res.status(500).json({ error: 'Failed to create write-off' });
    }
});

export default router;
