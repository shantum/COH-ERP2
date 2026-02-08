/**
 * Google Sheets Offload Worker — 3 Independent Jobs
 *
 * Three independently triggerable background jobs:
 *   1. Ingest Inward  — reads Inward (Live), creates INWARD InventoryTransactions
 *   2. Move Shipped    — copies shipped rows from "Orders from COH" to "Outward (Live)"
 *   3. Ingest Outward — reads Outward (Live), creates OUTWARD InventoryTransactions + links to OrderLines
 *
 * After each ingest job (1 & 3):
 *   - Writes updated ERP currentBalance to col R (Inventory) and col F (Balance Final)
 *   - Invalidates caches and broadcasts SSE
 *
 * Move Shipped (2) does NOT trigger balance updates — no ERP transactions are created.
 *
 * Follows trackingSync.ts pattern: module-level state, concurrency guard,
 * start/stop/getStatus/triggerSync exports.
 *
 * Feature-flagged: does nothing unless ENABLE_SHEET_OFFLOAD=true.
 */

import prisma from '../lib/prisma.js';
import { sheetsLogger } from '../utils/logger.js';
import { TXN_TYPE } from '../utils/patterns/types.js';
import type { TxnReason } from '../utils/patterns/types.js';
import { inventoryBalanceCache } from './inventoryBalanceCache.js';
import { broadcastOrderUpdate } from '../routes/sse.js';
import {
    readRange,
    writeRange,
    appendRows,
    deleteRowsBatch,
    getSheetId,
} from './googleSheetsClient.js';
import {
    ENABLE_SHEET_OFFLOAD,
    ENABLE_SHEET_DELETION,
    OFFICE_LEDGER_ID,
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    MASTERSHEET_TABS,
    LEDGER_TABS,
    INVENTORY_TAB,
    INWARD_LIVE_COLS,
    OUTWARD_LIVE_COLS,
    ORDERS_FROM_COH_COLS,
    INWARD_SOURCE_MAP,
    VALID_INWARD_LIVE_SOURCES,
    DEFAULT_INWARD_REASON,
    OUTWARD_DESTINATION_MAP,
    DEFAULT_OUTWARD_REASON,
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
    BATCH_SIZE,
} from '../config/sync/sheets.js';

// ============================================
// TYPES
// ============================================

interface IngestInwardResult {
    startedAt: string;
    inwardIngested: number;
    skipped: number;
    rowsDeleted: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    inwardValidationErrors: Record<string, number>;
}

interface IngestOutwardResult {
    startedAt: string;
    outwardIngested: number;
    ordersLinked: number;
    skipped: number;
    rowsDeleted: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    outwardSkipReasons?: Record<string, number>;
}

interface MoveShippedResult {
    shippedRowsFound: number;
    skippedRows: number;
    skipReasons: Record<string, number>;
    rowsWrittenToOutward: number;
    rowsVerified: number;
    rowsDeletedFromOrders: number;
    errors: string[];
    durationMs: number;
}

interface IngestPreviewResult {
    tab: string;
    totalRows: number;
    valid: number;
    invalid: number;
    duplicates: number;
    validationErrors: Record<string, number>;
    skipReasons?: Record<string, number>;
    affectedSkuCodes: string[];
    durationMs: number;
}

interface RunSummary {
    startedAt: string;
    durationMs: number;
    count: number;        // inwardIngested or outwardIngested or rowsWrittenToOutward
    error: string | null;
}

interface JobState<T> {
    isRunning: boolean;
    lastRunAt: Date | null;
    lastResult: T | null;
    recentRuns: RunSummary[];
}

interface OffloadStatus {
    ingestInward: JobState<IngestInwardResult>;
    ingestOutward: JobState<IngestOutwardResult>;
    moveShipped: JobState<MoveShippedResult>;
    schedulerActive: boolean;
}

interface ParsedRow {
    rowIndex: number;       // 0-based index in the sheet (including header)
    skuCode: string;
    qty: number;
    date: Date | null;
    source: string;         // inward: source, outward: destination
    extra: string;          // inward: doneBy, outward: orderNumber
    tailor: string;         // inward only
    courier: string;        // outward only — from sheet col J
    awb: string;            // outward only — from sheet col K
    referenceId: string;
    notes: string;
}

/** An outward item that has an orderNumber and can be linked to an OrderLine. */
interface LinkableOutward {
    orderNumber: string;
    skuId: string;
    qty: number;
    date: Date | null;
    courier: string;
    awb: string;
}

/** Internal accumulator for deleteIngestedRows — shared across job types. */
interface DeleteTracker {
    rowsDeleted: number;
    errors: number;
}

// ============================================
// STATE
// ============================================

let schedulerActive = false;

const MAX_RECENT_RUNS = 10;

// Per-job state
const ingestInwardState: JobState<IngestInwardResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const ingestOutwardState: JobState<IngestOutwardResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const moveShippedState: JobState<MoveShippedResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

// ============================================
// HELPERS
// ============================================

let cachedAdminUserId: string | null = null;

async function getAdminUserId(): Promise<string> {
    if (cachedAdminUserId) return cachedAdminUserId;

    const admin = await prisma.user.findFirst({
        where: { role: 'admin' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });

    if (!admin) {
        throw new Error('No admin user found — cannot create inventory transactions');
    }

    cachedAdminUserId = admin.id;
    return admin.id;
}

/**
 * Parse a date string from the sheet.
 * Live tabs use DD/MM/YYYY format (set via column formatting).
 * Also handles MM/DD/YYYY and ISO for robustness.
 */
function parseSheetDate(value: string | undefined): Date | null {
    if (!value?.trim()) return null;

    const trimmed = value.trim();

    // ISO format "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1900) return parsed;
        return null;
    }

    // Slash/dash/dot separated: A/B/YYYY
    const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!match) return null;

    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);

    if (year < 1901) return null;

    let month: number;
    let day: number;

    if (a > 12) {
        day = a; month = b;
    } else if (b > 12) {
        month = a; day = b;
    } else {
        // Ambiguous — default DD/MM for live tabs (Indian locale)
        day = a; month = b;
    }

    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) return d;
    return null;
}

function parseQty(value: string | undefined): number {
    if (!value?.trim()) return 0;
    const num = Math.round(Number(value.trim()));
    return num > 0 ? num : 0;
}

function mapSourceToReason(source: string): TxnReason {
    const normalized = source.toLowerCase().trim();
    return INWARD_SOURCE_MAP[normalized] ?? DEFAULT_INWARD_REASON;
}

function mapDestinationToReason(destination: string): TxnReason {
    const normalized = destination.toLowerCase().trim();
    return OUTWARD_DESTINATION_MAP[normalized] ?? DEFAULT_OUTWARD_REASON;
}

/**
 * Content-based referenceId — stable across row deletions.
 */
function buildReferenceId(
    prefix: string,
    skuCode: string,
    qty: number,
    dateStr: string,
    extra: string = ''
): string {
    const datePart = dateStr.replace(/[/\-.\s]/g, '').slice(0, 8) || 'nodate';
    const extraPart = extra ? `:${extra.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}` : '';
    return `${prefix}:${skuCode}:${qty}:${datePart}${extraPart}`;
}

/**
 * Write error strings to the Import Errors column for parsed rows.
 * Valid rows get empty string (clears stale errors), invalid rows get their error message.
 */
async function writeImportErrors(
    spreadsheetId: string,
    tab: string,
    errors: Array<{ rowIndex: number; error: string }>,
    errorColLetter: string
): Promise<void> {
    if (errors.length === 0) return;

    // Sort by rowIndex for efficient batching
    const sorted = [...errors].sort((a, b) => a.rowIndex - b.rowIndex);

    // Group consecutive rows into ranges
    const ranges: Array<{ startRow: number; values: string[][] }> = [];
    let current: { startRow: number; values: string[][] } | null = null;

    for (const { rowIndex, error } of sorted) {
        const sheetRow = rowIndex + 1; // 0-based index to 1-based row
        if (current && sheetRow === current.startRow + current.values.length) {
            current.values.push([error]);
        } else {
            if (current) ranges.push(current);
            current = { startRow: sheetRow, values: [[error]] };
        }
    }
    if (current) ranges.push(current);

    for (const range of ranges) {
        const rangeStr = `'${tab}'!${errorColLetter}${range.startRow}:${errorColLetter}${range.startRow + range.values.length - 1}`;
        await writeRange(spreadsheetId, rangeStr, range.values);
    }

    const errorCount = sorted.filter(e => e.error).length;
    if (errorCount > 0) {
        sheetsLogger.info({ tab, totalRows: sorted.length, errors: errorCount }, 'Wrote import errors to sheet');
    }
}

async function bulkLookupSkus(skuCodes: string[]): Promise<Map<string, string>> {
    if (skuCodes.length === 0) return new Map();
    const unique = [...new Set(skuCodes)];
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: unique } },
        select: { id: true, skuCode: true },
    });
    return new Map(skus.map(s => [s.skuCode, s.id]));
}

interface OutwardValidationResult {
    validRows: ParsedRow[];
    skipReasons: Record<string, number>;
    orderMap: Map<string, { id: string; orderLines: Array<{ id: string; skuId: string; qty: number; lineStatus: string }> }>;
}

/**
 * Pre-ingestion validation for outward rows.
 */
async function validateOutwardRows(
    rows: ParsedRow[],
    skuMap: Map<string, string>
): Promise<OutwardValidationResult> {
    const skipReasons: Record<string, number> = {};
    const addSkip = (reason: string) => {
        skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };

    // Pass 1: basic field validation
    const afterBasic: ParsedRow[] = [];
    for (const row of rows) {
        if (!row.skuCode) { addSkip('empty_sku'); continue; }
        if (row.qty <= 0) { addSkip('zero_qty'); continue; }
        if (!skuMap.has(row.skuCode)) { addSkip('unknown_sku'); continue; }
        if (!row.date) { addSkip('invalid_date'); continue; }
        afterBasic.push(row);
    }

    // Pass 2: order/order-line validation for rows with an orderNumber
    const orderNumbers = [...new Set(
        afterBasic
            .map(r => r.extra)
            .filter(Boolean)
    )];

    const orderMap = new Map<string, { id: string; orderLines: Array<{ id: string; skuId: string; qty: number; lineStatus: string }> }>();
    if (orderNumbers.length > 0) {
        const orders = await prisma.order.findMany({
            where: { orderNumber: { in: orderNumbers } },
            select: {
                id: true,
                orderNumber: true,
                orderLines: { select: { id: true, skuId: true, qty: true, lineStatus: true } },
            },
        });
        for (const o of orders) {
            orderMap.set(o.orderNumber, { id: o.id, orderLines: o.orderLines });
        }
    }

    const validRows: ParsedRow[] = [];
    for (const row of afterBasic) {
        const orderNumber = row.extra;
        if (!orderNumber) {
            validRows.push(row);
            continue;
        }

        const order = orderMap.get(orderNumber);
        if (!order) {
            addSkip('order_not_found');
            continue;
        }

        const skuId = skuMap.get(row.skuCode)!;
        const hasMatchingLine = order.orderLines.some(l => l.skuId === skuId);
        if (!hasMatchingLine) {
            addSkip('order_line_not_found');
            continue;
        }

        validRows.push(row);
    }

    return { validRows, skipReasons, orderMap };
}

const DEDUP_CHUNK_SIZE = 2000;

async function findExistingReferenceIds(referenceIds: string[]): Promise<Set<string>> {
    if (referenceIds.length === 0) return new Set();

    const result = new Set<string>();
    for (let i = 0; i < referenceIds.length; i += DEDUP_CHUNK_SIZE) {
        const chunk = referenceIds.slice(i, i + DEDUP_CHUNK_SIZE);
        const existing = await prisma.inventoryTransaction.findMany({
            where: { referenceId: { in: chunk } },
            select: { referenceId: true },
        });
        for (const t of existing) {
            if (t.referenceId) result.add(t.referenceId);
        }
    }
    return result;
}

// ============================================
// INWARD VALIDATION
// ============================================

function validateInwardRow(
    parsed: ParsedRow,
    rawRow: unknown[],
    skuMap: Map<string, string>,
): string[] {
    const reasons: string[] = [];

    const rawQty = String(rawRow[INWARD_LIVE_COLS.QTY] ?? '').trim();
    const product = String(rawRow[INWARD_LIVE_COLS.PRODUCT] ?? '').trim();
    const dateStr = String(rawRow[INWARD_LIVE_COLS.DATE] ?? '').trim();
    const barcode = String(rawRow[INWARD_LIVE_COLS.BARCODE] ?? '').trim();
    const notes = String(rawRow[INWARD_LIVE_COLS.NOTES] ?? '').trim();

    const source = parsed.source.toLowerCase();

    if (!parsed.skuCode)    reasons.push('missing SKU (A)');
    if (!rawQty)            reasons.push('missing Qty (B)');
    if (!product)           reasons.push('missing Product (C)');
    if (!dateStr)           reasons.push('missing Date (D)');
    if (!parsed.source)     reasons.push('missing Source (E)');
    if (!parsed.extra)      reasons.push('missing Done By (F)');
    if (rawQty && parsed.qty <= 0) reasons.push('Qty must be > 0');
    if (parsed.source && !VALID_INWARD_LIVE_SOURCES.some(s => s === source)) {
        reasons.push(`invalid Source "${parsed.source}"`);
    }
    if (source === 'repacking' && !barcode) {
        reasons.push('missing Barcode (G) for repacking');
    }
    if (source === 'sampling' && !parsed.tailor) {
        reasons.push('missing Tailor Number (H) for sampling');
    }
    if (source === 'adjustment' && !notes) {
        reasons.push('missing Notes (I) for adjustment');
    }
    if (parsed.skuCode && !skuMap.has(parsed.skuCode)) {
        reasons.push(`unknown SKU "${parsed.skuCode}"`);
    }

    return reasons;
}

// ============================================
// PHASE A: INGEST INWARD (LIVE)
// ============================================

async function ingestInwardLive(result: IngestInwardResult): Promise<Set<string>> {
    const tab = LIVE_TABS.INWARD;
    const affectedSkuIds = new Set<string>();

    sheetsLogger.info({ tab }, 'Reading inward live tab');

    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:I`);
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        return affectedSkuIds;
    }

    // --- Step 1: Parse rows (skip rows with no SKU) ---
    const parsed: ParsedRow[] = [];
    const seenRefs = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const skuCode = String(row[INWARD_LIVE_COLS.SKU] ?? '').trim();
        if (!skuCode) continue;

        const qty = parseQty(String(row[INWARD_LIVE_COLS.QTY] ?? ''));
        const dateStr = String(row[INWARD_LIVE_COLS.DATE] ?? '');
        const source = String(row[INWARD_LIVE_COLS.SOURCE] ?? '').trim();
        const doneBy = String(row[INWARD_LIVE_COLS.DONE_BY] ?? '').trim();
        const tailor = String(row[INWARD_LIVE_COLS.TAILOR] ?? '').trim();

        let refId = buildReferenceId(REF_PREFIX.INWARD_LIVE, skuCode, qty, dateStr, source);
        if (seenRefs.has(refId)) {
            let counter = 2;
            while (seenRefs.has(`${refId}:${counter}`)) counter++;
            refId = `${refId}:${counter}`;
        }
        seenRefs.add(refId);

        parsed.push({
            rowIndex: i,
            skuCode,
            qty,
            date: parseSheetDate(dateStr),
            source,
            extra: doneBy,
            tailor,
            courier: '',
            awb: '',
            referenceId: refId,
            notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
        });
    }

    if (parsed.length === 0) {
        sheetsLogger.info({ tab }, 'No data rows to process');
        return affectedSkuIds;
    }

    // --- Step 2: Bulk lookup SKUs for validation ---
    const skuMap = await bulkLookupSkus(parsed.map(r => r.skuCode));

    // --- Step 3: Validate each row ---
    const validRows: ParsedRow[] = [];
    const validationErrors: Record<string, number> = {};
    const importErrors: Array<{ rowIndex: number; error: string }> = [];
    let invalidCount = 0;

    for (const p of parsed) {
        const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap);
        if (reasons.length === 0) {
            validRows.push(p);
            importErrors.push({ rowIndex: p.rowIndex, error: '' });
        } else {
            invalidCount++;
            importErrors.push({ rowIndex: p.rowIndex, error: reasons.join('; ') });
            for (const reason of reasons) {
                validationErrors[reason] = (validationErrors[reason] ?? 0) + 1;
            }
            sheetsLogger.debug({
                row: p.rowIndex + 1,
                skuCode: p.skuCode,
                reasons,
            }, 'Inward row failed validation');
        }
    }

    result.inwardValidationErrors = validationErrors;
    result.skipped += invalidCount;

    // Write Import Errors column for all parsed rows (clears valid, shows errors for invalid)
    await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, importErrors, 'J');

    if (invalidCount > 0) {
        sheetsLogger.warn({
            tab,
            invalid: invalidCount,
            valid: validRows.length,
            validationErrors,
        }, 'Inward rows failed validation — will remain on sheet');
    }

    if (validRows.length === 0) {
        sheetsLogger.info({ tab, total: parsed.length, invalid: invalidCount }, 'No valid rows after validation');
        return affectedSkuIds;
    }

    // --- Step 4: Dedup valid rows against existing transactions ---
    const existingRefs = await findExistingReferenceIds(validRows.map(r => r.referenceId));
    const newRows = validRows.filter(r => !existingRefs.has(r.referenceId));

    if (newRows.length === 0) {
        sheetsLogger.info({ tab, total: validRows.length }, 'All valid rows already ingested');
        if (ENABLE_SHEET_DELETION) {
            await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, validRows.map(r => r.rowIndex), result);
        }
        return affectedSkuIds;
    }

    // --- Step 5: Create transactions ---
    const adminUserId = await getAdminUserId();
    const ingestedRowIndices: number[] = [];

    for (let batch = 0; batch < newRows.length; batch += BATCH_SIZE) {
        const chunk = newRows.slice(batch, batch + BATCH_SIZE);
        const txnData: Array<{
            skuId: string;
            txnType: string;
            qty: number;
            reason: string;
            referenceId: string;
            notes: string;
            createdById: string;
            createdAt: Date;
            source: string | null;
            performedBy: string | null;
            tailorNumber: string | null;
        }> = [];

        for (const row of chunk) {
            const skuId = skuMap.get(row.skuCode)!;

            txnData.push({
                skuId,
                txnType: TXN_TYPE.INWARD,
                qty: row.qty,
                reason: mapSourceToReason(row.source),
                referenceId: row.referenceId,
                notes: row.notes,
                createdById: adminUserId,
                createdAt: row.date ?? new Date(),
                source: row.source || null,
                performedBy: row.extra || null,
                tailorNumber: row.tailor || null,
            });

            affectedSkuIds.add(skuId);
            ingestedRowIndices.push(row.rowIndex);
        }

        if (txnData.length > 0) {
            await prisma.inventoryTransaction.createMany({ data: txnData });
            result.inwardIngested += txnData.length;
        }
    }

    sheetsLogger.info({
        tab,
        ingested: ingestedRowIndices.length,
        skippedInvalid: invalidCount,
    }, 'Inward ingestion complete');

    // Delete only valid rows — invalid rows remain on sheet for ops team to fix
    if (ENABLE_SHEET_DELETION) {
        await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, validRows.map(r => r.rowIndex), result);
    }

    return affectedSkuIds;
}

// ============================================
// PHASE B: INGEST OUTWARD (LIVE)
// ============================================

async function ingestOutwardLive(
    result: IngestOutwardResult
): Promise<{ affectedSkuIds: Set<string>; linkableItems: LinkableOutward[]; orderMap: Map<string, { id: string; orderLines: Array<{ id: string; skuId: string; qty: number; lineStatus: string }> }> }> {
    const tab = LIVE_TABS.OUTWARD;
    const affectedSkuIds = new Set<string>();
    const linkableItems: LinkableOutward[] = [];

    sheetsLogger.info({ tab }, 'Reading outward live tab');

    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AE`);
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        return { affectedSkuIds, linkableItems, orderMap: new Map() };
    }

    const parsed: ParsedRow[] = [];
    const seenRefs = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const skuCode = String(row[OUTWARD_LIVE_COLS.SKU] ?? '').trim();
        const qty = parseQty(String(row[OUTWARD_LIVE_COLS.QTY] ?? ''));
        const orderNo = String(row[OUTWARD_LIVE_COLS.ORDER_NO] ?? '').trim();
        const courier = String(row[OUTWARD_LIVE_COLS.COURIER] ?? '').trim();
        const awb = String(row[OUTWARD_LIVE_COLS.AWB] ?? '').trim();

        const outwardDateStr = String(row[OUTWARD_LIVE_COLS.OUTWARD_DATE] ?? '');
        const orderDateStr = String(row[OUTWARD_LIVE_COLS.ORDER_DATE] ?? '');
        const dateStr = outwardDateStr.trim() || orderDateStr;

        const dest = orderNo ? 'Customer' : '';

        if (!skuCode || qty === 0) continue;

        let refId = buildReferenceId(REF_PREFIX.OUTWARD_LIVE, skuCode, qty, dateStr, orderNo || dest);
        if (seenRefs.has(refId)) {
            let counter = 2;
            while (seenRefs.has(`${refId}:${counter}`)) counter++;
            refId = `${refId}:${counter}`;
        }
        seenRefs.add(refId);

        parsed.push({
            rowIndex: i,
            skuCode,
            qty,
            date: parseSheetDate(outwardDateStr) ?? parseSheetDate(orderDateStr),
            source: dest,
            extra: orderNo,
            tailor: '',
            courier,
            awb,
            referenceId: refId,
            notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
        });
    }

    if (parsed.length === 0) {
        sheetsLogger.info({ tab }, 'No valid rows to ingest');
        return { affectedSkuIds, linkableItems, orderMap: new Map() };
    }

    const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
    const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));

    if (newRows.length === 0) {
        sheetsLogger.info({ tab, total: parsed.length }, 'All rows already ingested');
        if (ENABLE_SHEET_DELETION) {
            await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, parsed.map(r => r.rowIndex), result);
        }
        return { affectedSkuIds, linkableItems, orderMap: new Map() };
    }

    const skuMap = await bulkLookupSkus(newRows.map(r => r.skuCode));

    const { validRows, skipReasons, orderMap } = await validateOutwardRows(newRows, skuMap);
    const skippedCount = newRows.length - validRows.length;
    result.skipped += skippedCount;
    if (Object.keys(skipReasons).length > 0) {
        result.outwardSkipReasons = skipReasons;
        sheetsLogger.info({ tab, skipped: skippedCount, skipReasons }, 'Outward validation complete');
    }

    // Write Import Errors column for ALL parsed rows
    // Valid rows + duplicates get empty string, invalid rows get their skip reason
    const validRefIds = new Set(validRows.map(r => r.referenceId));
    const outwardImportErrors: Array<{ rowIndex: number; error: string }> = [];
    for (const row of parsed) {
        if (existingRefs.has(row.referenceId)) {
            // Already ingested (duplicate) — clear error
            outwardImportErrors.push({ rowIndex: row.rowIndex, error: '' });
        } else if (validRefIds.has(row.referenceId)) {
            // Valid row — clear error
            outwardImportErrors.push({ rowIndex: row.rowIndex, error: '' });
        } else {
            // Skipped — determine reason
            const skuId = skuMap.get(row.skuCode);
            let reason = 'unknown';
            if (!row.skuCode) reason = 'empty_sku';
            else if (row.qty <= 0) reason = 'zero_qty';
            else if (!skuId) reason = 'unknown_sku';
            else if (!row.date) reason = 'invalid_date';
            else if (row.extra) {
                const order = orderMap.get(row.extra);
                if (!order) reason = 'order_not_found';
                else if (!order.orderLines.some(l => l.skuId === skuId)) reason = 'order_line_not_found';
            }
            outwardImportErrors.push({ rowIndex: row.rowIndex, error: reason });
        }
    }
    await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, outwardImportErrors, 'AG');

    const adminUserId = await getAdminUserId();
    const ingestedRowIndices: number[] = [];

    for (let batch = 0; batch < validRows.length; batch += BATCH_SIZE) {
        const chunk = validRows.slice(batch, batch + BATCH_SIZE);
        const txnData: Array<{
            skuId: string;
            txnType: string;
            qty: number;
            reason: string;
            referenceId: string;
            notes: string;
            createdById: string;
            createdAt: Date;
            destination: string | null;
            orderNumber: string | null;
        }> = [];

        for (const row of chunk) {
            const skuId = skuMap.get(row.skuCode)!;

            txnData.push({
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty: row.qty,
                reason: row.extra
                    ? 'sale' as TxnReason
                    : mapDestinationToReason(row.source),
                referenceId: row.referenceId,
                notes: row.notes,
                createdById: adminUserId,
                createdAt: row.date!,
                destination: row.source || null,
                orderNumber: row.extra || null,
            });

            affectedSkuIds.add(skuId);
            ingestedRowIndices.push(row.rowIndex);

            if (row.extra) {
                linkableItems.push({
                    orderNumber: row.extra,
                    skuId,
                    qty: row.qty,
                    date: row.date,
                    courier: row.courier,
                    awb: row.awb,
                });
            }
        }

        if (txnData.length > 0) {
            await prisma.inventoryTransaction.createMany({ data: txnData });
            result.outwardIngested += txnData.length;
        }
    }

    sheetsLogger.info({ tab, ingested: ingestedRowIndices.length }, 'Outward ingestion complete');

    // Delete only ingested + already-deduped rows — invalid rows stay on sheet
    if (ENABLE_SHEET_DELETION) {
        const duplicateIndices = parsed.filter(r => existingRefs.has(r.referenceId)).map(r => r.rowIndex);
        const safeToDelete = [...ingestedRowIndices, ...duplicateIndices];
        await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, safeToDelete, result);
    }

    return { affectedSkuIds, linkableItems, orderMap };
}

// ============================================
// PHASE B2: LINK OUTWARD TO ORDER LINES
// ============================================

const LINKABLE_STATUSES = ['pending', 'allocated', 'picked', 'packed'];

async function linkOutwardToOrders(
    items: LinkableOutward[],
    result: IngestOutwardResult,
    preloadedOrderMap: Map<string, { id: string; orderLines: Array<{ id: string; skuId: string; qty: number; lineStatus: string }> }>
): Promise<void> {
    if (items.length === 0) return;

    const byOrder = new Map<string, LinkableOutward[]>();
    for (const item of items) {
        const existing = byOrder.get(item.orderNumber);
        if (existing) {
            existing.push(item);
        } else {
            byOrder.set(item.orderNumber, [item]);
        }
    }

    const orderNumbers = [...byOrder.keys()];
    sheetsLogger.info({ uniqueOrders: orderNumbers.length, totalItems: items.length }, 'Linking outward to orders');

    // Use pre-loaded orderMap from validation (avoids duplicate query)
    const orderMap = preloadedOrderMap;

    let linked = 0;
    let skippedAlreadyShipped = 0;
    let skippedNoOrder = 0;
    let skippedNoLine = 0;

    const updates: Array<{ lineId: string; data: Record<string, unknown> }> = [];

    for (const [orderNumber, outwardItems] of byOrder) {
        const order = orderMap.get(orderNumber);
        if (!order) {
            skippedNoOrder += outwardItems.length;
            continue;
        }

        const linesBySkuId = new Map<string, Array<typeof order.orderLines[0]>>();
        for (const line of order.orderLines) {
            const existing = linesBySkuId.get(line.skuId);
            if (existing) {
                existing.push(line);
            } else {
                linesBySkuId.set(line.skuId, [line]);
            }
        }

        for (const item of outwardItems) {
            const lines = linesBySkuId.get(item.skuId);
            if (!lines || lines.length === 0) {
                skippedNoLine++;
                continue;
            }

            const line = lines.find(l => LINKABLE_STATUSES.includes(l.lineStatus));
            if (!line) {
                skippedAlreadyShipped++;
                continue;
            }

            const updateData: Record<string, unknown> = {
                lineStatus: 'shipped',
                shippedAt: item.date ?? new Date(),
            };
            if (item.courier) updateData.courier = item.courier;
            if (item.awb) updateData.awbNumber = item.awb;

            updates.push({ lineId: line.id, data: updateData });
            line.lineStatus = 'shipped';
        }
    }

    if (updates.length > 0) {
        try {
            await prisma.$transaction(
                updates.map(u => prisma.orderLine.update({ where: { id: u.lineId }, data: u.data }))
            );
            linked = updates.length;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message, count: updates.length }, 'Batch order linking failed');
            result.errors += updates.length;
        }
    }

    result.ordersLinked = linked;

    sheetsLogger.info({
        linked,
        skippedAlreadyShipped,
        skippedNoOrder,
        skippedNoLine,
    }, 'Order linking complete');
}

// ============================================
// DELETE HELPER
// ============================================

async function deleteIngestedRows(
    spreadsheetId: string,
    tab: string,
    rowIndices: number[],
    result: DeleteTracker
): Promise<void> {
    if (rowIndices.length === 0) return;

    try {
        const sheetId = await getSheetId(spreadsheetId, tab);
        await deleteRowsBatch(spreadsheetId, sheetId, rowIndices);
        result.rowsDeleted += rowIndices.length;
        sheetsLogger.info({ tab, deleted: rowIndices.length }, 'Deleted ingested rows');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ tab, error: message }, 'Failed to delete rows');
        result.errors++;
    }
}

// ============================================
// PHASE C: UPDATE ERP BALANCE ON SHEETS
// ============================================

function groupIntoRanges(
    updates: Array<{ row: number; value: number }>
): Array<{ startRow: number; values: number[][] }> {
    const ranges: Array<{ startRow: number; values: number[][] }> = [];
    let current: { startRow: number; values: number[][] } | null = null;

    for (const { row, value } of updates) {
        if (current && row === current.startRow + current.values.length) {
            current.values.push([value]);
        } else {
            if (current) ranges.push(current);
            current = { startRow: row, values: [[value]] };
        }
    }
    if (current) ranges.push(current);
    return ranges;
}

async function updateSheetBalances(
    affectedSkuIds: Set<string>,
    errorTracker: { errors: number; skusUpdated: number }
): Promise<void> {
    if (affectedSkuIds.size === 0) {
        sheetsLogger.info('No affected SKUs — skipping balance update');
        return;
    }

    sheetsLogger.info({ affectedSkus: affectedSkuIds.size }, 'Updating sheet balances');

    // Wait for DB triggers to update currentBalance after createMany
    await new Promise(resolve => setTimeout(resolve, 5000));

    const skus = await prisma.sku.findMany({
        where: { id: { in: [...affectedSkuIds] } },
        select: { id: true, skuCode: true, currentBalance: true },
    });

    const balanceByCode = new Map<string, number>();
    for (const sku of skus) {
        balanceByCode.set(sku.skuCode, sku.currentBalance);
    }

    let totalUpdated = 0;

    // --- Target 1: Inventory tab col R (Mastersheet) ---
    try {
        const inventoryRows = await readRange(
            ORDERS_MASTERSHEET_ID,
            `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.SKU_COL}:${INVENTORY_TAB.SKU_COL}`
        );

        const dataStart = INVENTORY_TAB.DATA_START_ROW - 1;
        const updates: Array<{ row: number; value: number }> = [];

        for (let i = dataStart; i < inventoryRows.length; i++) {
            const skuCode = String(inventoryRows[i]?.[0] ?? '').trim();
            if (skuCode && balanceByCode.has(skuCode)) {
                updates.push({ row: i + 1, value: balanceByCode.get(skuCode)! });
            }
        }

        if (updates.length > 0) {
            const ranges = groupIntoRanges(updates);
            for (const range of ranges) {
                const rangeStr = `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.ERP_BALANCE_COL}${range.startRow}:${INVENTORY_TAB.ERP_BALANCE_COL}${range.startRow + range.values.length - 1}`;
                await writeRange(ORDERS_MASTERSHEET_ID, rangeStr, range.values);
            }
            totalUpdated = updates.length;
            sheetsLogger.info({ updated: updates.length, ranges: ranges.length }, 'Inventory col R updated');
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'Failed to update Inventory col R');
        errorTracker.errors++;
    }

    // --- Target 2: Balance (Final) col F (Office Ledger) ---
    try {
        const balanceRows = await readRange(
            OFFICE_LEDGER_ID,
            `'${LEDGER_TABS.BALANCE_FINAL}'!A:A`
        );

        if (balanceRows.length > 2) {
            const updates: Array<{ row: number; value: number }> = [];
            for (let i = 2; i < balanceRows.length; i++) {
                const skuCode = String(balanceRows[i]?.[0] ?? '').trim();
                if (skuCode && balanceByCode.has(skuCode)) {
                    updates.push({ row: i + 1, value: balanceByCode.get(skuCode)! });
                }
            }

            if (updates.length > 0) {
                const ranges = groupIntoRanges(updates);
                for (const range of ranges) {
                    const rangeStr = `'${LEDGER_TABS.BALANCE_FINAL}'!F${range.startRow}:F${range.startRow + range.values.length - 1}`;
                    await writeRange(OFFICE_LEDGER_ID, rangeStr, range.values);
                }
                sheetsLogger.info({ updated: updates.length }, 'Balance (Final) col F updated');
            }
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'Failed to update Balance (Final) col F');
        errorTracker.errors++;
    }

    errorTracker.skusUpdated = totalUpdated;
}

// ============================================
// PHASE D: INVALIDATE CACHES
// ============================================

function invalidateCaches(): void {
    inventoryBalanceCache.invalidateAll();
    broadcastOrderUpdate({ type: 'inventory_updated' });
    sheetsLogger.info('Caches invalidated and SSE broadcast sent');
}

// ============================================
// RECENT RUN TRACKING
// ============================================

function pushRecentRun(state: JobState<unknown>, summary: RunSummary): void {
    state.recentRuns.unshift(summary);
    if (state.recentRuns.length > MAX_RECENT_RUNS) {
        state.recentRuns.length = MAX_RECENT_RUNS;
    }
}

// ============================================
// JOB 1: TRIGGER INGEST INWARD
// ============================================

async function triggerIngestInward(): Promise<IngestInwardResult | null> {
    if (ingestInwardState.isRunning) {
        sheetsLogger.debug('Ingest inward already in progress, skipping');
        return null;
    }

    ingestInwardState.isRunning = true;
    const startTime = Date.now();

    const result: IngestInwardResult = {
        startedAt: new Date().toISOString(),
        inwardIngested: 0,
        skipped: 0,
        rowsDeleted: 0,
        skusUpdated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
        inwardValidationErrors: {},
    };

    try {
        sheetsLogger.info({ deletionEnabled: ENABLE_SHEET_DELETION }, 'Starting ingest inward');

        const affectedSkuIds = await ingestInwardLive(result);

        // Balance update + cache invalidation if anything was ingested
        if (affectedSkuIds.size > 0) {
            await updateSheetBalances(affectedSkuIds, result);
        }
        if (result.inwardIngested > 0) {
            invalidateCaches();
        }

        result.durationMs = Date.now() - startTime;
        ingestInwardState.lastRunAt = new Date();
        ingestInwardState.lastResult = result;
        pushRecentRun(ingestInwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.inwardIngested,
            error: result.error,
        });

        sheetsLogger.info({
            durationMs: result.durationMs,
            inwardIngested: result.inwardIngested,
            skipped: result.skipped,
            skusUpdated: result.skusUpdated,
        }, 'Ingest inward completed');

        return result;
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message, stack: err.stack }, 'Ingest inward failed');
        result.error = err.message;
        result.durationMs = Date.now() - startTime;
        ingestInwardState.lastResult = result;
        pushRecentRun(ingestInwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.inwardIngested,
            error: result.error,
        });
        return result;
    } finally {
        ingestInwardState.isRunning = false;
    }
}

// ============================================
// JOB 1B: PREVIEW INGEST INWARD (DRY-RUN)
// ============================================

async function previewIngestInward(): Promise<IngestPreviewResult | null> {
    if (ingestInwardState.isRunning) {
        sheetsLogger.debug('Ingest inward already in progress, skipping preview');
        return null;
    }

    ingestInwardState.isRunning = true;
    const startTime = Date.now();

    try {
        const tab = LIVE_TABS.INWARD;
        sheetsLogger.info({ tab }, 'Preview: reading inward live tab');

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:I`);
        if (rows.length <= 1) {
            return { tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0, validationErrors: {}, affectedSkuCodes: [], durationMs: Date.now() - startTime };
        }

        // Parse
        const parsed: ParsedRow[] = [];
        const seenRefs = new Set<string>();
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const skuCode = String(row[INWARD_LIVE_COLS.SKU] ?? '').trim();
            if (!skuCode) continue;

            const qty = parseQty(String(row[INWARD_LIVE_COLS.QTY] ?? ''));
            const dateStr = String(row[INWARD_LIVE_COLS.DATE] ?? '');
            const source = String(row[INWARD_LIVE_COLS.SOURCE] ?? '').trim();
            const doneBy = String(row[INWARD_LIVE_COLS.DONE_BY] ?? '').trim();
            const tailor = String(row[INWARD_LIVE_COLS.TAILOR] ?? '').trim();

            let refId = buildReferenceId(REF_PREFIX.INWARD_LIVE, skuCode, qty, dateStr, source);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            parsed.push({
                rowIndex: i, skuCode, qty, date: parseSheetDate(dateStr),
                source, extra: doneBy, tailor, courier: '', awb: '',
                referenceId: refId, notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
            });
        }

        if (parsed.length === 0) {
            return { tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0, validationErrors: {}, affectedSkuCodes: [], durationMs: Date.now() - startTime };
        }

        // Validate
        const skuMap = await bulkLookupSkus(parsed.map(r => r.skuCode));
        const validRows: ParsedRow[] = [];
        const validationErrors: Record<string, number> = {};
        const importErrors: Array<{ rowIndex: number; error: string }> = [];

        for (const p of parsed) {
            const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap);
            if (reasons.length === 0) {
                validRows.push(p);
                importErrors.push({ rowIndex: p.rowIndex, error: '' });
            } else {
                importErrors.push({ rowIndex: p.rowIndex, error: reasons.join('; ') });
                for (const reason of reasons) {
                    validationErrors[reason] = (validationErrors[reason] ?? 0) + 1;
                }
            }
        }

        // Write import errors to sheet (even in preview mode)
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, importErrors, 'J');

        // Dedup
        const existingRefs = await findExistingReferenceIds(validRows.map(r => r.referenceId));
        const newRows = validRows.filter(r => !existingRefs.has(r.referenceId));
        const duplicates = validRows.length - newRows.length;

        const affectedSkuCodes = [...new Set(newRows.map(r => r.skuCode))];

        sheetsLogger.info({
            tab, total: parsed.length, valid: validRows.length,
            invalid: parsed.length - validRows.length, duplicates, new: newRows.length,
        }, 'Preview inward complete');

        return {
            tab,
            totalRows: parsed.length,
            valid: newRows.length,
            invalid: parsed.length - validRows.length,
            duplicates,
            validationErrors,
            affectedSkuCodes,
            durationMs: Date.now() - startTime,
        };
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message }, 'Preview ingest inward failed');
        throw err;
    } finally {
        ingestInwardState.isRunning = false;
    }
}

// ============================================
// JOB 2: TRIGGER INGEST OUTWARD
// ============================================

async function triggerIngestOutward(): Promise<IngestOutwardResult | null> {
    if (ingestOutwardState.isRunning) {
        sheetsLogger.debug('Ingest outward already in progress, skipping');
        return null;
    }

    ingestOutwardState.isRunning = true;
    const startTime = Date.now();

    const result: IngestOutwardResult = {
        startedAt: new Date().toISOString(),
        outwardIngested: 0,
        ordersLinked: 0,
        skipped: 0,
        rowsDeleted: 0,
        skusUpdated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
    };

    try {
        sheetsLogger.info({ deletionEnabled: ENABLE_SHEET_DELETION }, 'Starting ingest outward');

        const { affectedSkuIds, linkableItems, orderMap } = await ingestOutwardLive(result);

        // Link outward to order lines
        if (linkableItems.length > 0) {
            await linkOutwardToOrders(linkableItems, result, orderMap);
        }

        // Balance update + cache invalidation if anything was ingested
        if (affectedSkuIds.size > 0) {
            await updateSheetBalances(affectedSkuIds, result);
        }
        if (result.outwardIngested > 0) {
            invalidateCaches();
        }

        result.durationMs = Date.now() - startTime;
        ingestOutwardState.lastRunAt = new Date();
        ingestOutwardState.lastResult = result;
        pushRecentRun(ingestOutwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.outwardIngested,
            error: result.error,
        });

        sheetsLogger.info({
            durationMs: result.durationMs,
            outwardIngested: result.outwardIngested,
            ordersLinked: result.ordersLinked,
            skipped: result.skipped,
            skusUpdated: result.skusUpdated,
        }, 'Ingest outward completed');

        return result;
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message, stack: err.stack }, 'Ingest outward failed');
        result.error = err.message;
        result.durationMs = Date.now() - startTime;
        ingestOutwardState.lastResult = result;
        pushRecentRun(ingestOutwardState, {
            startedAt: result.startedAt,
            durationMs: result.durationMs,
            count: result.outwardIngested,
            error: result.error,
        });
        return result;
    } finally {
        ingestOutwardState.isRunning = false;
    }
}

// ============================================
// JOB 2B: PREVIEW INGEST OUTWARD (DRY-RUN)
// ============================================

async function previewIngestOutward(): Promise<IngestPreviewResult | null> {
    if (ingestOutwardState.isRunning) {
        sheetsLogger.debug('Ingest outward already in progress, skipping preview');
        return null;
    }

    ingestOutwardState.isRunning = true;
    const startTime = Date.now();

    try {
        const tab = LIVE_TABS.OUTWARD;
        sheetsLogger.info({ tab }, 'Preview: reading outward live tab');

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AE`);
        if (rows.length <= 1) {
            return { tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0, validationErrors: {}, affectedSkuCodes: [], durationMs: Date.now() - startTime };
        }

        // Parse
        const parsed: ParsedRow[] = [];
        const seenRefs = new Set<string>();
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const skuCode = String(row[OUTWARD_LIVE_COLS.SKU] ?? '').trim();
            const qty = parseQty(String(row[OUTWARD_LIVE_COLS.QTY] ?? ''));
            const orderNo = String(row[OUTWARD_LIVE_COLS.ORDER_NO] ?? '').trim();
            const courier = String(row[OUTWARD_LIVE_COLS.COURIER] ?? '').trim();
            const awb = String(row[OUTWARD_LIVE_COLS.AWB] ?? '').trim();
            const outwardDateStr = String(row[OUTWARD_LIVE_COLS.OUTWARD_DATE] ?? '');
            const orderDateStr = String(row[OUTWARD_LIVE_COLS.ORDER_DATE] ?? '');
            const dateStr = outwardDateStr.trim() || orderDateStr;
            const dest = orderNo ? 'Customer' : '';

            if (!skuCode || qty === 0) continue;

            let refId = buildReferenceId(REF_PREFIX.OUTWARD_LIVE, skuCode, qty, dateStr, orderNo || dest);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            parsed.push({
                rowIndex: i, skuCode, qty,
                date: parseSheetDate(outwardDateStr) ?? parseSheetDate(orderDateStr),
                source: dest, extra: orderNo, tailor: '', courier, awb,
                referenceId: refId, notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
            });
        }

        if (parsed.length === 0) {
            return { tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0, validationErrors: {}, affectedSkuCodes: [], durationMs: Date.now() - startTime };
        }

        // Dedup first (same order as ingestOutwardLive)
        const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
        const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));
        const duplicateCount = parsed.length - newRows.length;

        if (newRows.length === 0) {
            return { tab, totalRows: parsed.length, valid: 0, invalid: 0, duplicates: duplicateCount, validationErrors: {}, affectedSkuCodes: [], durationMs: Date.now() - startTime };
        }

        // Validate
        const skuMap = await bulkLookupSkus(newRows.map(r => r.skuCode));
        const { validRows, skipReasons, orderMap } = await validateOutwardRows(newRows, skuMap);

        // Write import errors (same logic as ingestOutwardLive)
        const validRefIds = new Set(validRows.map(r => r.referenceId));
        const outwardImportErrors: Array<{ rowIndex: number; error: string }> = [];
        for (const row of parsed) {
            if (existingRefs.has(row.referenceId)) {
                outwardImportErrors.push({ rowIndex: row.rowIndex, error: '' });
            } else if (validRefIds.has(row.referenceId)) {
                outwardImportErrors.push({ rowIndex: row.rowIndex, error: '' });
            } else {
                const skuId = skuMap.get(row.skuCode);
                let reason = 'unknown';
                if (!row.skuCode) reason = 'empty_sku';
                else if (row.qty <= 0) reason = 'zero_qty';
                else if (!skuId) reason = 'unknown_sku';
                else if (!row.date) reason = 'invalid_date';
                else if (row.extra) {
                    const order = orderMap.get(row.extra);
                    if (!order) reason = 'order_not_found';
                    else if (!order.orderLines.some(l => l.skuId === skuId)) reason = 'order_line_not_found';
                }
                outwardImportErrors.push({ rowIndex: row.rowIndex, error: reason });
            }
        }
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, outwardImportErrors, 'AG');

        const affectedSkuCodes = [...new Set(validRows.map(r => r.skuCode))];

        sheetsLogger.info({
            tab, total: parsed.length, valid: validRows.length,
            invalid: newRows.length - validRows.length, duplicates: duplicateCount,
        }, 'Preview outward complete');

        return {
            tab,
            totalRows: parsed.length,
            valid: validRows.length,
            invalid: newRows.length - validRows.length,
            duplicates: duplicateCount,
            validationErrors: {},
            skipReasons,
            affectedSkuCodes,
            durationMs: Date.now() - startTime,
        };
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message }, 'Preview ingest outward failed');
        throw err;
    } finally {
        ingestOutwardState.isRunning = false;
    }
}

// ============================================
// JOB 3: MOVE SHIPPED → OUTWARD (LIVE)
// ============================================

async function triggerMoveShipped(): Promise<MoveShippedResult | null> {
    if (moveShippedState.isRunning) {
        sheetsLogger.debug('Move shipped already in progress, skipping');
        return null;
    }

    moveShippedState.isRunning = true;
    const startTime = Date.now();
    const result: MoveShippedResult = {
        shippedRowsFound: 0,
        skippedRows: 0,
        skipReasons: {},
        rowsWrittenToOutward: 0,
        rowsVerified: 0,
        rowsDeletedFromOrders: 0,
        errors: [],
        durationMs: 0,
    };

    const addSkipReason = (reason: string) => {
        result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
        result.skippedRows++;
    };

    try {
        const tab = MASTERSHEET_TABS.ORDERS_FROM_COH;
        sheetsLogger.info({ tab }, 'Reading Orders from COH for shipped rows');

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AE`);
        if (rows.length <= 1) {
            sheetsLogger.info({ tab }, 'No data rows');
            result.durationMs = Date.now() - startTime;
            moveShippedState.lastRunAt = new Date();
            moveShippedState.lastResult = result;
            pushRecentRun(moveShippedState, {
                startedAt: new Date().toISOString(),
                durationMs: result.durationMs,
                count: 0,
                error: null,
            });
            return result;
        }

        const validRows: Array<{ rowIndex: number; row: string[]; uniqueId: string }> = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const shipped = String(row[ORDERS_FROM_COH_COLS.SHIPPED] ?? '').trim().toUpperCase();
            const outwardDone = String(row[ORDERS_FROM_COH_COLS.OUTWARD_DONE] ?? '').trim();

            if (shipped !== 'TRUE' || outwardDone === '1') continue;
            result.shippedRowsFound++;

            const sku = String(row[ORDERS_FROM_COH_COLS.SKU] ?? '').trim();
            const picked = String(row[ORDERS_FROM_COH_COLS.PICKED] ?? '').trim().toUpperCase();
            const packed = String(row[ORDERS_FROM_COH_COLS.PACKED] ?? '').trim().toUpperCase();
            const courier = String(row[ORDERS_FROM_COH_COLS.COURIER] ?? '').trim();
            const awb = String(row[ORDERS_FROM_COH_COLS.AWB] ?? '').trim();
            const awbScan = String(row[ORDERS_FROM_COH_COLS.AWB_SCAN] ?? '').trim();
            const orderNo = String(row[ORDERS_FROM_COH_COLS.ORDER_NO] ?? '').trim();

            if (!sku)                     { addSkipReason('missing SKU'); continue; }
            if (picked !== 'TRUE')        { addSkipReason('not Picked'); continue; }
            if (packed !== 'TRUE')        { addSkipReason('not Packed'); continue; }
            if (!courier)                 { addSkipReason('missing Courier'); continue; }
            if (!awb)                     { addSkipReason('missing AWB'); continue; }
            if (!awbScan)                 { addSkipReason('missing AWB Scan'); continue; }

            const qty = String(row[ORDERS_FROM_COH_COLS.QTY] ?? '').trim();
            const uniqueId = `${orderNo}${sku}${qty}`;
            validRows.push({ rowIndex: i, row, uniqueId });
        }

        if (validRows.length === 0) {
            sheetsLogger.info({
                tab,
                shippedRowsFound: result.shippedRowsFound,
                skippedRows: result.skippedRows,
                skipReasons: result.skipReasons,
            }, 'No valid rows to move after validation');
            result.durationMs = Date.now() - startTime;
            moveShippedState.lastRunAt = new Date();
            moveShippedState.lastResult = result;
            pushRecentRun(moveShippedState, {
                startedAt: new Date().toISOString(),
                durationMs: result.durationMs,
                count: 0,
                error: null,
            });
            return result;
        }

        sheetsLogger.info({
            tab,
            shippedRowsFound: result.shippedRowsFound,
            validRows: validRows.length,
            skippedRows: result.skippedRows,
            skipReasons: result.skipReasons,
        }, 'Validated shipped rows for move');

        // Build Outward rows: copy A-AD (30 cols) + AE=Outward Date + AF=Unique ID
        const today = new Date().toLocaleDateString('en-GB');
        const outwardRows: (string | number)[][] = [];

        for (const { row, uniqueId } of validRows) {
            const copiedRow: (string | number)[] = [];
            for (let c = 0; c < 30; c++) {
                copiedRow.push(row[c] ?? '');
            }
            copiedRow.push(today);
            copiedRow.push(uniqueId);
            outwardRows.push(copiedRow);
        }

        // Step 1: Write to Outward (Live)
        const outwardTab = LIVE_TABS.OUTWARD;
        await appendRows(
            ORDERS_MASTERSHEET_ID,
            `'${outwardTab}'!A:AF`,
            outwardRows
        );
        result.rowsWrittenToOutward = outwardRows.length;
        sheetsLogger.info({ tab: outwardTab, written: outwardRows.length }, 'Written shipped rows to Outward (Live)');

        // Step 2: Verify
        const outwardUidRows = await readRange(
            ORDERS_MASTERSHEET_ID,
            `'${outwardTab}'!AF:AF`
        );
        const outwardUids = new Set<string>();
        for (const uidRow of outwardUidRows) {
            const uid = String(uidRow[0] ?? '').trim();
            if (uid) outwardUids.add(uid);
        }

        const verifiedRows: typeof validRows = [];
        const unverifiedRows: typeof validRows = [];
        for (const vr of validRows) {
            if (outwardUids.has(vr.uniqueId)) {
                verifiedRows.push(vr);
            } else {
                unverifiedRows.push(vr);
            }
        }
        result.rowsVerified = verifiedRows.length;

        if (unverifiedRows.length > 0) {
            const sampleUids = unverifiedRows.slice(0, 5).map(r => r.uniqueId);
            const errMsg = `${unverifiedRows.length} rows written but NOT verified in Outward (Live) — will NOT delete. Sample UIDs: ${sampleUids.join(', ')}`;
            result.errors.push(errMsg);
            sheetsLogger.error({ unverified: unverifiedRows.length, sampleUids }, errMsg);
        }

        if (verifiedRows.length === 0) {
            sheetsLogger.warn('No rows verified — skipping delete and Outward Done marking');
            result.durationMs = Date.now() - startTime;
            moveShippedState.lastRunAt = new Date();
            moveShippedState.lastResult = result;
            pushRecentRun(moveShippedState, {
                startedAt: new Date().toISOString(),
                durationMs: result.durationMs,
                count: result.rowsWrittenToOutward,
                error: result.errors.length > 0 ? result.errors[0] : null,
            });
            return result;
        }

        sheetsLogger.info({ verified: verifiedRows.length, unverified: unverifiedRows.length }, 'Verification complete');

        // Step 3: Mark Outward Done = 1
        const adUpdates = verifiedRows
            .map(r => ({ row: r.rowIndex + 1, value: 1 }))
            .sort((a, b) => a.row - b.row);
        const adRanges = groupIntoRanges(adUpdates);
        for (const range of adRanges) {
            const rangeStr = `'${tab}'!AD${range.startRow}:AD${range.startRow + range.values.length - 1}`;
            await writeRange(ORDERS_MASTERSHEET_ID, rangeStr, range.values);
        }
        sheetsLogger.info({ marked: verifiedRows.length, apiCalls: adRanges.length }, 'Marked Outward Done on verified source rows');

        // Step 4: Delete verified source rows
        try {
            const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, tab);
            const rowIndices = verifiedRows.map(r => r.rowIndex);
            await deleteRowsBatch(ORDERS_MASTERSHEET_ID, sheetId, rowIndices);
            result.rowsDeletedFromOrders = rowIndices.length;
            sheetsLogger.info({ tab, deleted: rowIndices.length }, 'Deleted verified rows from Orders from COH');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Delete from Orders failed: ${message}`);
            sheetsLogger.error({ tab, error: message }, 'Failed to delete shipped rows from Orders from COH');
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(message);
        sheetsLogger.error({ error: message }, 'triggerMoveShipped failed');
    }

    result.durationMs = Date.now() - startTime;
    moveShippedState.lastRunAt = new Date();
    moveShippedState.lastResult = result;
    pushRecentRun(moveShippedState, {
        startedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        count: result.rowsWrittenToOutward,
        error: result.errors.length > 0 ? result.errors[0] : null,
    });

    sheetsLogger.info({
        shippedRowsFound: result.shippedRowsFound,
        skippedRows: result.skippedRows,
        rowsWrittenToOutward: result.rowsWrittenToOutward,
        rowsVerified: result.rowsVerified,
        rowsDeletedFromOrders: result.rowsDeletedFromOrders,
        errors: result.errors.length,
        durationMs: result.durationMs,
    }, 'triggerMoveShipped completed');

    return result;
}

// ============================================
// BUFFER ROW COUNTS (for admin UI)
// ============================================

async function getBufferCounts(): Promise<{ inward: number; outward: number }> {
    try {
        const [inwardRows, outwardRows] = await Promise.all([
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.INWARD}'!A:A`),
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.OUTWARD}'!A:A`),
        ]);

        const countNonEmpty = (rows: string[][]) =>
            rows.length <= 1 ? 0 : rows.slice(1).filter(r => r[0]?.trim()).length;

        return {
            inward: countNonEmpty(inwardRows),
            outward: countNonEmpty(outwardRows),
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'Failed to get buffer counts');
        return { inward: -1, outward: -1 };
    }
}

// ============================================
// PUBLIC API
// ============================================

function start(): void {
    if (!ENABLE_SHEET_OFFLOAD) {
        sheetsLogger.info('Sheet offload worker disabled (ENABLE_SHEET_OFFLOAD != true)');
        return;
    }

    if (schedulerActive) {
        sheetsLogger.debug('Offload scheduler already running');
        return;
    }

    schedulerActive = true;

    sheetsLogger.info({
        deletionEnabled: ENABLE_SHEET_DELETION,
    }, 'Sheet offload worker ready (manual trigger only)');
}

function stop(): void {
    schedulerActive = false;
    sheetsLogger.info('Sheet offload worker stopped');
}

function getStatus(): OffloadStatus {
    return {
        ingestInward: {
            isRunning: ingestInwardState.isRunning,
            lastRunAt: ingestInwardState.lastRunAt,
            lastResult: ingestInwardState.lastResult,
            recentRuns: [...ingestInwardState.recentRuns],
        },
        ingestOutward: {
            isRunning: ingestOutwardState.isRunning,
            lastRunAt: ingestOutwardState.lastRunAt,
            lastResult: ingestOutwardState.lastResult,
            recentRuns: [...ingestOutwardState.recentRuns],
        },
        moveShipped: {
            isRunning: moveShippedState.isRunning,
            lastRunAt: moveShippedState.lastRunAt,
            lastResult: moveShippedState.lastResult,
            recentRuns: [...moveShippedState.recentRuns],
        },
        schedulerActive,
    };
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerIngestInward,
    triggerIngestOutward,
    triggerMoveShipped,
    getBufferCounts,
    previewIngestInward,
    previewIngestOutward,
};

export type { IngestInwardResult, IngestOutwardResult, IngestPreviewResult, MoveShippedResult, OffloadStatus, RunSummary };
