import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { calculateAllInventoryBalances, TXN_TYPE, TXN_REASON } from '../utils/queryPatterns.js';

const router = Router();

// Get all tailors
router.get('/tailors', authenticateToken, async (req, res) => {
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
router.get('/batches', authenticateToken, async (req, res) => {
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

// Helper to generate batch code (YYYYMMDD-XXX)
const generateBatchCode = async (prisma, targetDate) => {
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Count existing batches for this date
    const existingCount = await prisma.productionBatch.count({
        where: {
            batchDate: { gte: startOfDay, lte: endOfDay }
        }
    });

    const serial = String(existingCount + 1).padStart(3, '0');
    return `${dateStr}-${serial}`;
};

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

        // Generate batch code
        const batchCode = await generateBatchCode(req.prisma, targetDate);

        const batch = await req.prisma.productionBatch.create({
            data: {
                batchCode,
                batchDate: targetDate,
                tailorId: tailorId || null,
                skuId,
                qtyPlanned,
                priority: priority || 'normal',
                sourceOrderLineId: sourceOrderLineId || null,
                notes: notes || null
            },
            include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } },
        });

        // If linked to order line, update it
        if (sourceOrderLineId) {
            await req.prisma.orderLine.update({ where: { id: sourceOrderLineId }, data: { productionBatchId: batch.id } });
        }

        res.status(201).json(batch);
    } catch (error) {
        console.error('Create batch error:', error);
        res.status(500).json({ error: error.message || 'Failed to create batch' });
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

            // Create inventory inward with batch code for tracking
            await tx.inventoryTransaction.create({
                data: { skuId: batch.skuId, txnType: TXN_TYPE.INWARD, qty: qtyCompleted, reason: TXN_REASON.PRODUCTION, referenceId: batch.id, notes: `Production ${batch.batchCode || batch.id}`, createdById: req.user.id },
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
        });

        const updated = await req.prisma.productionBatch.findUnique({ where: { id: req.params.id }, include: { tailor: true, sku: true } });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete batch' });
    }
});

// Uncomplete batch (reverses inventory inward + fabric outward)
router.post('/batches/:id/uncomplete', authenticateToken, async (req, res) => {
    try {
        const batch = await req.prisma.productionBatch.findUnique({
            where: { id: req.params.id },
            include: { sku: { include: { variation: true } } }
        });

        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        if (batch.status !== 'completed') return res.status(400).json({ error: 'Batch is not completed' });

        await req.prisma.$transaction(async (tx) => {
            // Update batch status back to planned
            await tx.productionBatch.update({
                where: { id: req.params.id },
                data: { qtyCompleted: 0, status: 'planned', completedAt: null }
            });

            // Delete inventory inward transaction
            await tx.inventoryTransaction.deleteMany({
                where: { referenceId: batch.id, reason: TXN_REASON.PRODUCTION, txnType: TXN_TYPE.INWARD }
            });

            // Delete fabric outward transaction
            await tx.fabricTransaction.deleteMany({
                where: { referenceId: batch.id, reason: TXN_REASON.PRODUCTION, txnType: 'outward' }
            });
        });

        const updated = await req.prisma.productionBatch.findUnique({
            where: { id: req.params.id },
            include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } }
        });
        res.json(updated);
    } catch (error) {
        console.error('Uncomplete batch error:', error);
        res.status(500).json({ error: 'Failed to uncomplete batch' });
    }
});

// Get locked production dates
router.get('/locked-dates', authenticateToken, async (req, res) => {
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
router.get('/capacity', authenticateToken, async (req, res) => {
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

// Get production requirements from open orders (order-wise)
router.get('/requirements', authenticateToken, async (req, res) => {
    try {
        // Get all open orders with their lines (only pending - allocated already have inventory)
        const openOrders = await req.prisma.order.findMany({
            where: { status: 'open' },
            include: {
                orderLines: {
                    where: { lineStatus: 'pending' },
                    include: {
                        sku: {
                            include: {
                                variation: {
                                    include: {
                                        product: { include: { fabricType: true } },
                                        fabric: true
                                    }
                                }
                            }
                        }
                    }
                },
                customer: true
            },
            orderBy: { orderDate: 'asc' }
        });

        // Get current inventory for all SKUs (using shared helper)
        const balanceMap = await calculateAllInventoryBalances(req.prisma);

        // Convert to simple object for lookup (use availableBalance for production planning)
        const inventoryBalance = {};
        for (const [skuId, balance] of balanceMap) {
            inventoryBalance[skuId] = balance.availableBalance;
        }

        // Get planned/in-progress production batches per SKU
        const plannedBatches = await req.prisma.productionBatch.findMany({
            where: { status: { in: ['planned', 'in_progress'] } },
            select: { skuId: true, qtyPlanned: true, qtyCompleted: true, sourceOrderLineId: true }
        });

        // Calculate scheduled production per SKU
        const scheduledProduction = {};
        const scheduledByOrderLine = {};
        plannedBatches.forEach(batch => {
            if (!scheduledProduction[batch.skuId]) scheduledProduction[batch.skuId] = 0;
            scheduledProduction[batch.skuId] += (batch.qtyPlanned - batch.qtyCompleted);
            if (batch.sourceOrderLineId) {
                scheduledByOrderLine[batch.sourceOrderLineId] = (scheduledByOrderLine[batch.sourceOrderLineId] || 0) + batch.qtyPlanned;
            }
        });

        // Build order-wise requirements
        const requirements = [];

        openOrders.forEach(order => {
            order.orderLines.forEach(line => {
                const sku = line.sku;
                const currentInventory = inventoryBalance[line.skuId] || 0;
                const totalScheduled = scheduledProduction[line.skuId] || 0;
                const scheduledForThisLine = scheduledByOrderLine[line.id] || 0;
                const availableQty = currentInventory + totalScheduled;

                // Skip if inventory already covers this line
                if (currentInventory >= line.qty) {
                    return; // No production needed - inventory available
                }

                // Skip if production is already scheduled for this line
                const shortage = Math.max(0, line.qty - scheduledForThisLine);

                if (shortage > 0) {
                    requirements.push({
                        orderLineId: line.id,
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        orderDate: order.orderDate,
                        customerName: order.customer?.name || 'Unknown',
                        skuId: line.skuId,
                        skuCode: sku.skuCode,
                        productName: sku.variation.product.name,
                        colorName: sku.variation.colorName,
                        size: sku.size,
                        fabricType: sku.variation.product.fabricType?.name || 'N/A',
                        qty: line.qty,
                        currentInventory,
                        scheduledForLine: scheduledForThisLine,
                        shortage,
                        lineStatus: line.lineStatus
                    });
                }
            });
        });

        // Sort by order date (oldest first)
        requirements.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

        // Summary stats
        const summary = {
            totalLinesNeedingProduction: requirements.length,
            totalUnitsNeeded: requirements.reduce((sum, r) => sum + r.shortage, 0),
            totalOrdersAffected: new Set(requirements.map(r => r.orderId)).size
        };

        res.json({ requirements, summary });
    } catch (error) {
        console.error('Get production requirements error:', error);
        res.status(500).json({ error: 'Failed to fetch production requirements' });
    }
});

// Get pending production batches for a SKU (for Production Inward page)
router.get('/pending-by-sku/:skuId', authenticateToken, async (req, res) => {
    try {
        const { skuId } = req.params;

        const batches = await req.prisma.productionBatch.findMany({
            where: {
                skuId,
                status: { in: ['planned', 'in_progress'] },
            },
            include: {
                tailor: { select: { id: true, name: true } },
            },
            orderBy: { batchDate: 'asc' },
        });

        // Calculate pending quantity for each batch
        const pendingBatches = batches.map(batch => ({
            id: batch.id,
            batchCode: batch.batchCode,
            batchDate: batch.batchDate,
            qtyPlanned: batch.qtyPlanned,
            qtyCompleted: batch.qtyCompleted,
            qtyPending: batch.qtyPlanned - batch.qtyCompleted,
            status: batch.status,
            tailor: batch.tailor,
        }));

        const totalPending = pendingBatches.reduce((sum, b) => sum + b.qtyPending, 0);

        res.json({ batches: pendingBatches, totalPending });
    } catch (error) {
        console.error('Get pending batches by SKU error:', error);
        res.status(500).json({ error: 'Failed to fetch pending batches' });
    }
});

export default router;
