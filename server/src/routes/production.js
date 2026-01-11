import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/permissions.js';
import {
    NotFoundError,
    ValidationError,
    BusinessLogicError,
} from '../utils/errors.js';
import { calculateAllInventoryBalances, calculateFabricBalance, TXN_TYPE, TXN_REASON } from '../utils/queryPatterns.js';
import { getLockedDates, saveLockedDates } from '../utils/productionUtils.js';

const router = Router();

// Get all tailors
router.get('/tailors', authenticateToken, asyncHandler(async (req, res) => {
    const tailors = await req.prisma.tailor.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json(tailors);
}));

// Create tailor
router.post('/tailors', authenticateToken, asyncHandler(async (req, res) => {
    const { name, specializations, dailyCapacityMins } = req.body;
    const tailor = await req.prisma.tailor.create({ data: { name, specializations, dailyCapacityMins: dailyCapacityMins || 480 } });
    res.status(201).json(tailor);
}));

// Get all production batches
// Custom batches include customization details and linked order info
router.get('/batches', authenticateToken, asyncHandler(async (req, res) => {
    const { status, tailorId, startDate, endDate, customOnly } = req.query;
    const where = {};
    if (status) where.status = status;
    if (tailorId) where.tailorId = tailorId;
    if (startDate || endDate) {
        where.batchDate = {};
        if (startDate) where.batchDate.gte = new Date(startDate);
        if (endDate) where.batchDate.lte = new Date(endDate);
    }
    // Optional filter to show only custom SKU batches
    if (customOnly === 'true') {
        where.sku = { isCustomSku: true };
    }

    const batches = await req.prisma.productionBatch.findMany({
        where,
        include: {
            tailor: true,
            sku: { include: { variation: { include: { product: true, fabric: true } } } },
            // Include linked order line details for custom batches
            orderLines: {
                include: {
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            customerName: true
                        }
                    }
                }
            }
        },
        orderBy: { batchDate: 'desc' },
    });

    // Enrich batches with customization display info
    const enrichedBatches = batches.map(batch => {
        const isCustom = batch.sku?.isCustomSku || false;

        return {
            ...batch,
            // Add explicit custom SKU indicator
            isCustomSku: isCustom,
            // Add customization details if this is a custom batch
            ...(isCustom && batch.sku && {
                customization: {
                    type: batch.sku.customizationType || null,
                    value: batch.sku.customizationValue || null,
                    notes: batch.sku.customizationNotes || null,
                    sourceOrderLineId: batch.sourceOrderLineId,
                    // Include linked order info
                    linkedOrder: batch.orderLines?.[0]?.order || null
                }
            })
        };
    });

    res.json(enrichedBatches);
}));

/**
 * Generate batch code atomically using database sequence pattern
 * Format: YYYYMMDD-XXX (e.g., 20260107-001)
 *
 * Uses a retry loop with unique constraint to handle race conditions.
 * If concurrent requests try to create batches for the same date,
 * only one will succeed with each code, others will retry with next number.
 */
const generateBatchCode = async (prisma, targetDate) => {
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get the highest existing batch code for this date
    const latestBatch = await prisma.productionBatch.findFirst({
        where: {
            batchDate: { gte: startOfDay, lte: endOfDay },
            batchCode: { startsWith: dateStr }
        },
        orderBy: { batchCode: 'desc' },
        select: { batchCode: true }
    });

    let nextSerial = 1;
    if (latestBatch && latestBatch.batchCode) {
        // Extract serial number from batch code (e.g., "20260107-003" -> 3)
        const match = latestBatch.batchCode.match(/-(\d+)$/);
        if (match) {
            nextSerial = parseInt(match[1], 10) + 1;
        }
    }

    const serial = String(nextSerial).padStart(3, '0');
    return `${dateStr}-${serial}`;
};

/**
 * Create batch with atomic batch code generation
 * Handles race conditions by catching unique constraint violations and retrying
 */
const createBatchWithAtomicCode = async (prisma, batchData, targetDate, maxRetries = 5) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const batchCode = await generateBatchCode(prisma, targetDate);

            const batch = await prisma.productionBatch.create({
                data: {
                    ...batchData,
                    batchCode,
                },
                include: {
                    tailor: true,
                    sku: { include: { variation: { include: { product: true } } } }
                },
            });

            return batch;
        } catch (error) {
            // P2002 is Prisma's unique constraint violation error code
            if (error.code === 'P2002' && error.meta?.target?.includes('batchCode')) {
                // Race condition occurred, retry with new code
                if (attempt === maxRetries - 1) {
                    throw new Error('Failed to generate unique batch code after multiple attempts');
                }
                // Small delay before retry to reduce contention
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
};

// Create batch
router.post('/batches', authenticateToken, requirePermission('production:create'), asyncHandler(async (req, res) => {
    const { batchDate, tailorId, skuId, qtyPlanned, priority, sourceOrderLineId, notes } = req.body;

    // Check if date is locked
    const targetDate = batchDate ? new Date(batchDate) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    const lockedDates = await getLockedDates(req.prisma);

    if (lockedDates.includes(dateStr)) {
        throw new BusinessLogicError(`Production date ${dateStr} is locked. Cannot add new items.`, 'DATE_LOCKED');
    }

    // Validate scheduled date is not in the past (allow today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDateNormalized = new Date(targetDate);
    targetDateNormalized.setHours(0, 0, 0, 0);

    if (targetDateNormalized < today) {
        throw new ValidationError('Cannot schedule batch for a past date');
    }

    // Create batch with atomic batch code generation (handles race conditions)
    const batchData = {
        batchDate: targetDate,
        tailorId: tailorId || null,
        skuId,
        qtyPlanned,
        priority: priority || 'normal',
        sourceOrderLineId: sourceOrderLineId || null,
        notes: notes || null
    };

    const batch = await createBatchWithAtomicCode(req.prisma, batchData, targetDate);

    // If linked to order line, update it
    if (sourceOrderLineId) {
        await req.prisma.orderLine.update({ where: { id: sourceOrderLineId }, data: { productionBatchId: batch.id } });
    }

    res.status(201).json(batch);
}));

// Start batch
router.post('/batches/:id/start', authenticateToken, asyncHandler(async (req, res) => {
    const batch = await req.prisma.productionBatch.update({ where: { id: req.params.id }, data: { status: 'in_progress' } });
    res.json(batch);
}));

/**
 * Determine appropriate batch status based on quantities
 * @param {number} qtyPlanned - Planned quantity
 * @param {number} qtyCompleted - Completed quantity
 * @param {string} currentStatus - Current status
 * @returns {string|null} New status or null if no change needed
 */
const determineBatchStatus = (qtyPlanned, qtyCompleted, currentStatus) => {
    // If fully completed, should be 'completed'
    if (qtyCompleted >= qtyPlanned && qtyCompleted > 0) {
        return currentStatus !== 'completed' ? 'completed' : null;
    }

    // If partially completed, should be 'in_progress'
    if (qtyCompleted > 0 && qtyCompleted < qtyPlanned) {
        return currentStatus !== 'in_progress' ? 'in_progress' : null;
    }

    // If nothing completed and currently 'completed', reset to 'planned'
    if (qtyCompleted === 0 && currentStatus === 'completed') {
        return 'planned';
    }

    return null; // No status change needed
};

// Update batch (change date, qty, notes)
router.put('/batches/:id', authenticateToken, asyncHandler(async (req, res) => {
    const { batchDate, qtyPlanned, tailorId, priority, notes } = req.body;

    // Fetch current batch state first
    const currentBatch = await req.prisma.productionBatch.findUnique({
        where: { id: req.params.id },
        select: { qtyPlanned: true, qtyCompleted: true, status: true }
    });

    if (!currentBatch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', req.params.id);
    }

    const updateData = {};
    if (batchDate) updateData.batchDate = new Date(batchDate);
    if (qtyPlanned) updateData.qtyPlanned = qtyPlanned;
    if (tailorId) updateData.tailorId = tailorId;
    if (priority) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes;

    // AUTO-UPDATE STATUS: If qtyPlanned changes, check if status needs update
    const newQtyPlanned = qtyPlanned ?? currentBatch.qtyPlanned;
    const newStatus = determineBatchStatus(newQtyPlanned, currentBatch.qtyCompleted, currentBatch.status);
    if (newStatus) {
        updateData.status = newStatus;
        // If status changes to completed, set completedAt
        if (newStatus === 'completed' && !currentBatch.completedAt) {
            updateData.completedAt = new Date();
        }
    }

    // Return minimal data - frontend uses optimistic updates with cached data
    const batch = await req.prisma.productionBatch.update({
        where: { id: req.params.id },
        data: updateData,
        select: {
            id: true,
            batchCode: true,
            batchDate: true,
            status: true,
            qtyPlanned: true,
            qtyCompleted: true,
            tailorId: true,
            priority: true,
            notes: true,
        },
    });
    res.json(batch);
}));

// Delete batch
router.delete('/batches/:id', authenticateToken, requirePermission('production:delete'), asyncHandler(async (req, res) => {
    const batch = await req.prisma.productionBatch.findUnique({ where: { id: req.params.id } });
    if (!batch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', req.params.id);
    }

    // SAFETY CHECK: Prevent deletion if batch has inventory transactions
    // This protects data integrity - completed batches have created inventory
    const inventoryTxnCount = await req.prisma.inventoryTransaction.count({
        where: {
            referenceId: batch.id,
            reason: TXN_REASON.PRODUCTION
        }
    });

    if (inventoryTxnCount > 0) {
        throw new BusinessLogicError(
            'Cannot delete batch with inventory transactions. Use uncomplete first.',
            'HAS_INVENTORY_TRANSACTIONS'
        );
    }

    // Also check for fabric transactions
    const fabricTxnCount = await req.prisma.fabricTransaction.count({
        where: {
            referenceId: batch.id,
            reason: 'production'
        }
    });

    if (fabricTxnCount > 0) {
        throw new BusinessLogicError(
            'Cannot delete batch with fabric transactions. Use uncomplete first.',
            'HAS_FABRIC_TRANSACTIONS'
        );
    }

    // Unlink from order line if connected
    if (batch.sourceOrderLineId) {
        await req.prisma.orderLine.update({ where: { id: batch.sourceOrderLineId }, data: { productionBatchId: null } });
    }

    await req.prisma.productionBatch.delete({ where: { id: req.params.id } });
    res.json({ success: true });
}));

/**
 * Get effective fabric consumption for a SKU
 * Standardized priority: SKU.fabricConsumption ?? Product.defaultFabricConsumption ?? 1.5
 *
 * Note: SKU schema default is 1.5, so we check if it differs from default
 * to determine if it was explicitly set.
 */
const DEFAULT_FABRIC_CONSUMPTION = 1.5;

const getEffectiveFabricConsumption = (sku, product) => {
    // Priority 1: SKU-specific consumption (if explicitly set, not default)
    const skuConsumption = Number(sku.fabricConsumption);
    if (skuConsumption && skuConsumption !== DEFAULT_FABRIC_CONSUMPTION && skuConsumption > 0) {
        return skuConsumption;
    }

    // Priority 2: Product-level default
    const productDefault = product?.defaultFabricConsumption;
    if (productDefault && Number(productDefault) > 0) {
        return Number(productDefault);
    }

    // Priority 3: System default
    return DEFAULT_FABRIC_CONSUMPTION;
};

// Complete batch (creates inventory inward + fabric outward)
// Custom SKUs auto-allocate to their linked order line
router.post('/batches/:id/complete', authenticateToken, requirePermission('production:complete'), asyncHandler(async (req, res) => {
    const { qtyCompleted } = req.body;

    if (!qtyCompleted || qtyCompleted <= 0) {
        throw new ValidationError('qtyCompleted must be a positive number');
    }

    const batch = await req.prisma.productionBatch.findUnique({
        where: { id: req.params.id },
        include: { sku: { include: { variation: { include: { product: true } } } } }
    });

    if (!batch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', req.params.id);
    }

    // IDEMPOTENCY CHECK: Prevent double completion
    if (batch.completedAt) {
        throw new BusinessLogicError('Batch already completed', 'ALREADY_COMPLETED');
    }

    // Calculate required fabric consumption
    const consumptionPerUnit = getEffectiveFabricConsumption(
        batch.sku,
        batch.sku.variation.product
    );
    const fabricConsumption = consumptionPerUnit * qtyCompleted;

    // FABRIC BALANCE CHECK: Validate sufficient fabric before completion
    const fabricId = batch.sku.variation.fabricId;
    const fabricBalance = await calculateFabricBalance(req.prisma, fabricId);

    if (fabricBalance.currentBalance < fabricConsumption) {
        throw new BusinessLogicError(
            `Insufficient fabric balance: required ${fabricConsumption}, available ${fabricBalance.currentBalance}`,
            'INSUFFICIENT_FABRIC'
        );
    }

    // Check if this is a custom SKU batch that should auto-allocate
    const isCustomSkuBatch = batch.sku.isCustomSku && batch.sourceOrderLineId;

    let autoAllocated = false;
    await req.prisma.$transaction(async (tx) => {
        // Update batch
        await tx.productionBatch.update({
            where: { id: req.params.id },
            data: { qtyCompleted, status: 'completed', completedAt: new Date() }
        });

        // Create inventory inward with batch code for tracking
        const inwardReason = isCustomSkuBatch ? 'production_custom' : TXN_REASON.PRODUCTION;
        await tx.inventoryTransaction.create({
            data: {
                skuId: batch.skuId,
                txnType: TXN_TYPE.INWARD,
                qty: qtyCompleted,
                reason: inwardReason,
                referenceId: batch.id,
                notes: isCustomSkuBatch
                    ? `Custom production: ${batch.sku.skuCode}`
                    : `Production ${batch.batchCode || batch.id}`,
                createdById: req.user.id
            },
        });

        // Create fabric outward transaction
        await tx.fabricTransaction.create({
            data: {
                fabricId: fabricId,
                txnType: 'outward',
                qty: fabricConsumption,
                unit: 'meter',
                reason: 'production',
                referenceId: batch.id,
                createdById: req.user.id
            },
        });

        // CUSTOM SKU AUTO-ALLOCATION:
        // When a custom SKU batch completes, auto-allocate to the linked order line
        // Standard order-linked batches do NOT auto-allocate (staff allocates manually)
        if (isCustomSkuBatch) {
            // Create reserved transaction for the completed quantity
            await tx.inventoryTransaction.create({
                data: {
                    skuId: batch.skuId,
                    txnType: TXN_TYPE.RESERVED,
                    qty: qtyCompleted,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                    referenceId: batch.sourceOrderLineId,
                    notes: `Auto-allocated from custom production: ${batch.sku.skuCode}`,
                    createdById: req.user.id
                },
            });

            // Update order line status to 'allocated'
            await tx.orderLine.update({
                where: { id: batch.sourceOrderLineId },
                data: {
                    lineStatus: 'allocated',
                    allocatedAt: new Date()
                }
            });

            autoAllocated = true;
        }
    });

    const updated = await req.prisma.productionBatch.findUnique({
        where: { id: req.params.id },
        include: { tailor: true, sku: true }
    });

    // Include auto-allocation info in response
    res.json({
        ...updated,
        autoAllocated,
        isCustomSku: batch.sku.isCustomSku,
        ...(isCustomSkuBatch && {
            allocationInfo: {
                orderLineId: batch.sourceOrderLineId,
                qtyAllocated: qtyCompleted,
                message: 'Custom SKU auto-allocated to order line'
            }
        })
    });
}));

// Uncomplete batch (reverses inventory inward + fabric outward)
// For custom SKUs, also reverses auto-allocation
router.post('/batches/:id/uncomplete', authenticateToken, requirePermission('production:complete'), asyncHandler(async (req, res) => {
    const batch = await req.prisma.productionBatch.findUnique({
        where: { id: req.params.id },
        include: { sku: { include: { variation: true } } }
    });

    if (!batch) {
        throw new NotFoundError('Batch not found', 'ProductionBatch', req.params.id);
    }
    if (batch.status !== 'completed') {
        throw new ValidationError('Batch is not completed');
    }

    // Check if this is a custom SKU batch that was auto-allocated
    const isCustomSkuBatch = batch.sku.isCustomSku && batch.sourceOrderLineId;

    // If custom SKU, check if order line has progressed beyond allocation
    if (isCustomSkuBatch) {
        const orderLine = await req.prisma.orderLine.findUnique({
            where: { id: batch.sourceOrderLineId }
        });

        if (orderLine && ['picked', 'packed', 'shipped'].includes(orderLine.lineStatus)) {
            throw new BusinessLogicError(
                `Cannot uncomplete - order line has progressed to ${orderLine.lineStatus}. Unship or unpick first.`,
                'ORDER_LINE_PROGRESSED'
            );
        }
    }

    let allocationReversed = false;
    await req.prisma.$transaction(async (tx) => {
        // Update batch status back to planned
        await tx.productionBatch.update({
            where: { id: req.params.id },
            data: { qtyCompleted: 0, status: 'planned', completedAt: null }
        });

        // Delete inventory inward transaction (includes both 'production' and 'production_custom' reasons)
        await tx.inventoryTransaction.deleteMany({
            where: {
                referenceId: batch.id,
                reason: { in: [TXN_REASON.PRODUCTION, 'production_custom'] },
                txnType: TXN_TYPE.INWARD
            }
        });

        // Delete fabric outward transaction
        await tx.fabricTransaction.deleteMany({
            where: { referenceId: batch.id, reason: TXN_REASON.PRODUCTION, txnType: 'outward' }
        });

        // CUSTOM SKU: Reverse auto-allocation
        if (isCustomSkuBatch) {
            // Delete reserved transaction for this order line
            await tx.inventoryTransaction.deleteMany({
                where: {
                    referenceId: batch.sourceOrderLineId,
                    txnType: TXN_TYPE.RESERVED,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                    skuId: batch.skuId
                }
            });

            // Reset order line status back to pending
            await tx.orderLine.update({
                where: { id: batch.sourceOrderLineId },
                data: {
                    lineStatus: 'pending',
                    allocatedAt: null
                }
            });

            allocationReversed = true;
        }
    });

    const updated = await req.prisma.productionBatch.findUnique({
        where: { id: req.params.id },
        include: { tailor: true, sku: { include: { variation: { include: { product: true } } } } }
    });

    res.json({
        ...updated,
        allocationReversed,
        isCustomSku: batch.sku.isCustomSku,
        ...(allocationReversed && {
            message: 'Custom SKU allocation reversed - order line reset to pending'
        })
    });
}));

// Get locked production dates
router.get('/locked-dates', authenticateToken, asyncHandler(async (req, res) => {
    const lockedDates = await getLockedDates(req.prisma);
    res.json(lockedDates);
}));

// Lock a production date
router.post('/lock-date', authenticateToken, asyncHandler(async (req, res) => {
    const { date } = req.body;
    if (!date) {
        throw new ValidationError('Date is required');
    }

    const dateStr = date.split('T')[0]; // Normalize to YYYY-MM-DD

    const lockedDates = await getLockedDates(req.prisma);

    if (!lockedDates.includes(dateStr)) {
        lockedDates.push(dateStr);
        await saveLockedDates(req.prisma, lockedDates);
    }

    res.json({ success: true, lockedDates });
}));

// Unlock a production date
router.post('/unlock-date', authenticateToken, asyncHandler(async (req, res) => {
    const { date } = req.body;
    if (!date) {
        throw new ValidationError('Date is required');
    }

    const dateStr = date.split('T')[0]; // Normalize to YYYY-MM-DD

    let lockedDates = await getLockedDates(req.prisma);

    lockedDates = lockedDates.filter(d => d !== dateStr);
    await saveLockedDates(req.prisma, lockedDates);

    res.json({ success: true, lockedDates });
}));

// Capacity dashboard
router.get('/capacity', authenticateToken, asyncHandler(async (req, res) => {
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
}));

// Get production requirements from open orders (order-wise)
router.get('/requirements', authenticateToken, asyncHandler(async (req, res) => {
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

    // Collect unique SKU IDs from pending order lines (optimization: only calculate balances for these)
    const pendingSkuIds = new Set();
    openOrders.forEach(order => {
        order.orderLines.forEach(line => {
            pendingSkuIds.add(line.skuId);
        });
    });

    // Get current inventory only for pending SKUs (major performance improvement)
    const balanceMap = pendingSkuIds.size > 0
        ? await calculateAllInventoryBalances(req.prisma, Array.from(pendingSkuIds))
        : new Map();

    // Convert to simple object for lookup (use availableBalance for production planning)
    const inventoryBalance = {};
    for (const [skuId, balance] of balanceMap) {
        inventoryBalance[skuId] = balance.availableBalance;
    }

    // Get planned/in-progress production batches only for relevant SKUs
    const plannedBatches = pendingSkuIds.size > 0
        ? await req.prisma.productionBatch.findMany({
            where: {
                status: { in: ['planned', 'in_progress'] },
                skuId: { in: Array.from(pendingSkuIds) }
            },
            select: { skuId: true, qtyPlanned: true, qtyCompleted: true, sourceOrderLineId: true }
        })
        : [];

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
}));

// Get pending production batches for a SKU (for Production Inward page)
router.get('/pending-by-sku/:skuId', authenticateToken, asyncHandler(async (req, res) => {
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
}));

export default router;
