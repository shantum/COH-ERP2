/**
 * Google Sheets Offload Worker
 *
 * Periodically ingests old data from Google Sheets (inward/outward entries),
 * stores them as InventoryTransactions in the ERP, optionally deletes them
 * from the sheet, and writes back a "Past Balance" so sheet formulas stay fast.
 *
 * Follows trackingSync.ts pattern: module-level state, concurrency guard,
 * start/stop/getStatus/triggerSync exports.
 *
 * Feature-flagged: does nothing unless ENABLE_SHEET_OFFLOAD=true.
 */

import prisma from '../lib/prisma.js';
import { sheetsLogger } from '../utils/logger.js';
import { TXN_TYPE, TXN_REASON } from '../utils/patterns/types.js';
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
    LEDGER_TABS,
    MASTERSHEET_TABS,
    INWARD_COLS,
    OUTWARD_COLS,
    ORDERS_OUTWARD_COLS,
    ORDERS_OUTWARD_OLD_COLS,
    MASTERSHEET_OUTWARD_COLS,
    INWARD_SOURCE_MAP,
    DEFAULT_INWARD_REASON,
    OUTWARD_DESTINATION_MAP,
    DEFAULT_OUTWARD_REASON,
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
    OFFLOAD_INTERVAL_MS,
    OFFLOAD_AGE_DAYS,
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
    sheetRowCounts: Record<string, number>;
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

interface ParsedInwardRow {
    rowIndex: number;       // 0-based index in the sheet (including header)
    skuCode: string;
    qty: number;
    date: Date | null;
    source: string;
    doneBy: string;
    tailor: string;
    referenceId: string;
    notes: string;
}

interface ParsedOutwardRow {
    rowIndex: number;
    skuCode: string;
    qty: number;
    date: Date | null;
    destination: string;
    orderNumber: string;
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

/**
 * Get the admin user ID for createdById on system-generated transactions.
 * Cached after first lookup.
 */
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
 * Indian sheets use DD/MM/YYYY — try that FIRST to avoid ambiguity
 * (e.g., "01/02/2025" = Feb 1 in DD/MM, but Jan 2 in new Date()).
 * Returns null if unparseable.
 */
function parseSheetDate(value: string | undefined): Date | null {
    if (!value?.trim()) return null;

    const trimmed = value.trim();

    // Try DD/MM/YYYY first (Indian format — primary format in these sheets)
    const ddmmyyyy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        const d = new Date(Number(year), Number(month) - 1, Number(day));
        if (!isNaN(d.getTime())) return d;
    }

    // Fallback: ISO format "YYYY-MM-DD" (unambiguous)
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) return parsed;
    }

    return null;
}

/**
 * Check if a date is older than OFFLOAD_AGE_DAYS
 */
function isOldEnough(date: Date | null): boolean {
    if (!date) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - OFFLOAD_AGE_DAYS);
    return date < cutoff;
}

/**
 * Parse quantity string to positive integer. Returns 0 if invalid.
 */
function parseQty(value: string | undefined): number {
    if (!value?.trim()) return 0;
    const num = Math.round(Number(value.trim()));
    return num > 0 ? num : 0;
}

/**
 * Map inward source text to TXN_REASON
 */
function mapSourceToReason(source: string): TxnReason {
    const normalized = source.toLowerCase().trim();
    return INWARD_SOURCE_MAP[normalized] ?? DEFAULT_INWARD_REASON;
}

/**
 * Map outward destination text to TXN_REASON
 */
function mapDestinationToReason(destination: string): TxnReason {
    const normalized = destination.toLowerCase().trim();
    return OUTWARD_DESTINATION_MAP[normalized] ?? DEFAULT_OUTWARD_REASON;
}

/**
 * Build a content-based referenceId that's stable across row deletions.
 * Uses SKU + qty + date + source to create a unique key.
 * Row index is NOT used because it shifts when rows are deleted.
 */
function buildReferenceId(
    prefix: string,
    skuCode: string,
    qty: number,
    dateStr: string,
    extra: string = ''
): string {
    // Truncate and normalize for a reasonable key length
    const datePart = dateStr.replace(/[/\-.\s]/g, '').slice(0, 8) || 'nodate';
    const extraPart = extra ? `:${extra.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}` : '';
    return `${prefix}:${skuCode}:${qty}:${datePart}${extraPart}`;
}

/**
 * Look up SKU IDs by skuCode in bulk.
 * Returns a Map of skuCode → skuId.
 */
async function bulkLookupSkus(skuCodes: string[]): Promise<Map<string, string>> {
    if (skuCodes.length === 0) return new Map();

    const unique = [...new Set(skuCodes)];
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: unique } },
        select: { id: true, skuCode: true },
    });

    const map = new Map<string, string>();
    for (const sku of skus) {
        map.set(sku.skuCode, sku.id);
    }
    return map;
}

/**
 * Find referenceIds that already exist in the DB (to skip duplicates).
 * Chunked to avoid blowing up Prisma/PG with huge IN clauses (37K+ items).
 */
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
// PHASE A: INGEST OLD INWARD ENTRIES
// ============================================

async function ingestInward(result: OffloadResult): Promise<void> {
    for (const tabConfig of [
        { tab: LEDGER_TABS.INWARD_FINAL, prefix: REF_PREFIX.INWARD_FINAL },
        { tab: LEDGER_TABS.INWARD_ARCHIVE, prefix: REF_PREFIX.INWARD_ARCHIVE },
    ]) {
        sheetsLogger.info({ tab: tabConfig.tab }, 'Reading inward tab');

        const rows = await readRange(OFFICE_LEDGER_ID, `'${tabConfig.tab}'!A:H`);
        result.sheetRowCounts[tabConfig.tab] = rows.length;
        if (rows.length <= 1) {
            sheetsLogger.info({ tab: tabConfig.tab }, 'No data rows found');
            continue;
        }

        // Parse rows (skip header row 0)
        const parsed: ParsedInwardRow[] = [];
        const seenRefs = new Set<string>();

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const skuCode = row[INWARD_COLS.SKU]?.trim();
            const qty = parseQty(row[INWARD_COLS.QTY]);
            const dateStr = row[INWARD_COLS.DATE] ?? '';
            const date = parseSheetDate(dateStr);
            const source = row[INWARD_COLS.SOURCE] ?? '';
            const doneBy = String(row[INWARD_COLS.DONE_BY] ?? '').trim();
            const tailor = String(row[INWARD_COLS.TAILOR] ?? '').trim();

            if (!skuCode || qty === 0) continue;

            // For Inward (Final), only ingest rows older than OFFLOAD_AGE_DAYS
            // For Inward (Archive), ingest ALL rows (they're already old)
            if (tabConfig.tab === LEDGER_TABS.INWARD_FINAL && !isOldEnough(date)) {
                continue;
            }

            // Content-based referenceId (stable across row deletions)
            let refId = buildReferenceId(tabConfig.prefix, skuCode, qty, dateStr, source);
            // Handle duplicate content within same sheet (append counter)
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
                date,
                source,
                doneBy,
                tailor,
                referenceId: refId,
                notes: `${OFFLOAD_NOTES_PREFIX} ${tabConfig.tab}`,
            });
        }

        if (parsed.length === 0) {
            sheetsLogger.info({ tab: tabConfig.tab }, 'No eligible rows to ingest');
            continue;
        }

        // Check for duplicates
        const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
        const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));

        if (newRows.length === 0) {
            sheetsLogger.info({ tab: tabConfig.tab, total: parsed.length }, 'All rows already ingested');
            continue;
        }

        // Bulk SKU lookup
        const skuMap = await bulkLookupSkus(newRows.map(r => r.skuCode));
        const adminUserId = await getAdminUserId();

        // Process in batches
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
                    sheetsLogger.warn({ skuCode: row.skuCode, tab: tabConfig.tab, rowIndex: row.rowIndex }, 'Unknown SKU — skipping');
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
                    performedBy: row.doneBy || null,
                    tailorNumber: row.tailor || null,
                });

                ingestedRowIndices.push(row.rowIndex);
            }

            if (txnData.length > 0) {
                await prisma.inventoryTransaction.createMany({ data: txnData });
                result.inwardIngested += txnData.length;
            }
        }

        result.ingestedCounts[tabConfig.tab] = ingestedRowIndices.length;

        sheetsLogger.info({
            tab: tabConfig.tab,
            ingested: ingestedRowIndices.length,
            skipped: parsed.length - newRows.length,
        }, 'Inward ingestion complete');

        // Collect rows for deletion (if enabled)
        if (ENABLE_SHEET_DELETION && ingestedRowIndices.length > 0) {
            try {
                const sheetId = await getSheetId(OFFICE_LEDGER_ID, tabConfig.tab);
                await deleteRowsBatch(OFFICE_LEDGER_ID, sheetId, ingestedRowIndices);
                result.rowsDeleted += ingestedRowIndices.length;
                sheetsLogger.info({
                    tab: tabConfig.tab,
                    deleted: ingestedRowIndices.length,
                }, 'Deleted ingested rows from sheet');
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                sheetsLogger.error({ tab: tabConfig.tab, error: message }, 'Failed to delete rows from sheet');
                result.errors++;
            }
        }
    }
}

// ============================================
// PHASE B: INGEST OLD OUTWARD ENTRIES
// ============================================

async function ingestOutward(result: OffloadResult): Promise<void> {
    // --- Outward tab (has dates — filter by age) ---
    {
        const tab = LEDGER_TABS.OUTWARD;
        sheetsLogger.info({ tab }, 'Reading outward tab');

        const rows = await readRange(OFFICE_LEDGER_ID, `'${tab}'!A:F`);
        result.sheetRowCounts[tab] = rows.length;
        if (rows.length <= 1) {
            sheetsLogger.info({ tab }, 'No data rows found');
        } else {
            const parsed: ParsedOutwardRow[] = [];
            const seenRefs = new Set<string>();

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const skuCode = row[OUTWARD_COLS.SKU]?.trim();
                const qty = parseQty(row[OUTWARD_COLS.QTY]);
                const dateStr = row[OUTWARD_COLS.DATE] ?? '';
                const date = parseSheetDate(dateStr);
                const dest = row[OUTWARD_COLS.DESTINATION] ?? '';

                if (!skuCode || qty === 0) continue;
                if (!isOldEnough(date)) continue;

                let refId = buildReferenceId(REF_PREFIX.OUTWARD, skuCode, qty, dateStr, dest);
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
                    date,
                    destination: dest,
                    orderNumber: '',
                    referenceId: refId,
                    notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
                });
            }

            await ingestOutwardBatch(parsed, tab, result);
        }
    }

    // --- Mastersheet Outward (individual order lines — replaces OL Orders Outward) ---
    {
        const tab = MASTERSHEET_TABS.OUTWARD;
        sheetsLogger.info({ tab, spreadsheet: 'Mastersheet' }, 'Reading mastersheet outward');

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:I`);
        result.sheetRowCounts[`Mastersheet ${tab}`] = rows.length;

        if (rows.length <= 1) {
            sheetsLogger.info({ tab }, 'No data rows found');
        } else {
            const parsed: ParsedOutwardRow[] = [];
            const seenRefs = new Set<string>();

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const skuCode = String(row[MASTERSHEET_OUTWARD_COLS.SKU] ?? '').trim();
                const qty = parseQty(String(row[MASTERSHEET_OUTWARD_COLS.QTY] ?? ''));
                const dateStr = String(row[MASTERSHEET_OUTWARD_COLS.DATE] ?? '');
                const date = parseSheetDate(dateStr);
                const orderNo = String(row[MASTERSHEET_OUTWARD_COLS.ORDER_NO] ?? '').trim();

                if (!skuCode || qty === 0) continue;
                if (!isOldEnough(date)) continue;

                let refId = buildReferenceId(
                    REF_PREFIX.MASTERSHEET_OUTWARD, skuCode, qty, dateStr, orderNo
                );
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
                    date,
                    destination: '',
                    orderNumber: orderNo,
                    referenceId: refId,
                    notes: `${OFFLOAD_NOTES_PREFIX} Mastersheet ${tab}`,
                });
            }

            await ingestOutwardBatch(parsed, `Mastersheet ${tab}`, result);
        }
    }

    // --- Orders Outward tab (no dates — ingest ALL) ---
    {
        const tab = LEDGER_TABS.ORDERS_OUTWARD;
        sheetsLogger.info({ tab }, 'Reading orders outward tab');

        const rows = await readRange(OFFICE_LEDGER_ID, `'${tab}'!A:B`);
        result.sheetRowCounts[tab] = rows.length;
        const parsed: ParsedOutwardRow[] = [];
        const seenRefs = new Set<string>();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const skuCode = row[ORDERS_OUTWARD_COLS.SKU]?.trim();
            const qty = parseQty(row[ORDERS_OUTWARD_COLS.QTY]);

            if (!skuCode || qty === 0) continue;

            let refId = buildReferenceId(REF_PREFIX.ORDERS_OUTWARD, skuCode, qty, '');
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
                date: null,
                destination: '',
                orderNumber: '',
                referenceId: refId,
                notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
            });
        }

        await ingestOutwardBatch(parsed, tab, result);
    }

    // --- Orders Outward 12728-41874 tab (no dates — ingest ALL, cols N+O) ---
    {
        const tab = LEDGER_TABS.ORDERS_OUTWARD_OLD;
        sheetsLogger.info({ tab }, 'Reading old orders outward tab');

        // Read cols A through O (index 0-14) to capture N and O
        const rows = await readRange(OFFICE_LEDGER_ID, `'${tab}'!A:O`);
        result.sheetRowCounts[tab] = rows.length;
        const parsed: ParsedOutwardRow[] = [];
        const seenRefs = new Set<string>();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const skuCode = row[ORDERS_OUTWARD_OLD_COLS.SKU]?.trim();
            const qty = parseQty(row[ORDERS_OUTWARD_OLD_COLS.QTY]);

            if (!skuCode || qty === 0) continue;

            let refId = buildReferenceId(REF_PREFIX.ORDERS_OUTWARD_OLD, skuCode, qty, '');
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
                date: null,
                destination: '',
                orderNumber: '',
                referenceId: refId,
                notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
            });
        }

        await ingestOutwardBatch(parsed, tab, result);
    }
}

/**
 * Shared logic for ingesting outward rows from any tab
 */
async function ingestOutwardBatch(
    parsed: ParsedOutwardRow[],
    tab: string,
    result: OffloadResult
): Promise<void> {
    if (parsed.length === 0) {
        sheetsLogger.info({ tab }, 'No eligible rows to ingest');
        return;
    }

    // Check for duplicates
    const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
    const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));

    if (newRows.length === 0) {
        sheetsLogger.info({ tab, total: parsed.length }, 'All rows already ingested');
        return;
    }

    // Bulk SKU lookup
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
                sheetsLogger.warn({ skuCode: row.skuCode, tab, rowIndex: row.rowIndex }, 'Unknown SKU — skipping');
                result.skipped++;
                continue;
            }

            txnData.push({
                skuId,
                txnType: TXN_TYPE.OUTWARD,
                qty: row.qty,
                reason: row.orderNumber
                    ? TXN_REASON.SALE
                    : mapDestinationToReason(row.destination),
                referenceId: row.referenceId,
                notes: row.notes,
                createdById: adminUserId,
                createdAt: row.date ?? new Date(),
                destination: row.destination || null,
                orderNumber: row.orderNumber || null,
            });

            ingestedRowIndices.push(row.rowIndex);
        }

        if (txnData.length > 0) {
            await prisma.inventoryTransaction.createMany({ data: txnData });
            result.outwardIngested += txnData.length;
        }
    }

    result.ingestedCounts[tab] = ingestedRowIndices.length;

    sheetsLogger.info({
        tab,
        ingested: ingestedRowIndices.length,
        skipped: parsed.length - newRows.length,
    }, 'Outward ingestion complete');

    // Delete ingested rows if enabled
    if (ENABLE_SHEET_DELETION && ingestedRowIndices.length > 0) {
        try {
            const sheetId = await getSheetId(OFFICE_LEDGER_ID, tab);
            await deleteRowsBatch(OFFICE_LEDGER_ID, sheetId, ingestedRowIndices);
            result.rowsDeleted += ingestedRowIndices.length;
            sheetsLogger.info({ tab, deleted: ingestedRowIndices.length }, 'Deleted ingested rows from sheet');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ tab, error: message }, 'Failed to delete rows from sheet');
            result.errors++;
        }
    }
}

// ============================================
// PHASE C: UPDATE PAST BALANCE
// ============================================

async function updatePastBalance(result: OffloadResult): Promise<void> {
    sheetsLogger.info('Calculating past balances from ingested data');

    // Query: sum all sheet-offload transactions grouped by SKU
    // Past balance = SUM(inward qty) - SUM(outward qty)
    const inwardSums = await prisma.inventoryTransaction.groupBy({
        by: ['skuId'],
        where: {
            notes: { startsWith: OFFLOAD_NOTES_PREFIX },
            txnType: TXN_TYPE.INWARD,
        },
        _sum: { qty: true },
    });

    const outwardSums = await prisma.inventoryTransaction.groupBy({
        by: ['skuId'],
        where: {
            notes: { startsWith: OFFLOAD_NOTES_PREFIX },
            txnType: TXN_TYPE.OUTWARD,
        },
        _sum: { qty: true },
    });

    // Build past balance map: skuId → balance
    const balanceBySkuId = new Map<string, number>();
    for (const row of inwardSums) {
        balanceBySkuId.set(row.skuId, row._sum.qty ?? 0);
    }
    for (const row of outwardSums) {
        const current = balanceBySkuId.get(row.skuId) ?? 0;
        balanceBySkuId.set(row.skuId, current - (row._sum.qty ?? 0));
    }

    if (balanceBySkuId.size === 0) {
        sheetsLogger.info('No past balances to write');
        return;
    }

    // Get skuCode for each skuId
    const skuIds = [...balanceBySkuId.keys()];
    const skus = await prisma.sku.findMany({
        where: { id: { in: skuIds } },
        select: { id: true, skuCode: true },
    });
    const skuCodeMap = new Map(skus.map(s => [s.id, s.skuCode]));

    // Build skuCode → pastBalance
    const pastBalanceByCode = new Map<string, number>();
    for (const [skuId, balance] of balanceBySkuId) {
        const code = skuCodeMap.get(skuId);
        if (code) pastBalanceByCode.set(code, balance);
    }

    // Read Balance (Final) tab — col A has SKU codes
    const balanceRows = await readRange(
        OFFICE_LEDGER_ID,
        `'${LEDGER_TABS.BALANCE_FINAL}'!A:A`
    );

    if (balanceRows.length <= 2) {
        sheetsLogger.warn('Balance (Final) tab has no data rows');
        return;
    }

    // Build col F values (row 1 = header row, row 2 = subheader/labels, data starts row 3)
    // We write to col F starting from row 3
    const colFValues: (string | number)[][] = [];
    let updated = 0;

    for (let i = 2; i < balanceRows.length; i++) {
        const skuCode = balanceRows[i][0]?.trim();
        if (!skuCode) {
            colFValues.push([0]);
            continue;
        }

        const pastBalance = pastBalanceByCode.get(skuCode) ?? 0;
        colFValues.push([pastBalance]);
        if (pastBalance !== 0) updated++;
    }

    // Write col F (ERP Past Balance)
    if (colFValues.length > 0) {
        await writeRange(
            OFFICE_LEDGER_ID,
            `'${LEDGER_TABS.BALANCE_FINAL}'!F3:F${2 + colFValues.length}`,
            colFValues
        );
        result.skusUpdated = updated;
        sheetsLogger.info({ skusUpdated: updated, totalRows: colFValues.length }, 'Past balance written to sheet');
    }
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

        // Phase A: Ingest old inward entries
        await ingestInward(result);

        // Phase B: Ingest old outward entries
        await ingestOutward(result);

        // Phase C: Update past balance on sheet
        await updatePastBalance(result);

        // Phase D: Invalidate caches
        invalidateCaches();

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
// PUBLIC API
// ============================================

/**
 * Start the scheduled offload worker.
 * Does nothing if ENABLE_SHEET_OFFLOAD is false.
 */
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
        offloadAgeDays: OFFLOAD_AGE_DAYS,
    }, 'Starting sheet offload scheduler');

    // Run after startup delay, then start repeating interval
    startupTimeout = setTimeout(async () => {
        await runOffloadSync();
        // Start repeating interval after first run completes
        if (schedulerActive && !syncInterval) {
            syncInterval = setInterval(runOffloadSync, OFFLOAD_INTERVAL_MS);
        }
    }, STARTUP_DELAY_MS);
}

/**
 * Stop the scheduled offload worker
 */
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

/**
 * Get current worker status
 */
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

/**
 * Manually trigger an offload sync
 */
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
};

export type { OffloadResult, OffloadStatus, RunSummary };
