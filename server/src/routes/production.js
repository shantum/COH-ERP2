import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get all tailors
router.get('/tailors', async (req, res) => {
    try {
        const tailors = await req.prisma.tailor.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
        res.json(tailors);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tailors' });
    }
});

// Create tailor
router.post('/tailors', authenticateToken, async (req, res) => {
    try {
        const { name, specializations, dailyCapacityMins } = req.body;
        const tailor = await req.prisma.tailor.create({ data: { name, specializations, dailyCapacityMins: dailyCapacityMins || 480 } });
        res.status(201).json(tailor);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create tailor' });
    }
});

// Get production batches
router.get('/batches', async (req, res) => {
    try {
        const { status, tailorId, startDate, endDate } = req.query;
        const where = {};
        if (status) where.status = status;
        if (tailorId) where.tailorId = tailorId;
        if (startDate || endDate) {
            where.batchDate = {};
            if (startDate) where.batchDate.gte = new Date(startDate);
            if (endDate) where.batchDate.lte = new Date(endDate);
        }

        const batches = await req.prisma.productionBatch.findMany({
            where,
            include: {
                tailor: true,
                sku: { include: { variation: { include: { product: true, fabric: true } } } },
            },
            orderBy: { batchDate: 'desc' },
        });

        res.json(batches);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch batches' });
    }
});

// Create batch
router.post('/batches', authenticateToken, async (req, res) => {
    try {
        const { batchDate, tailorId, skuId, qtyPlanned, priority, sourceOrderLineId, notes } = req.body;

        const batch = await req.prisma.productionBatch.create({
            data: { batchDate: batchDate ? new Date(batchDate) : new Date(), tailorId, skuId, qtyPlanned, priority, sourceOrderLineId, notes },
            include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } },
        });

        // If linked to order line, update it
        if (sourceOrderLineId) {
            await req.prisma.orderLine.update({ where: { id: sourceOrderLineId }, data: { productionBatchId: batch.id } });
        }

        res.status(201).json(batch);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create batch' });
    }
});

// Start batch
router.post('/batches/:id/start', authenticateToken, async (req, res) => {
    try {
        const batch = await req.prisma.productionBatch.update({ where: { id: req.params.id }, data: { status: 'in_progress' } });
        res.json(batch);
    } catch (error) {
        res.status(500).json({ error: 'Failed to start batch' });
    }
});

// Update batch (change date, qty, notes)
router.put('/batches/:id', authenticateToken, async (req, res) => {
    try {
        const { batchDate, qtyPlanned, tailorId, priority, notes } = req.body;
        const updateData = {};
        if (batchDate) updateData.batchDate = new Date(batchDate);
        if (qtyPlanned) updateData.qtyPlanned = qtyPlanned;
        if (tailorId) updateData.tailorId = tailorId;
        if (priority) updateData.priority = priority;
        if (notes !== undefined) updateData.notes = notes;

        const batch = await req.prisma.productionBatch.update({
            where: { id: req.params.id },
            data: updateData,
            include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } },
        });
        res.json(batch);
    } catch (error) {
        console.error('Update batch error:', error);
        res.status(500).json({ error: 'Failed to update batch' });
    }
});

// Delete batch
router.delete('/batches/:id', authenticateToken, async (req, res) => {
    try {
        const batch = await req.prisma.productionBatch.findUnique({ where: { id: req.params.id } });
        if (!batch) return res.status(404).json({ error: 'Batch not found' });

        // Unlink from order line if connected
        if (batch.sourceOrderLineId) {
            await req.prisma.orderLine.update({ where: { id: batch.sourceOrderLineId }, data: { productionBatchId: null } });
        }

        await req.prisma.productionBatch.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete batch error:', error);
        res.status(500).json({ error: 'Failed to delete batch' });
    }
});

// Complete batch (creates inventory inward + fabric outward)
router.post('/batches/:id/complete', authenticateToken, async (req, res) => {
    try {
        const { qtyCompleted } = req.body;
        const batch = await req.prisma.productionBatch.findUnique({ where: { id: req.params.id }, include: { sku: { include: { variation: true } } } });

        if (!batch) return res.status(404).json({ error: 'Batch not found' });

        await req.prisma.$transaction(async (tx) => {
            // Update batch
            await tx.productionBatch.update({ where: { id: req.params.id }, data: { qtyCompleted, status: 'completed', completedAt: new Date() } });

            // Create inventory inward
            await tx.inventoryTransaction.create({
                data: { skuId: batch.skuId, txnType: 'inward', qty: qtyCompleted, reason: 'production', referenceId: batch.id, notes: `Production batch ${batch.id}`, createdById: req.user.id },
            });

            // Create fabric outward
            const fabricConsumption = Number(batch.sku.fabricConsumption) * qtyCompleted;
            await tx.fabricTransaction.create({
                data: { fabricId: batch.sku.variation.fabricId, txnType: 'outward', qty: fabricConsumption, unit: 'meter', reason: 'production', referenceId: batch.id, createdById: req.user.id },
            });

            // Update order line if linked
            if (batch.sourceOrderLineId) {
                await tx.orderLine.update({ where: { id: batch.sourceOrderLineId }, data: { lineStatus: 'allocated', allocatedAt: new Date() } });
            }
        });

        const updated = await req.prisma.productionBatch.findUnique({ where: { id: req.params.id }, include: { tailor: true, sku: true } });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete batch' });
    }
});

// Capacity dashboard
router.get('/capacity', async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

        const tailors = await req.prisma.tailor.findMany({ where: { isActive: true } });
        const batches = await req.prisma.productionBatch.findMany({
            where: { batchDate: { gte: startOfDay, lte: endOfDay }, status: { not: 'cancelled' } },
            include: { sku: { include: { variation: { include: { product: true } } } } },
        });

        const capacity = tailors.map((tailor) => {
            const tailorBatches = batches.filter((b) => b.tailorId === tailor.id);
            const allocatedMins = tailorBatches.reduce((sum, b) => {
                const timePer = b.sku.variation.product.baseProductionTimeMins;
                return sum + (timePer * b.qtyPlanned);
            }, 0);

            return {
                tailorId: tailor.id,
                tailorName: tailor.name,
                dailyCapacityMins: tailor.dailyCapacityMins,
                allocatedMins,
                availableMins: Math.max(0, tailor.dailyCapacityMins - allocatedMins),
                utilizationPct: ((allocatedMins / tailor.dailyCapacityMins) * 100).toFixed(0),
                batches: tailorBatches,
            };
        });

        res.json(capacity);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch capacity' });
    }
});

export default router;
