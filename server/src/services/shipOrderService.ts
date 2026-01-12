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
 * ```ts
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
    releaseReservedInventory,
    createSaleTransaction,
} from '../utils/queryPatterns.js';
import type { PrismaTransactionClient } from '../utils/queryPatterns.js';
import type { PrismaClient } from '@prisma/client';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Result object for a single line shipment attempt
 */
export interface LineResult {
    lineId: string;
    skuCode?: string;
    qty: number;
    reason?: string;
}

/**
 * Result object for the shipOrderLines operation
 */
export interface ShipResult {
    shipped: LineResult[];
    skipped: LineResult[];
    errors: Array<{
        lineId?: string;
        skuCode?: string;
        error: string;
        code: string;
        currentStatus?: string;
    }>;
    orderUpdated: boolean;
    orderId: string | null;
    message?: string;
}

/**
 * Options for shipping order lines
 */
export interface ShipOptions {
    orderLineIds: string[];
    awbNumber: string;
    courier: string;
    userId: string;
    skipStatusValidation?: boolean;
    skipInventory?: boolean;
}

/**
 * Options for shipping an entire order
 */
export interface ShipOrderOptions {
    orderId: string;
    awbNumber: string;
    courier: string;
    userId: string;
    skipStatusValidation?: boolean;
    skipInventory?: boolean;
}

/**
 * Validation issue for a line
 */
export interface ValidationIssue {
    lineId?: string;
    orderNumber?: string;
    skuCode?: string;
    issue: string;
    code: string;
    currentStatus?: string;
    existingOrderNumber?: string;
}

/**
 * Result of shipment validation
 */
export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    lineCount: number;
    shippableCount: number;
}

/**
 * Options for shipment validation
 */
export interface ValidationOptions {
    skipStatusValidation?: boolean;
    awbNumber?: string;
}

// ============================================
// SHIPPING FUNCTIONS
// ============================================

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
 * @param tx - Prisma transaction client
 * @param options - Shipping options
 * @returns Result object with shipped, skipped, errors arrays
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
export async function shipOrderLines(
    tx: PrismaTransactionClient,
    options: ShipOptions
): Promise<ShipResult> {
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
    const shipped: LineResult[] = [];
    const skipped: LineResult[] = [];
    const errors: ShipResult['errors'] = [];

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
    const linesToShip: typeof lines = [];
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
            // Only deduct inventory if the line was properly allocated
            if (!skipInventory && line.allocatedAt) {
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
                error: error instanceof Error ? error.message : String(error),
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
 * @param tx - Prisma transaction client
 * @param options - Shipping options
 * @returns Result object
 */
export async function shipOrder(
    tx: PrismaTransactionClient,
    options: ShipOrderOptions
): Promise<ShipResult> {
    const { orderId, awbNumber, courier, userId, skipStatusValidation, skipInventory } = options;

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
        awbNumber,
        courier,
        userId,
        skipStatusValidation,
        skipInventory,
    });
}

/**
 * Validate that lines can be shipped (pre-check before transaction)
 *
 * Use this for early validation before starting a transaction.
 * Returns validation errors without modifying any data.
 *
 * @param prisma - Prisma client
 * @param orderLineIds - Line IDs to validate
 * @param options - Validation options
 * @returns Validation result with valid flag and issues array
 */
export async function validateShipment(
    prisma: PrismaClient,
    orderLineIds: string[],
    options: ValidationOptions = {}
): Promise<ValidationResult> {
    const { skipStatusValidation = false, awbNumber } = options;

    const issues: ValidationIssue[] = [];

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
