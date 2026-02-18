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
import { appendRows, addBottomBorders, getSheetId, readRange, batchWriteRanges } from './googleSheetsClient.js';
import {
    ORDERS_MASTERSHEET_ID,
    MASTERSHEET_TABS,
    ORDERS_FROM_COH_COLS,
} from '../config/sync/sheets.js';
import prisma from '../lib/prisma.js';
import iThinkService from './ithinkLogistics.js';
import { resolveTrackingStatus } from '../config/mappings/trackingStatus.js';
import { recomputeOrderStatus } from '../utils/orderStatus.js';

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

export interface SyncSheetAwbResult {
    checked: number;
    linked: number;
    skipped: number;
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
                // All scalar fields (lineStatus, trackingStatus, courier, awbNumber) included by default
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
        // Y/Z/AA: Status, Courier, AWB — written at push time to avoid race condition
        row[24] = buildDisplayStatus(order.channel, line.lineStatus, line.trackingStatus);
        row[25] = line.courier ?? '';
        row[26] = line.awbNumber ?? '';
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

// ============================================
// UPDATE CHANNEL DETAILS IN SHEET
// ============================================

interface ChannelDetailUpdate {
    orderNumber: string;
    skuCode: string;
    channelStatus: string | null;
    courier: string | null;
    awb: string | null;
}

/**
 * Update channel status, courier, and AWB columns in "Orders from COH" sheet
 * for orders that already exist there. Matches by order number + SKU.
 *
 * Called after channel CSV import to backfill shipping details.
 */
export async function updateSheetChannelDetails(updates: ChannelDetailUpdate[]): Promise<{ matched: number; updated: number }> {
    const result = { matched: 0, updated: 0 };
    if (updates.length === 0) return result;

    // Filter to only updates that have at least one value to write
    const meaningful = updates.filter(u => u.channelStatus || u.courier || u.awb);
    if (meaningful.length === 0) return result;

    const tab = MASTERSHEET_TABS.ORDERS_FROM_COH;

    // Read order# (B) and SKU (G) columns to find matching rows
    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!B:G`);
    if (rows.length <= 1) return result;

    // Build lookup: "orderNumber|skuCode" → sheet row numbers (1-based)
    // Handle format differences: Myntra short UUIDs, Nykaa --1 suffix
    const sheetRowMap = new Map<string, number[]>();
    const addToMap = (key: string, rowNum: number) => {
        const existing = sheetRowMap.get(key);
        if (existing) existing.push(rowNum);
        else sheetRowMap.set(key, [rowNum]);
    };

    for (let i = 1; i < rows.length; i++) {
        const orderNo = String(rows[i][0] ?? '').trim();  // B is index 0 in B:G range
        const sku = String(rows[i][5] ?? '').trim();       // G is index 5 in B:G range
        if (!orderNo || !sku) continue;

        addToMap(`${orderNo}|${sku}`, i + 1); // +1 for 1-based sheet row
    }

    // Match updates to sheet rows
    const writeData: Array<{ range: string; values: (string | number)[][] }> = [];

    for (const update of meaningful) {
        const ref = update.orderNumber;
        const sku = update.skuCode;

        // Try exact match first, then alternate formats
        let matchRows = sheetRowMap.get(`${ref}|${sku}`);
        if (!matchRows) {
            // Myntra: sheet may have first 8 chars of UUID
            if (ref.includes('-') && ref.length > 20) {
                const short = ref.split('-')[0];
                matchRows = sheetRowMap.get(`${short}|${sku}`);
            }
        }
        if (!matchRows) {
            // Nykaa: sheet may have ref without "--1" suffix
            if (ref.endsWith('--1')) {
                matchRows = sheetRowMap.get(`${ref.slice(0, -3)}|${sku}`);
            }
        }

        if (!matchRows || matchRows.length === 0) continue;
        result.matched += matchRows.length;

        for (const rowNum of matchRows) {
            // Build row: Y (24) = channel status, Z (25) = courier, AA (26) = AWB
            const values: (string | number)[] = [
                update.channelStatus || '',
                update.courier || '',
                update.awb || '',
            ];
            writeData.push({
                range: `'${tab}'!Y${rowNum}:AA${rowNum}`,
                values: [values],
            });
        }
    }

    if (writeData.length > 0) {
        await batchWriteRanges(ORDERS_MASTERSHEET_ID, writeData);
        result.updated = writeData.length;
        log.info({ matched: result.matched, updated: result.updated }, 'Updated channel details in sheet');
    }

    return result;
}

// ============================================
// SYNC ORDER STATUS TO SHEET (scheduled + targeted)
// ============================================

let statusSyncRunning = false;

/** Clean channel name for display: shopify_online → shopify */
function cleanChannel(ch: string): string {
    if (ch === 'shopify_online') return 'shopify';
    return ch || 'unknown';
}

/** Build display status: channel-trackingStatus (or channel-lineStatus as fallback) */
function buildDisplayStatus(channel: string, lineStatus: string, trackingStatus: string | null): string {
    const prefix = cleanChannel(channel);
    const status = trackingStatus || lineStatus;
    return `${prefix}-${status}`;
}

/**
 * Sync order status, courier, and AWB from ERP database to the Google Sheet.
 * Reads "Orders from COH", looks up each order in the DB, and updates
 * columns Y (status), Z (courier), AA (AWB) where the ERP has newer data.
 *
 * Status format: "channel-status" (e.g. "shopify-in_transit", "myntra-shipped")
 * Only updates rows where at least one value has changed (avoids unnecessary writes).
 */
export async function syncSheetOrderStatus(): Promise<{ checked: number; updated: number }> {
    if (statusSyncRunning) {
        log.debug('Sheet status sync already running, skipping');
        return { checked: 0, updated: 0 };
    }

    statusSyncRunning = true;
    const result = { checked: 0, updated: 0 };

    try {
        const tab = MASTERSHEET_TABS.ORDERS_FROM_COH;

        // Read columns B (order#), G (SKU), Y (status), Z (courier), AA (AWB)
        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!B:AA`);
        if (rows.length <= 1) return result;

        // Collect order numbers to look up (column B = index 0 in B:AA range)
        const orderNumbers = new Set<string>();
        for (let i = 1; i < rows.length; i++) {
            const orderNo = String(rows[i][0] ?? '').trim();
            if (orderNo) orderNumbers.add(orderNo);
        }

        if (orderNumbers.size === 0) return result;

        // Batch query all matching orders with their lines from DB
        const orders = await prisma.order.findMany({
            where: { orderNumber: { in: [...orderNumbers] } },
            select: {
                orderNumber: true,
                channel: true,
                orderLines: {
                    select: {
                        lineStatus: true,
                        courier: true,
                        awbNumber: true,
                        trackingStatus: true,
                        sku: { select: { skuCode: true } },
                    },
                },
            },
        });

        // Build lookup: "orderNumber|skuCode" → { status, courier, awb }
        const erpData = new Map<string, { status: string; courier: string | null; awb: string | null }>();
        for (const order of orders) {
            for (const line of order.orderLines) {
                const key = `${order.orderNumber}|${line.sku.skuCode}`;
                erpData.set(key, {
                    status: buildDisplayStatus(order.channel, line.lineStatus, line.trackingStatus),
                    courier: line.courier,
                    awb: line.awbNumber,
                });
            }
        }

        // Compare sheet values with ERP data and build updates
        const writeData: Array<{ range: string; values: (string | number)[][] }> = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const orderNo = String(row[0] ?? '').trim();   // B = index 0 in B:AA
            const sku = String(row[5] ?? '').trim();        // G = index 5 in B:AA
            if (!orderNo || !sku) continue;

            const erp = erpData.get(`${orderNo}|${sku}`);
            if (!erp) continue;

            result.checked++;

            // Current sheet values: Y = index 23 in B:AA (col 24 - col 1 = 23), Z = 24, AA = 25
            const sheetStatus = String(row[23] ?? '').trim();
            const sheetCourier = String(row[24] ?? '').trim();
            const sheetAwb = String(row[25] ?? '').trim();

            const newStatus = erp.status || '';
            const newCourier = erp.courier || '';
            const newAwb = erp.awb || '';

            // Only update if something actually changed
            if (newStatus === sheetStatus && newCourier === sheetCourier && newAwb === sheetAwb) continue;

            const rowNum = i + 1; // 1-based sheet row
            writeData.push({
                range: `'${tab}'!Y${rowNum}:AA${rowNum}`,
                values: [[newStatus, newCourier, newAwb]],
            });
        }

        if (writeData.length > 0) {
            await batchWriteRanges(ORDERS_MASTERSHEET_ID, writeData);
            result.updated = writeData.length;
        }

        log.info({ checked: result.checked, updated: result.updated }, 'Sheet order status sync completed');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ error: message }, 'Sheet order status sync failed');
    } finally {
        statusSyncRunning = false;
    }

    return result;
}

/**
 * Immediately sync a single order's status/courier/AWB to the sheet.
 * Called right after a fulfillment webhook so the AWB shows instantly.
 * Reads only column B+G to find matching rows, then writes Y:AA.
 */
export async function syncSingleOrderToSheet(orderNumber: string): Promise<void> {
    try {
        const tab = MASTERSHEET_TABS.ORDERS_FROM_COH;

        // Query this order's line data from DB
        const order = await prisma.order.findFirst({
            where: { orderNumber },
            select: {
                channel: true,
                orderLines: {
                    select: {
                        lineStatus: true,
                        courier: true,
                        awbNumber: true,
                        trackingStatus: true,
                        sku: { select: { skuCode: true } },
                    },
                },
            },
        });
        if (!order || order.orderLines.length === 0) return;

        // Build lookup by SKU
        const lineData = new Map<string, { status: string; courier: string; awb: string }>();
        for (const line of order.orderLines) {
            lineData.set(line.sku.skuCode, {
                status: buildDisplayStatus(order.channel, line.lineStatus, line.trackingStatus),
                courier: line.courier || '',
                awb: line.awbNumber || '',
            });
        }

        // Read columns B (order#) and G (SKU) to find matching rows
        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!B:G`);
        if (rows.length <= 1) return;

        const writeData: Array<{ range: string; values: (string | number)[][] }> = [];
        for (let i = 1; i < rows.length; i++) {
            const rowOrderNo = String(rows[i][0] ?? '').trim();
            if (rowOrderNo !== orderNumber) continue;

            const rowSku = String(rows[i][5] ?? '').trim();
            const data = lineData.get(rowSku);
            if (!data) continue;

            const rowNum = i + 1;
            writeData.push({
                range: `'${tab}'!Y${rowNum}:AA${rowNum}`,
                values: [[data.status, data.courier, data.awb]],
            });
        }

        if (writeData.length > 0) {
            await batchWriteRanges(ORDERS_MASTERSHEET_ID, writeData);
            log.info({ orderNumber, rows: writeData.length }, 'Synced order status/AWB to sheet immediately');
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ orderNumber, error: message }, 'Failed to sync single order to sheet');
    }
}

// ============================================
// SYNC AWB FROM SHEET → DB (reverse sync)
// ============================================

/** Statuses where an OrderLine can be linked to an AWB */
const LINKABLE_STATUSES = ['pending', 'allocated', 'picked', 'packed'];

let awbSyncRunning = false;

/**
 * Read AWB numbers entered manually in the Google Sheet, validate them via
 * iThink Logistics API, and link them to matching OrderLines in the database.
 *
 * This is the reverse of syncSheetOrderStatus: sheet→DB instead of DB→sheet.
 * Used for offline/exchange orders where the ops team enters the AWB in the sheet.
 */
export async function syncSheetAwb(): Promise<SyncSheetAwbResult> {
    if (awbSyncRunning) {
        log.debug('Sheet AWB sync already running, skipping');
        return { checked: 0, linked: 0, skipped: 0, failed: 0, errors: [], durationMs: 0 };
    }

    awbSyncRunning = true;
    const start = Date.now();
    const result: SyncSheetAwbResult = { checked: 0, linked: 0, skipped: 0, failed: 0, errors: [], durationMs: 0 };

    try {
        const tab = MASTERSHEET_TABS.ORDERS_FROM_COH;

        // Read columns B through AD (need AC = AWB_SCAN where ops enters AWBs)
        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!B:AD`);
        if (rows.length <= 1) {
            result.durationMs = Date.now() - start;
            return result;
        }

        // Collect rows that have an AWB in column AC (AWB_SCAN, index 27 in B:AD range)
        interface SheetAwbRow {
            rowIndex: number;   // 1-based index in rows array (for sheet row = rowIndex + 1)
            orderNumber: string;
            sku: string;
            awb: string;
        }

        const awbRows: SheetAwbRow[] = [];
        const uniqueAwbs = new Set<string>();

        for (let i = 1; i < rows.length; i++) {
            const awb = String(rows[i][27] ?? '').trim(); // AC = index 27 in B:AD
            if (!awb) continue;

            const orderNumber = String(rows[i][0] ?? '').trim();
            const sku = String(rows[i][5] ?? '').trim();
            if (!orderNumber || !sku) continue;

            awbRows.push({ rowIndex: i, orderNumber, sku, awb });
            uniqueAwbs.add(awb);
        }

        result.checked = awbRows.length;
        if (awbRows.length === 0) {
            result.durationMs = Date.now() - start;
            return result;
        }

        // Batch validate AWBs via iThink (max 10 per call)
        const awbList = [...uniqueAwbs];
        const validatedAwbs = new Map<string, { logistic: string; statusCode: string; statusText: string }>();

        for (let i = 0; i < awbList.length; i += 10) {
            const batch = awbList.slice(i, i + 10);
            try {
                const data = await iThinkService.trackShipments(batch, true);
                for (const awb of batch) {
                    const tracking = data[awb];
                    if (tracking && tracking.message === 'success') {
                        validatedAwbs.set(awb, {
                            logistic: tracking.logistic,
                            statusCode: tracking.current_status_code,
                            statusText: tracking.current_status,
                        });
                    }
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                result.errors.push(`iThink batch error: ${message}`);
                log.error({ batch, err: message }, 'iThink batch validation failed');
            }
        }

        // Look up all relevant order numbers in one query
        const orderNumbers = [...new Set(awbRows.map(r => r.orderNumber))];
        const orders = await prisma.order.findMany({
            where: { orderNumber: { in: orderNumbers } },
            select: {
                id: true,
                orderNumber: true,
                channel: true,
                orderLines: {
                    select: {
                        id: true,
                        orderId: true,
                        lineStatus: true,
                        awbNumber: true,
                        trackingStatus: true,
                        sku: { select: { skuCode: true } },
                    },
                },
            },
        });

        // Build lookup: "orderNumber|skuCode" → OrderLine
        const lineMap = new Map<string, {
            id: string;
            orderId: string;
            lineStatus: string;
            awbNumber: string | null;
            trackingStatus: string | null;
            channel: string;
        }>();
        for (const order of orders) {
            for (const line of order.orderLines) {
                lineMap.set(`${order.orderNumber}|${line.sku.skuCode}`, {
                    id: line.id,
                    orderId: line.orderId,
                    lineStatus: line.lineStatus,
                    awbNumber: line.awbNumber,
                    trackingStatus: line.trackingStatus,
                    channel: order.channel,
                });
            }
        }

        // Process each sheet row: update DB + collect sheet write-backs
        const writeData: Array<{ range: string; values: (string | number)[][] }> = [];
        const recomputeOrderIds = new Set<string>();

        for (const row of awbRows) {
            const validated = validatedAwbs.get(row.awb);
            if (!validated) {
                result.failed++;
                continue;
            }

            const line = lineMap.get(`${row.orderNumber}|${row.sku}`);
            if (!line) {
                result.skipped++;
                continue;
            }

            // Skip if already has an AWB
            if (line.awbNumber) {
                result.skipped++;
                continue;
            }

            // Skip if not in a linkable status
            if (!LINKABLE_STATUSES.includes(line.lineStatus)) {
                result.skipped++;
                continue;
            }

            const resolvedStatus = resolveTrackingStatus(validated.statusCode, validated.statusText);

            try {
                await prisma.orderLine.update({
                    where: { id: line.id },
                    data: {
                        awbNumber: row.awb,
                        courier: validated.logistic,
                        trackingStatus: resolvedStatus,
                        lineStatus: 'shipped',
                        shippedAt: new Date(),
                    },
                });
                recomputeOrderIds.add(line.orderId);
                result.linked++;

                // Queue sheet write-back: status (Y), courier (Z), AWB (AA)
                const displayStatus = buildDisplayStatus(line.channel, 'shipped', resolvedStatus);
                const sheetRowNum = row.rowIndex + 1; // 1-based
                writeData.push({
                    range: `'${tab}'!Y${sheetRowNum}:AA${sheetRowNum}`,
                    values: [[displayStatus, validated.logistic, row.awb]],
                });
            } catch (err: unknown) {
                result.failed++;
                const message = err instanceof Error ? err.message : String(err);
                result.errors.push(`#${row.orderNumber} ${row.sku}: ${message}`);
                log.error({ orderNumber: row.orderNumber, sku: row.sku, err: message }, 'Failed to link AWB');
            }
        }

        // Recompute order statuses
        for (const orderId of recomputeOrderIds) {
            try {
                await recomputeOrderStatus(orderId);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                log.error({ orderId, err: message }, 'Failed to recompute order status after AWB link');
            }
        }

        // Write back courier + status to sheet in one batch
        if (writeData.length > 0) {
            await batchWriteRanges(ORDERS_MASTERSHEET_ID, writeData);
        }

        log.info(
            { checked: result.checked, linked: result.linked, skipped: result.skipped, failed: result.failed },
            'Sheet AWB sync completed'
        );
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(message);
        log.error({ error: message }, 'Sheet AWB sync fatal error');
    } finally {
        awbSyncRunning = false;
    }

    result.durationMs = Date.now() - start;
    return result;
}
