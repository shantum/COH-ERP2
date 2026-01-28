/**
 * Order Sync Logic for Google Sheets sync
 *
 * Handles:
 * - AdminShip + release orders not on the sheet
 * - Create missing marketplace orders
 * - Sync notes on existing orders
 * - Sync order line statuses (allocated/picked/packed/shipped)
 * - Assign production batches from samplingDate
 */

import type { PrismaClient } from '@prisma/client';
import type { OrderRow } from './csvParser.js';
import { mapChannel } from './csvParser.js';

// ============================================
// TYPES
// ============================================

export interface ShipAndReleaseReport {
    ordersToRelease: Array<{
        orderNumber: string;
        orderId: string;
        lineCount: number;
        nonShippedLineCount: number;
        allCancelled: boolean;
    }>;
}

export interface CreateOrderReport {
    ordersToCreate: Array<{
        orderNumber: string;
        channel: string;
        isExchange: boolean;
        lineCount: number;
        skuCodes: string[];
        missingSkus: string[];
    }>;
}

export interface SyncNotesReport {
    ordersToUpdate: Array<{
        orderNumber: string;
        newNotes: string;
    }>;
}

type LineStatus = 'pending' | 'allocated' | 'picked' | 'packed' | 'shipped' | 'cancelled';

export interface StatusTransition {
    orderNumber: string;
    lineId: string;
    skuCode: string;
    from: LineStatus;
    to: LineStatus;
    awb?: string;
    courier?: string;
}

export interface LineStatusSyncReport {
    transitions: StatusTransition[];
    awbUpdates: Array<{ lineId: string; skuCode: string; orderNumber: string; awb: string; courier: string }>;
    skipped: Array<{ orderNumber: string; skuCode: string; reason: string }>;
}


// ============================================
// STEP 2: Admin Ship + Release
// ============================================

/**
 * Find open orders not on the sheet and plan their release
 */
export async function planShipAndRelease(
    prisma: PrismaClient,
    sheetOrderNumbers: Set<string>
): Promise<ShipAndReleaseReport> {
    // Query all open orders
    const openOrders = await prisma.order.findMany({
        where: {
            isArchived: false,
            OR: [
                { orderLines: { some: { lineStatus: { notIn: ['shipped', 'cancelled'] } } } },
                {
                    releasedToShipped: false,
                    orderLines: { some: { lineStatus: 'shipped' } },
                    NOT: { orderLines: { some: { lineStatus: { notIn: ['shipped', 'cancelled'] } } } },
                },
                {
                    releasedToCancelled: false,
                    orderLines: { some: { lineStatus: 'cancelled' } },
                    NOT: { orderLines: { some: { lineStatus: { not: 'cancelled' } } } },
                },
            ],
        },
        select: {
            id: true,
            orderNumber: true,
            orderLines: {
                select: { id: true, lineStatus: true },
            },
        },
    });

    const ordersToRelease: ShipAndReleaseReport['ordersToRelease'] = [];

    for (const order of openOrders) {
        if (sheetOrderNumbers.has(order.orderNumber)) continue;

        const nonShippedLines = order.orderLines.filter(
            l => !['shipped', 'cancelled'].includes(l.lineStatus)
        );
        const allCancelled = order.orderLines.every(l => l.lineStatus === 'cancelled');

        ordersToRelease.push({
            orderNumber: order.orderNumber,
            orderId: order.id,
            lineCount: order.orderLines.length,
            nonShippedLineCount: nonShippedLines.length,
            allCancelled,
        });
    }

    return { ordersToRelease };
}

/**
 * Execute admin ship + release for orders not on the sheet
 */
export async function executeShipAndRelease(
    prisma: PrismaClient,
    report: ShipAndReleaseReport,
    userId: string
): Promise<{ shipped: number; released: number; errors: string[] }> {
    let shipped = 0;
    let released = 0;
    const errors: string[] = [];

    for (const order of report.ordersToRelease) {
        try {
            await prisma.$transaction(async (tx) => {
                const now = new Date();

                if (order.allCancelled) {
                    // All lines cancelled - just release
                    await tx.order.update({
                        where: { id: order.orderId },
                        data: { releasedToCancelled: true },
                    });
                } else {
                    // Admin ship non-shipped/non-cancelled lines
                    if (order.nonShippedLineCount > 0) {
                        const linesToShip = await tx.orderLine.findMany({
                            where: {
                                orderId: order.orderId,
                                lineStatus: { notIn: ['shipped', 'cancelled'] },
                            },
                            select: { id: true, skuId: true, qty: true, lineStatus: true },
                        });

                        const lineIds = linesToShip.map(l => l.id);

                        // For lines with existing allocations, update reason to admin_ship
                        await tx.inventoryTransaction.updateMany({
                            where: {
                                referenceId: { in: lineIds },
                                reason: 'order_allocation',
                            },
                            data: {
                                reason: 'admin_ship',
                            },
                        });

                        // For pending lines (no allocation transaction), create outward txn
                        const pendingLines = linesToShip.filter(l => l.lineStatus === 'pending');
                        if (pendingLines.length > 0) {
                            await tx.inventoryTransaction.createMany({
                                data: pendingLines.map(l => ({
                                    skuId: l.skuId,
                                    txnType: 'outward' as const,
                                    qty: l.qty,
                                    reason: 'admin_ship',
                                    referenceId: l.id,
                                    createdById: userId,
                                })),
                            });
                        }

                        await tx.orderLine.updateMany({
                            where: {
                                orderId: order.orderId,
                                lineStatus: { notIn: ['shipped', 'cancelled'] },
                            },
                            data: {
                                lineStatus: 'shipped',
                                shippedAt: now,
                                awbNumber: 'ADMIN-SHEET-SYNC',
                                courier: 'Manual',
                                trackingStatus: 'in_transit',
                            },
                        });

                        shipped += order.nonShippedLineCount;
                    }

                    // Release to shipped
                    await tx.order.update({
                        where: { id: order.orderId },
                        data: {
                            releasedToShipped: true,
                            status: 'shipped',
                        },
                    });
                }

                released++;
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${order.orderNumber}: ${msg}`);
        }
    }

    return { shipped, released, errors };
}

// ============================================
// STEP 3: Create Missing Marketplace Orders
// ============================================

/**
 * Plan creation of marketplace orders not in the ERP
 */
export async function planCreateOrders(
    prisma: PrismaClient,
    ordersByNumber: Map<string, OrderRow[]>
): Promise<CreateOrderReport> {
    const ordersToCreate: CreateOrderReport['ordersToCreate'] = [];

    // Marketplace channels to create orders for
    const marketplaceChannels = new Set(['myntra', 'ajio', 'nykaa', 'offline']);

    // Collect all unique order numbers that might need creation
    const candidateOrderNumbers: string[] = [];
    for (const [orderNum, rows] of ordersByNumber) {
        const { channel } = mapChannel(rows[0].channel);
        if (marketplaceChannels.has(channel)) {
            candidateOrderNumbers.push(orderNum);
        }
    }

    if (candidateOrderNumbers.length === 0) return { ordersToCreate };

    // Batch check which orders already exist
    const existingOrders = await prisma.order.findMany({
        where: { orderNumber: { in: candidateOrderNumbers } },
        select: { orderNumber: true },
    });
    const existingSet = new Set(existingOrders.map(o => o.orderNumber));

    // Collect all SKU codes from candidate orders
    const allSkuCodes = new Set<string>();
    for (const orderNum of candidateOrderNumbers) {
        if (existingSet.has(orderNum)) continue;
        const rows = ordersByNumber.get(orderNum);
        if (rows) {
            for (const row of rows) allSkuCodes.add(row.skuCode);
        }
    }

    // Batch lookup SKUs
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: [...allSkuCodes] } },
        select: { id: true, skuCode: true, mrp: true },
    });
    const skuMap = new Map(skus.map(s => [s.skuCode, s]));

    for (const orderNum of candidateOrderNumbers) {
        if (existingSet.has(orderNum)) continue;

        const rows = ordersByNumber.get(orderNum);
        if (!rows || rows.length === 0) continue;

        const { channel, isExchange } = mapChannel(rows[0].channel);
        const skuCodes = rows.map(r => r.skuCode);
        const missingSkus = skuCodes.filter(code => !skuMap.has(code));

        ordersToCreate.push({
            orderNumber: orderNum,
            channel,
            isExchange,
            lineCount: rows.length,
            skuCodes,
            missingSkus,
        });
    }

    return { ordersToCreate };
}

/**
 * Execute creation of missing marketplace orders
 */
export async function executeCreateOrders(
    prisma: PrismaClient,
    ordersByNumber: Map<string, OrderRow[]>,
    report: CreateOrderReport,
    userId: string
): Promise<{ created: number; errors: string[] }> {
    let created = 0;
    const errors: string[] = [];

    // Batch lookup all needed SKUs
    const allSkuCodes = new Set<string>();
    for (const order of report.ordersToCreate) {
        for (const code of order.skuCodes) allSkuCodes.add(code);
    }
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: [...allSkuCodes] } },
        select: { id: true, skuCode: true, mrp: true },
    });
    const skuMap = new Map(skus.map(s => [s.skuCode, s]));

    for (const orderPlan of report.ordersToCreate) {
        const rows = ordersByNumber.get(orderPlan.orderNumber);
        if (!rows) continue;

        // Skip if any SKU is missing
        const validRows = rows.filter(r => skuMap.has(r.skuCode));
        if (validRows.length === 0) {
            errors.push(`${orderPlan.orderNumber}: All SKUs missing, cannot create order`);
            continue;
        }

        const firstRow = rows[0];
        const { channel, isExchange } = mapChannel(firstRow.channel);

        // Build notes
        const notes = [firstRow.orderNote, firstRow.cohNote].filter(Boolean).join(' | ');

        try {
            await prisma.$transaction(async (tx) => {
                // Calculate total
                let totalAmount = 0;
                const lineData = validRows.map(row => {
                    const sku = skuMap.get(row.skuCode);
                    const price = row.unitPrice || sku?.mrp || 0;
                    totalAmount += price * row.qty;
                    return {
                        skuId: sku!.id,
                        qty: row.qty,
                        unitPrice: price,
                        lineStatus: 'pending' as const,
                    };
                });

                await tx.order.create({
                    data: {
                        orderNumber: orderPlan.orderNumber,
                        channel,
                        customerName: firstRow.customerName || 'Unknown',
                        customerPhone: firstRow.customerPhone || null,
                        orderDate: firstRow.orderDate || new Date(),
                        paymentMethod: firstRow.paymentMethod,
                        internalNotes: notes || null,
                        shipByDate: firstRow.shipByDate || null,
                        isExchange,
                        totalAmount,
                        status: 'open',
                        orderLines: {
                            create: lineData,
                        },
                    },
                });
            });

            created++;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${orderPlan.orderNumber}: ${msg}`);
        }
    }

    return { created, errors };
}

// ============================================
// STEP 4: Sync Notes
// ============================================

/**
 * Plan notes sync for existing orders
 *
 * Writes notes to OrderLine.notes (visible in the orders table grid),
 * and also to Order.internalNotes for the detail modal.
 */
export async function planSyncNotes(
    prisma: PrismaClient,
    ordersByNumber: Map<string, OrderRow[]>
): Promise<SyncNotesReport> {
    const ordersToUpdate: SyncNotesReport['ordersToUpdate'] = [];

    // Build notes map from CSV
    const notesMap = new Map<string, string>();
    for (const [orderNum, rows] of ordersByNumber) {
        const firstRow = rows[0];
        const notes = [firstRow.orderNote, firstRow.cohNote].filter(Boolean).join(' | ');
        if (notes) notesMap.set(orderNum, notes);
    }

    if (notesMap.size === 0) return { ordersToUpdate };

    // Batch fetch orders with their lines to check existing notes
    const orders = await prisma.order.findMany({
        where: { orderNumber: { in: [...notesMap.keys()] } },
        select: {
            orderNumber: true,
            internalNotes: true,
            orderLines: { select: { id: true, notes: true } },
        },
    });

    for (const order of orders) {
        const newNotes = notesMap.get(order.orderNumber);
        if (!newNotes) continue;

        // Check if any line already has different notes, or order internalNotes differs
        const linesNeedUpdate = order.orderLines.some(l => l.notes !== newNotes);
        const orderNeedsUpdate = order.internalNotes !== newNotes;

        if (linesNeedUpdate || orderNeedsUpdate) {
            ordersToUpdate.push({ orderNumber: order.orderNumber, newNotes });
        }
    }

    return { ordersToUpdate };
}

/**
 * Execute notes sync — writes to both OrderLine.notes and Order.internalNotes
 */
export async function executeSyncNotes(
    prisma: PrismaClient,
    report: SyncNotesReport
): Promise<{ updated: number; errors: string[] }> {
    let updated = 0;
    const errors: string[] = [];

    for (const item of report.ordersToUpdate) {
        try {
            // Update Order.internalNotes
            const order = await prisma.order.update({
                where: { orderNumber: item.orderNumber },
                data: { internalNotes: item.newNotes },
                select: { id: true },
            });

            // Update all lines of this order with the same notes
            await prisma.orderLine.updateMany({
                where: { orderId: order.id },
                data: { notes: item.newNotes },
            });

            updated++;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${item.orderNumber}: ${msg}`);
        }
    }

    return { updated, errors };
}

// ============================================
// STEP 5: Sync Line Statuses
// ============================================

/**
 * Determine the target status from CSV boolean flags
 */
function getTargetStatus(row: OrderRow): LineStatus {
    if (row.shipped) return 'shipped';
    if (row.packed) return 'packed';
    if (row.picked) return 'picked';
    if (row.assigned) return 'allocated';
    return 'pending';
}

/**
 * Get the ordered transition path from one status to another
 */
function getTransitionPath(from: LineStatus, to: LineStatus): LineStatus[] {
    const forward: LineStatus[] = ['pending', 'allocated', 'picked', 'packed', 'shipped'];
    const fromIdx = forward.indexOf(from);
    const toIdx = forward.indexOf(to);

    if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) return [];

    // Return intermediate + target statuses (excluding current)
    return forward.slice(fromIdx + 1, toIdx + 1);
}

/**
 * Plan line status transitions
 */
export async function planLineStatusSync(
    prisma: PrismaClient,
    ordersByNumber: Map<string, OrderRow[]>
): Promise<LineStatusSyncReport> {
    const transitions: StatusTransition[] = [];
    const awbUpdates: LineStatusSyncReport['awbUpdates'] = [];
    const skipped: LineStatusSyncReport['skipped'] = [];

    // Batch fetch all orders with their lines
    const orderNumbers = [...ordersByNumber.keys()];

    // Process in batches to avoid massive queries
    const BATCH_SIZE = 500;
    for (let i = 0; i < orderNumbers.length; i += BATCH_SIZE) {
        const batch = orderNumbers.slice(i, i + BATCH_SIZE);

        const orders = await prisma.order.findMany({
            where: { orderNumber: { in: batch } },
            select: {
                id: true,
                orderNumber: true,
                orderLines: {
                    select: {
                        id: true,
                        lineStatus: true,
                        skuId: true,
                        qty: true,
                        awbNumber: true,
                        courier: true,
                        sku: { select: { skuCode: true } },
                    },
                },
            },
        });

        const orderMap = new Map(orders.map(o => [o.orderNumber, o]));

        for (const orderNum of batch) {
            const csvRows = ordersByNumber.get(orderNum);
            const dbOrder = orderMap.get(orderNum);

            if (!csvRows || !dbOrder) continue;

            // Track consumed line IDs to handle duplicate SKUs within an order
            const consumedLineIds = new Set<string>();

            for (const csvRow of csvRows) {
                // Find matching line by SKU code, skipping already-consumed lines
                const matchingLine = dbOrder.orderLines.find(
                    l => l.sku?.skuCode === csvRow.skuCode && !consumedLineIds.has(l.id)
                );
                if (matchingLine) consumedLineIds.add(matchingLine.id);

                if (!matchingLine) {
                    skipped.push({
                        orderNumber: orderNum,
                        skuCode: csvRow.skuCode,
                        reason: 'Line not found in ERP',
                    });
                    continue;
                }

                const currentStatus = matchingLine.lineStatus as LineStatus;
                const targetStatus = getTargetStatus(csvRow);

                // Skip cancelled lines
                if (currentStatus === 'cancelled') {
                    skipped.push({
                        orderNumber: orderNum,
                        skuCode: csvRow.skuCode,
                        reason: 'Line is cancelled',
                    });
                    continue;
                }

                // Skip if already at or beyond target
                if (currentStatus === targetStatus) {
                    // Check if AWB needs updating
                    if (csvRow.awb && matchingLine.awbNumber !== csvRow.awb) {
                        awbUpdates.push({
                            lineId: matchingLine.id,
                            skuCode: csvRow.skuCode,
                            orderNumber: orderNum,
                            awb: csvRow.awb,
                            courier: csvRow.courier || matchingLine.courier || '',
                        });
                    }
                    continue;
                }

                // Plan transitions through intermediate statuses
                const path = getTransitionPath(currentStatus, targetStatus);

                if (path.length === 0) {
                    skipped.push({
                        orderNumber: orderNum,
                        skuCode: csvRow.skuCode,
                        reason: `Cannot transition ${currentStatus} -> ${targetStatus}`,
                    });
                    continue;
                }

                let prevStatus: LineStatus = currentStatus;
                for (const nextStatus of path) {
                    transitions.push({
                        orderNumber: orderNum,
                        lineId: matchingLine.id,
                        skuCode: csvRow.skuCode,
                        from: prevStatus,
                        to: nextStatus,
                        ...(nextStatus === 'shipped' ? { awb: csvRow.awb, courier: csvRow.courier } : {}),
                    });
                    prevStatus = nextStatus;
                }

                // If not shipped but has AWB info, store it
                if (!csvRow.shipped && csvRow.awb && targetStatus !== 'shipped') {
                    awbUpdates.push({
                        lineId: matchingLine.id,
                        skuCode: csvRow.skuCode,
                        orderNumber: orderNum,
                        awb: csvRow.awb,
                        courier: csvRow.courier,
                    });
                }
            }
        }
    }

    return { transitions, awbUpdates, skipped };
}

/**
 * Execute line status transitions using the state machine
 */
export async function executeLineStatusSync(
    prisma: PrismaClient,
    report: LineStatusSyncReport,
    userId: string
): Promise<{ transitioned: number; awbUpdated: number; errors: string[] }> {
    let transitioned = 0;
    let awbUpdated = 0;
    const errors: string[] = [];

    // Group transitions by lineId for sequential processing
    const transitionsByLine = new Map<string, StatusTransition[]>();
    for (const t of report.transitions) {
        const existing = transitionsByLine.get(t.lineId);
        if (existing) {
            existing.push(t);
        } else {
            transitionsByLine.set(t.lineId, [t]);
        }
    }

    // Process each line's transitions in a transaction
    for (const [lineId, lineTransitions] of transitionsByLine) {
        try {
            await prisma.$transaction(async (tx) => {
                for (const t of lineTransitions) {
                    // Get current line to verify status
                    const line = await tx.orderLine.findUnique({
                        where: { id: lineId },
                        select: { lineStatus: true, skuId: true, qty: true },
                    });

                    if (!line) throw new Error(`Line ${lineId} not found`);
                    if (line.lineStatus !== t.from) {
                        throw new Error(
                            `Status mismatch for ${t.orderNumber}/${t.skuCode}: expected ${t.from}, got ${line.lineStatus}`
                        );
                    }

                    // Build update data
                    const updateData: Record<string, unknown> = { lineStatus: t.to };

                    // Handle inventory for allocation
                    if (t.from === 'pending' && t.to === 'allocated') {
                        await tx.inventoryTransaction.create({
                            data: {
                                skuId: line.skuId,
                                txnType: 'outward',
                                qty: line.qty,
                                reason: 'order_allocation',
                                referenceId: lineId,
                                createdById: userId,
                            },
                        });
                        updateData.allocatedAt = new Date();
                    }

                    // Handle timestamps
                    if (t.to === 'picked') updateData.pickedAt = new Date();
                    if (t.to === 'packed') updateData.packedAt = new Date();
                    if (t.to === 'shipped') {
                        updateData.shippedAt = new Date();
                        updateData.awbNumber = t.awb || 'SHEET-SYNC';
                        updateData.courier = t.courier || 'Manual';
                        updateData.trackingStatus = 'in_transit';
                    }

                    await tx.orderLine.update({
                        where: { id: lineId },
                        data: updateData,
                    });

                    transitioned++;
                }
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            const t = lineTransitions[0];
            errors.push(`${t.orderNumber}/${t.skuCode}: ${msg}`);
        }
    }

    // AWB updates (no status change)
    for (const update of report.awbUpdates) {
        try {
            await prisma.orderLine.update({
                where: { id: update.lineId },
                data: {
                    awbNumber: update.awb,
                    courier: update.courier,
                },
            });
            awbUpdated++;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`AWB update ${update.orderNumber}/${update.skuCode}: ${msg}`);
        }
    }

    return { transitioned, awbUpdated, errors };
}

// ============================================
// STEP 6: Production Batch Assignment
// ============================================

export interface ProductionBatchAssignment {
    orderNumber: string;
    lineId: string;
    skuCode: string;
    skuId: string;
    samplingDate: Date;
    qty: number;
}

export interface ProductionBatchDateUpdate {
    orderNumber: string;
    skuCode: string;
    batchId: string;
    batchCode: string | null;
    oldDate: Date;
    newDate: Date;
}

export interface ProductionBatchSyncReport {
    assignments: ProductionBatchAssignment[];
    dateUpdates: ProductionBatchDateUpdate[];
    alreadyLinked: number;
    skipped: Array<{ orderNumber: string; skuCode: string; reason: string }>;
}

/**
 * Plan production batch assignments from samplingDate in CSV
 */
export async function planProductionBatchSync(
    prisma: PrismaClient,
    ordersByNumber: Map<string, OrderRow[]>
): Promise<ProductionBatchSyncReport> {
    const assignments: ProductionBatchAssignment[] = [];
    const dateUpdates: ProductionBatchDateUpdate[] = [];
    const skipped: ProductionBatchSyncReport['skipped'] = [];
    let alreadyLinked = 0;

    // Collect rows with samplingDate
    const rowsWithDate: OrderRow[] = [];
    for (const rows of ordersByNumber.values()) {
        for (const row of rows) {
            if (row.samplingDate) rowsWithDate.push(row);
        }
    }

    if (rowsWithDate.length === 0) return { assignments, dateUpdates, alreadyLinked, skipped };

    // Batch fetch orders
    const orderNumbers = [...new Set(rowsWithDate.map(r => r.orderNumber))];
    const BATCH_SIZE = 500;

    for (let i = 0; i < orderNumbers.length; i += BATCH_SIZE) {
        const batch = orderNumbers.slice(i, i + BATCH_SIZE);

        const orders = await prisma.order.findMany({
            where: { orderNumber: { in: batch } },
            select: {
                id: true,
                orderNumber: true,
                orderLines: {
                    select: {
                        id: true,
                        skuId: true,
                        qty: true,
                        productionBatchId: true,
                        sku: { select: { skuCode: true } },
                        productionBatch: { select: { id: true, batchCode: true, batchDate: true } },
                    },
                },
            },
        });

        const orderMap = new Map(orders.map(o => [o.orderNumber, o]));

        // Track consumed line IDs per order to handle duplicate SKUs
        const consumedLineIds = new Set<string>();

        for (const row of rowsWithDate) {
            if (!batch.includes(row.orderNumber)) continue;

            const dbOrder = orderMap.get(row.orderNumber);
            if (!dbOrder) {
                skipped.push({ orderNumber: row.orderNumber, skuCode: row.skuCode, reason: 'Order not found' });
                continue;
            }

            const line = dbOrder.orderLines.find(
                l => l.sku?.skuCode === row.skuCode && !consumedLineIds.has(l.id)
            );
            if (line) consumedLineIds.add(line.id);
            if (!line) {
                skipped.push({ orderNumber: row.orderNumber, skuCode: row.skuCode, reason: 'Line not found' });
                continue;
            }

            if (line.productionBatchId && line.productionBatch) {
                // Check if the date needs updating
                const existingDay = line.productionBatch.batchDate.toISOString().split('T')[0];
                const csvDay = row.samplingDate!.toISOString().split('T')[0];
                if (existingDay !== csvDay) {
                    dateUpdates.push({
                        orderNumber: row.orderNumber,
                        skuCode: row.skuCode,
                        batchId: line.productionBatch.id,
                        batchCode: line.productionBatch.batchCode,
                        oldDate: line.productionBatch.batchDate,
                        newDate: row.samplingDate!,
                    });
                } else {
                    alreadyLinked++;
                }
                continue;
            }

            assignments.push({
                orderNumber: row.orderNumber,
                lineId: line.id,
                skuCode: row.skuCode,
                skuId: line.skuId,
                samplingDate: row.samplingDate!,
                qty: line.qty,
            });
        }
    }

    return { assignments, dateUpdates, alreadyLinked, skipped };
}

/**
 * Execute production batch creation and assignment.
 *
 * Pre-fetches the latest batch code per date, then uses an in-memory
 * counter to generate unique codes without collisions.
 */
export async function executeProductionBatchSync(
    prisma: PrismaClient,
    report: ProductionBatchSyncReport
): Promise<{ created: number; dateUpdated: number; errors: string[] }> {
    let created = 0;
    const errors: string[] = [];

    // Collect all unique dates and find the latest existing batch code per date
    const dateStrs = new Set<string>();
    for (const a of report.assignments) {
        dateStrs.add(a.samplingDate.toISOString().split('T')[0]);
    }

    // Build per-date serial counters starting from the next available code
    const dateSerials = new Map<string, number>();
    for (const dateStr of dateStrs) {
        const dateKey = dateStr.replace(/-/g, '');
        const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
        const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

        const latestBatch = await prisma.productionBatch.findFirst({
            where: {
                batchDate: { gte: startOfDay, lte: endOfDay },
                batchCode: { startsWith: dateKey },
            },
            orderBy: { batchCode: 'desc' },
            select: { batchCode: true },
        });

        let nextSerial = 1;
        if (latestBatch?.batchCode) {
            const match = latestBatch.batchCode.match(/-(\d+)$/);
            if (match) {
                nextSerial = parseInt(match[1], 10) + 1;
            }
        }
        dateSerials.set(dateStr, nextSerial);
    }

    for (const assignment of report.assignments) {
        try {
            const dateStr = assignment.samplingDate.toISOString().split('T')[0];
            const dateKey = dateStr.replace(/-/g, '');
            const serial = dateSerials.get(dateStr) ?? 1;
            const batchCode = `${dateKey}-${String(serial).padStart(3, '0')}`;
            dateSerials.set(dateStr, serial + 1);

            await prisma.$transaction(async (tx) => {
                const batch = await tx.productionBatch.create({
                    data: {
                        batchCode,
                        batchDate: assignment.samplingDate,
                        skuId: assignment.skuId,
                        qtyPlanned: assignment.qty,
                        priority: 'normal',
                        sourceOrderLineId: assignment.lineId,
                        status: 'planned',
                        notes: `Sheet sync: ${assignment.orderNumber}/${assignment.skuCode}`,
                    },
                });

                await tx.orderLine.update({
                    where: { id: assignment.lineId },
                    data: { productionBatchId: batch.id },
                });
            });

            created++;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${assignment.orderNumber}/${assignment.skuCode}: ${msg}`);
        }
    }

    // Update batch dates where CSV samplingDate differs from DB batchDate
    let dateUpdated = 0;
    for (const update of report.dateUpdates) {
        try {
            await prisma.productionBatch.update({
                where: { id: update.batchId },
                data: { batchDate: update.newDate },
            });
            dateUpdated++;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`Date update ${update.orderNumber}/${update.skuCode}: ${msg}`);
        }
    }

    return { created, dateUpdated, errors };
}
