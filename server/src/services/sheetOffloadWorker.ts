/**
 * Google Sheets Offload Worker — Phase 3
 *
 * Ingests entries from two live buffer tabs in the COH Orders Mastersheet:
 *   - "Inward (Live)"  → creates INWARD InventoryTransactions
 *   - "Outward (Live)" → creates OUTWARD InventoryTransactions
 *
 * After ingestion:
 *   - Deletes ingested rows from the buffer tabs (when ENABLE_SHEET_DELETION=true)
 *   - Writes updated ERP currentBalance to col F in Balance (Final)
 *   - Invalidates caches and broadcasts SSE
 *
 * The Balance (Final) formula is:
 *   =F{row} + SUMIF(Inward Live) - SUMIF(Outward Live)
 * Where col F = ERP currentBalance, updated after each ingestion cycle.
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
    deleteRowsBatch,
    getSheetId,
} from './googleSheetsClient.js';
import {
    ENABLE_SHEET_OFFLOAD,
    ENABLE_SHEET_DELETION,
    OFFICE_LEDGER_ID,
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    LEDGER_TABS,
    INVENTORY_TAB,
    INWARD_LIVE_COLS,
    OUTWARD_LIVE_COLS,
    INWARD_SOURCE_MAP,
    DEFAULT_INWARD_REASON,
    OUTWARD_DESTINATION_MAP,
    DEFAULT_OUTWARD_REASON,
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
    OFFLOAD_INTERVAL_MS,
    STARTUP_DELAY_MS,
    BATCH_SIZE,
} from '../config/sync/sheets.js';

// ============================================
// TYPES
// ============================================

interface OffloadResult {
    startedAt: string;
    inwardIngested: number;
    outwardIngested: number;
    rowsDeleted: number;
    skusUpdated: number;
    skipped: number;
    errors: number;
    durationMs: number;
    error: string | null;
    /** Row counts read from each tab */
    sheetRowCounts: Record<string, number>;
    /** Row counts actually ingested per tab */
    ingestedCounts: Record<string, number>;
}

interface RunSummary {
    startedAt: string;
    durationMs: number;
    inwardIngested: number;
    outwardIngested: number;
    error: string | null;
}

interface OffloadStatus {
    isRunning: boolean;
    schedulerActive: boolean;
    intervalMs: number;
    lastRunAt: Date | null;
    lastResult: OffloadResult | null;
    recentRuns: RunSummary[];
}

interface ParsedRow {
    rowIndex: number;       // 0-based index in the sheet (including header)
    skuCode: string;
    qty: number;
    date: Date | null;
    source: string;         // inward: source, outward: destination
    extra: string;          // inward: doneBy, outward: orderNumber
    tailor: string;         // inward only
    referenceId: string;
    notes: string;
}

// ============================================
// STATE
// ============================================

let syncInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let schedulerActive = false;
let isRunning = false;
let lastRunAt: Date | null = null;
let lastResult: OffloadResult | null = null;
const recentRuns: RunSummary[] = [];
const MAX_RECENT_RUNS = 10;

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

async function bulkLookupSkus(skuCodes: string[]): Promise<Map<string, string>> {
    if (skuCodes.length === 0) return new Map();
    const unique = [...new Set(skuCodes)];
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: unique } },
        select: { id: true, skuCode: true },
    });
    return new Map(skus.map(s => [s.skuCode, s.id]));
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
// PHASE A: INGEST INWARD (LIVE)
// ============================================

async function ingestInwardLive(result: OffloadResult): Promise<Set<string>> {
    const tab = LIVE_TABS.INWARD;
    const affectedSkuIds = new Set<string>();

    sheetsLogger.info({ tab }, 'Reading inward live tab');

    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:I`);
    result.sheetRowCounts[tab] = rows.length > 1 ? rows.length - 1 : 0;
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        return affectedSkuIds;
    }

    // Parse rows (skip header row 0)
    const parsed: ParsedRow[] = [];
    const seenRefs = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const skuCode = String(row[INWARD_LIVE_COLS.SKU] ?? '').trim();
        const qty = parseQty(String(row[INWARD_LIVE_COLS.QTY] ?? ''));
        const dateStr = String(row[INWARD_LIVE_COLS.DATE] ?? '');
        const source = String(row[INWARD_LIVE_COLS.SOURCE] ?? '').trim();
        const doneBy = String(row[INWARD_LIVE_COLS.DONE_BY] ?? '').trim();
        const tailor = String(row[INWARD_LIVE_COLS.TAILOR] ?? '').trim();

        if (!skuCode || qty === 0) continue;

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
            referenceId: refId,
            notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
        });
    }

    if (parsed.length === 0) {
        sheetsLogger.info({ tab }, 'No valid rows to ingest');
        return affectedSkuIds;
    }

    // Dedup against existing transactions
    const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
    const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));

    if (newRows.length === 0) {
        sheetsLogger.info({ tab, total: parsed.length }, 'All rows already ingested');
        // Still delete if enabled (rows were previously ingested but not deleted)
        if (ENABLE_SHEET_DELETION) {
            await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, parsed.map(r => r.rowIndex), result);
        }
        return affectedSkuIds;
    }

    const skuMap = await bulkLookupSkus(newRows.map(r => r.skuCode));
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
            const skuId = skuMap.get(row.skuCode);
            if (!skuId) {
                sheetsLogger.warn({ skuCode: row.skuCode, tab }, 'Unknown SKU — skipping');
                result.skipped++;
                continue;
            }

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

    result.ingestedCounts[tab] = ingestedRowIndices.length;
    sheetsLogger.info({ tab, ingested: ingestedRowIndices.length }, 'Inward ingestion complete');

    // Delete ALL parsed rows (including already-ingested duplicates)
    if (ENABLE_SHEET_DELETION) {
        await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, parsed.map(r => r.rowIndex), result);
    }

    return affectedSkuIds;
}

// ============================================
// PHASE B: INGEST OUTWARD (LIVE)
// ============================================

async function ingestOutwardLive(result: OffloadResult): Promise<Set<string>> {
    const tab = LIVE_TABS.OUTWARD;
    const affectedSkuIds = new Set<string>();

    sheetsLogger.info({ tab }, 'Reading outward live tab');

    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:M`);
    result.sheetRowCounts[tab] = rows.length > 1 ? rows.length - 1 : 0;
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        return affectedSkuIds;
    }

    const parsed: ParsedRow[] = [];
    const seenRefs = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const skuCode = String(row[OUTWARD_LIVE_COLS.SKU] ?? '').trim();
        const qty = parseQty(String(row[OUTWARD_LIVE_COLS.QTY] ?? ''));
        const dateStr = String(row[OUTWARD_LIVE_COLS.DATE] ?? '');
        const dest = String(row[OUTWARD_LIVE_COLS.DESTINATION] ?? '').trim();
        const orderNo = String(row[OUTWARD_LIVE_COLS.ORDER_NO] ?? '').trim();

        if (!skuCode || qty === 0) continue;

        let refId = buildReferenceId(REF_PREFIX.OUTWARD_LIVE, skuCode, qty, dateStr, dest || orderNo);
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
            source: dest,
            extra: orderNo,
            tailor: '',
            referenceId: refId,
            notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
        });
    }

    if (parsed.length === 0) {
        sheetsLogger.info({ tab }, 'No valid rows to ingest');
        return affectedSkuIds;
    }

    const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
    const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));

    if (newRows.length === 0) {
        sheetsLogger.info({ tab, total: parsed.length }, 'All rows already ingested');
        if (ENABLE_SHEET_DELETION) {
            await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, parsed.map(r => r.rowIndex), result);
        }
        return affectedSkuIds;
    }

    const skuMap = await bulkLookupSkus(newRows.map(r => r.skuCode));
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
            destination: string | null;
            orderNumber: string | null;
        }> = [];

        for (const row of chunk) {
            const skuId = skuMap.get(row.skuCode);
            if (!skuId) {
                sheetsLogger.warn({ skuCode: row.skuCode, tab }, 'Unknown SKU — skipping');
                result.skipped++;
                continue;
            }

            // If an order number is present, it's an order-linked outward → reason=sale.
            // Otherwise, use the destination mapping (e.g., Warehouse→adjustment, Customer→order_allocation).
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
                createdAt: row.date ?? new Date(),
                destination: row.source || null,
                orderNumber: row.extra || null,
            });

            affectedSkuIds.add(skuId);
            ingestedRowIndices.push(row.rowIndex);
        }

        if (txnData.length > 0) {
            await prisma.inventoryTransaction.createMany({ data: txnData });
            result.outwardIngested += txnData.length;
        }
    }

    result.ingestedCounts[tab] = ingestedRowIndices.length;
    sheetsLogger.info({ tab, ingested: ingestedRowIndices.length }, 'Outward ingestion complete');

    if (ENABLE_SHEET_DELETION) {
        await deleteIngestedRows(ORDERS_MASTERSHEET_ID, tab, parsed.map(r => r.rowIndex), result);
    }

    return affectedSkuIds;
}

// ============================================
// DELETE HELPER
// ============================================

async function deleteIngestedRows(
    spreadsheetId: string,
    tab: string,
    rowIndices: number[],
    result: OffloadResult
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

/**
 * Group contiguous (row, value) pairs into ranges for efficient batch writing.
 */
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

/**
 * Write ERP currentBalance to:
 *   1. Inventory tab col R (Mastersheet) — feeds col C formula in real-time
 *   2. Balance (Final) col F (Office Ledger) — backward compat
 */
async function updateSheetBalances(
    affectedSkuIds: Set<string>,
    result: OffloadResult
): Promise<void> {
    if (affectedSkuIds.size === 0) {
        sheetsLogger.info('No affected SKUs — skipping balance update');
        return;
    }

    sheetsLogger.info({ affectedSkus: affectedSkuIds.size }, 'Updating sheet balances');

    // Get currentBalance for affected SKUs
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

        const dataStart = INVENTORY_TAB.DATA_START_ROW - 1; // 0-indexed
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
        result.errors++;
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
        result.errors++;
    }

    result.skusUpdated = totalUpdated;
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
// MAIN SYNC FUNCTION
// ============================================

function pushRecentRun(result: OffloadResult): void {
    recentRuns.unshift({
        startedAt: result.startedAt,
        durationMs: result.durationMs,
        inwardIngested: result.inwardIngested,
        outwardIngested: result.outwardIngested,
        error: result.error,
    });
    if (recentRuns.length > MAX_RECENT_RUNS) {
        recentRuns.length = MAX_RECENT_RUNS;
    }
}

async function runOffloadSync(): Promise<OffloadResult | null> {
    if (isRunning) {
        sheetsLogger.debug('Offload sync already in progress, skipping');
        return null;
    }

    isRunning = true;
    const startTime = Date.now();

    const result: OffloadResult = {
        startedAt: new Date().toISOString(),
        inwardIngested: 0,
        outwardIngested: 0,
        rowsDeleted: 0,
        skusUpdated: 0,
        skipped: 0,
        errors: 0,
        durationMs: 0,
        error: null,
        sheetRowCounts: {},
        ingestedCounts: {},
    };

    try {
        sheetsLogger.info({ deletionEnabled: ENABLE_SHEET_DELETION }, 'Starting sheet offload sync');

        // Phase A: Ingest Inward (Live)
        const inwardSkuIds = await ingestInwardLive(result);

        // Phase B: Ingest Outward (Live)
        const outwardSkuIds = await ingestOutwardLive(result);

        // Phase C: Update sheet balances (Inventory col R + Balance (Final) col F)
        const allAffectedSkuIds = new Set([...inwardSkuIds, ...outwardSkuIds]);
        await updateSheetBalances(allAffectedSkuIds, result);

        // Phase D: Invalidate caches (only if something changed)
        if (result.inwardIngested > 0 || result.outwardIngested > 0) {
            invalidateCaches();
        }

        result.durationMs = Date.now() - startTime;
        lastRunAt = new Date();
        lastResult = result;
        pushRecentRun(result);

        sheetsLogger.info({
            durationMs: result.durationMs,
            inwardIngested: result.inwardIngested,
            outwardIngested: result.outwardIngested,
            rowsDeleted: result.rowsDeleted,
            skusUpdated: result.skusUpdated,
            skipped: result.skipped,
            errors: result.errors,
        }, 'Sheet offload sync completed');

        return result;
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message, stack: err.stack }, 'Sheet offload sync failed');
        result.error = err.message;
        result.durationMs = Date.now() - startTime;
        lastResult = result;
        pushRecentRun(result);
        return result;
    } finally {
        isRunning = false;
    }
}

// ============================================
// BUFFER ROW COUNTS (for admin UI)
// ============================================

/**
 * Get the number of pending rows in each live buffer tab.
 * Lightweight — just reads row counts, no data processing.
 */
async function getBufferCounts(): Promise<{ inward: number; outward: number }> {
    try {
        const [inwardRows, outwardRows] = await Promise.all([
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.INWARD}'!A:A`),
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.OUTWARD}'!A:A`),
        ]);

        // Count non-empty rows after header (guard against empty array)
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
        intervalMs: OFFLOAD_INTERVAL_MS,
        startupDelayMs: STARTUP_DELAY_MS,
        deletionEnabled: ENABLE_SHEET_DELETION,
    }, 'Starting sheet offload scheduler');

    // Run after startup delay, then start repeating interval
    startupTimeout = setTimeout(async () => {
        await runOffloadSync();
        if (schedulerActive && !syncInterval) {
            syncInterval = setInterval(runOffloadSync, OFFLOAD_INTERVAL_MS);
        }
    }, STARTUP_DELAY_MS);
}

function stop(): void {
    schedulerActive = false;
    if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
    }
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    sheetsLogger.info('Sheet offload scheduler stopped');
}

function getStatus(): OffloadStatus {
    return {
        isRunning,
        schedulerActive,
        intervalMs: OFFLOAD_INTERVAL_MS,
        lastRunAt,
        lastResult,
        recentRuns: [...recentRuns],
    };
}

async function triggerSync(): Promise<OffloadResult | null> {
    return runOffloadSync();
}

// ============================================
// EXPORTS
// ============================================

export default {
    start,
    stop,
    getStatus,
    triggerSync,
    getBufferCounts,
};

export type { OffloadResult, OffloadStatus, RunSummary };
