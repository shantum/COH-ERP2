/**
 * Shipping Rules
 * Rules for order and line shipping/unshipping operations
 */

import { defineRule, simpleBooleanRule } from '../core/defineRule.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface ShipOrderData {
    awbNumber?: string;
    courier?: string;
    lines: Array<{
        id: string;
        lineStatus: string;
        orderId: string;
    }>;
}

interface ShipLineData {
    line: {
        id: string;
        lineStatus: string;
        orderId: string;
    };
    awbNumber?: string;
    courier?: string;
}

interface UnshipData {
    order?: {
        id: string;
        status: string;
    };
    line?: {
        id: string;
        lineStatus: string;
    };
}

interface DuplicateAwbData {
    awbNumber: string;
    orderIds: string[];
}

// ============================================
// SHIP RULES - INPUT VALIDATION
// ============================================

/**
 * AWB number is required for shipping
 */
export const awbRequired = simpleBooleanRule<ShipOrderData>({
    id: 'ship.awb_required',
    name: 'AWB Required',
    description: 'AWB number is required for shipping',
    category: 'shipping',
    errorCode: 'AWB_REQUIRED',
    operations: ['shipOrder', 'shipLine'],
    condition: ({ data }) => Boolean(data.awbNumber?.trim()),
});

/**
 * Courier is required for shipping
 */
export const courierRequired = simpleBooleanRule<ShipOrderData>({
    id: 'ship.courier_required',
    name: 'Courier Required',
    description: 'Courier is required for shipping',
    category: 'shipping',
    errorCode: 'COURIER_REQUIRED',
    operations: ['shipOrder', 'shipLine'],
    condition: ({ data }) => Boolean(data.courier?.trim()),
});

// ============================================
// SHIP RULES - STATUS VALIDATION
// ============================================

/**
 * Lines must be packed before shipping
 * Accepts both 'packed' and 'marked_shipped' (for backward compatibility)
 */
export const linesMustBePacked = defineRule<ShipOrderData>({
    id: 'ship.lines_must_be_packed',
    name: 'Lines Must Be Packed',
    description: 'All lines must be packed before shipping',
    category: 'shipping',
    errorCode: 'LINES_NOT_PACKED',
    operations: ['shipOrder'],
    evaluate: async ({ data }) => {
        const invalidLines = data.lines.filter(
            line => !['packed', 'marked_shipped', 'shipped', 'cancelled'].includes(line.lineStatus)
        );

        if (invalidLines.length === 0) {
            return true;
        }

        const statuses = [...new Set(invalidLines.map(l => l.lineStatus))];
        return {
            passed: false,
            message: `${invalidLines.length} line(s) not ready for shipping (status: ${statuses.join(', ')})`,
        };
    },
});

/**
 * Single line must be packed before shipping
 */
export const lineMustBePacked = defineRule<ShipLineData>({
    id: 'ship.line_must_be_packed',
    name: 'Line Must Be Packed',
    description: 'Line must be packed before shipping',
    category: 'shipping',
    errorCode: 'LINE_NOT_PACKED',
    operations: ['shipLine'],
    evaluate: async ({ data }) => {
        const validStatuses = ['packed', 'marked_shipped'];
        if (validStatuses.includes(data.line.lineStatus)) {
            return true;
        }
        return {
            passed: false,
            message: `Line must be packed before shipping (current: ${data.line.lineStatus})`,
        };
    },
});

/**
 * Cannot ship already shipped lines
 */
export const lineNotAlreadyShipped = simpleBooleanRule<ShipLineData>({
    id: 'ship.line_not_already_shipped',
    name: 'Line Not Already Shipped',
    description: 'Line is already shipped',
    category: 'shipping',
    errorCode: 'LINE_ALREADY_SHIPPED',
    operations: ['shipLine'],
    condition: ({ data }) => data.line.lineStatus !== 'shipped',
});

/**
 * Cannot ship cancelled lines
 */
export const lineNotCancelled = simpleBooleanRule<ShipLineData>({
    id: 'ship.line_not_cancelled',
    name: 'Cannot Ship Cancelled Line',
    description: 'Cannot ship a cancelled line',
    category: 'shipping',
    errorCode: 'CANNOT_SHIP_CANCELLED',
    operations: ['shipLine'],
    condition: ({ data }) => data.line.lineStatus !== 'cancelled',
});

// ============================================
// SHIP RULES - DATABASE VALIDATION (ASYNC)
// ============================================

/**
 * AWB number must not be used on other orders
 * This rule requires a database lookup
 */
export const noDuplicateAwb = defineRule<DuplicateAwbData>({
    id: 'ship.no_duplicate_awb',
    name: 'No Duplicate AWB',
    description: 'AWB number already used on another order',
    category: 'shipping',
    phase: 'transaction', // Runs within transaction for accurate check
    errorCode: 'DUPLICATE_AWB',
    operations: ['shipOrder', 'shipLine'],
    evaluate: async ({ prisma, data }) => {
        const existingAwb = await prisma.orderLine.findFirst({
            where: {
                awbNumber: data.awbNumber.trim(),
                orderId: { notIn: data.orderIds },
            },
            select: {
                id: true,
                order: { select: { orderNumber: true } },
            },
        });

        if (!existingAwb) {
            return true;
        }

        return {
            passed: false,
            message: `AWB number already used on order ${existingAwb.order?.orderNumber || 'unknown'}`,
        };
    },
});

// ============================================
// DELIVERY RULES
// ============================================

interface MarkDeliveredData {
    order: {
        id: string;
        status: string;
    };
}

/**
 * Order must be shipped to mark as delivered
 */
export const orderMustBeShippedForDelivery = defineRule<MarkDeliveredData>({
    id: 'delivery.order_must_be_shipped',
    name: 'Order Must Be Shipped',
    description: 'Order must be shipped to mark as delivered',
    category: 'shipping',
    errorCode: 'ORDER_NOT_SHIPPED',
    operations: ['markDelivered'],
    evaluate: async ({ data }) => {
        if (data.order.status === 'shipped') return true;
        return { passed: false, message: `Order must be shipped to mark as delivered (current: ${data.order.status})` };
    },
});

// ============================================
// UNSHIP RULES
// ============================================

/**
 * Can only unship shipped orders
 */
export const orderMustBeShipped = simpleBooleanRule<UnshipData>({
    id: 'unship.order_must_be_shipped',
    name: 'Order Must Be Shipped',
    description: 'Order must be shipped to unship',
    category: 'shipping',
    errorCode: 'ORDER_NOT_SHIPPED',
    operations: ['unshipOrder'],
    condition: ({ data }) => data.order?.status === 'shipped',
});

/**
 * Can only unship shipped lines
 */
export const lineMustBeShipped = simpleBooleanRule<UnshipData>({
    id: 'unship.line_must_be_shipped',
    name: 'Line Must Be Shipped',
    description: 'Line must be shipped to unship',
    category: 'shipping',
    errorCode: 'LINE_NOT_SHIPPED',
    operations: ['unshipLine'],
    condition: ({ data }) => data.line?.lineStatus === 'shipped',
});

/**
 * Cannot unship delivered orders
 */
export const orderNotDelivered = simpleBooleanRule<UnshipData>({
    id: 'unship.order_not_delivered',
    name: 'Cannot Unship Delivered Order',
    description: 'Cannot unship delivered orders',
    category: 'shipping',
    errorCode: 'CANNOT_UNSHIP_DELIVERED',
    operations: ['unshipOrder'],
    condition: ({ data }) => data.order?.status !== 'delivered',
});

// ============================================
// EXPORTS
// ============================================

/**
 * All shipping rules
 */
export const shippingRules = [
    // Input validation
    awbRequired,
    courierRequired,
    // Status validation
    linesMustBePacked,
    lineMustBePacked,
    lineNotAlreadyShipped,
    lineNotCancelled,
    // Database validation
    noDuplicateAwb,
    // Delivery rules
    orderMustBeShippedForDelivery,
    // Unship rules
    orderMustBeShipped,
    lineMustBeShipped,
    orderNotDelivered,
];
