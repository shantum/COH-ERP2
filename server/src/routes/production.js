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

        // Check if date is locked
        const targetDate = batchDate ? new Date(batchDate) : new Date();
        const dateStr = targetDate.toISOString().split('T')[0];

        const lockSetting = await req.prisma.systemSetting.findUnique({
            where: { key: 'locked_production_dates' }
        });
        const lockedDates = lockSetting?.value ? JSON.parse(lockSetting.value) : [];

        if (lockedDates.includes(dateStr)) {
            return res.status(400).json({ error: `Production date ${dateStr} is locked. Cannot add new items.` });
        }

        const batch = await req.prisma.productionBatch.create({
            data: { batchDate: targetDate, tailorId, skuId, qtyPlanned, priority, sourceOrderLineId, notes },
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

// Helper to get effective fabric consumption (SKU-specific or Product-level fallback)
const getEffectiveFabricConsumption = (sku, product) => {
    const skuConsumption = Number(sku.fabricConsumption);
    const DEFAULT_SKU_CONSUMPTION = 1.5; // Schema default

    // If SKU has a non-default consumption value, use it
    if (skuConsumption !== DEFAULT_SKU_CONSUMPTION) {
        return skuConsumption;
    }

    // Otherwise, use Product-level default if set
    if (product.defaultFabricConsumption) {
        return Number(product.defaultFabricConsumption);
    }

    // Final fallback to SKU value
    return skuConsumption;
};

// Complete batch (creates inventory inward + fabric outward)
router.post('/batches/:id/complete', authenticateToken, async (req, res) => {
    try {
        const { qtyCompleted } = req.body;
        const batch = await req.prisma.productionBatch.findUnique({
            where: { id: req.params.id },
            include: { sku: { include: { variation: { include: { product: true } } } } }
        });

        if (!batch) return res.status(404).json({ error: 'Batch not found' });

        await req.prisma.$transaction(async (tx) => {
            // Update batch
            await tx.productionBatch.update({ where: { id: req.params.id }, data: { qtyCompleted, status: 'completed', completedAt: new Date() } });

            // Create inventory inward
            await tx.inventoryTransaction.create({
                data: { skuId: batch.skuId, txnType: 'inward', qty: qtyCompleted, reason: 'production', referenceId: batch.id, notes: `Production batch ${batch.id}`, createdById: req.user.id },
            });

            // Get effective fabric consumption (SKU or Product-level fallback)
            const consumptionPerUnit = getEffectiveFabricConsumption(
                batch.sku,
                batch.sku.variation.product
            );
            const fabricConsumption = consumptionPerUnit * qtyCompleted;

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

// Get locked production dates
router.get('/locked-dates', async (req, res) => {
    try {
        const setting = await req.prisma.systemSetting.findUnique({
            where: { key: 'locked_production_dates' }
        });
        const lockedDates = setting?.value ? JSON.parse(setting.value) : [];
        res.json(lockedDates);
    } catch (error) {
        console.error('Get locked dates error:', error);
        res.status(500).json({ error: 'Failed to get locked dates' });
    }
});

// Lock a production date
router.post('/lock-date', authenticateToken, async (req, res) => {
    try {
        const { date } = req.body;
        if (!date) return res.status(400).json({ error: 'Date is required' });

        const dateStr = date.split('T')[0]; // Normalize to YYYY-MM-DD

        const setting = await req.prisma.systemSetting.findUnique({
            where: { key: 'locked_production_dates' }
        });
        const lockedDates = setting?.value ? JSON.parse(setting.value) : [];

        if (!lockedDates.includes(dateStr)) {
            lockedDates.push(dateStr);
            await req.prisma.systemSetting.upsert({
                where: { key: 'locked_production_dates' },
                update: { value: JSON.stringify(lockedDates) },
                create: { key: 'locked_production_dates', value: JSON.stringify(lockedDates) }
            });
        }

        res.json({ success: true, lockedDates });
    } catch (error) {
        console.error('Lock date error:', error);
        res.status(500).json({ error: 'Failed to lock date' });
    }
});

// Unlock a production date
router.post('/unlock-date', authenticateToken, async (req, res) => {
    try {
        const { date } = req.body;
        if (!date) return res.status(400).json({ error: 'Date is required' });

        const dateStr = date.split('T')[0]; // Normalize to YYYY-MM-DD

        const setting = await req.prisma.systemSetting.findUnique({
            where: { key: 'locked_production_dates' }
        });
        let lockedDates = setting?.value ? JSON.parse(setting.value) : [];

        lockedDates = lockedDates.filter(d => d !== dateStr);
        await req.prisma.systemSetting.upsert({
            where: { key: 'locked_production_dates' },
            update: { value: JSON.stringify(lockedDates) },
            create: { key: 'locked_production_dates', value: JSON.stringify(lockedDates) }
        });

        res.json({ success: true, lockedDates });
    } catch (error) {
        console.error('Unlock date error:', error);
        res.status(500).json({ error: 'Failed to unlock date' });
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
