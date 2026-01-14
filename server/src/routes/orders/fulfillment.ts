/**
 * Fulfillment Router
 * Order line status updates and shipping operations
 *
 * ORDER LINE STATUS FLOW:
 * pending -> allocated -> packed -> [mark-shipped*] -> shipped
 *   | (allocate)          |
 * [creates reserve]     [unpack, clear AWB]
 *   | (unallocate)
 * [releases reserve]
 *
 * * mark-shipped: Visual-only status (part of spreadsheet shipping workflow)
 *   Converted to shipped via process-marked-shipped batch endpoint
 *
 * INVENTORY MECHANICS:
 * - Allocate: Creates RESERVED transaction (holds stock, not deducted from balance)
 * - Unallocate: Deletes RESERVED transaction
 * - Ship: Releases RESERVED, creates OUTWARD (deducts from balance)
 * - Unship: Reverses OUTWARD, recreates RESERVED
 *
 * RACE CONDITION PREVENTION:
 * - Pre-checks before transaction (status, stock, AWB)
 * - Re-checks inside transaction before updates
 * - ConflictError if concurrent requests detected
 *
 * @module routes/orders/fulfillment
 */

import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/permissions.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessLogicError,
    ForbiddenError,
} from '../../utils/errors.js';
import {
    calculateInventoryBalance,
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createReservedTransaction,
    deleteSaleTransactions,
} from '../../utils/queryPatterns.js';
import { validate } from '../../utils/validation.js';
import { ShipOrderSchema } from '@coh/shared';
import { shipOrderLines, shipOrder } from '../../services/shipOrderService.js';

const router: Router = Router();

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrderLine {
    id: string;
    skuId: string;
    qty: number;
    lineStatus: string;
    awbNumber: string | null;
    courier: string | null;
    allocatedAt: Date | null;
}

interface OrderWithLines {
    id: string;
    orderNumber: string;
    status: string;
    customerId: string | null;
    rtoInitiatedAt: Date | null;
    rtoReceivedAt: Date | null;
    orderLines: OrderLine[];
}

interface OrderWithShopifyCache {
    id: string;
    orderNumber: string;
    orderLines: Array<{
        id: string;
        lineStatus: string;
        awbNumber: string | null;
        courier: string | null;
    }>;
    shopifyCache: {
        trackingNumber: string | null;
    } | null;
}

interface EligibleOrder {
    id: string;
    orderNumber: string;
    orderLines: Array<{ id: string }>;
    shopifyCache: {
        trackingNumber: string;
        trackingCompany: string;
    };
}

// ============================================
// ORDER LINE STATUS UPDATES
// ============================================

/**
 * POST /lines/:lineId/allocate
 * Reserve inventory for an order line (pending -> allocated)
 *
 * WHAT HAPPENS:
 * - Creates RESERVED transaction (holds stock, available = balance - reserved)
 * - Updates lineStatus to 'allocated'
 * - Sets allocatedAt timestamp
 *
 * VALIDATION:
 * - Line must be in 'pending' status
 * - Available stock must >= qty requested
 * - Re-checks inside transaction to prevent race conditions
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/allocate
 * // Returns: { id, lineStatus: 'allocated', allocatedAt: '2025-01-11T...' }
 */
router.post('/lines/:lineId/allocate', authenticateToken, requirePermission('orders:allocate'), asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    // Quick pre-check outside transaction (fail fast for invalid requests)
    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
        select: { id: true, skuId: true, qty: true, lineStatus: true },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'pending') {
        throw new BusinessLogicError(
            `Line must be in pending status to allocate (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    // All operations inside single transaction for consistency and fewer round trips
    const updated = await req.prisma.$transaction(async (tx) => {
        // Re-check status inside transaction to prevent race conditions
        const currentLine = await tx.orderLine.findUnique({
            where: { id: lineId },
            select: { lineStatus: true, skuId: true, qty: true },
        });

        if (!currentLine) {
            throw new NotFoundError('Order line not found', 'OrderLine', lineId);
        }

        if (currentLine.lineStatus !== 'pending') {
            throw new ConflictError('Line was already allocated by another request', 'RACE_CONDITION');
        }

        // Balance check inside transaction (atomic with reserve creation)
        const balance = await calculateInventoryBalance(tx, currentLine.skuId);
        if (balance.availableBalance < currentLine.qty) {
            throw new BusinessLogicError(
                `Insufficient stock: ${balance.availableBalance} available, ${currentLine.qty} requested`,
                'INSUFFICIENT_STOCK'
            );
        }

        await createReservedTransaction(tx, {
            skuId: currentLine.skuId,
            qty: currentLine.qty,
            orderLineId: lineId,
            userId: req.user!.id,
        });

        // Return updated line directly (no refetch needed)
        return await tx.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'allocated', allocatedAt: new Date() },
        });
    });

    res.json(updated);
}));

/**
 * POST /lines/bulk-allocate
 * Reserve inventory for multiple order lines in a single operation
 *
 * PERFORMANCE OPTIMIZED:
 * - Single query to fetch all lines
 * - Batched balance calculations per SKU
 * - createMany for transactions (single INSERT)
 * - updateMany for line status (single UPDATE)
 *
 * VALIDATION:
 * - All lines must be in 'pending' status
 * - Sufficient stock must be available for each SKU
 *
 * @param {string[]} req.body.lineIds - Array of order line IDs to allocate
 * @returns {Object} { allocated: number, failed: Array<{lineId, reason}> }
 *
 * @example
 * POST /fulfillment/lines/bulk-allocate
 * Body: { lineIds: ["abc123", "def456", "ghi789"] }
 */
router.post('/lines/bulk-allocate', authenticateToken, requirePermission('orders:allocate'), asyncHandler(async (req: Request, res: Response) => {
    const { lineIds } = req.body as { lineIds?: string[] };

    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }

    // Deduplicate
    const uniqueLineIds = [...new Set(lineIds)];

    // Fetch all lines in single query
    const lines = await req.prisma.orderLine.findMany({
        where: { id: { in: uniqueLineIds } },
        select: { id: true, skuId: true, qty: true, lineStatus: true },
    });

    if (lines.length === 0) {
        throw new NotFoundError('No order lines found', 'OrderLine', uniqueLineIds.join(','));
    }

    // Group lines by SKU for efficient balance checking
    const linesBySku = new Map<string, typeof lines>();
    const failed: Array<{ lineId: string; reason: string }> = [];

    for (const line of lines) {
        if (line.lineStatus !== 'pending') {
            failed.push({ lineId: line.id, reason: `Invalid status: ${line.lineStatus}` });
            continue;
        }
        if (!linesBySku.has(line.skuId)) {
            linesBySku.set(line.skuId, []);
        }
        linesBySku.get(line.skuId)!.push(line);
    }

    // Calculate required qty per SKU
    const skuRequirements = new Map<string, { lines: typeof lines; totalQty: number }>();
    for (const [skuId, skuLines] of linesBySku) {
        const totalQty = skuLines.reduce((sum, l) => sum + l.qty, 0);
        skuRequirements.set(skuId, { lines: skuLines, totalQty });
    }

    // Allocate inside transaction with batch operations
    const result = await req.prisma.$transaction(async (tx) => {
        const allocated: string[] = [];
        const txnData: Array<{
            skuId: string;
            txnType: string;
            qty: number;
            reason: string;
            referenceId: string;
            createdById: string;
        }> = [];
        const allocatableLineIds: string[] = [];
        const timestamp = new Date();

        // Check balance for each SKU and prepare transactions
        for (const [skuId, { lines: skuLines, totalQty }] of skuRequirements) {
            const balance = await calculateInventoryBalance(tx, skuId);

            if (balance.availableBalance < totalQty) {
                // Not enough stock - fail all lines for this SKU
                for (const line of skuLines) {
                    failed.push({
                        lineId: line.id,
                        reason: `Insufficient stock: ${balance.availableBalance} available, ${totalQty} required for SKU`,
                    });
                }
                continue;
            }

            // Prepare transaction data for all lines of this SKU
            for (const line of skuLines) {
                txnData.push({
                    skuId: line.skuId,
                    txnType: TXN_TYPE.RESERVED,
                    qty: line.qty,
                    reason: TXN_REASON.ORDER_ALLOCATION,
                    referenceId: line.id,
                    createdById: req.user!.id,
                });
                allocatableLineIds.push(line.id);
                allocated.push(line.id);
            }
        }

        // Batch create all transactions
        if (txnData.length > 0) {
            await tx.inventoryTransaction.createMany({
                data: txnData,
            });

            // Batch update all line statuses
            await tx.orderLine.updateMany({
                where: { id: { in: allocatableLineIds } },
                data: { lineStatus: 'allocated', allocatedAt: timestamp },
            });
        }

        return { allocated, failed };
    });

    res.json({
        allocated: result.allocated.length,
        failed: result.failed.length > 0 ? result.failed : undefined,
        lineIds: result.allocated,
    });
}));

/**
 * POST /lines/:lineId/unallocate
 * Release reserved inventory for an order line (allocated -> pending)
 *
 * WHAT HAPPENS:
 * - Deletes RESERVED transaction (releases hold, adds back to available)
 * - Updates lineStatus to 'pending'
 * - Clears allocatedAt timestamp
 *
 * VALIDATION:
 * - Line must be in 'allocated' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/unallocate
 * // Returns: { id, lineStatus: 'pending', allocatedAt: null }
 */
router.post('/lines/:lineId/unallocate', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    // Quick pre-check outside transaction
    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
        select: { id: true, lineStatus: true },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'allocated') {
        throw new BusinessLogicError(
            `Line must be in allocated status to unallocate (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    // All operations inside single transaction, return result directly
    const updated = await req.prisma.$transaction(async (tx) => {
        await releaseReservedInventory(tx, line.id);

        return await tx.orderLine.update({
            where: { id: lineId },
            data: { lineStatus: 'pending', allocatedAt: null },
        });
    });

    res.json(updated);
}));

/**
 * POST /lines/:lineId/pick
 * Mark order line as picked (allocated -> picked)
 *
 * WHAT HAPPENS:
 * - Updates lineStatus to 'picked'
 * - Sets pickedAt timestamp
 * - No inventory changes (just status tracking)
 *
 * VALIDATION:
 * - Line must be in 'allocated' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 */
router.post('/lines/:lineId/pick', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'allocated') {
        throw new BusinessLogicError(
            `Line must be in allocated status to pick (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: { lineStatus: 'picked', pickedAt: new Date() },
    });

    res.json(updated);
}));

/**
 * POST /lines/:lineId/unpick
 * Revert order line from picked to allocated
 *
 * WHAT HAPPENS:
 * - Updates lineStatus back to 'allocated'
 * - Clears pickedAt timestamp
 * - No inventory changes
 *
 * VALIDATION:
 * - Line must be in 'picked' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 */
router.post('/lines/:lineId/unpick', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'picked') {
        throw new BusinessLogicError(
            `Line must be in picked status to unpick (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: { lineStatus: 'allocated', pickedAt: null },
    });

    res.json(updated);
}));

/**
 * POST /lines/:lineId/pack
 * Mark order line as packed (allocated/picked -> packed)
 *
 * WHAT HAPPENS:
 * - Updates lineStatus to 'packed'
 * - Sets packedAt timestamp
 * - No inventory changes (just status tracking)
 *
 * VALIDATION:
 * - Line must be in 'allocated' or 'picked' status
 *
 * @param {string} req.params.lineId - Order line ID
 * @returns {Object} Updated orderLine record
 *
 * @example
 * POST /fulfillment/lines/abc123/pack
 * // Returns: { id, lineStatus: 'packed', packedAt: '2025-01-11T...' }
 */
router.post('/lines/:lineId/pack', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'allocated' && line.lineStatus !== 'picked') {
        throw new BusinessLogicError(
            `Line must be in allocated or picked status to pack (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: { lineStatus: 'packed', packedAt: new Date() },
    });

    res.json(updated);
}));

// Unpack order line (revert to picked if pickedAt exists, otherwise allocated)
router.post('/lines/:lineId/unpack', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'packed') {
        throw new BusinessLogicError(
            `Line must be in packed status to unpack (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    // Revert to 'picked' if the line was picked before packing, otherwise revert to 'allocated'
    const revertStatus = line.pickedAt ? 'picked' : 'allocated';

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: {
            lineStatus: revertStatus,
            packedAt: null,
            // Clear manual AWB and courier when unpacking
            awbNumber: null,
            courier: null,
        },
    });

    res.json(updated);
}));

// ============================================
// MARK SHIPPED (Visual Only - No Side Effects)
// Part of spreadsheet-style shipping workflow
// ============================================

// Mark order line as shipped (visual only - no inventory release)
router.post('/lines/:lineId/mark-shipped', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;
    const { awbNumber, courier } = (req.body || {}) as { awbNumber?: string; courier?: string };

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'packed') {
        throw new BusinessLogicError(
            `Line must be in packed status to mark as shipped (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: {
            lineStatus: 'marked_shipped',
            ...(awbNumber && { awbNumber: awbNumber.trim() }),
            ...(courier && { courier: courier.trim() }),
        },
    });

    res.json(updated);
}));

// Unmark shipped line (revert to packed)
router.post('/lines/:lineId/unmark-shipped', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (line.lineStatus !== 'marked_shipped') {
        throw new BusinessLogicError(
            `Line must be in marked_shipped status to unmark (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: { lineStatus: 'packed' },
    });

    res.json(updated);
}));

// Update line tracking info (AWB/courier)
router.patch('/lines/:lineId/tracking', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const lineId = req.params.lineId as string;
    const { awbNumber, courier } = req.body as { awbNumber?: string; courier?: string };

    const line = await req.prisma.orderLine.findUnique({
        where: { id: lineId },
    });

    if (!line) {
        throw new NotFoundError('Order line not found', 'OrderLine', lineId);
    }

    if (!['packed', 'marked_shipped'].includes(line.lineStatus)) {
        throw new BusinessLogicError(
            `Can only update tracking on packed or marked_shipped lines (current: ${line.lineStatus})`,
            'INVALID_STATUS'
        );
    }

    const updateData: { awbNumber?: string | null; courier?: string | null } = {};
    if (awbNumber !== undefined) {
        updateData.awbNumber = awbNumber?.trim() || null;
    }
    if (courier !== undefined) {
        updateData.courier = courier?.trim() || null;
    }

    if (Object.keys(updateData).length === 0) {
        throw new ValidationError('No tracking data provided');
    }

    const updated = await req.prisma.orderLine.update({
        where: { id: lineId },
        data: updateData,
    });

    res.json(updated);
}));

// Bulk update line statuses
router.post('/lines/bulk-update', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const { lineIds, status } = req.body as { lineIds?: string[]; status?: string };

    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }

    if (!status) {
        throw new ValidationError('status is required');
    }

    // Block direct shipping via bulk update - must use ship endpoints
    if (status === 'shipped') {
        throw new BusinessLogicError(
            'Cannot set status to shipped directly. Use ship endpoint.',
            'INVALID_STATUS_CHANGE'
        );
    }

    // Deduplicate lineIds to prevent double-counting
    const uniqueLineIds = [...new Set(lineIds)];

    const timestamp = new Date();

    const updateData: {
        lineStatus: string;
        allocatedAt?: Date;
        pickedAt?: Date;
        packedAt?: Date;
        shippedAt?: Date;
    } = { lineStatus: status };
    if (status === 'allocated') updateData.allocatedAt = timestamp;
    if (status === 'picked') updateData.pickedAt = timestamp;
    if (status === 'packed') updateData.packedAt = timestamp;
    if (status === 'shipped') updateData.shippedAt = timestamp;

    const result = await req.prisma.orderLine.updateMany({
        where: { id: { in: uniqueLineIds } },
        data: updateData,
    });

    res.json({ updated: result.count, requested: lineIds.length, deduplicated: uniqueLineIds.length });
}));

// ============================================
// SHIP ORDER
// ============================================

/**
 * POST /:id/ship
 * Ship entire order (all lines packed -> shipped)
 *
 * Uses ShipOrderService which handles:
 * - Release RESERVED transactions for all lines
 * - Create OUTWARD (SALE) transactions for all lines
 * - Update order status to 'shipped'
 * - Update all lines to 'shipped' with tracking info
 *
 * VALIDATIONS:
 * - AWB and courier are required
 * - Service validates packed status and handles race conditions
 *
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.awbNumber - AWB/tracking number (required)
 * @param {string} req.body.courier - Courier name (required)
 * @returns {Object} Updated order with orderLines
 *
 * @example
 * POST /fulfillment/123/ship
 * Body: { awbNumber: "DL12345", courier: "Delhivery" }
 */
router.post('/:id/ship', authenticateToken, requirePermission('orders:ship'), validate(ShipOrderSchema) as RequestHandler, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;
    const { awbNumber, courier } = req.validatedBody as { awbNumber: string; courier: string };

    // Validate required fields
    if (!awbNumber?.trim()) {
        throw new ValidationError('awbNumber is required');
    }
    if (!courier?.trim()) {
        throw new ValidationError('courier is required');
    }

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Idempotency check - if already shipped, return success
    if (order.status === 'shipped') {
        return res.json({
            ...order,
            message: 'Order is already shipped',
        });
    }

    // Ship using the service
    const result = await req.prisma.$transaction(async (tx) => {
        return await shipOrder(tx, {
            orderId,
            awbNumber: awbNumber.trim(),
            courier: courier.trim(),
            userId: req.user!.id,
        });
    });

    // Check for errors in the result
    if (result.errors && result.errors.length > 0) {
        const errorCodes = result.errors.map(e => e.code);

        // Throw appropriate error based on the error codes
        if (errorCodes.includes('INVALID_STATUS')) {
            throw new BusinessLogicError(
                result.errors[0].error,
                'INVALID_STATUS'
            );
        } else if (errorCodes.includes('DUPLICATE_AWB')) {
            throw new ConflictError(
                result.errors[0].error,
                'DUPLICATE_AWB'
            );
        } else {
            throw new BusinessLogicError(
                result.errors[0].error,
                result.errors[0].code
            );
        }
    }

    // Fetch updated order
    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

// ============================================
// SHIP SPECIFIC LINES (Partial Shipment Support)
// ============================================

/**
 * Ship specific order lines with a given AWB
 * Enables partial shipments - different lines can ship at different times with different AWBs
 *
 * Uses ShipOrderService which handles inventory transactions and status updates.
 *
 * POST /orders/:id/ship-lines
 * Body: { lineIds: string[], awbNumber: string, courier: string }
 */
router.post('/:id/ship-lines', authenticateToken, requirePermission('orders:ship'), asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;
    const { lineIds, awbNumber, courier } = req.body as { lineIds?: string[]; awbNumber?: string; courier?: string };

    // Validate required fields
    if (!lineIds?.length) {
        throw new ValidationError('lineIds array is required');
    }
    if (!awbNumber?.trim()) {
        throw new ValidationError('awbNumber is required');
    }
    if (!courier?.trim()) {
        throw new ValidationError('courier is required');
    }

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    // Validate all requested lines exist and belong to this order
    const linesToShip = order.orderLines.filter(l => lineIds.includes(l.id));
    if (linesToShip.length !== lineIds.length) {
        throw new ValidationError(
            `Some lineIds not found in this order (found ${linesToShip.length} of ${lineIds.length})`
        );
    }

    // Ship using the service
    const result = await req.prisma.$transaction(async (tx) => {
        return await shipOrderLines(tx, {
            orderLineIds: lineIds,
            awbNumber: awbNumber.trim(),
            courier: courier.trim(),
            userId: req.user!.id,
        });
    });

    // Check for errors in the result
    if (result.errors && result.errors.length > 0) {
        const errorCodes = result.errors.map(e => e.code);

        // Throw appropriate error based on the error codes
        if (errorCodes.includes('LINE_CANCELLED')) {
            throw new BusinessLogicError(
                result.errors[0].error,
                'LINES_CANCELLED'
            );
        } else if (errorCodes.includes('INVALID_STATUS')) {
            throw new BusinessLogicError(
                result.errors[0].error,
                'LINES_NOT_PACKED'
            );
        } else if (errorCodes.includes('DUPLICATE_AWB')) {
            throw new ConflictError(
                result.errors[0].error,
                'DUPLICATE_AWB'
            );
        } else {
            throw new BusinessLogicError(
                result.errors[0].error,
                result.errors[0].code
            );
        }
    }

    // Fetch updated order
    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    res.json({
        ...updated,
        linesShipped: result.shipped.length,
        allShipped: updated?.status === 'shipped',
    });
}));

// ============================================
// PROCESS MARKED SHIPPED (Batch Clear)
// Final step of spreadsheet-style shipping workflow
// Releases inventory and creates sale transactions
// ============================================

router.post('/process-marked-shipped', authenticateToken, requirePermission('orders:ship'), asyncHandler(async (req: Request, res: Response) => {
    // Find all orders with marked_shipped lines
    const ordersWithMarkedLines = await req.prisma.order.findMany({
        where: {
            status: 'open',
            isArchived: false,
            orderLines: {
                some: { lineStatus: 'marked_shipped' },
            },
        },
        include: {
            orderLines: true,
            shopifyCache: {
                select: { trackingNumber: true },
            },
        },
    }) as unknown as OrderWithShopifyCache[];

    if (ordersWithMarkedLines.length === 0) {
        return res.json({
            processed: 0,
            orders: [],
            message: 'No marked shipped lines to process',
        });
    }

    // Collect all marked_shipped lines and validate
    interface LineToProcess {
        line: OrderWithShopifyCache['orderLines'][0];
        orderId: string;
        orderNumber: string;
        expectedAwb: string | null;
    }

    interface ValidationIssue {
        lineId: string;
        orderNumber: string;
        issue: string;
        expected?: string;
        actual?: string;
    }

    const linesToProcess: LineToProcess[] = [];
    const validationIssues: ValidationIssue[] = [];

    for (const order of ordersWithMarkedLines) {
        const expectedAwb = order.shopifyCache?.trackingNumber || null;

        for (const line of order.orderLines) {
            if (line.lineStatus !== 'marked_shipped') continue;

            linesToProcess.push({
                line,
                orderId: order.id,
                orderNumber: order.orderNumber,
                expectedAwb,
            });

            if (!line.awbNumber) {
                validationIssues.push({
                    lineId: line.id,
                    orderNumber: order.orderNumber,
                    issue: 'missing_awb',
                });
            } else if (expectedAwb && line.awbNumber.toLowerCase() !== expectedAwb.toLowerCase()) {
                validationIssues.push({
                    lineId: line.id,
                    orderNumber: order.orderNumber,
                    issue: 'awb_mismatch',
                    expected: expectedAwb,
                    actual: line.awbNumber,
                });
            }

            if (!line.courier) {
                validationIssues.push({
                    lineId: line.id,
                    orderNumber: order.orderNumber,
                    issue: 'missing_courier',
                });
            }
        }
    }

    // Group lines by order for batch processing
    const linesByOrder = new Map<string, OrderWithShopifyCache['orderLines']>();
    for (const item of linesToProcess) {
        if (!linesByOrder.has(item.orderId)) {
            linesByOrder.set(item.orderId, []);
        }
        linesByOrder.get(item.orderId)!.push(item.line);
    }

    // Process each order's lines using the service
    await req.prisma.$transaction(async (tx) => {
        for (const [, lines] of linesByOrder.entries()) {
            // Get AWB and courier from the first line (all lines in same order should have same AWB)
            const firstLine = lines[0];
            const awbNumber = firstLine.awbNumber || 'MISSING_AWB';
            const courier = firstLine.courier || 'MISSING_COURIER';

            const lineIds = lines.map(l => l.id);

            // Use shipOrderLines service to ship these lines
            await shipOrderLines(tx, {
                orderLineIds: lineIds,
                awbNumber,
                courier,
                userId: req.user!.id,
                skipStatusValidation: true, // Accept marked_shipped status
            });
        }
    });

    const orderSummary = ordersWithMarkedLines.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        linesProcessed: o.orderLines.filter(l => l.lineStatus === 'marked_shipped').length,
    }));

    console.log(`[Process Marked Shipped] Processed ${linesToProcess.length} lines across ${ordersWithMarkedLines.length} orders`);

    res.json({
        processed: linesToProcess.length,
        orders: orderSummary,
        validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
        message: `Processed ${linesToProcess.length} lines across ${ordersWithMarkedLines.length} orders`,
    });
}));

// ============================================
// MIGRATE SHOPIFY FULFILLED (Onboarding)
// One-click migration for orders fulfilled on Shopify
// Marks as shipped without inventory transactions
// ============================================

router.post('/migrate-shopify-fulfilled', authenticateToken, requirePermission('orders:ship'), asyncHandler(async (req: Request, res: Response) => {
    // Admin only for safety
    if (req.user!.role !== 'admin') {
        throw new ForbiddenError('Migration requires admin role');
    }

    // Batch limit - process in chunks to avoid timeout (default 50, max 500)
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    // Only migrate OPEN orders (not delivered, archived, etc.)
    const whereClause = {
        status: 'open',
        shopifyCache: {
            fulfillmentStatus: 'fulfilled',
            trackingNumber: { not: null },
            trackingCompany: { not: null },
        },
    };

    // Count total eligible first
    const totalEligible = await req.prisma.order.count({ where: whereClause });

    if (totalEligible === 0) {
        return res.json({
            migrated: 0,
            remaining: 0,
            message: 'No eligible open orders found - migration complete!',
        });
    }

    console.log(`[Migrate Shopify Fulfilled] Starting batch: ${limit} of ${totalEligible} eligible open orders`);

    // Fetch batch of eligible orders (oldest first for consistent ordering)
    const eligibleOrders = await req.prisma.order.findMany({
        where: whereClause,
        include: {
            orderLines: { select: { id: true } },
            shopifyCache: {
                select: { trackingNumber: true, trackingCompany: true },
            },
        },
        orderBy: { orderDate: 'asc' },
        take: limit,
    }) as unknown as EligibleOrder[];

    // Process each order in its own transaction (avoids timeout)
    interface MigrationResults {
        migrated: Array<{ orderNumber: string; linesShipped: number }>;
        skipped: Array<{ orderNumber: string; reason: string }>;
        errors: Array<{ orderNumber: string; error: string }>;
    }
    const results: MigrationResults = { migrated: [], skipped: [], errors: [] };

    for (const order of eligibleOrders) {
        try {
            const lineIds = order.orderLines.map(l => l.id);
            const awb = order.shopifyCache.trackingNumber;
            const courier = order.shopifyCache.trackingCompany;

            // Each order gets its own transaction
            const result = await req.prisma.$transaction(async (tx) => {
                return await shipOrderLines(tx, {
                    orderLineIds: lineIds,
                    awbNumber: awb,
                    courier: courier,
                    userId: req.user!.id,
                    skipStatusValidation: true,
                    skipInventory: true,
                });
            });

            if (result.shipped.length > 0) {
                results.migrated.push({
                    orderNumber: order.orderNumber,
                    linesShipped: result.shipped.length,
                });
            } else if (result.skipped.length > 0) {
                results.skipped.push({
                    orderNumber: order.orderNumber,
                    reason: result.skipped[0]?.reason || 'Already shipped',
                });
            }
        } catch (error) {
            results.errors.push({
                orderNumber: order.orderNumber,
                error: (error as Error).message,
            });
        }
    }

    const remaining = totalEligible - results.migrated.length;
    console.log(`[Migrate Shopify Fulfilled] Batch complete: migrated ${results.migrated.length}, skipped ${results.skipped.length}, errors ${results.errors.length}, remaining ~${remaining}`);

    res.json({
        migrated: results.migrated.length,
        skipped: results.skipped.length,
        remaining: remaining,
        errors: results.errors.length > 0 ? results.errors : undefined,
        message: remaining > 0
            ? `Migrated ${results.migrated.length} orders. ${remaining} remaining - click again to continue.`
            : `Migrated ${results.migrated.length} orders. Migration complete!`,
    });
}));

// Unship order (move back to open)
router.post('/:id/unship', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to unship (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    await req.prisma.$transaction(async (tx) => {
        // Re-check status inside transaction to prevent race condition
        const currentOrder = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
        });

        if (!currentOrder) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        if (currentOrder.status !== 'shipped') {
            throw new ConflictError('Order status changed by another request', 'RACE_CONDITION');
        }

        // Atomic inventory correction
        // First, delete all sale transactions for this order's lines
        for (const line of order.orderLines) {
            await deleteSaleTransactions(tx, line.id);
        }

        // Then create reserved transactions atomically
        for (const line of order.orderLines) {
            // Skip cancelled lines - they shouldn't get reserved inventory
            if (line.lineStatus === 'cancelled') continue;

            await createReservedTransaction(tx, {
                skuId: line.skuId,
                qty: line.qty,
                orderLineId: line.id,
                userId: req.user!.id,
            });
        }

        await tx.order.update({
            where: { id: orderId },
            data: {
                status: 'open',
            },
        });

        // Revert line statuses and clear tracking fields
        await tx.orderLine.updateMany({
            where: { orderId },
            data: {
                lineStatus: 'packed',
                shippedAt: null,
                awbNumber: null,
                courier: null,
                trackingStatus: null,
            },
        });
    });

    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

/**
 * POST /:id/migration-ship
 * Migration endpoint: Mark order as shipped WITHOUT inventory transactions
 *
 * USE CASE:
 * When migrating from an old system where orders were already physically shipped,
 * this endpoint updates the ERP status without affecting inventory (since items
 * were already shipped in the old system).
 *
 * RESTRICTIONS:
 * - Admin only (sensitive operation that bypasses inventory controls)
 * - Skips status validation (can ship from any status)
 * - Skips inventory transactions (no RESERVED release, no OUTWARD creation)
 *
 * WHAT IT DOES:
 * - Updates all order lines to 'shipped' status
 * - Sets AWB, courier, shippedAt, trackingStatus
 * - Updates order status to 'shipped' when all lines processed
 * - NO inventory changes
 *
 * @param {string} req.params.id - Order ID
 * @param {string} req.body.awbNumber - AWB/tracking number (required)
 * @param {string} req.body.courier - Courier name (required)
 * @returns {Object} Shipping result from shipOrderLines service
 *
 * @example
 * POST /fulfillment/123/migration-ship
 * Body: { awbNumber: "OLD123", courier: "Manual" }
 */
router.post('/:id/migration-ship',
    authenticateToken,
    requirePermission('orders:ship'),
    asyncHandler(async (req: Request, res: Response) => {
        const orderId = req.params.id as string;
        const { awbNumber, courier } = req.body as { awbNumber?: string; courier?: string };

        // Admin only for migration operations
        if (req.user!.role !== 'admin') {
            throw new ForbiddenError('Migration ship requires admin role');
        }

        // Validate required fields
        if (!awbNumber?.trim()) {
            throw new ValidationError('awbNumber is required');
        }
        if (!courier?.trim()) {
            throw new ValidationError('courier is required');
        }

        // Get order and all its lines
        const order = await req.prisma.order.findUnique({
            where: { id: orderId },
            include: { orderLines: { select: { id: true } } },
        });

        if (!order) {
            throw new NotFoundError('Order not found', 'Order', orderId);
        }

        // Use shipOrderLines service with migration flags
        const result = await req.prisma.$transaction(async (tx) => {
            const lineIds = order.orderLines.map((l: { id: string }) => l.id);
            return await shipOrderLines(tx, {
                orderLineIds: lineIds,
                awbNumber: awbNumber.trim(),
                courier: courier.trim(),
                userId: req.user!.id,
                skipStatusValidation: true,  // Allow shipping from any status
                skipInventory: true,         // Skip inventory transactions
            });
        });

        res.json(result);
    })
);

// Mark delivered (simple version)
router.post('/:id/deliver', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const updated = await req.prisma.order.update({
        where: { id: orderId },
        data: { status: 'delivered', deliveredAt: new Date() },
    });
    res.json(updated);
}));

// Mark order as delivered (with validation)
router.post('/:id/mark-delivered', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to mark as delivered (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.order.update({
        where: { id: orderId },
        data: {
            status: 'delivered',
            deliveredAt: new Date(),
        },
    });

    res.json(updated);
}));

// Initiate RTO for order
router.post('/:id/mark-rto', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, customerId: true, rtoInitiatedAt: true },
    });

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (order.status !== 'shipped') {
        throw new BusinessLogicError(
            `Order must be shipped to initiate RTO (current: ${order.status})`,
            'INVALID_STATUS'
        );
    }

    const updated = await req.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
            where: { id: orderId },
            data: {
                rtoInitiatedAt: new Date(),
            },
        });

        // Increment customer RTO count on first RTO initiation
        if (!order.rtoInitiatedAt && order.customerId) {
            await tx.customer.update({
                where: { id: order.customerId },
                data: { rtoCount: { increment: 1 } },
            });
        }

        return updatedOrder;
    });

    res.json(updated);
}));

// Receive RTO package (creates inventory inward)
router.post('/:id/receive-rto', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.params.id as string;

    const order = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    }) as OrderWithLines | null;

    if (!order) {
        throw new NotFoundError('Order not found', 'Order', orderId);
    }

    if (!order.rtoInitiatedAt) {
        throw new BusinessLogicError('RTO must be initiated first', 'RTO_NOT_INITIATED');
    }

    if (order.rtoReceivedAt) {
        throw new ConflictError('RTO already received', 'RTO_ALREADY_RECEIVED');
    }

    await req.prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: orderId },
            data: { rtoReceivedAt: new Date() },
        });

        for (const line of order.orderLines) {
            await tx.inventoryTransaction.create({
                data: {
                    skuId: line.skuId,
                    txnType: TXN_TYPE.INWARD,
                    qty: line.qty,
                    reason: TXN_REASON.RTO_RECEIVED,
                    referenceId: line.id,
                    createdById: req.user!.id,
                },
            });
        }
    });

    const updated = await req.prisma.order.findUnique({
        where: { id: orderId },
        include: { orderLines: true },
    });

    res.json(updated);
}));

export default router;
