/**
 * Push New Shopify Orders to "Orders from COH" Sheet
 *
 * When a new order arrives via the orders/create webhook, this service
 * appends one row per line item to the "Orders from COH" tab in the
 * COH Orders Mastersheet. This lets the ops team start processing
 * immediately without waiting for any manual entry.
 *
 * Triggered via deferredExecutor — fire-and-forget, never blocks webhook response.
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

// Total columns in "Orders from COH" tab (A through AD = 30 columns)
const TOTAL_COLS = 30;

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Push a new Shopify order to the "Orders from COH" sheet tab.
 * Creates one row per line item. Skips silently if not an orders/create webhook.
 * Adds a bottom border after the last line item of the order.
 */
export async function pushNewOrderToSheet(
    shopifyOrder: ShopifyOrder
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
 * Never throws — errors are logged silently.
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
