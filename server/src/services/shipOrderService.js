/**
 * Unified Shipping Service
 *
 * Consolidates all shipping operations into a single service that all shipping paths use.
 * This replaces the 7 different shipping implementations across the codebase.
 *
 * INVENTORY OPERATIONS:
 * - Releases RESERVED transactions (deletes allocation holds)
 * - Creates OUTWARD/SALE transactions (deducts from inventory balance)
 *
 * IDEMPOTENCY:
 * - Already-shipped lines are skipped (safe to retry)
 * - Returns detailed results for each line processed
 *
 * USAGE:
 * ```js
 * import { shipOrderLines } from '../services/shipOrderService.js';
 *
 * await prisma.$transaction(async (tx) => {
 *   const result = await shipOrderLines(tx, {
 *     orderLineIds: ['line1', 'line2'],
 *     awbNumber: 'AWB123',
 *     courier: 'Delhivery',
 *     userId: req.user.id,
 *   });
 *   // result: { shipped: [...], skipped: [...], errors: [...], orderUpdated: boolean }
 * });
 * ```
 *
 * @module services/shipOrderService
 */

import {
    TXN_TYPE,
    TXN_REASON,
    releaseReservedInventory,
    createSaleTransaction,
} from '../utils/queryPatterns.js';

/**
 * Result object for a single line shipment attempt
 * @typedef {Object} LineResult
 * @property {string} lineId - Order line ID
 * @property {string} skuCode - SKU code for reference
 * @property {number} qty - Quantity shipped
 */

/**
 * Result object for the shipOrderLines operation
 * @typedef {Object} ShipResult
 * @property {LineResult[]} shipped - Lines successfully shipped
 * @property {LineResult[]} skipped - Lines skipped (already shipped)
 * @property {Object[]} errors - Lines that failed with error details
 * @property {boolean} orderUpdated - Whether the order status was updated to 'shipped'
 * @property {string|null} orderId - The order ID if all lines belong to same order
 */

/**
 * Ship order lines with unified inventory and status management
 *
 * This function handles all aspects of shipping:
 * 1. Validates line statuses (unless skipStatusValidation)
 * 2. Releases reserved inventory (unless skipInventory)
 * 3. Creates sale/outward transactions (unless skipInventory)
 * 4. Updates line status, AWB, courier, shippedAt, trackingStatus
 * 5. Updates order status to 'shipped' when all non-cancelled lines are shipped
 *
 * IMPORTANT: Must be called within a Prisma transaction for atomicity.
 *
 * @param {import('@prisma/client').PrismaClient} tx - Prisma transaction client
 * @param {Object} options - Shipping options
 * @param {string[]} options.orderLineIds - Array of order line IDs to ship
 * @param {string} options.awbNumber - AWB/tracking number
 * @param {string} options.courier - Courier/carrier name
 * @param {string} options.userId - User ID performing the action
 * @param {boolean} [options.skipStatusValidation=false] - Skip packed status check (for migration)
 * @param {boolean} [options.skipInventory=false] - Skip inventory transactions (for migration)
 * @returns {Promise<ShipResult>} Result object with shipped, skipped, errors arrays
 *
 * @example
 * // Standard shipping (validates packed status, creates inventory transactions)
 * const result = await shipOrderLines(tx, {
 *   orderLineIds: ['line1', 'line2'],
 *   awbNumber: 'DL12345',
 *   courier: 'Delhivery',
 *   userId: 'user123',
 * });
 *
 * @example
 * // Migration mode (skip validations and inventory)
 * const result = await shipOrderLines(tx, {
 *   orderLineIds: ['line1'],
 *   awbNumber: 'LEGACY123',
 *   courier: 'Manual',
 *   userId: 'migration-user',
 *   skipStatusValidation: true,
 *   skipInventory: true,
 * });
 */
export async function shipOrderLines(tx, options) {
    const {
        orderLineIds,
        awbNumber,
        courier,
        userId,
        skipStatusValidation = false,
        skipInventory = false,
    } = options;

    // Validate required parameters
    if (!orderLineIds || orderLineIds.length === 0) {
        throw new Error('orderLineIds array is required and must not be empty');
    }
    if (!awbNumber?.trim()) {
        throw new Error('awbNumber is required');
    }
    if (!courier?.trim()) {
        throw new Error('courier is required');
    }
    if (!userId) {
        throw new Error('userId is required');
    }

    // Deduplicate line IDs
    const uniqueLineIds = [...new Set(orderLineIds)];

    // Fetch all lines with their order and SKU info
    const lines = await tx.orderLine.findMany({
        where: { id: { in: uniqueLineIds } },
        include: {
            order: { select: { id: true, orderNumber: true, status: true } },
            sku: { select: { id: true, skuCode: true } },
        },
    });

    // Track results
    const shipped = [];
    const skipped = [];
    const errors = [];

    // Validate all lines were found
    const foundIds = new Set(lines.map(l => l.id));
    for (const lineId of uniqueLineIds) {
        if (!foundIds.has(lineId)) {
            errors.push({
                lineId,
                error: 'Line not found',
                code: 'NOT_FOUND',
            });
        }
    }

    // Get unique order ID (for order status update check)
    const orderIds = [...new Set(lines.map(l => l.orderId))];
    const orderId = orderIds.length === 1 ? orderIds[0] : null;

    // Process each line
    const linesToShip = [];
    const now = new Date();

    for (const line of lines) {
        // Skip already shipped lines (idempotent)
        if (line.lineStatus === 'shipped') {
            skipped.push({
                lineId: line.id,
                skuCode: line.sku?.skuCode,
                qty: line.qty,
                reason: 'Already shipped',
            });
            continue;
        }

        // Skip cancelled lines
        if (line.lineStatus === 'cancelled') {
            skipped.push({
                lineId: line.id,
                skuCode: line.sku?.skuCode,
                qty: line.qty,
                reason: 'Line is cancelled',
            });
            continue;
        }

        // Validate line status unless skipping validation
        if (!skipStatusValidation) {
            // Accept both 'packed' and 'marked_shipped' as valid pre-ship statuses
            if (!['packed', 'marked_shipped'].includes(line.lineStatus)) {
                errors.push({
                    lineId: line.id,
                    skuCode: line.sku?.skuCode,
                    error: `Line must be packed before shipping (current: ${line.lineStatus})`,
                    code: 'INVALID_STATUS',
                    currentStatus: line.lineStatus,
                });
                continue;
            }
        }

        // Line is valid for shipping
        linesToShip.push(line);
    }

    // Process inventory and update lines
    for (const line of linesToShip) {
        try {
            // Release reserved inventory and create sale transaction
            if (!skipInventory) {
                await releaseReservedInventory(tx, line.id);
                await createSaleTransaction(tx, {
                    skuId: line.skuId,
                    qty: line.qty,
                    orderLineId: line.id,
                    userId,
                });
            }

            // Update line status and tracking info
            await tx.orderLine.update({
                where: { id: line.id },
                data: {
                    lineStatus: 'shipped',
                    shippedAt: now,
                    awbNumber: awbNumber.trim(),
                    courier: courier.trim(),
                    trackingStatus: 'in_transit',
                },
            });

            shipped.push({
                lineId: line.id,
                skuCode: line.sku?.skuCode,
                qty: line.qty,
            });
        } catch (error) {
            errors.push({
                lineId: line.id,
                skuCode: line.sku?.skuCode,
                error: error.message,
                code: 'PROCESSING_ERROR',
            });
        }
    }

    // Check if order should be updated to 'shipped'
    let orderUpdated = false;

    if (orderId && shipped.length > 0) {
        // Check if all non-cancelled lines are now shipped
        const remainingLines = await tx.orderLine.findMany({
            where: {
                orderId,
                lineStatus: { notIn: ['cancelled', 'shipped'] },
            },
            select: { id: true },
        });

        if (remainingLines.length === 0) {
            await tx.order.update({
                where: { id: orderId },
                data: { status: 'shipped' },
            });
            orderUpdated = true;
        }
    }

    // Log summary
    const orderNumber = lines[0]?.order?.orderNumber || 'unknown';
    console.log(
        `[ShipOrderService] Order ${orderNumber}: shipped=${shipped.length}, skipped=${skipped.length}, errors=${errors.length}, orderUpdated=${orderUpdated}`
    );

    return {
        shipped,
        skipped,
        errors,
        orderUpdated,
        orderId,
    };
}

/**
 * Ship all eligible lines for an order
 *
 * Convenience wrapper that ships all non-cancelled, packed lines for an order.
 *
 * @param {import('@prisma/client').PrismaClient} tx - Prisma transaction client
 * @param {Object} options - Shipping options
 * @param {string} options.orderId - Order ID to ship
 * @param {string} options.awbNumber - AWB/tracking number
 * @param {string} options.courier - Courier/carrier name
 * @param {string} options.userId - User ID performing the action
 * @param {boolean} [options.skipStatusValidation=false] - Skip packed status check
 * @param {boolean} [options.skipInventory=false] - Skip inventory transactions
 * @returns {Promise<ShipResult>} Result object
 */
export async function shipOrder(tx, options) {
    const { orderId, ...restOptions } = options;

    if (!orderId) {
        throw new Error('orderId is required');
    }

    // Get all non-cancelled, non-shipped lines for the order
    const lines = await tx.orderLine.findMany({
        where: {
            orderId,
            lineStatus: { notIn: ['cancelled', 'shipped'] },
        },
        select: { id: true },
    });

    if (lines.length === 0) {
        return {
            shipped: [],
            skipped: [],
            errors: [],
            orderUpdated: false,
            orderId,
            message: 'No eligible lines to ship',
        };
    }

    const orderLineIds = lines.map(l => l.id);

    return shipOrderLines(tx, {
        orderLineIds,
        ...restOptions,
    });
}

/**
 * Validate that lines can be shipped (pre-check before transaction)
 *
 * Use this for early validation before starting a transaction.
 * Returns validation errors without modifying any data.
 *
 * @param {import('@prisma/client').PrismaClient} prisma - Prisma client
 * @param {string[]} orderLineIds - Line IDs to validate
 * @param {Object} options - Validation options
 * @param {boolean} [options.skipStatusValidation=false] - Skip packed status check
 * @param {string} [options.awbNumber] - AWB to check for duplicates
 * @returns {Promise<Object>} Validation result with valid flag and issues array
 */
export async function validateShipment(prisma, orderLineIds, options = {}) {
    const { skipStatusValidation = false, awbNumber } = options;

    const issues = [];

    // Deduplicate
    const uniqueLineIds = [...new Set(orderLineIds)];

    // Fetch lines
    const lines = await prisma.orderLine.findMany({
        where: { id: { in: uniqueLineIds } },
        include: {
            order: { select: { id: true, orderNumber: true, status: true } },
            sku: { select: { skuCode: true } },
        },
    });

    // Check for missing lines
    const foundIds = new Set(lines.map(l => l.id));
    for (const lineId of uniqueLineIds) {
        if (!foundIds.has(lineId)) {
            issues.push({
                lineId,
                issue: 'Line not found',
                code: 'NOT_FOUND',
            });
        }
    }

    // Validate line statuses
    for (const line of lines) {
        if (line.lineStatus === 'shipped') {
            // Not an error, just informational
            continue;
        }

        if (line.lineStatus === 'cancelled') {
            issues.push({
                lineId: line.id,
                orderNumber: line.order?.orderNumber,
                issue: 'Cannot ship cancelled line',
                code: 'LINE_CANCELLED',
            });
            continue;
        }

        if (!skipStatusValidation && !['packed', 'marked_shipped'].includes(line.lineStatus)) {
            issues.push({
                lineId: line.id,
                orderNumber: line.order?.orderNumber,
                skuCode: line.sku?.skuCode,
                issue: `Line must be packed (current: ${line.lineStatus})`,
                code: 'INVALID_STATUS',
                currentStatus: line.lineStatus,
            });
        }
    }

    // Check for duplicate AWB on other orders
    if (awbNumber) {
        const orderIds = [...new Set(lines.map(l => l.orderId))];
        const existingAwb = await prisma.orderLine.findFirst({
            where: {
                awbNumber: awbNumber.trim(),
                orderId: { notIn: orderIds },
            },
            select: {
                id: true,
                order: { select: { orderNumber: true } },
            },
        });

        if (existingAwb) {
            issues.push({
                issue: `AWB number already used on order ${existingAwb.order?.orderNumber}`,
                code: 'DUPLICATE_AWB',
                existingOrderNumber: existingAwb.order?.orderNumber,
            });
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        lineCount: lines.length,
        shippableCount: lines.filter(l =>
            l.lineStatus !== 'shipped' &&
            l.lineStatus !== 'cancelled' &&
            (skipStatusValidation || ['packed', 'marked_shipped'].includes(l.lineStatus))
        ).length,
    };
}
