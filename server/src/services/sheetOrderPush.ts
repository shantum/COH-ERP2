/**
 * Push New Shopify Orders to "Orders from COH" Sheet
 *
 * When a new order arrives via the orders/create webhook, this service
 * appends one row per line item to the "Orders from COH" tab in the
 * COH Orders Mastersheet. This lets the ops team start processing
 * immediately without waiting for any manual entry.
 *
 * Triggered via deferredExecutor — fire-and-forget, never blocks webhook response.
 *
 * Also includes a reconciler that catches any orders missed due to crashes/downtime.
 */

import { sheetsLogger } from '../utils/logger.js';
import { appendRows, addBottomBorders, getSheetId } from './googleSheetsClient.js';
import {
    ORDERS_MASTERSHEET_ID,
    MASTERSHEET_TABS,
} from '../config/sync/sheets.js';
import prisma from '../lib/prisma.js';

const log = sheetsLogger.child({ service: 'sheetOrderPush' });

// ============================================
// TYPES
// ============================================

interface ShopifyLineItem {
    sku?: string | null;
    title?: string | null;
    variant_title?: string | null;
    quantity?: number | null;
}

interface ShopifyAddress {
    first_name?: string | null;
    last_name?: string | null;
    city?: string | null;
    phone?: string | null;
}

interface ShopifyOrder {
    created_at?: string | null;
    name?: string | null;
    note?: string | null;
    source_name?: string | null;
    payment_gateway_names?: string[] | null;
    shipping_address?: ShopifyAddress | null;
    line_items?: ShopifyLineItem[] | null;
}

export interface ReconcileResult {
    found: number;
    pushed: number;
    failed: number;
    errors: string[];
    durationMs: number;
}

// ============================================
// HELPERS
// ============================================

/** Format ISO date string as YYYY-MM-DD HH:MM:SS in IST */
function formatDate(isoDate: string | null | undefined): string {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    // Format in IST (Asia/Kolkata)
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const p = (type: string) => parts.find(x => x.type === type)?.value ?? '';
    return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}:${p('second')}`;
}

/** Stamp sheetPushedAt on an order after successful push */
async function stampSheetPushed(orderId: string): Promise<void> {
    try {
        await prisma.order.update({
            where: { id: orderId },
            data: { sheetPushedAt: new Date() },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ orderId, err: message }, 'Failed to stamp sheetPushedAt');
    }
}

// Total columns in "Orders from COH" tab (A through AD = 30 columns)
const TOTAL_COLS = 30;

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Push a new Shopify order to the "Orders from COH" sheet tab.
 * Creates one row per line item. Skips silently if not an orders/create webhook.
 * Adds a bottom border after the last line item of the order.
 * Stamps sheetPushedAt on the order after successful push.
 */
export async function pushNewOrderToSheet(
    shopifyOrder: ShopifyOrder,
    orderId?: string
): Promise<void> {

    const lineItems = shopifyOrder.line_items;
    if (!lineItems || lineItems.length === 0) {
        log.warn({ orderName: shopifyOrder.name }, 'No line items to push');
        return;
    }

    // Extract order-level fields
    const orderDate = formatDate(shopifyOrder.created_at);
    const orderNumber = shopifyOrder.name ?? '';
    const addr = shopifyOrder.shipping_address;
    const customerName = [addr?.first_name, addr?.last_name].filter(Boolean).join(' ');
    const city = addr?.city ?? '';
    const phone = addr?.phone ?? '';
    const channel = shopifyOrder.payment_gateway_names?.[0] ?? shopifyOrder.source_name ?? '';
    const orderNote = shopifyOrder.note ?? '';

    // Build one row per line item
    // Col H (Product Name) left empty — populated by VLOOKUP formula on the sheet
    const rows: (string | number)[][] = lineItems.map(item => {
        const row: (string | number)[] = new Array(TOTAL_COLS).fill('');
        row[0] = orderDate;           // A: Order Date
        row[1] = orderNumber;         // B: Order#
        row[2] = customerName;        // C: Name
        row[3] = city;                // D: City
        row[4] = phone;               // E: Mobile
        row[5] = channel;             // F: Channel
        row[6] = item.sku ?? '';      // G: SKU
        // row[7] left empty          // H: Product Name (VLOOKUP)
        row[8] = item.quantity ?? 0;  // I: Qty
        row[10] = orderNote;          // K: Order Note
        return row;
    });

    const range = `'${MASTERSHEET_TABS.ORDERS_FROM_COH}'!A:AD`;

    try {
        const startRow = await appendRows(ORDERS_MASTERSHEET_ID, range, rows);

        // Add bottom border on the last row of this order
        if (startRow >= 0) {
            const lastRowIdx = startRow + rows.length - 1;
            const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, MASTERSHEET_TABS.ORDERS_FROM_COH);
            await addBottomBorders(ORDERS_MASTERSHEET_ID, sheetId, [lastRowIdx]);
        }

        // Stamp sheetPushedAt
        if (orderId) {
            await stampSheetPushed(orderId);
        }

        log.info(
            { orderName: orderNumber, lineCount: rows.length },
            'Pushed order to Orders from COH sheet'
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(
            { orderName: orderNumber, lineCount: rows.length, err: message },
            'Failed to push order to sheet'
        );
    }
}

// ============================================
// ERP-CREATED ORDER PUSH
// ============================================

/**
 * Push an ERP-created order (manual or exchange) to the "Orders from COH" sheet.
 * Queries the order from DB and maps to the same 30-column row format as Shopify orders.
 * Stamps sheetPushedAt on success. Never throws — errors are logged silently.
 */
export async function pushERPOrderToSheet(orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            orderLines: {
                include: { sku: { select: { skuCode: true } } },
            },
        },
    });

    if (!order) {
        log.warn({ orderId }, 'pushERPOrderToSheet: order not found');
        return;
    }

    if (order.orderLines.length === 0) {
        log.warn({ orderId, orderNumber: order.orderNumber }, 'pushERPOrderToSheet: no line items');
        return;
    }

    // Parse city from shippingAddress (may be JSON with city field, or plain text)
    let city = '';
    if (order.shippingAddress) {
        try {
            const addr = JSON.parse(order.shippingAddress);
            city = addr.city ?? '';
        } catch {
            // Not JSON — leave city empty
        }
    }

    const orderDate = formatDate(order.orderDate.toISOString());

    const rows: (string | number)[][] = order.orderLines.map(line => {
        const row: (string | number)[] = new Array(TOTAL_COLS).fill('');
        row[0] = orderDate;                   // A: Order Date
        row[1] = order.orderNumber;           // B: Order#
        row[2] = order.customerName;          // C: Name
        row[3] = city;                        // D: City
        row[4] = order.customerPhone ?? '';    // E: Mobile
        row[5] = order.channel;               // F: Channel
        row[6] = line.sku.skuCode;            // G: SKU
        // row[7] left empty                  // H: Product Name (VLOOKUP)
        row[8] = line.qty;                    // I: Qty
        row[10] = order.internalNotes ?? '';   // K: Order Note
        // L: COH Notes — write "SHIP BY <date>" if shipByDate is set
        if (order.shipByDate) {
            row[11] = `SHIP BY ${order.shipByDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`;
        }
        return row;
    });

    const range = `'${MASTERSHEET_TABS.ORDERS_FROM_COH}'!A:AD`;

    try {
        const startRow = await appendRows(ORDERS_MASTERSHEET_ID, range, rows);

        if (startRow >= 0) {
            const lastRowIdx = startRow + rows.length - 1;
            const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, MASTERSHEET_TABS.ORDERS_FROM_COH);
            await addBottomBorders(ORDERS_MASTERSHEET_ID, sheetId, [lastRowIdx]);
        }

        // Stamp sheetPushedAt
        await stampSheetPushed(orderId);

        log.info(
            { orderNumber: order.orderNumber, lineCount: rows.length },
            'Pushed ERP order to Orders from COH sheet'
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(
            { orderNumber: order.orderNumber, lineCount: rows.length, err: message },
            'Failed to push ERP order to sheet'
        );
    }
}

// ============================================
// RECONCILER
// ============================================

/** How far back to look for unpushed orders (prevents pushing ancient orders on first run) */
const RECONCILE_LOOKBACK_DAYS = 3;
/** Max orders to push per reconciliation run */
const RECONCILE_BATCH_LIMIT = 20;

/**
 * Find orders that were never pushed to the sheet and push them.
 * Looks back 3 days and pushes up to 20 at a time (oldest first).
 * Uses pushERPOrderToSheet which handles all the mapping + stamping.
 */
export async function reconcileSheetOrders(): Promise<ReconcileResult> {
    const start = Date.now();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECONCILE_LOOKBACK_DAYS);

    const result: ReconcileResult = { found: 0, pushed: 0, failed: 0, errors: [], durationMs: 0 };

    try {
        // Find recent orders that were never pushed
        const unpushed = await prisma.order.findMany({
            where: {
                sheetPushedAt: null,
                createdAt: { gte: cutoff },
            },
            select: { id: true, orderNumber: true },
            orderBy: { createdAt: 'asc' },
            take: RECONCILE_BATCH_LIMIT,
        });

        result.found = unpushed.length;

        if (unpushed.length === 0) {
            log.info('Sheet reconciler: all orders pushed, nothing to do');
            result.durationMs = Date.now() - start;
            return result;
        }

        log.info(
            { count: unpushed.length, orders: unpushed.map(o => o.orderNumber) },
            'Sheet reconciler: found unpushed orders'
        );

        // Push each one using the ERP push function (it handles stamping)
        for (const order of unpushed) {
            try {
                await pushERPOrderToSheet(order.id);
                result.pushed++;
            } catch (err: unknown) {
                result.failed++;
                const message = err instanceof Error ? err.message : String(err);
                result.errors.push(`#${order.orderNumber}: ${message}`);
                log.error({ orderNumber: order.orderNumber, err: message }, 'Reconciler: failed to push order');
            }
        }

        log.info(
            { found: result.found, pushed: result.pushed, failed: result.failed },
            'Sheet reconciler: done'
        );
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(message);
        log.error({ err: message }, 'Sheet reconciler: fatal error');
    }

    result.durationMs = Date.now() - start;
    return result;
}
