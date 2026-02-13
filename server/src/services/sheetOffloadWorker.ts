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
import { trackWorkerRun } from '../utils/workerRunTracker.js';
import { TXN_TYPE, FABRIC_TXN_TYPE } from '../utils/patterns/types.js';
import type { TxnReason } from '../utils/patterns/types.js';
import { inventoryBalanceCache } from './inventoryBalanceCache.js';
import { broadcastOrderUpdate } from '../routes/sse.js';
import {
    readRange,
    writeRange,
    batchWriteRanges,
    appendRows,
    deleteRowsBatch,
    getSheetId,
} from './googleSheetsClient.js';
import {
    ENABLE_SHEET_OFFLOAD,
    OFFICE_LEDGER_ID,
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    MASTERSHEET_TABS,
    LEDGER_TABS,
    INVENTORY_TAB,
    INWARD_LIVE_COLS,
    OUTWARD_LIVE_COLS,
    ORDERS_FROM_COH_COLS,
    FABRIC_INWARD_LIVE_COLS,
    INWARD_SOURCE_MAP,
    VALID_INWARD_LIVE_SOURCES,
    FABRIC_DEDUCT_SOURCES,
    DEFAULT_INWARD_REASON,
    OUTWARD_DESTINATION_MAP,
    DEFAULT_OUTWARD_REASON,
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
    BATCH_SIZE,
    INGESTED_PREFIX,
    CLEANUP_RETENTION_DAYS,
    INVENTORY_BALANCE_FORMULA_TEMPLATE,
    LIVE_BALANCE_FORMULA_V2_TEMPLATE,
    FABRIC_BALANCES_HEADERS,
    FABRIC_BALANCES_COLS,
    FABRIC_BALANCES_COUNT_DATETIME,
    MAX_QTY_PER_ROW,
    MAX_FUTURE_DAYS,
    MAX_PAST_DAYS,
} from '../config/sync/sheets.js';
import { generateFabricColourCode } from '../config/fabric/codes.js';
import { bookFabricConsumptionForMonth, bookShipmentCOGSForMonth, bookReturnReversalForMonth } from './ledgerService.js';

// ============================================
// TYPES
// ============================================

interface IngestInwardResult {
    startedAt: string;
    inwardIngested: number;
    skipped: number;
    rowsMarkedDone: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    inwardValidationErrors: Record<string, number>;
    balanceVerification?: BalanceVerificationResult;
}

interface IngestOutwardResult {
    startedAt: string;
    outwardIngested: number;
    ordersLinked: number;
    skipped: number;
    rowsMarkedDone: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    outwardSkipReasons?: Record<string, number>;
    balanceVerification?: BalanceVerificationResult;
}

interface CleanupDoneResult {
    startedAt: string;
    inwardDeleted: number;
    outwardDeleted: number;
    fabricInwardDeleted: number;
    errors: string[];
    durationMs: number;
}

interface MigrateFormulasResult {
    startedAt: string;
    inventoryRowsUpdated: number;
    balanceFinalRowsUpdated: number;
    errors: string[];
    durationMs: number;
}

interface PushBalancesResult {
    startedAt: string;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
}

interface PushFabricBalancesResult {
    startedAt: string;
    totalColours: number;
    newColoursAdded: number;
    balancesUpdated: number;
    errors: number;
    durationMs: number;
    error: string | null;
}

interface ImportFabricBalancesResult {
    startedAt: string;
    rowsWithCounts: number;
    adjustmentsCreated: number;
    alreadyMatching: number;
    skipped: number;
    skipReasons: Record<string, number>;
    adjustments: Array<{
        fabricCode: string;
        colour: string;
        fabric: string;
        systemBalance: number;
        physicalCount: number;
        delta: number;
        type: 'inward' | 'outward';
    }>;
    durationMs: number;
    error: string | null;
}

interface FabricInwardResult {
    startedAt: string;
    imported: number;
    skipped: number;
    rowsMarkedDone: number;
    suppliersCreated: number;
    errors: number;
    durationMs: number;
    error: string | null;
    validationErrors: Record<string, number>;
}

interface FabricInwardPreviewRow {
    fabricCode: string;
    material: string;
    fabric: string;
    colour: string;
    qty: number;
    unit: string;
    costPerUnit: number;
    supplier: string;
    date: string;
    notes: string;
    status: 'ready' | 'invalid' | 'duplicate';
    error?: string;
}

interface FabricInwardPreviewResult {
    tab: string;
    totalRows: number;
    valid: number;
    invalid: number;
    duplicates: number;
    validationErrors: Record<string, number>;
    affectedFabricCodes: string[];
    durationMs: number;
    previewRows?: FabricInwardPreviewRow[];
}

interface PushBalancesPreviewResult {
    totalSkusInDb: number;
    mastersheetMatched: number;
    mastersheetWouldChange: number;
    ledgerMatched: number;
    ledgerWouldChange: number;
    alreadyCorrect: number;
    wouldChange: number;
    sampleChanges: Array<{ skuCode: string; productName: string; colorName: string; size: string; sheet: string; sheetValue: number; dbValue: number }>;
    durationMs: number;
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

interface InwardPreviewRow {
    skuCode: string;
    product: string;
    qty: number;
    source: string;
    date: string;
    doneBy: string;
    tailor: string;
    status: 'ready' | 'invalid' | 'duplicate';
    error?: string;
}

interface OutwardPreviewRow {
    skuCode: string;
    product: string;
    qty: number;
    orderNo: string;
    orderDate: string;
    customerName: string;
    courier: string;
    awb: string;
    status: 'ready' | 'invalid' | 'duplicate';
    error?: string;
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
    previewRows?: InwardPreviewRow[] | OutwardPreviewRow[];
    balanceSnapshot?: {
        skuBalances: Array<{
            skuCode: string;
            qty: number;
            erpBalance: number;
            afterErpBalance: number;
            sheetPending: number;
            afterSheetPending: number;
            colC: number;
            inSync: boolean;
        }>;
        allInSync: boolean;
    };
}

interface BalanceSnapshot {
    balances: Map<string, { c: number; d: number; e: number; r: number }>;
    rowCount: number;
    timestamp: string;
}

interface BalanceVerificationResult {
    passed: boolean;
    totalSkusChecked: number;
    drifted: number;
    sampleDrifts: Array<{
        skuCode: string;
        before: { c: number; d: number; e: number; r: number };
        after: { c: number; d: number; e: number; r: number };
        cDelta: number;
    }>;
    snapshotBeforeMs: number;
    snapshotAfterMs: number;
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
    cleanupDone: JobState<CleanupDoneResult>;
    migrateFormulas: JobState<MigrateFormulasResult>;
    pushBalances: JobState<PushBalancesResult>;
    pushFabricBalances: JobState<PushFabricBalancesResult>;
    importFabricBalances: JobState<ImportFabricBalancesResult>;
    fabricInward: JobState<FabricInwardResult>;
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
    barcode: string;        // inward only — unique piece barcode from col G
    userNotes: string;      // inward only — user-entered notes from col I
    orderNotes: string;     // outward only — Order Note from col K
    cohNotes: string;       // outward only — COH Note from col L
    courier: string;        // outward only — from sheet col Z
    awb: string;            // outward only — from sheet col AA
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

/** Internal accumulator for markRowsIngested — shared across job types. */
interface MarkTracker {
    rowsMarkedDone: number;
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

const cleanupDoneState: JobState<CleanupDoneResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const migrateFormulasState: JobState<MigrateFormulasResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const pushBalancesState: JobState<PushBalancesResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const pushFabricBalancesState: JobState<PushFabricBalancesResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const importFabricBalancesState: JobState<ImportFabricBalancesResult> = {
    isRunning: false,
    lastRunAt: null,
    lastResult: null,
    recentRuns: [],
};

const fabricInwardState: JobState<FabricInwardResult> = {
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
        const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!isoMatch) return null;
        const [, yStr, mStr, dStr] = isoMatch;
        const y = Number(yStr), m = Number(mStr), dy = Number(dStr);
        const parsed = new Date(y, m - 1, dy);
        // Validate calendar date didn't roll over (e.g. Feb 31 → Mar 3)
        if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== dy) return null;
        if (y < 1901) return null;
        return parsed;
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
    // Validate calendar date didn't roll over (e.g. Feb 31 → Mar 3)
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
}

/**
 * Parses a date+time string from the sheet. Handles:
 *   "10/02/2026 7:00 PM"  → DD/MM/YYYY h:mm AM/PM
 *   "10/02/2026 19:00"    → DD/MM/YYYY HH:mm
 *   "2026-02-10 19:00"    → ISO-ish
 *   "10/02/2026"          → date only (midnight)
 *
 * Returns IST-interpreted Date (no timezone conversion — the entered time IS the local time).
 */
function parseSheetDateTime(value: string | undefined): Date | null {
    if (!value?.trim()) return null;
    const trimmed = value.trim();

    // Try ISO-ish first: "2026-02-10 19:00" or "2026-02-10T19:00"
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1900) return parsed;
    }

    // DD/MM/YYYY with optional time
    const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:\s+(.+))?$/);
    if (!match) return null;

    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);
    const timeStr = match[4]?.trim();

    // DD/MM default (Indian locale)
    let day: number, month: number;
    if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else { day = a; month = b; }

    let hours = 0, minutes = 0;
    if (timeStr) {
        // "7:00 PM", "19:00", "7 PM", "7:30pm"
        const timeMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (timeMatch) {
            hours = Number(timeMatch[1]);
            minutes = Number(timeMatch[2] || 0);
            const ampm = timeMatch[3]?.toLowerCase();
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;
        }
    }

    const d = new Date(year, month - 1, day, hours, minutes);
    if (!isNaN(d.getTime())) return d;
    return null;
}

/**
 * Parse quantity from sheet cell.
 * Returns 0 for empty/invalid. Rejects Infinity, NaN, and non-integer values.
 * Returns negative value to signal "non-integer" for better error messages.
 * Convention: 0 = empty/invalid, -1 = non-integer fractional, -2 = Infinity/NaN
 */
function parseQty(value: string | undefined): number {
    if (!value?.trim()) return 0;
    const raw = Number(value.trim());
    if (!Number.isFinite(raw)) return -2; // Infinity or NaN
    if (raw !== Math.floor(raw)) return -1; // fractional like 2.5
    return raw > 0 ? raw : 0;
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

    const batchData = ranges.map(range => ({
        range: `'${tab}'!${errorColLetter}${range.startRow}:${errorColLetter}${range.startRow + range.values.length - 1}`,
        values: range.values,
    }));
    await batchWriteRanges(spreadsheetId, batchData);

    const errorCount = sorted.filter(e => e.error).length;
    if (errorCount > 0) {
        sheetsLogger.info({ tab, totalRows: sorted.length, errors: errorCount }, 'Wrote import errors to sheet');
    }
}

interface SkuLookupInfo {
    id: string;
    variationId: string;
    fabricConsumption: number;
    isActive: boolean;
}

async function bulkLookupSkus(skuCodes: string[]): Promise<Map<string, SkuLookupInfo>> {
    if (skuCodes.length === 0) return new Map();
    const unique = [...new Set(skuCodes)];
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: unique } },
        select: { id: true, skuCode: true, variationId: true, fabricConsumption: true, isActive: true },
    });
    return new Map(skus.map(s => [s.skuCode, { id: s.id, variationId: s.variationId, fabricConsumption: s.fabricConsumption, isActive: s.isActive }]));
}

interface OrderMapEntry {
    id: string;
    orderNumber: string;  // the actual ERP orderNumber (may differ from the sheet key)
    orderLines: Array<{ id: string; skuId: string; qty: number; lineStatus: string }>;
}

interface OutwardValidationResult {
    validRows: ParsedRow[];
    skipReasons: Record<string, number>;
    orderMap: Map<string, OrderMapEntry>;
    /** ERP orderNumber|skuId keys that already have OUTWARD txns in DB */
    existingOrderSkuKeys: Set<string>;
}

/**
 * Pre-ingestion validation for outward rows.
 */
async function validateOutwardRows(
    rows: ParsedRow[],
    skuMap: Map<string, SkuLookupInfo>
): Promise<OutwardValidationResult> {
    const skipReasons: Record<string, number> = {};
    const addSkip = (reason: string) => {
        skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };

    const now = new Date();
    const maxFuture = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
    const maxPast = new Date(now.getTime() - MAX_PAST_DAYS * 24 * 60 * 60 * 1000);

    // Pass 1: strict field validation
    const afterBasic: ParsedRow[] = [];
    for (const row of rows) {
        if (!row.skuCode) { addSkip('empty_sku'); continue; }
        if (row.qty === -2) { addSkip('qty_not_a_number'); continue; }
        if (row.qty === -1) { addSkip('qty_not_whole_number'); continue; }
        if (row.qty <= 0) { addSkip('zero_qty'); continue; }
        if (row.qty > MAX_QTY_PER_ROW) { addSkip(`qty_exceeds_max_${MAX_QTY_PER_ROW}`); continue; }
        if (!skuMap.has(row.skuCode)) { addSkip('unknown_sku'); continue; }
        if (skuMap.has(row.skuCode) && !skuMap.get(row.skuCode)!.isActive) { addSkip('inactive_sku'); continue; }
        if (!row.date) { addSkip('invalid_date'); continue; }
        if (row.date > maxFuture) { addSkip('date_too_far_in_future'); continue; }
        if (row.date < maxPast) { addSkip('date_too_old'); continue; }
        // Order rows must have courier and AWB
        if (row.extra) {
            if (!row.courier) { addSkip('missing_courier'); continue; }
            if (!row.awb) { addSkip('missing_awb'); continue; }
        }
        // Non-order rows must have a destination
        if (!row.extra && !row.source) { addSkip('missing_destination'); continue; }
        afterBasic.push(row);
    }

    // Pass 2: order/order-line validation for rows with an orderNumber
    const orderNumbers = [...new Set(
        afterBasic
            .map(r => r.extra)
            .filter(Boolean)
    )];

    const orderMap = new Map<string, OrderMapEntry>();
    if (orderNumbers.length > 0) {
        // Build alternate format lookups for channel orders.
        // Historical imports created inconsistent formats:
        // - Myntra: full UUID "abc12345-xxxx-..." vs short "abc12345" (first 8 chars)
        // - Nykaa: "NYK-xxx--1" (with suffix) vs "NYK-xxx" (without)
        // This mirrors the matching logic in channels.ts (channel import preview).
        const allLookups = new Set<string>(orderNumbers);
        const alternateToOriginal = new Map<string, string>(); // DB format → sheet format
        const shortMyntraIds = new Set<string>();

        for (const num of orderNumbers) {
            // Myntra full UUID → also try short 8-char form
            if (num.includes('-') && num.length > 20) {
                const short = num.split('-')[0];
                allLookups.add(short);
                alternateToOriginal.set(short, num);
            }
            // Myntra short form → flag for startsWith fallback (can't predict full UUID)
            if (/^[0-9a-f]{8}$/i.test(num)) {
                shortMyntraIds.add(num);
            }
            // Myntra combo "shortId - btOrderId" (e.g., "35d4288c - 9659143096")
            // Old sheet format that concatenated both IDs. Extract the short UUID part.
            const comboMatch = num.match(/^([0-9a-f]{8})\s*-\s*\d+$/i);
            if (comboMatch) {
                const short = comboMatch[1];
                shortMyntraIds.add(short);
                alternateToOriginal.set(short, num);
            }
            // Nykaa: bidirectional --1 suffix handling
            if (num.endsWith('--1')) {
                const trimmed = num.slice(0, -3);
                allLookups.add(trimmed);
                alternateToOriginal.set(trimmed, num);
            }
            if (num.startsWith('NYK-') && !num.endsWith('--1')) {
                const withSuffix = num + '--1';
                allLookups.add(withSuffix);
                alternateToOriginal.set(withSuffix, num);
            }
        }

        // Query with all formats (exact + alternates)
        const orders = await prisma.order.findMany({
            where: { orderNumber: { in: Array.from(allLookups) } },
            select: {
                id: true,
                orderNumber: true,
                orderLines: { select: { id: true, skuId: true, qty: true, lineStatus: true } },
            },
        });

        // startsWith fallback for short Myntra IDs not found by exact match
        const foundNumbers = new Set(orders.map(o => o.orderNumber));
        const shortMyntraUnmatched = [...shortMyntraIds].filter(num => !foundNumbers.has(num));
        if (shortMyntraUnmatched.length > 0) {
            const startsWithOrders = await prisma.order.findMany({
                where: {
                    OR: shortMyntraUnmatched.map(short => ({
                        orderNumber: { startsWith: short },
                    })),
                },
                select: {
                    id: true,
                    orderNumber: true,
                    orderLines: { select: { id: true, skuId: true, qty: true, lineStatus: true } },
                },
            });
            for (const o of startsWithOrders) {
                const short = o.orderNumber.split('-')[0];
                if (shortMyntraIds.has(short)) {
                    alternateToOriginal.set(o.orderNumber, short);
                    orders.push(o);
                }
            }
        }

        for (const o of orders) {
            // Key by the ORIGINAL sheet order number so downstream lookup works
            const sheetKey = alternateToOriginal.get(o.orderNumber) ?? o.orderNumber;
            if (orderMap.has(sheetKey)) {
                sheetsLogger.warn(
                    { sheetKey, newOrderId: o.id, existingOrderId: orderMap.get(sheetKey)!.id },
                    'Multiple DB orders match same sheet order number — keeping first'
                );
            } else {
                orderMap.set(sheetKey, { id: o.id, orderNumber: o.orderNumber, orderLines: o.orderLines });
            }
        }

        const alternateMatches = orders.filter(o => alternateToOriginal.has(o.orderNumber)).length;
        if (alternateMatches > 0) {
            sheetsLogger.info(
                { matchedViaAlternate: alternateMatches },
                'Channel orders matched via alternate format'
            );
        }
    }

    // Pre-query: find existing OUTWARD transactions for orders we're about to validate.
    // An order can only have one line per SKU, so order+SKU is a natural unique key.
    // This catches duplicates from moveShipped crash-retries and double-triggers.
    const existingOrderSkuKeys = new Set<string>();
    const orderBasedRows = afterBasic.filter(r => r.extra && orderMap.has(r.extra));
    if (orderBasedRows.length > 0) {
        const erpOrderNumbers = [...new Set(
            orderBasedRows.map(r => orderMap.get(r.extra)!.orderNumber)
        )];
        const existingOutward = await prisma.inventoryTransaction.findMany({
            where: {
                txnType: TXN_TYPE.OUTWARD,
                orderNumber: { in: erpOrderNumbers },
            },
            select: { orderNumber: true, skuId: true },
        });
        for (const t of existingOutward) {
            if (t.orderNumber) existingOrderSkuKeys.add(`${t.orderNumber}|${t.skuId}`);
        }
    }

    const seenOrderSkus = new Set<string>(); // within-batch tracker
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

        const skuId = skuMap.get(row.skuCode)!.id;
        const hasMatchingLine = order.orderLines.some(l => l.skuId === skuId);
        if (!hasMatchingLine) {
            addSkip('order_line_not_found');
            continue;
        }

        // Duplicate check: order+SKU must be unique (one order line per SKU)
        const orderSkuKey = `${order.orderNumber}|${skuId}`;
        if (existingOrderSkuKeys.has(orderSkuKey)) {
            addSkip('duplicate_order_sku');
            continue;
        }
        if (seenOrderSkus.has(orderSkuKey)) {
            addSkip('duplicate_order_sku_in_batch');
            continue;
        }
        seenOrderSkus.add(orderSkuKey);

        validRows.push(row);
    }

    return { validRows, skipReasons, orderMap, existingOrderSkuKeys };
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

async function findExistingFabricReferenceIds(referenceIds: string[]): Promise<Set<string>> {
    if (referenceIds.length === 0) return new Set();

    const result = new Set<string>();
    for (let i = 0; i < referenceIds.length; i += DEDUP_CHUNK_SIZE) {
        const chunk = referenceIds.slice(i, i + DEDUP_CHUNK_SIZE);
        const existing = await prisma.fabricColourTransaction.findMany({
            where: { referenceId: { in: chunk } },
            select: { referenceId: true },
        });
        for (const t of existing) {
            if (t.referenceId) result.add(t.referenceId);
        }
    }
    return result;
}

/**
 * Normalize Fabric.unit to FabricColourTransaction unit format.
 * Fabric stores 'm' or 'kg', transactions expect 'meter' or 'kg'.
 */
function normalizeFabricUnit(unit: string | null): string {
    if (!unit) return 'meter';
    const lower = unit.toLowerCase().trim();
    if (lower === 'm') return 'meter';
    return lower || 'meter';
}

// ============================================
// INWARD VALIDATION
// ============================================

function validateInwardRow(
    parsed: ParsedRow,
    rawRow: unknown[],
    skuMap: Map<string, SkuLookupInfo>,
    activeSkuCodes: Set<string>,
): string[] {
    const reasons: string[] = [];

    const rawQty = String(rawRow[INWARD_LIVE_COLS.QTY] ?? '').trim();
    const product = String(rawRow[INWARD_LIVE_COLS.PRODUCT] ?? '').trim();
    const dateStr = String(rawRow[INWARD_LIVE_COLS.DATE] ?? '').trim();
    const barcode = String(rawRow[INWARD_LIVE_COLS.BARCODE] ?? '').trim();
    const notes = String(rawRow[INWARD_LIVE_COLS.NOTES] ?? '').trim();

    const source = parsed.source.toLowerCase();

    // Required fields
    if (!parsed.skuCode)    reasons.push('missing SKU (A)');
    if (!rawQty)            reasons.push('missing Qty (B)');
    if (!product)           reasons.push('missing Product (C)');
    if (!dateStr)           reasons.push('missing Date (D)');
    if (!parsed.source)     reasons.push('missing Source (E)');
    if (!parsed.extra)      reasons.push('missing Done By (F)');

    // Qty validation
    if (rawQty && parsed.qty === -2) reasons.push('Qty is not a valid number');
    if (rawQty && parsed.qty === -1) reasons.push('Qty must be a whole number (no decimals)');
    if (rawQty && parsed.qty === 0)  reasons.push('Qty must be > 0');
    if (parsed.qty > MAX_QTY_PER_ROW) reasons.push(`Qty ${parsed.qty} exceeds max ${MAX_QTY_PER_ROW}`);

    // Date validation — must be parseable, not in future, not too old
    if (dateStr && !parsed.date) {
        reasons.push(`invalid Date format "${dateStr}" — use DD/MM/YYYY`);
    }
    if (parsed.date) {
        const now = new Date();
        const maxFuture = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
        const maxPast = new Date(now.getTime() - MAX_PAST_DAYS * 24 * 60 * 60 * 1000);
        if (parsed.date > maxFuture) reasons.push(`Date is too far in the future (max ${MAX_FUTURE_DAYS} days)`);
        if (parsed.date < maxPast) reasons.push(`Date is too old (max ${MAX_PAST_DAYS} days in past)`);
    }

    // Source validation
    if (parsed.source && !VALID_INWARD_LIVE_SOURCES.some(s => s === source)) {
        reasons.push(`invalid Source "${parsed.source}"`);
    }

    // Source-specific requirements
    if (source === 'repacking' && !barcode) {
        reasons.push('missing Barcode (G) for repacking');
    }
    if (source === 'sampling' && !parsed.tailor) {
        reasons.push('missing Tailor Number (H) for sampling');
    }
    if (source === 'adjustment' && !notes) {
        reasons.push('missing Notes (I) for adjustment');
    }

    // SKU validation — must exist AND be active
    if (parsed.skuCode && !skuMap.has(parsed.skuCode)) {
        reasons.push(`unknown SKU "${parsed.skuCode}"`);
    } else if (parsed.skuCode && !activeSkuCodes.has(parsed.skuCode)) {
        reasons.push(`inactive SKU "${parsed.skuCode}"`);
    }

    return reasons;
}

// ============================================
// FABRIC DEDUCTION FOR SAMPLING INWARDS
// ============================================

/**
 * After sampling inward rows are created, deduct fabric used.
 * Formula: fabric qty = row.qty × Sku.fabricConsumption
 * Creates FabricColourTransaction (outward) records.
 */
async function deductFabricForSamplingRows(
    successfulRows: ParsedRow[],
    skuMap: Map<string, SkuLookupInfo>,
    adminUserId: string
): Promise<void> {
    // Filter to only sampling source rows
    const samplingRows = successfulRows.filter(
        r => FABRIC_DEDUCT_SOURCES.some(s => s === r.source.toLowerCase().trim())
    );
    if (samplingRows.length === 0) return;

    // Collect unique variationIds from sampling rows
    const variationIds = [...new Set(
        samplingRows
            .map(r => skuMap.get(r.skuCode)?.variationId)
            .filter((v): v is string => !!v)
    )];

    if (variationIds.length === 0) return;

    // Batch lookup fabric assignments via BOM
    const { getVariationsMainFabrics } = await import('@coh/shared/services/bom');
    const fabricMap = await getVariationsMainFabrics(prisma, variationIds);

    // Dedup: check existing referenceIds in FabricColourTransaction
    const existingFabricRefs = await findExistingFabricReferenceIds(
        samplingRows.map(r => r.referenceId)
    );

    // Build fabric transaction data
    const fabricTxnData: Array<{
        fabricColourId: string;
        txnType: string;
        qty: number;
        unit: string;
        reason: string;
        referenceId: string;
        notes: string;
        createdById: string;
        createdAt: Date;
    }> = [];
    const affectedFabricColourIds = new Set<string>();
    let skippedNoFabric = 0;
    let skippedZeroConsumption = 0;
    let skippedDuplicate = 0;

    for (const row of samplingRows) {
        // Skip duplicates
        if (existingFabricRefs.has(row.referenceId)) {
            skippedDuplicate++;
            continue;
        }

        const skuInfo = skuMap.get(row.skuCode);
        if (!skuInfo) continue;

        // Skip if fabricConsumption is 0
        if (skuInfo.fabricConsumption <= 0) {
            skippedZeroConsumption++;
            continue;
        }

        // Look up fabric assignment
        const fabric = fabricMap.get(skuInfo.variationId);
        if (!fabric) {
            skippedNoFabric++;
            sheetsLogger.debug({ skuCode: row.skuCode, variationId: skuInfo.variationId }, 'No fabric assigned — skipping fabric deduction');
            continue;
        }

        const fabricQty = row.qty * skuInfo.fabricConsumption;

        fabricTxnData.push({
            fabricColourId: fabric.fabricColourId,
            txnType: FABRIC_TXN_TYPE.OUTWARD,
            qty: fabricQty,
            unit: normalizeFabricUnit(fabric.fabricUnit),
            reason: 'production',
            referenceId: row.referenceId,
            notes: `${OFFLOAD_NOTES_PREFIX} Auto fabric deduction for sampling inward`,
            createdById: adminUserId,
            createdAt: row.date!, // Validated as non-null during validation step
        });

        affectedFabricColourIds.add(fabric.fabricColourId);
    }

    // Create in batches
    let fabricTxnCreated = 0;
    for (let i = 0; i < fabricTxnData.length; i += BATCH_SIZE) {
        const chunk = fabricTxnData.slice(i, i + BATCH_SIZE);
        try {
            await prisma.fabricColourTransaction.createMany({ data: chunk });
            fabricTxnCreated += chunk.length;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ batchStart: i, error: message }, 'Fabric deduction batch failed');
        }
    }

    // Invalidate fabric colour balance cache
    if (affectedFabricColourIds.size > 0) {
        const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
        fabricColourBalanceCache.invalidate([...affectedFabricColourIds]);
    }

    sheetsLogger.info({
        samplingRows: samplingRows.length,
        fabricTxnCreated,
        skippedNoFabric,
        skippedZeroConsumption,
        skippedDuplicate,
        affectedFabricColours: affectedFabricColourIds.size,
    }, 'Fabric deduction for sampling inwards complete');
}

// ============================================
// PHASE A: INGEST INWARD (LIVE)
// ============================================

async function ingestInwardLive(result: IngestInwardResult): Promise<Set<string>> {
    const tab = LIVE_TABS.INWARD;
    const affectedSkuIds = new Set<string>();

    sheetsLogger.info({ tab }, 'Reading inward live tab');

    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:J`);
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        return affectedSkuIds;
    }

    // --- Step 1: Parse rows (skip rows with no SKU and DONE rows) ---
    const parsed: ParsedRow[] = [];
    const seenRefs = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const skuCode = String(row[INWARD_LIVE_COLS.SKU] ?? '').trim();
        if (!skuCode) continue;

        // Skip already-ingested rows
        const status = String(row[INWARD_LIVE_COLS.IMPORT_ERRORS] ?? '').trim();
        if (status.startsWith(INGESTED_PREFIX)) continue;

        const qty = parseQty(String(row[INWARD_LIVE_COLS.QTY] ?? ''));
        const dateStr = String(row[INWARD_LIVE_COLS.DATE] ?? '');
        const source = String(row[INWARD_LIVE_COLS.SOURCE] ?? '').trim();
        const doneBy = String(row[INWARD_LIVE_COLS.DONE_BY] ?? '').trim();
        const tailor = String(row[INWARD_LIVE_COLS.TAILOR] ?? '').trim();
        const barcode = String(row[INWARD_LIVE_COLS.BARCODE] ?? '').trim();
        const userNotes = String(row[INWARD_LIVE_COLS.NOTES] ?? '').trim();

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
            barcode,
            userNotes,
            orderNotes: '',
            cohNotes: '',
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
    const activeSkuCodes = new Set<string>(
        [...skuMap.entries()].filter(([, info]) => info.isActive).map(([code]) => code)
    );

    // --- Step 3: Validate each row ---
    const validRows: ParsedRow[] = [];
    const validationErrors: Record<string, number> = {};
    const importErrors: Array<{ rowIndex: number; error: string }> = [];
    let invalidCount = 0;

    for (const p of parsed) {
        const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap, activeSkuCodes);
        if (reasons.length === 0) {
            validRows.push(p);
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

    // Write Import Errors column only for invalid rows
    if (importErrors.length > 0) {
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, importErrors, 'J');
    }

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
        // Mark all-dupe rows as DONE
        await markRowsIngested(
            ORDERS_MASTERSHEET_ID, tab,
            validRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
            'J', result
        );
        return affectedSkuIds;
    }

    // --- Step 5: Create transactions ---
    const adminUserId = await getAdminUserId();
    const successfulRows: ParsedRow[] = [];

    for (let batch = 0; batch < newRows.length; batch += BATCH_SIZE) {
        const chunk = newRows.slice(batch, batch + BATCH_SIZE);
        const txnData: Array<{
            skuId: string;
            txnType: string;
            qty: number;
            reason: string;
            referenceId: string;
            notes: string;
            userNotes: string | null;
            createdById: string;
            createdAt: Date;
            source: string | null;
            performedBy: string | null;
            tailorNumber: string | null;
            repackingBarcode: string | null;
        }> = [];

        for (const row of chunk) {
            const skuInfo = skuMap.get(row.skuCode)!;

            txnData.push({
                skuId: skuInfo.id,
                txnType: TXN_TYPE.INWARD,
                qty: row.qty,
                reason: mapSourceToReason(row.source),
                referenceId: row.referenceId,
                notes: row.notes,
                userNotes: row.userNotes || null,
                createdById: adminUserId,
                createdAt: row.date!, // Validated as non-null during validation step
                source: row.source || null,
                performedBy: row.extra || null,
                tailorNumber: row.tailor || null,
                repackingBarcode: row.barcode || null,
            });

            affectedSkuIds.add(skuInfo.id);
        }

        if (txnData.length > 0) {
            try {
                await prisma.inventoryTransaction.createMany({ data: txnData });
                result.inwardIngested += txnData.length;
                successfulRows.push(...chunk);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                sheetsLogger.error({ tab, batchStart: batch, error: message }, 'Batch createMany failed');
                result.errors++;
            }
        }
    }

    sheetsLogger.info({
        tab,
        ingested: successfulRows.length,
        skippedInvalid: invalidCount,
    }, 'Inward ingestion complete');

    // --- Step 6: Auto-deduct fabric for sampling inwards ---
    if (successfulRows.length > 0) {
        try {
            await deductFabricForSamplingRows(successfulRows, skuMap, adminUserId);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message }, 'Fabric deduction failed (non-fatal)');
        }
    }

    // --- Step 7: Book production → finished goods for affected months ---
    // When sampling inwards are ingested, fabric becomes finished goods
    const samplingRows = successfulRows.filter(
        r => FABRIC_DEDUCT_SOURCES.some(s => s === r.source.toLowerCase().trim())
    );
    if (samplingRows.length > 0) {
        try {
            const affectedMonths = new Set<string>();
            for (const row of samplingRows) {
                const d = row.date!; // Validated as non-null during validation step
                const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
                affectedMonths.add(`${ist.getFullYear()}-${ist.getMonth() + 1}`);
            }

            for (const key of affectedMonths) {
                const [y, m] = key.split('-').map(Number);
                const res = await bookFabricConsumptionForMonth(prisma, y, m, adminUserId);
                sheetsLogger.info(
                    { month: `${y}-${String(m).padStart(2, '0')}`, fabricCost: res.fabricCost, action: res.action },
                    'Production → Finished Goods updated'
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message }, 'Production finished goods booking failed (non-fatal)');
        }
    }

    // --- Step 8: Book return/RTO COGS reversal for affected months ---
    // When RTO/return inwards are ingested, returned goods go back to finished goods
    const returnSources = ['rto', 'return', 'repacking'];
    const returnRows = successfulRows.filter(
        r => returnSources.includes(r.source.toLowerCase().trim())
    );
    if (returnRows.length > 0) {
        try {
            const returnMonths = new Set<string>();
            for (const row of returnRows) {
                const d = row.date!; // Validated as non-null during validation step
                const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
                returnMonths.add(`${ist.getFullYear()}-${ist.getMonth() + 1}`);
            }

            for (const key of returnMonths) {
                const [y, m] = key.split('-').map(Number);
                const res = await bookReturnReversalForMonth(prisma, y, m, adminUserId);
                sheetsLogger.info(
                    { month: `${y}-${String(m).padStart(2, '0')}`, amount: res.amount, action: res.action },
                    'Return/RTO COGS reversal updated'
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message }, 'Return COGS reversal failed (non-fatal)');
        }
    }

    // Mark successfully ingested rows + already-deduped rows as DONE
    const dupeRows = validRows.filter(r => existingRefs.has(r.referenceId));
    const rowsToMark = [
        ...successfulRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
        ...dupeRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
    ];
    await markRowsIngested(ORDERS_MASTERSHEET_ID, tab, rowsToMark, 'J', result);

    return affectedSkuIds;
}

// ============================================
// PHASE B: INGEST OUTWARD (LIVE)
// ============================================

async function ingestOutwardLive(
    result: IngestOutwardResult
): Promise<{ affectedSkuIds: Set<string>; linkableItems: LinkableOutward[]; orderMap: Map<string, OrderMapEntry> }> {
    const tab = LIVE_TABS.OUTWARD;
    const affectedSkuIds = new Set<string>();
    const linkableItems: LinkableOutward[] = [];

    sheetsLogger.info({ tab }, 'Reading outward live tab');

    const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AG`);
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
        const orderNotes = String(row[OUTWARD_LIVE_COLS.ORDER_NOTE] ?? '').trim();
        const cohNotes = String(row[OUTWARD_LIVE_COLS.COH_NOTE] ?? '').trim();

        const dest = orderNo ? 'Customer' : '';

        // Skip already-ingested rows
        const status = String(row[OUTWARD_LIVE_COLS.IMPORT_ERRORS] ?? '').trim();
        if (status.startsWith(INGESTED_PREFIX)) continue;

        // Skip completely empty rows (no data at all)
        if (!skuCode && !String(row[OUTWARD_LIVE_COLS.QTY] ?? '').trim()) continue;

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
            barcode: '',
            userNotes: '',
            orderNotes,
            cohNotes,
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
        // Mark all-dupe rows as DONE
        await markRowsIngested(
            ORDERS_MASTERSHEET_ID, tab,
            parsed.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
            'AG', result
        );
        return { affectedSkuIds, linkableItems, orderMap: new Map() };
    }

    const skuMap = await bulkLookupSkus(newRows.map(r => r.skuCode));

    const { validRows, skipReasons, orderMap, existingOrderSkuKeys } = await validateOutwardRows(newRows, skuMap);
    const skippedCount = newRows.length - validRows.length;
    result.skipped += skippedCount;
    if (Object.keys(skipReasons).length > 0) {
        result.outwardSkipReasons = skipReasons;
        sheetsLogger.info({ tab, skipped: skippedCount, skipReasons }, 'Outward validation complete');
    }

    // Write Import Errors column only for invalid/skipped rows (not valid or dupe rows)
    const validRefIds = new Set(validRows.map(r => r.referenceId));
    const outwardImportErrors: Array<{ rowIndex: number; error: string }> = [];
    const seenOrderSkusForErrors = new Set<string>(); // track within-batch dupes for error reporting
    for (const row of parsed) {
        if (existingRefs.has(row.referenceId)) continue;  // dupe — will be marked DONE
        if (validRefIds.has(row.referenceId)) continue;    // valid — will be marked DONE
        // Skipped — determine reason
        const skuInfo = skuMap.get(row.skuCode);
        const now = new Date();
        const maxFutureDate = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
        const maxPastDate = new Date(now.getTime() - MAX_PAST_DAYS * 24 * 60 * 60 * 1000);
        let reason = 'unknown';
        if (!row.skuCode) reason = 'empty_sku';
        else if (row.qty === -2) reason = 'qty_not_a_number';
        else if (row.qty === -1) reason = 'qty_not_whole_number';
        else if (row.qty <= 0) reason = 'zero_qty';
        else if (row.qty > MAX_QTY_PER_ROW) reason = `qty_exceeds_max_${MAX_QTY_PER_ROW}`;
        else if (!skuInfo) reason = 'unknown_sku';
        else if (!skuInfo.isActive) reason = 'inactive_sku';
        else if (!row.date) reason = 'invalid_date';
        else if (row.date > maxFutureDate) reason = 'date_too_far_in_future';
        else if (row.date < maxPastDate) reason = 'date_too_old';
        else if (row.extra && !row.courier) reason = 'missing_courier';
        else if (row.extra && !row.awb) reason = 'missing_awb';
        else if (!row.extra && !row.source) reason = 'missing_destination';
        else if (row.extra) {
            const order = orderMap.get(row.extra);
            if (!order) reason = 'order_not_found';
            else if (!order.orderLines.some(l => l.skuId === skuInfo.id)) reason = 'order_line_not_found';
            else {
                const orderSkuKey = `${order.orderNumber}|${skuInfo.id}`;
                if (existingOrderSkuKeys.has(orderSkuKey)) reason = 'duplicate_order_sku';
                else if (seenOrderSkusForErrors.has(orderSkuKey)) reason = 'duplicate_order_sku_in_batch';
                else seenOrderSkusForErrors.add(orderSkuKey);
            }
        }
        outwardImportErrors.push({ rowIndex: row.rowIndex, error: reason });
    }
    if (outwardImportErrors.length > 0) {
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, outwardImportErrors, 'AG');
    }

    const adminUserId = await getAdminUserId();
    const successfulRows: ParsedRow[] = [];

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
            orderNotes: string | null;
            cohNotes: string | null;
        }> = [];

        const chunkLinkable: LinkableOutward[] = [];

        for (const row of chunk) {
            const skuInfo = skuMap.get(row.skuCode)!;
            // Use the real ERP orderNumber (from orderMap), not the sheet value
            // which may be an alternate format (short Myntra UUID, Nykaa without --1, etc.)
            const matchedOrder = row.extra ? orderMap.get(row.extra) : null;
            const erpOrderNumber = matchedOrder?.orderNumber ?? row.extra ?? null;

            txnData.push({
                skuId: skuInfo.id,
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
                orderNumber: erpOrderNumber,
                orderNotes: row.orderNotes || null,
                cohNotes: row.cohNotes || null,
            });

            affectedSkuIds.add(skuInfo.id);

            if (row.extra) {
                chunkLinkable.push({
                    orderNumber: row.extra,  // sheet key — for orderMap lookup in linkOutwardToOrders
                    skuId: skuInfo.id,
                    qty: row.qty,
                    date: row.date,
                    courier: row.courier,
                    awb: row.awb,
                });
            }
        }

        if (txnData.length > 0) {
            try {
                await prisma.inventoryTransaction.createMany({ data: txnData });
                result.outwardIngested += txnData.length;
                successfulRows.push(...chunk);
                linkableItems.push(...chunkLinkable);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                sheetsLogger.error({ tab, batchStart: batch, error: message }, 'Batch createMany failed');
                result.errors++;
            }
        }
    }

    sheetsLogger.info({ tab, ingested: successfulRows.length }, 'Outward ingestion complete');

    // Mark successfully ingested rows + already-deduped rows as DONE
    const dupeRows = parsed.filter(r => existingRefs.has(r.referenceId));
    const rowsToMark = [
        ...successfulRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
        ...dupeRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
    ];
    await markRowsIngested(ORDERS_MASTERSHEET_ID, tab, rowsToMark, 'AG', result);

    return { affectedSkuIds, linkableItems, orderMap };
}

// ============================================
// PHASE B2: LINK OUTWARD TO ORDER LINES
// ============================================

const LINKABLE_STATUSES = ['pending', 'allocated', 'picked', 'packed'];

async function linkOutwardToOrders(
    items: LinkableOutward[],
    result: IngestOutwardResult,
    preloadedOrderMap: Map<string, OrderMapEntry>
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
// MARK DONE HELPER (replaces deleteIngestedRows)
// ============================================

/**
 * Writes "DONE:{referenceId}" to the status column for each ingested row.
 * Non-destructive — rows stay on the sheet but are excluded by formulas.
 */
async function markRowsIngested(
    spreadsheetId: string,
    tab: string,
    rows: Array<{ rowIndex: number; referenceId: string }>,
    statusCol: string,
    result: MarkTracker
): Promise<void> {
    if (rows.length === 0) return;

    try {
        const entries = rows.map(r => ({
            rowIndex: r.rowIndex,
            error: `${INGESTED_PREFIX}${r.referenceId}`,
        }));
        await writeImportErrors(spreadsheetId, tab, entries, statusCol);
        result.rowsMarkedDone += rows.length;
        sheetsLogger.info({ tab, marked: rows.length }, 'Marked ingested rows as DONE');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ tab, error: message }, 'Failed to mark rows as DONE');
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

// ============================================
// BALANCE VERIFICATION — snapshot + compare
// ============================================

/**
 * Read a snapshot of ALL SKU balances from the Inventory tab (cols A–R).
 * Returns a Map of skuCode → { c, d, e, r } for every row with a non-empty SKU.
 * Col R (index 17) = ERP currentBalance as written by the worker.
 */
async function readInventorySnapshot(): Promise<BalanceSnapshot> {
    const startMs = Date.now();
    const rows = await readRange(
        ORDERS_MASTERSHEET_ID,
        `'${INVENTORY_TAB.NAME}'!A:R`
    );

    const dataStart = INVENTORY_TAB.DATA_START_ROW - 1; // skip header rows
    const balances = new Map<string, { c: number; d: number; e: number; r: number }>();

    for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i];
        const skuCode = String(row?.[0] ?? '').trim();
        if (!skuCode) continue;

        const c = Number(row?.[2] ?? 0) || 0;
        const d = Number(row?.[3] ?? 0) || 0;
        const e = Number(row?.[4] ?? 0) || 0;
        const r = Number(row?.[17] ?? 0) || 0; // col R = index 17
        balances.set(skuCode, { c, d, e, r });
    }

    sheetsLogger.info({ skus: balances.size, durationMs: Date.now() - startMs }, 'Inventory snapshot read');

    return {
        balances,
        rowCount: balances.size,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Compare two inventory snapshots. Returns pass if every SKU's C/D/E values
 * are within tolerance (0.01) of each other.
 */
function compareSnapshots(
    before: BalanceSnapshot,
    after: BalanceSnapshot
): BalanceVerificationResult {
    const TOLERANCE = 0.01;
    const drifts: BalanceVerificationResult['sampleDrifts'] = [];
    let totalChecked = 0;

    for (const [skuCode, bVals] of before.balances) {
        const aVals = after.balances.get(skuCode);
        if (!aVals) continue; // SKU removed — skip

        totalChecked++;
        const cDelta = Math.abs(aVals.c - bVals.c);
        const dDelta = Math.abs(aVals.d - bVals.d);
        const eDelta = Math.abs(aVals.e - bVals.e);

        if (cDelta > TOLERANCE || dDelta > TOLERANCE || eDelta > TOLERANCE) {
            if (drifts.length < 10) {
                drifts.push({
                    skuCode,
                    before: bVals,
                    after: aVals,
                    cDelta: Math.round((aVals.c - bVals.c) * 100) / 100,
                });
            }
        }
    }

    return {
        passed: drifts.length === 0,
        totalSkusChecked: totalChecked,
        drifted: drifts.length,
        sampleDrifts: drifts,
        snapshotBeforeMs: 0, // filled by caller
        snapshotAfterMs: 0,
    };
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
            const batchData = ranges.map(range => ({
                range: `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.ERP_BALANCE_COL}${range.startRow}:${INVENTORY_TAB.ERP_BALANCE_COL}${range.startRow + range.values.length - 1}`,
                values: range.values,
            }));
            await batchWriteRanges(ORDERS_MASTERSHEET_ID, batchData);
            totalUpdated = updates.length;
            sheetsLogger.info({ updated: updates.length, ranges: ranges.length }, 'Inventory col R updated (batch)');
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
                const batchData = ranges.map(range => ({
                    range: `'${LEDGER_TABS.BALANCE_FINAL}'!F${range.startRow}:F${range.startRow + range.values.length - 1}`,
                    values: range.values,
                }));
                await batchWriteRanges(OFFICE_LEDGER_ID, batchData);
                sheetsLogger.info({ updated: updates.length }, 'Balance (Final) col F updated (batch)');
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
        rowsMarkedDone: 0,
        skusUpdated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
        inwardValidationErrors: {},
    };

    try {
        sheetsLogger.info('Starting ingest inward');

        // Before-snapshot for balance verification (non-fatal)
        let beforeSnapshot: BalanceSnapshot | null = null;
        try {
            const snapStart = Date.now();
            beforeSnapshot = await readInventorySnapshot();
            beforeSnapshot.timestamp = String(Date.now() - snapStart); // reuse as ms duration
        } catch (snapErr: unknown) {
            sheetsLogger.warn({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, 'Before-snapshot failed (non-fatal)');
        }

        const affectedSkuIds = await ingestInwardLive(result);

        // Balance update + cache invalidation if anything was ingested
        if (affectedSkuIds.size > 0) {
            await updateSheetBalances(affectedSkuIds, result);
        }
        if (result.inwardIngested > 0) {
            invalidateCaches();
        }

        // After-snapshot + comparison (non-fatal)
        if (beforeSnapshot && result.inwardIngested > 0) {
            try {
                sheetsLogger.info('Waiting 8s for sheet formulas to recalculate...');
                await new Promise(resolve => setTimeout(resolve, 8000));

                const afterStart = Date.now();
                const afterSnapshot = await readInventorySnapshot();
                const afterMs = Date.now() - afterStart;

                const verification = compareSnapshots(beforeSnapshot, afterSnapshot);
                verification.snapshotBeforeMs = Number(beforeSnapshot.timestamp);
                verification.snapshotAfterMs = afterMs;
                result.balanceVerification = verification;

                sheetsLogger.info({
                    passed: verification.passed,
                    totalSkusChecked: verification.totalSkusChecked,
                    drifted: verification.drifted,
                }, verification.passed ? 'Balance verification PASSED' : 'Balance verification FAILED — drift detected');
            } catch (snapErr: unknown) {
                sheetsLogger.warn({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, 'After-snapshot failed (non-fatal)');
            }
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

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:J`);
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

            // Skip already-ingested rows
            const status = String(row[INWARD_LIVE_COLS.IMPORT_ERRORS] ?? '').trim();
            if (status.startsWith(INGESTED_PREFIX)) continue;

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

            const barcode = String(row[INWARD_LIVE_COLS.BARCODE] ?? '').trim();
            const userNotes = String(row[INWARD_LIVE_COLS.NOTES] ?? '').trim();

            parsed.push({
                rowIndex: i, skuCode, qty, date: parseSheetDate(dateStr),
                source, extra: doneBy, tailor, barcode, userNotes, orderNotes: '', cohNotes: '',
                courier: '', awb: '',
                referenceId: refId, notes: `${OFFLOAD_NOTES_PREFIX} ${tab}`,
            });
        }

        if (parsed.length === 0) {
            return { tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0, validationErrors: {}, affectedSkuCodes: [], durationMs: Date.now() - startTime };
        }

        // Validate
        const skuMap = await bulkLookupSkus(parsed.map(r => r.skuCode));
        const activeSkuCodes = new Set<string>(
            [...skuMap.entries()].filter(([, info]) => info.isActive).map(([code]) => code)
        );
        const validRows: ParsedRow[] = [];
        const validationErrors: Record<string, number> = {};
        const rowErrors = new Map<string, string>(); // referenceId → error text

        for (const p of parsed) {
            const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap, activeSkuCodes);
            if (reasons.length === 0) {
                validRows.push(p);
            } else {
                for (const reason of reasons) {
                    validationErrors[reason] = (validationErrors[reason] ?? 0) + 1;
                }
                rowErrors.set(p.referenceId, reasons.join('; '));
            }
        }

        // Dedup
        const existingRefs = await findExistingReferenceIds(validRows.map(r => r.referenceId));
        const newRows = validRows.filter(r => !existingRefs.has(r.referenceId));
        const duplicates = validRows.length - newRows.length;

        // Write status column: "ok" for valid, "ok (already in ERP)" for dupes, error text for invalid
        const importErrors: Array<{ rowIndex: number; error: string }> = [];
        for (const p of parsed) {
            const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap, activeSkuCodes);
            if (reasons.length > 0) {
                importErrors.push({ rowIndex: p.rowIndex, error: reasons.join('; ') });
            } else if (existingRefs.has(p.referenceId)) {
                importErrors.push({ rowIndex: p.rowIndex, error: 'ok (already in ERP)' });
            } else {
                importErrors.push({ rowIndex: p.rowIndex, error: 'ok' });
            }
        }
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, importErrors, 'J');

        const affectedSkuCodes = [...new Set(newRows.map(r => r.skuCode))];

        // Build preview rows — actual import data from the sheet
        const previewRows: InwardPreviewRow[] = parsed.map(p => {
            const row = rows[p.rowIndex];
            const errorText = rowErrors.get(p.referenceId);
            const isDupe = existingRefs.has(p.referenceId);
            return {
                skuCode: p.skuCode,
                product: String(row[INWARD_LIVE_COLS.PRODUCT] ?? '').trim(),
                qty: p.qty,
                source: p.source,
                date: String(row[INWARD_LIVE_COLS.DATE] ?? '').trim(),
                doneBy: p.extra,
                tailor: p.tailor,
                status: errorText ? 'invalid' as const : isDupe ? 'duplicate' as const : 'ready' as const,
                ...(errorText ? { error: errorText } : {}),
            };
        });

        // Balance snapshot for affected SKUs (non-fatal)
        let balanceSnapshot: IngestPreviewResult['balanceSnapshot'];
        try {
            const [snapshot, erpSkus] = await Promise.all([
                readInventorySnapshot(),
                prisma.sku.findMany({
                    where: { skuCode: { in: affectedSkuCodes } },
                    select: { skuCode: true, currentBalance: true },
                }),
            ]);
            const erpByCode = new Map(erpSkus.map(s => [s.skuCode, s.currentBalance]));
            const pendingByCode = new Map<string, number>();
            for (const row of newRows) {
                pendingByCode.set(row.skuCode, (pendingByCode.get(row.skuCode) ?? 0) + row.qty);
            }
            let allInSync = true;
            const skuBalances = affectedSkuCodes.map(code => {
                const bal = snapshot.balances.get(code);
                const erpBalance = erpByCode.get(code) ?? 0;
                const colR = bal?.r ?? 0;
                const colC = bal?.c ?? 0;
                const pending = pendingByCode.get(code) ?? 0;
                const inSync = Math.abs(erpBalance - colR) < 0.01;
                if (!inSync) allInSync = false;
                const sheetPending = colC - colR;
                return {
                    skuCode: code,
                    qty: pending,
                    erpBalance,
                    afterErpBalance: erpBalance + pending,
                    sheetPending,
                    afterSheetPending: sheetPending - pending,
                    colC,
                    inSync,
                };
            });
            balanceSnapshot = { skuBalances, allInSync };
        } catch (snapErr: unknown) {
            sheetsLogger.warn({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, 'Preview balance snapshot failed (non-fatal)');
        }

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
            previewRows,
            balanceSnapshot,
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
        rowsMarkedDone: 0,
        skusUpdated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
    };

    try {
        sheetsLogger.info('Starting ingest outward');

        // Before-snapshot for balance verification (non-fatal)
        let beforeSnapshot: BalanceSnapshot | null = null;
        try {
            const snapStart = Date.now();
            beforeSnapshot = await readInventorySnapshot();
            beforeSnapshot.timestamp = String(Date.now() - snapStart);
        } catch (snapErr: unknown) {
            sheetsLogger.warn({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, 'Before-snapshot failed (non-fatal)');
        }

        const { affectedSkuIds, linkableItems, orderMap } = await ingestOutwardLive(result);

        // Link outward to order lines
        if (linkableItems.length > 0) {
            await linkOutwardToOrders(linkableItems, result, orderMap);
        }

        // Book shipment COGS for affected months (sale outwards → Dr COGS, Cr FINISHED_GOODS)
        if (linkableItems.length > 0) {
            try {
                const adminUserId = await getAdminUserId();
                const cogsMonths = new Set<string>();
                for (const item of linkableItems) {
                    const d = item.date ?? new Date();
                    const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
                    cogsMonths.add(`${ist.getFullYear()}-${ist.getMonth() + 1}`);
                }

                for (const key of cogsMonths) {
                    const [y, m] = key.split('-').map(Number);
                    const res = await bookShipmentCOGSForMonth(prisma, y, m, adminUserId);
                    sheetsLogger.info(
                        { month: `${y}-${String(m).padStart(2, '0')}`, amount: res.amount, action: res.action },
                        'Shipment COGS updated'
                    );
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                sheetsLogger.error({ error: message }, 'Shipment COGS booking failed (non-fatal)');
            }
        }

        // Balance update + cache invalidation if anything was ingested
        if (affectedSkuIds.size > 0) {
            await updateSheetBalances(affectedSkuIds, result);
        }
        if (result.outwardIngested > 0) {
            invalidateCaches();
        }

        // After-snapshot + comparison (non-fatal)
        if (beforeSnapshot && result.outwardIngested > 0) {
            try {
                sheetsLogger.info('Waiting 8s for sheet formulas to recalculate...');
                await new Promise(resolve => setTimeout(resolve, 8000));

                const afterStart = Date.now();
                const afterSnapshot = await readInventorySnapshot();
                const afterMs = Date.now() - afterStart;

                const verification = compareSnapshots(beforeSnapshot, afterSnapshot);
                verification.snapshotBeforeMs = Number(beforeSnapshot.timestamp);
                verification.snapshotAfterMs = afterMs;
                result.balanceVerification = verification;

                sheetsLogger.info({
                    passed: verification.passed,
                    totalSkusChecked: verification.totalSkusChecked,
                    drifted: verification.drifted,
                }, verification.passed ? 'Balance verification PASSED' : 'Balance verification FAILED — drift detected');
            } catch (snapErr: unknown) {
                sheetsLogger.warn({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, 'After-snapshot failed (non-fatal)');
            }
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

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AG`);
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

            // Skip already-ingested rows
            const status = String(row[OUTWARD_LIVE_COLS.IMPORT_ERRORS] ?? '').trim();
            if (status.startsWith(INGESTED_PREFIX)) continue;

            let refId = buildReferenceId(REF_PREFIX.OUTWARD_LIVE, skuCode, qty, dateStr, orderNo || dest);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            const orderNotes = String(row[OUTWARD_LIVE_COLS.ORDER_NOTE] ?? '').trim();
            const cohNotes = String(row[OUTWARD_LIVE_COLS.COH_NOTE] ?? '').trim();

            parsed.push({
                rowIndex: i, skuCode, qty,
                date: parseSheetDate(outwardDateStr) ?? parseSheetDate(orderDateStr),
                source: dest, extra: orderNo, tailor: '', barcode: '', userNotes: '',
                orderNotes, cohNotes, courier, awb,
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
        const { validRows, skipReasons, orderMap, existingOrderSkuKeys } = await validateOutwardRows(newRows, skuMap);

        // Write status column: "ok" for valid, "ok (already in ERP)" for dupes, error text for invalid
        const validRefIds = new Set(validRows.map(r => r.referenceId));
        const rowErrors = new Map<string, string>(); // referenceId → error text
        const outwardImportErrors: Array<{ rowIndex: number; error: string }> = [];
        const seenOrderSkusForErrors = new Set<string>(); // track within-batch dupes for error reporting
        for (const row of parsed) {
            if (existingRefs.has(row.referenceId)) {
                outwardImportErrors.push({ rowIndex: row.rowIndex, error: 'ok (already in ERP)' });
            } else if (validRefIds.has(row.referenceId)) {
                outwardImportErrors.push({ rowIndex: row.rowIndex, error: 'ok' });
            } else {
                const skuInfo = skuMap.get(row.skuCode);
                let reason = 'unknown';
                if (!row.skuCode) reason = 'empty_sku';
                else if (row.qty <= 0) reason = 'zero_qty';
                else if (!skuInfo) reason = 'unknown_sku';
                else if (!row.date) reason = 'invalid_date';
                else if (row.extra) {
                    const order = orderMap.get(row.extra);
                    if (!order) reason = 'order_not_found';
                    else if (!order.orderLines.some(l => l.skuId === skuInfo.id)) reason = 'order_line_not_found';
                    else {
                        const orderSkuKey = `${order.orderNumber}|${skuInfo.id}`;
                        if (existingOrderSkuKeys.has(orderSkuKey)) reason = 'duplicate_order_sku';
                        else if (seenOrderSkusForErrors.has(orderSkuKey)) reason = 'duplicate_order_sku_in_batch';
                        else seenOrderSkusForErrors.add(orderSkuKey);
                    }
                }
                outwardImportErrors.push({ rowIndex: row.rowIndex, error: reason });
                rowErrors.set(row.referenceId, reason);
            }
        }
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, outwardImportErrors, 'AG');

        const affectedSkuCodes = [...new Set(validRows.map(r => r.skuCode))];

        // Build preview rows — actual import data from the sheet
        const previewRows: OutwardPreviewRow[] = parsed.map(p => {
            const row = rows[p.rowIndex];
            const isDupe = existingRefs.has(p.referenceId);
            const errorText = rowErrors.get(p.referenceId);
            return {
                skuCode: p.skuCode,
                product: String(row[OUTWARD_LIVE_COLS.PRODUCT] ?? '').trim(),
                qty: p.qty,
                orderNo: p.extra,
                orderDate: String(row[OUTWARD_LIVE_COLS.ORDER_DATE] ?? '').trim(),
                customerName: String(row[OUTWARD_LIVE_COLS.NAME] ?? '').trim(),
                courier: p.courier,
                awb: p.awb,
                status: isDupe ? 'duplicate' as const : errorText ? 'invalid' as const : 'ready' as const,
                ...(errorText ? { error: errorText } : {}),
            };
        });

        // Balance snapshot for affected SKUs (non-fatal)
        let balanceSnapshot: IngestPreviewResult['balanceSnapshot'];
        try {
            const [snapshot, erpSkus] = await Promise.all([
                readInventorySnapshot(),
                prisma.sku.findMany({
                    where: { skuCode: { in: affectedSkuCodes } },
                    select: { skuCode: true, currentBalance: true },
                }),
            ]);
            const erpByCode = new Map(erpSkus.map(s => [s.skuCode, s.currentBalance]));
            const pendingByCode = new Map<string, number>();
            for (const row of validRows) {
                pendingByCode.set(row.skuCode, (pendingByCode.get(row.skuCode) ?? 0) + row.qty);
            }
            let allInSync = true;
            const skuBalances = affectedSkuCodes.map(code => {
                const bal = snapshot.balances.get(code);
                const erpBalance = erpByCode.get(code) ?? 0;
                const colR = bal?.r ?? 0;
                const colC = bal?.c ?? 0;
                const pending = pendingByCode.get(code) ?? 0;
                const inSync = Math.abs(erpBalance - colR) < 0.01;
                if (!inSync) allInSync = false;
                const sheetPending = colC - colR;
                return {
                    skuCode: code,
                    qty: pending,
                    erpBalance,
                    afterErpBalance: erpBalance - pending,
                    sheetPending,
                    afterSheetPending: sheetPending - pending,
                    colC,
                    inSync,
                };
            });
            balanceSnapshot = { skuBalances, allInSync };
        } catch (snapErr: unknown) {
            sheetsLogger.warn({ error: snapErr instanceof Error ? snapErr.message : String(snapErr) }, 'Preview balance snapshot failed (non-fatal)');
        }

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
            previewRows,
            balanceSnapshot,
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
    try {
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

        // Step 1: Write to Outward (Live) — use writeRange to exact row position
        // (appendRows uses values.append which auto-detects table boundaries and can paste at wrong column)
        const outwardTab = LIVE_TABS.OUTWARD;
        const existingRows = await readRange(ORDERS_MASTERSHEET_ID, `'${outwardTab}'!A:AG`);
        const startRow = existingRows.length + 1; // 1-based, after all existing rows (including header)
        const endRow = startRow + outwardRows.length - 1;
        await writeRange(
            ORDERS_MASTERSHEET_ID,
            `'${outwardTab}'!A${startRow}:AF${endRow}`,
            outwardRows
        );
        result.rowsWrittenToOutward = outwardRows.length;
        sheetsLogger.info({ tab: outwardTab, written: outwardRows.length, startRow, endRow }, 'Written shipped rows to Outward (Live)');

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
        const adBatchData = adRanges.map(range => ({
            range: `'${tab}'!AD${range.startRow}:AD${range.startRow + range.values.length - 1}`,
            values: range.values,
        }));
        await batchWriteRanges(ORDERS_MASTERSHEET_ID, adBatchData);
        sheetsLogger.info({ marked: verifiedRows.length, ranges: adRanges.length }, 'Marked Outward Done on verified source rows (batch)');

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
    } finally {
        moveShippedState.isRunning = false;
    }
}

// ============================================
// PUSH BALANCES (standalone)
// ============================================

/**
 * Preview push balances — read-only comparison of DB vs sheet values.
 * No concurrency guard needed since it doesn't mutate anything.
 */
async function previewPushBalances(): Promise<PushBalancesPreviewResult> {
    const start = Date.now();

    // 1. Fetch all SKU balances + product info from DB
    const allSkus = await prisma.sku.findMany({
        select: {
            skuCode: true,
            currentBalance: true,
            size: true,
            variation: { select: { colorName: true, product: { select: { name: true } } } },
        },
    });

    const balanceByCode = new Map<string, number>();
    const infoByCode = new Map<string, { productName: string; colorName: string; size: string }>();
    for (const sku of allSkus) {
        balanceByCode.set(sku.skuCode, sku.currentBalance);
        infoByCode.set(sku.skuCode, {
            productName: sku.variation.product.name,
            colorName: sku.variation.colorName,
            size: sku.size,
        });
    }

    const mastersheetSamples: PushBalancesPreviewResult['sampleChanges'] = [];
    const ledgerSamples: PushBalancesPreviewResult['sampleChanges'] = [];
    let mastersheetMatched = 0;
    let mastersheetWouldChange = 0;
    let ledgerMatched = 0;
    let ledgerWouldChange = 0;

    // 2. Read Mastersheet Inventory col A (SKU) + col R (ERP balance)
    try {
        const inventoryRows = await readRange(
            ORDERS_MASTERSHEET_ID,
            `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.SKU_COL}:${INVENTORY_TAB.ERP_BALANCE_COL}`
        );

        const dataStart = INVENTORY_TAB.DATA_START_ROW - 1;
        for (let i = dataStart; i < inventoryRows.length; i++) {
            const skuCode = String(inventoryRows[i]?.[0] ?? '').trim();
            if (!skuCode || !balanceByCode.has(skuCode)) continue;

            const dbValue = balanceByCode.get(skuCode)!;
            // Col R is index 17 (A=0 ... R=17)
            const sheetRaw = inventoryRows[i]?.[17];
            const sheetValue = sheetRaw != null ? Number(sheetRaw) : 0;

            if (sheetValue === dbValue) {
                mastersheetMatched++;
            } else {
                mastersheetWouldChange++;
                if (mastersheetSamples.length < 10) {
                    const info = infoByCode.get(skuCode);
                    mastersheetSamples.push({ skuCode, productName: info?.productName ?? '', colorName: info?.colorName ?? '', size: info?.size ?? '', sheet: 'Mastersheet Inventory', sheetValue, dbValue });
                }
            }
        }
    } catch (err: unknown) {
        sheetsLogger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'previewPushBalances: failed to read Inventory');
    }

    // 3. Read Office Ledger Balance (Final) col A (SKU) + col F (ERP balance)
    try {
        const balanceRows = await readRange(
            OFFICE_LEDGER_ID,
            `'${LEDGER_TABS.BALANCE_FINAL}'!A:F`
        );

        if (balanceRows.length > 2) {
            for (let i = 2; i < balanceRows.length; i++) {
                const skuCode = String(balanceRows[i]?.[0] ?? '').trim();
                if (!skuCode || !balanceByCode.has(skuCode)) continue;

                const dbValue = balanceByCode.get(skuCode)!;
                // Col F is index 5
                const sheetRaw = balanceRows[i]?.[5];
                const sheetValue = sheetRaw != null ? Number(sheetRaw) : 0;

                if (sheetValue === dbValue) {
                    ledgerMatched++;
                } else {
                    ledgerWouldChange++;
                    if (ledgerSamples.length < 10) {
                        const info = infoByCode.get(skuCode);
                        ledgerSamples.push({ skuCode, productName: info?.productName ?? '', colorName: info?.colorName ?? '', size: info?.size ?? '', sheet: 'Office Ledger Balance', sheetValue, dbValue });
                    }
                }
            }
        }
    } catch (err: unknown) {
        sheetsLogger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'previewPushBalances: failed to read Balance (Final)');
    }

    const wouldChange = mastersheetWouldChange + ledgerWouldChange;
    const alreadyCorrect = mastersheetMatched + ledgerMatched;

    return {
        totalSkusInDb: allSkus.length,
        mastersheetMatched,
        mastersheetWouldChange,
        ledgerMatched,
        ledgerWouldChange,
        alreadyCorrect,
        wouldChange,
        sampleChanges: [...mastersheetSamples, ...ledgerSamples],
        durationMs: Date.now() - start,
    };
}

async function triggerPushBalances(): Promise<PushBalancesResult | null> {
    if (pushBalancesState.isRunning) {
        sheetsLogger.warn('triggerPushBalances skipped — already running');
        return null;
    }

    pushBalancesState.isRunning = true;
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
        // Fetch all SKUs with balances in a single query
        const skus = await prisma.sku.findMany({
            select: { id: true, skuCode: true, currentBalance: true },
        });

        sheetsLogger.info({ skuCount: skus.length }, 'Push balances: fetched all SKUs');

        const tracker = { errors: 0, skusUpdated: 0 };

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
                const batchData = ranges.map(range => ({
                    range: `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.ERP_BALANCE_COL}${range.startRow}:${INVENTORY_TAB.ERP_BALANCE_COL}${range.startRow + range.values.length - 1}`,
                    values: range.values,
                }));
                await batchWriteRanges(ORDERS_MASTERSHEET_ID, batchData);
                totalUpdated += updates.length;
                sheetsLogger.info({ updated: updates.length, ranges: ranges.length }, 'Push balances: Inventory col R updated (batch)');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message }, 'Push balances: Failed to update Inventory col R');
            tracker.errors++;
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
                    const batchData = ranges.map(range => ({
                        range: `'${LEDGER_TABS.BALANCE_FINAL}'!F${range.startRow}:F${range.startRow + range.values.length - 1}`,
                        values: range.values,
                    }));
                    await batchWriteRanges(OFFICE_LEDGER_ID, batchData);
                    totalUpdated += updates.length;
                    sheetsLogger.info({ updated: updates.length }, 'Push balances: Balance (Final) col F updated (batch)');
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message }, 'Push balances: Failed to update Balance (Final) col F');
            tracker.errors++;
        }

        tracker.skusUpdated = totalUpdated;

        const result: PushBalancesResult = {
            startedAt,
            skusUpdated: tracker.skusUpdated,
            errors: tracker.errors,
            durationMs: Date.now() - start,
            error: null,
        };

        pushBalancesState.lastRunAt = new Date();
        pushBalancesState.lastResult = result;
        pushRecentRun(pushBalancesState, {
            startedAt,
            durationMs: result.durationMs,
            count: result.skusUpdated,
            error: null,
        });

        sheetsLogger.info({
            skusUpdated: result.skusUpdated,
            errors: result.errors,
            durationMs: result.durationMs,
        }, 'triggerPushBalances completed');

        return result;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'triggerPushBalances failed');

        const result: PushBalancesResult = {
            startedAt,
            skusUpdated: 0,
            errors: 1,
            durationMs: Date.now() - start,
            error: message,
        };

        pushBalancesState.lastRunAt = new Date();
        pushBalancesState.lastResult = result;
        pushRecentRun(pushBalancesState, {
            startedAt,
            durationMs: result.durationMs,
            count: 0,
            error: message,
        });

        return result;
    } finally {
        pushBalancesState.isRunning = false;
    }
}

// ============================================
// BUFFER ROW COUNTS (for admin UI)
// ============================================

async function getBufferCounts(): Promise<{ inward: number; outward: number }> {
    try {
        const [inwardRows, outwardRows] = await Promise.all([
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.INWARD}'!A:J`),
            readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.OUTWARD}'!A:AG`),
        ]);

        // Only count rows where SKU exists AND status is not DONE
        const countActive = (rows: unknown[][], skuIdx: number, statusIdx: number) =>
            rows.length <= 1 ? 0 : rows.slice(1).filter(r =>
                String((r as string[])[skuIdx] ?? '').trim() &&
                !String((r as string[])[statusIdx] ?? '').trim().startsWith(INGESTED_PREFIX)
            ).length;

        return {
            inward: countActive(inwardRows, INWARD_LIVE_COLS.SKU, INWARD_LIVE_COLS.IMPORT_ERRORS),
            outward: countActive(outwardRows, OUTWARD_LIVE_COLS.SKU, OUTWARD_LIVE_COLS.IMPORT_ERRORS),
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'Failed to get buffer counts');
        return { inward: -1, outward: -1 };
    }
}

// ============================================
// JOB 4: CLEANUP DONE ROWS
// ============================================

async function triggerCleanupDoneRows(): Promise<CleanupDoneResult | null> {
    if (cleanupDoneState.isRunning) {
        sheetsLogger.debug('Cleanup DONE rows already in progress, skipping');
        return null;
    }

    cleanupDoneState.isRunning = true;
    try {
    const startTime = Date.now();
    const result: CleanupDoneResult = {
        startedAt: new Date().toISOString(),
        inwardDeleted: 0,
        outwardDeleted: 0,
        fabricInwardDeleted: 0,
        errors: [],
        durationMs: 0,
    };

    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_RETENTION_DAYS);
        sheetsLogger.info({ cutoffDate: cutoffDate.toISOString(), retentionDays: CLEANUP_RETENTION_DAYS }, 'Starting DONE row cleanup');

        // --- Inward (Live) ---
        try {
            const inwardRows = await readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.INWARD}'!A:J`);
            const inwardToDelete: number[] = [];

            for (let i = 1; i < inwardRows.length; i++) {
                const row = inwardRows[i];
                const status = String(row[INWARD_LIVE_COLS.IMPORT_ERRORS] ?? '').trim();
                if (!status.startsWith(INGESTED_PREFIX)) continue;

                const dateStr = String(row[INWARD_LIVE_COLS.DATE] ?? '');
                const rowDate = parseSheetDate(dateStr);
                if (rowDate && rowDate < cutoffDate) {
                    inwardToDelete.push(i);
                }
            }

            if (inwardToDelete.length > 0) {
                const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, LIVE_TABS.INWARD);
                await deleteRowsBatch(ORDERS_MASTERSHEET_ID, sheetId, inwardToDelete);
                result.inwardDeleted = inwardToDelete.length;
                sheetsLogger.info({ deleted: inwardToDelete.length }, 'Cleaned up DONE inward rows');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Inward cleanup failed: ${message}`);
            sheetsLogger.error({ error: message }, 'Failed to cleanup inward DONE rows');
        }

        // --- Outward (Live) ---
        try {
            const outwardRows = await readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.OUTWARD}'!A:AG`);
            const outwardToDelete: number[] = [];

            for (let i = 1; i < outwardRows.length; i++) {
                const row = outwardRows[i];
                const status = String(row[OUTWARD_LIVE_COLS.IMPORT_ERRORS] ?? '').trim();
                if (!status.startsWith(INGESTED_PREFIX)) continue;

                const outwardDateStr = String(row[OUTWARD_LIVE_COLS.OUTWARD_DATE] ?? '');
                const orderDateStr = String(row[OUTWARD_LIVE_COLS.ORDER_DATE] ?? '');
                const rowDate = parseSheetDate(outwardDateStr) ?? parseSheetDate(orderDateStr);
                if (rowDate && rowDate < cutoffDate) {
                    outwardToDelete.push(i);
                }
            }

            if (outwardToDelete.length > 0) {
                const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, LIVE_TABS.OUTWARD);
                await deleteRowsBatch(ORDERS_MASTERSHEET_ID, sheetId, outwardToDelete);
                result.outwardDeleted = outwardToDelete.length;
                sheetsLogger.info({ deleted: outwardToDelete.length }, 'Cleaned up DONE outward rows');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Outward cleanup failed: ${message}`);
            sheetsLogger.error({ error: message }, 'Failed to cleanup outward DONE rows');
        }

        // --- Fabric Inward (Live) ---
        try {
            const fabricRows = await readRange(ORDERS_MASTERSHEET_ID, `'${LIVE_TABS.FABRIC_INWARD}'!A:K`);
            const fabricToDelete: number[] = [];

            for (let i = 1; i < fabricRows.length; i++) {
                const row = fabricRows[i];
                const status = String(row[FABRIC_INWARD_LIVE_COLS.STATUS] ?? '').trim();
                if (!status.startsWith(INGESTED_PREFIX)) continue;

                const dateStr = String(row[FABRIC_INWARD_LIVE_COLS.DATE] ?? '');
                const rowDate = parseSheetDate(dateStr);
                if (rowDate && rowDate < cutoffDate) {
                    fabricToDelete.push(i);
                }
            }

            if (fabricToDelete.length > 0) {
                const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, LIVE_TABS.FABRIC_INWARD);
                await deleteRowsBatch(ORDERS_MASTERSHEET_ID, sheetId, fabricToDelete);
                result.fabricInwardDeleted = fabricToDelete.length;
                sheetsLogger.info({ deleted: fabricToDelete.length }, 'Cleaned up DONE fabric inward rows');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Fabric inward cleanup failed: ${message}`);
            sheetsLogger.error({ error: message }, 'Failed to cleanup fabric inward DONE rows');
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(message);
        sheetsLogger.error({ error: message }, 'triggerCleanupDoneRows failed');
    }

    result.durationMs = Date.now() - startTime;
    cleanupDoneState.lastRunAt = new Date();
    cleanupDoneState.lastResult = result;
    pushRecentRun(cleanupDoneState, {
        startedAt: result.startedAt,
        durationMs: result.durationMs,
        count: result.inwardDeleted + result.outwardDeleted + result.fabricInwardDeleted,
        error: result.errors.length > 0 ? result.errors[0] : null,
    });

    sheetsLogger.info({
        inwardDeleted: result.inwardDeleted,
        outwardDeleted: result.outwardDeleted,
        fabricInwardDeleted: result.fabricInwardDeleted,
        errors: result.errors.length,
        durationMs: result.durationMs,
    }, 'triggerCleanupDoneRows completed');

    return result;
    } finally {
        cleanupDoneState.isRunning = false;
    }
}

// ============================================
// JOB 5: MIGRATE SHEET FORMULAS (ONE-TIME)
// ============================================

async function triggerMigrateFormulas(): Promise<MigrateFormulasResult | null> {
    if (migrateFormulasState.isRunning) {
        sheetsLogger.debug('Migrate formulas already in progress, skipping');
        return null;
    }

    migrateFormulasState.isRunning = true;
    try {
    const startTime = Date.now();
    const result: MigrateFormulasResult = {
        startedAt: new Date().toISOString(),
        inventoryRowsUpdated: 0,
        balanceFinalRowsUpdated: 0,
        errors: [],
        durationMs: 0,
    };

    try {
        sheetsLogger.info('Starting formula migration to SUMIFS');

        // --- Target 1: Inventory tab col C (Mastersheet) ---
        try {
            const inventoryRows = await readRange(
                ORDERS_MASTERSHEET_ID,
                `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.SKU_COL}:${INVENTORY_TAB.SKU_COL}`
            );

            const dataStart = INVENTORY_TAB.DATA_START_ROW; // 1-based row number
            const formulas: string[][] = [];

            for (let i = dataStart - 1; i < inventoryRows.length; i++) {
                const skuCode = String(inventoryRows[i]?.[0] ?? '').trim();
                if (!skuCode) break; // stop at first empty row
                formulas.push([INVENTORY_BALANCE_FORMULA_TEMPLATE(i + 1)]);
            }

            if (formulas.length > 0) {
                const rangeStr = `'${INVENTORY_TAB.NAME}'!${INVENTORY_TAB.BALANCE_COL}${dataStart}:${INVENTORY_TAB.BALANCE_COL}${dataStart + formulas.length - 1}`;
                await writeRange(ORDERS_MASTERSHEET_ID, rangeStr, formulas);
                result.inventoryRowsUpdated = formulas.length;
                sheetsLogger.info({ updated: formulas.length }, 'Inventory col C formulas migrated');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Inventory formula migration failed: ${message}`);
            sheetsLogger.error({ error: message }, 'Failed to migrate Inventory formulas');
        }

        // --- Target 2: Balance (Final) col E (Office Ledger) ---
        try {
            const balanceRows = await readRange(
                OFFICE_LEDGER_ID,
                `'${LEDGER_TABS.BALANCE_FINAL}'!A:A`
            );

            if (balanceRows.length > 2) {
                const formulas: string[][] = [];

                for (let i = 2; i < balanceRows.length; i++) {
                    const skuCode = String(balanceRows[i]?.[0] ?? '').trim();
                    if (!skuCode) break;
                    formulas.push([LIVE_BALANCE_FORMULA_V2_TEMPLATE(i + 1)]);
                }

                if (formulas.length > 0) {
                    const startRow = 3; // data starts at row 3
                    const rangeStr = `'${LEDGER_TABS.BALANCE_FINAL}'!E${startRow}:E${startRow + formulas.length - 1}`;
                    await writeRange(OFFICE_LEDGER_ID, rangeStr, formulas);
                    result.balanceFinalRowsUpdated = formulas.length;
                    sheetsLogger.info({ updated: formulas.length }, 'Balance (Final) col E formulas migrated');
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Balance (Final) formula migration failed: ${message}`);
            sheetsLogger.error({ error: message }, 'Failed to migrate Balance (Final) formulas');
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(message);
        sheetsLogger.error({ error: message }, 'triggerMigrateFormulas failed');
    }

    result.durationMs = Date.now() - startTime;
    migrateFormulasState.lastRunAt = new Date();
    migrateFormulasState.lastResult = result;
    pushRecentRun(migrateFormulasState, {
        startedAt: result.startedAt,
        durationMs: result.durationMs,
        count: result.inventoryRowsUpdated + result.balanceFinalRowsUpdated,
        error: result.errors.length > 0 ? result.errors[0] : null,
    });

    sheetsLogger.info({
        inventoryRowsUpdated: result.inventoryRowsUpdated,
        balanceFinalRowsUpdated: result.balanceFinalRowsUpdated,
        errors: result.errors.length,
        durationMs: result.durationMs,
    }, 'triggerMigrateFormulas completed');

    return result;
    } finally {
        migrateFormulasState.isRunning = false;
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

    sheetsLogger.info('Sheet offload worker ready (manual trigger only)');
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
        cleanupDone: {
            isRunning: cleanupDoneState.isRunning,
            lastRunAt: cleanupDoneState.lastRunAt,
            lastResult: cleanupDoneState.lastResult,
            recentRuns: [...cleanupDoneState.recentRuns],
        },
        migrateFormulas: {
            isRunning: migrateFormulasState.isRunning,
            lastRunAt: migrateFormulasState.lastRunAt,
            lastResult: migrateFormulasState.lastResult,
            recentRuns: [...migrateFormulasState.recentRuns],
        },
        pushBalances: {
            isRunning: pushBalancesState.isRunning,
            lastRunAt: pushBalancesState.lastRunAt,
            lastResult: pushBalancesState.lastResult,
            recentRuns: [...pushBalancesState.recentRuns],
        },
        pushFabricBalances: {
            isRunning: pushFabricBalancesState.isRunning,
            lastRunAt: pushFabricBalancesState.lastRunAt,
            lastResult: pushFabricBalancesState.lastResult,
            recentRuns: [...pushFabricBalancesState.recentRuns],
        },
        importFabricBalances: {
            isRunning: importFabricBalancesState.isRunning,
            lastRunAt: importFabricBalancesState.lastRunAt,
            lastResult: importFabricBalancesState.lastResult,
            recentRuns: [...importFabricBalancesState.recentRuns],
        },
        fabricInward: {
            isRunning: fabricInwardState.isRunning,
            lastRunAt: fabricInwardState.lastRunAt,
            lastResult: fabricInwardState.lastResult,
            recentRuns: [...fabricInwardState.recentRuns],
        },
        schedulerActive,
    };
}

// ============================================
// JOB: PUSH FABRIC BALANCES TO SHEET
// ============================================

/**
 * Syncs all active fabric colours to the "Fabric Balances" tab in the Mastersheet.
 *
 * - Adds any new colours that don't exist in the sheet yet
 * - Updates System Balance (col F) for all rows
 * - Preserves user-entered Physical Count (col G), Notes (col I), and Status (col J)
 * - Recalculates Variance formulas (col H)
 */
async function triggerPushFabricBalances(): Promise<PushFabricBalancesResult | null> {
    if (pushFabricBalancesState.isRunning) {
        sheetsLogger.warn('triggerPushFabricBalances skipped — already running');
        return null;
    }

    pushFabricBalancesState.isRunning = true;
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
        // 1. Fetch all active fabric colours from DB
        const colours = await prisma.fabricColour.findMany({
            where: { isActive: true },
            include: {
                fabric: { include: { material: true } },
            },
        });

        // Sort: Material → Fabric → Colour
        colours.sort((a, b) => {
            const matA = a.fabric?.material?.name ?? '';
            const matB = b.fabric?.material?.name ?? '';
            if (matA !== matB) return matA.localeCompare(matB);
            const fabA = a.fabric?.name ?? '';
            const fabB = b.fabric?.name ?? '';
            if (fabA !== fabB) return fabA.localeCompare(fabB);
            return a.colourName.localeCompare(b.colourName);
        });

        sheetsLogger.info({ count: colours.length }, 'pushFabricBalances: fetched fabric colours');

        // 2. Read existing sheet to preserve user-entered data
        const tabName = MASTERSHEET_TABS.FABRIC_BALANCES;
        let existingRows: string[][] = [];
        try {
            existingRows = await readRange(ORDERS_MASTERSHEET_ID, `'${tabName}'!A:J`);
        } catch {
            sheetsLogger.warn('pushFabricBalances: Fabric Balances tab not found — will write fresh');
        }

        // Build map of existing data keyed by fabric code
        const preservedData = new Map<string, { physicalCount: string; notes: string; status: string }>();
        for (let i = 1; i < existingRows.length; i++) {
            const row = existingRows[i];
            const code = String(row?.[FABRIC_BALANCES_COLS.FABRIC_CODE] ?? '').trim();
            if (code) {
                preservedData.set(code, {
                    physicalCount: String(row?.[FABRIC_BALANCES_COLS.PHYSICAL_COUNT] ?? ''),
                    notes: String(row?.[FABRIC_BALANCES_COLS.NOTES] ?? ''),
                    status: String(row?.[FABRIC_BALANCES_COLS.STATUS] ?? ''),
                });
            }
        }

        const existingCodes = new Set(preservedData.keys());
        let newColoursAdded = 0;

        // 3. Build data rows
        const formatUnit = (unit: string | null) => {
            if (!unit) return '';
            if (unit === 'meters' || unit === 'm') return 'm';
            return unit;
        };

        const dataRows: (string | number)[][] = colours.map((fc, i) => {
            const materialName = fc.fabric?.material?.name ?? 'Unknown';
            const fabricName = fc.fabric?.name ?? 'Unknown';
            const code = fc.code || generateFabricColourCode(materialName, fabricName, fc.colourName);
            const rowNum = i + 2;

            // Preserve user data — but clear Physical Count & Status for DONE rows (fresh slate)
            const preserved = preservedData.get(code);
            if (!existingCodes.has(code)) newColoursAdded++;
            const isDone = preserved?.status?.startsWith('DONE:') ?? false;

            return [
                code,
                materialName,
                fabricName,
                fc.colourName,
                formatUnit(fc.fabric?.unit ?? ''),
                fc.currentBalance,
                isDone ? '' : (preserved?.physicalCount ?? ''),
                `=IF(G${rowNum}="","",G${rowNum}-F${rowNum})`,
                isDone ? '' : (preserved?.notes ?? ''),
                isDone ? '' : (preserved?.status ?? ''),
            ];
        });

        // 4. Write headers + data
        const allRows: (string | number)[][] = [[...FABRIC_BALANCES_HEADERS], ...dataRows];

        await writeRange(
            ORDERS_MASTERSHEET_ID,
            `'${tabName}'!A1:J${allRows.length}`,
            allRows,
        );

        // 5. Clear the Count Date + Time cells (fresh slate for next count)
        await batchWriteRanges(ORDERS_MASTERSHEET_ID, [
            { range: `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.DATE_CELL}`, values: [['']] },
            { range: `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.TIME_CELL}`, values: [['']] },
        ]);

        sheetsLogger.info({
            totalColours: colours.length,
            newColoursAdded,
            existingPreserved: preservedData.size,
        }, 'pushFabricBalances: sheet updated');

        const result: PushFabricBalancesResult = {
            startedAt,
            totalColours: colours.length,
            newColoursAdded,
            balancesUpdated: colours.length,
            errors: 0,
            durationMs: Date.now() - start,
            error: null,
        };

        pushFabricBalancesState.lastRunAt = new Date();
        pushFabricBalancesState.lastResult = result;
        pushRecentRun(pushFabricBalancesState, {
            startedAt,
            durationMs: result.durationMs,
            count: result.totalColours,
            error: null,
        });

        return result;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'triggerPushFabricBalances failed');

        const result: PushFabricBalancesResult = {
            startedAt,
            totalColours: 0,
            newColoursAdded: 0,
            balancesUpdated: 0,
            errors: 1,
            durationMs: Date.now() - start,
            error: message,
        };

        pushFabricBalancesState.lastRunAt = new Date();
        pushFabricBalancesState.lastResult = result;
        pushRecentRun(pushFabricBalancesState, {
            startedAt,
            durationMs: result.durationMs,
            count: 0,
            error: message,
        });

        return result;
    } finally {
        pushFabricBalancesState.isRunning = false;
    }
}

// ============================================
// JOB: IMPORT FABRIC BALANCES FROM SHEET
// ============================================

/**
 * Reads Physical Count values from the "Fabric Balances" sheet tab,
 * compares with DB balances **at the count time**, and creates backdated
 * adjustment FabricColourTransactions to reconcile.
 *
 * The team enters a "Count Date/Time" (cell M1) — when they physically
 * counted the stock. The import calculates what the DB balance was at
 * that exact time, so transactions after the count (e.g., today's sampling)
 * don't affect the adjustment.
 *
 * Only processes rows where:
 *   - Physical Count (col G) is filled
 *   - Status (col J) does NOT start with "DONE:"
 *
 * After creating transactions:
 *   - Pushes fresh current balances to System Balance column
 *   - Clears Physical Count, Notes, Status (clean for next count)
 *   - Clears the Count Date/Time field
 */
async function triggerImportFabricBalances(): Promise<ImportFabricBalancesResult | null> {
    if (importFabricBalancesState.isRunning) {
        sheetsLogger.warn('triggerImportFabricBalances skipped — already running');
        return null;
    }

    importFabricBalancesState.isRunning = true;
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
        const tabName = MASTERSHEET_TABS.FABRIC_BALANCES;

        // 1. Read the sheet + Count Date + Time cells
        const [rows, countDateRows, countTimeRows] = await Promise.all([
            readRange(ORDERS_MASTERSHEET_ID, `'${tabName}'!A:J`),
            readRange(ORDERS_MASTERSHEET_ID, `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.DATE_CELL}`),
            readRange(ORDERS_MASTERSHEET_ID, `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.TIME_CELL}`),
        ]);

        if (rows.length <= 1) {
            const result: ImportFabricBalancesResult = {
                startedAt, rowsWithCounts: 0, adjustmentsCreated: 0,
                alreadyMatching: 0, skipped: 0, skipReasons: {},
                adjustments: [], durationMs: Date.now() - start, error: 'No data rows in sheet',
            };
            importFabricBalancesState.lastRunAt = new Date();
            importFabricBalancesState.lastResult = result;
            pushRecentRun(importFabricBalancesState, { startedAt, durationMs: result.durationMs, count: 0, error: result.error });
            return result;
        }

        // Parse Count Date + Time — REQUIRED for accurate reconciliation
        const countDateStr = String(countDateRows?.[0]?.[0] ?? '').trim();
        const countTimeStr = String(countTimeRows?.[0]?.[0] ?? '').trim();

        // Combine date + time into a single string for parsing (e.g., "10/02/2026 7:00 PM")
        const combinedDateTimeStr = countTimeStr ? `${countDateStr} ${countTimeStr}` : countDateStr;
        const countDateTime = parseSheetDateTime(combinedDateTimeStr);

        if (!countDateTime) {
            const errorMsg = !countDateStr
                ? 'Count Date (cell M1) is empty. Pick the date when the physical count was taken.'
                : `Could not parse count date/time: "${combinedDateTimeStr}". Pick a date in M1 and time in O1.`;
            const result: ImportFabricBalancesResult = {
                startedAt, rowsWithCounts: 0, adjustmentsCreated: 0,
                alreadyMatching: 0, skipped: 0, skipReasons: {},
                adjustments: [], durationMs: Date.now() - start, error: errorMsg,
            };
            importFabricBalancesState.lastRunAt = new Date();
            importFabricBalancesState.lastResult = result;
            pushRecentRun(importFabricBalancesState, { startedAt, durationMs: result.durationMs, count: 0, error: errorMsg });
            return result;
        }

        const countDateTimeStr = combinedDateTimeStr;

        sheetsLogger.info({ totalRows: rows.length - 1, countDateTime: countDateTime.toISOString() }, 'importFabricBalances: reading sheet');

        // 2. Look up all fabric colours by code
        const fabricColours = await prisma.fabricColour.findMany({
            where: { isActive: true },
            include: { fabric: { include: { material: true } } },
        });

        const codeToColour = new Map<string, typeof fabricColours[0]>();
        for (const fc of fabricColours) {
            if (fc.code) codeToColour.set(fc.code, fc);
        }

        // 2b. Calculate balance AT COUNT TIME for all fabric colours
        // balance_at_time = SUM(inward where createdAt <= time) - SUM(outward where createdAt <= time)
        const allFabricColourIds = fabricColours.map(fc => fc.id);
        const txnAggregations = await prisma.fabricColourTransaction.groupBy({
            by: ['fabricColourId', 'txnType'],
            where: {
                fabricColourId: { in: allFabricColourIds },
                createdAt: { lte: countDateTime },
            },
            _sum: { qty: true },
        });

        const historicalBalanceMap = new Map<string, number>();
        for (const agg of txnAggregations) {
            const prev = historicalBalanceMap.get(agg.fabricColourId) ?? 0;
            const qty = Number(agg._sum.qty) || 0;
            if (agg.txnType === 'inward') {
                historicalBalanceMap.set(agg.fabricColourId, prev + qty);
            } else {
                historicalBalanceMap.set(agg.fabricColourId, prev - qty);
            }
        }

        sheetsLogger.info({ coloursWithHistory: historicalBalanceMap.size }, 'importFabricBalances: calculated historical balances');

        // 3. Get admin user
        const adminUserId = await getAdminUserId();

        // 4. Parse rows
        const skipReasons: Record<string, number> = {};
        const addSkip = (reason: string) => { skipReasons[reason] = (skipReasons[reason] || 0) + 1; };

        interface PendingAdjustment {
            sheetRow: number;
            fabricColourId: string;
            fabricCode: string;
            colour: string;
            fabric: string;
            unit: string;
            systemBalance: number;
            physicalCount: number;
            delta: number;
        }

        const pendingAdjustments: PendingAdjustment[] = [];
        const matchingRows: number[] = [];  // sheetRows where physical = system
        let rowsWithCounts = 0;
        let alreadyDone = 0;

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const sheetRow = i + 1;
            const fabricCode = String(row?.[FABRIC_BALANCES_COLS.FABRIC_CODE] ?? '').trim();
            const physicalStr = String(row?.[FABRIC_BALANCES_COLS.PHYSICAL_COUNT] ?? '').trim();
            const status = String(row?.[FABRIC_BALANCES_COLS.STATUS] ?? '').trim();

            // Skip already-imported
            if (status.startsWith('DONE:')) {
                alreadyDone++;
                continue;
            }

            // Skip empty physical count
            if (physicalStr === '') continue;

            rowsWithCounts++;

            // Parse physical count
            const physicalCount = parseFloat(physicalStr.replace(/,/g, ''));
            if (isNaN(physicalCount)) {
                addSkip(`invalid_number: ${physicalStr}`);
                continue;
            }
            if (physicalCount < 0) {
                addSkip('negative_value');
                continue;
            }

            // Look up fabric colour
            const fc = codeToColour.get(fabricCode);
            if (!fc) {
                addSkip('unknown_fabric_code');
                continue;
            }

            // Compare with DB balance AT COUNT TIME (not current)
            const systemBalance = historicalBalanceMap.get(fc.id) ?? 0;
            const delta = physicalCount - systemBalance;

            if (Math.abs(delta) < 0.01) {
                matchingRows.push(sheetRow);
                continue;
            }

            pendingAdjustments.push({
                sheetRow, fabricColourId: fc.id, fabricCode,
                colour: fc.colourName, fabric: fc.fabric?.name ?? 'Unknown',
                unit: normalizeFabricUnit(fc.fabric?.unit ?? null),
                systemBalance, physicalCount, delta,
            });
        }

        sheetsLogger.info({
            rowsWithCounts,
            adjustmentsNeeded: pendingAdjustments.length,
            alreadyMatching: matchingRows.length,
            alreadyDone,
            skipped: Object.values(skipReasons).reduce((a, b) => a + b, 0),
        }, 'importFabricBalances: parsed rows');

        // 5. Create adjustment transactions — backdated to count time
        const timestamp = countDateTime.toISOString();
        const adjustmentResults: ImportFabricBalancesResult['adjustments'] = [];

        for (const adj of pendingAdjustments) {
            const txnType = adj.delta > 0 ? FABRIC_TXN_TYPE.INWARD : FABRIC_TXN_TYPE.OUTWARD;
            const qty = Math.abs(adj.delta);
            const referenceId = `fabric-recon:${adj.fabricCode}:${timestamp}`;

            await prisma.fabricColourTransaction.create({
                data: {
                    fabricColourId: adj.fabricColourId,
                    txnType,
                    qty,
                    unit: adj.unit,
                    reason: 'reconciliation',
                    referenceId,
                    notes: `[fabric-reconciliation] Count at ${countDateTimeStr}. Physical: ${adj.physicalCount}, System@time: ${adj.systemBalance}, Adj: ${adj.delta > 0 ? '+' : ''}${adj.delta.toFixed(2)}`,
                    createdById: adminUserId,
                    createdAt: countDateTime,  // Backdate to count time
                },
            });

            adjustmentResults.push({
                fabricCode: adj.fabricCode,
                colour: adj.colour,
                fabric: adj.fabric,
                systemBalance: adj.systemBalance,
                physicalCount: adj.physicalCount,
                delta: adj.delta,
                type: adj.delta > 0 ? 'inward' : 'outward',
            });

            sheetsLogger.debug({
                fabricCode: adj.fabricCode,
                txnType,
                qty,
                delta: adj.delta,
            }, 'importFabricBalances: created adjustment');
        }

        // 6. Wait for DB triggers, then refresh balances
        if (pendingAdjustments.length > 0) {
            await new Promise(r => setTimeout(r, 2000));
        }

        // Build a sheetRow→fabricColour map for all processed rows
        const sheetRowToFc = new Map<number, { fabricColourId: string; physicalCount: number }>();
        for (const adj of pendingAdjustments) {
            sheetRowToFc.set(adj.sheetRow, { fabricColourId: adj.fabricColourId, physicalCount: adj.physicalCount });
        }
        // For matching rows, re-parse to get their fabricColourId
        for (const sheetRow of matchingRows) {
            const row = rows[sheetRow - 1];
            const code = String(row?.[FABRIC_BALANCES_COLS.FABRIC_CODE] ?? '').trim();
            const fc = codeToColour.get(code);
            const physicalStr = String(row?.[FABRIC_BALANCES_COLS.PHYSICAL_COUNT] ?? '').trim();
            if (fc) {
                sheetRowToFc.set(sheetRow, { fabricColourId: fc.id, physicalCount: parseFloat(physicalStr.replace(/,/g, '')) || 0 });
            }
        }

        // Fetch fresh balances from DB
        const allFcIds = [...new Set([...sheetRowToFc.values()].map(v => v.fabricColourId))];
        const updatedColours = allFcIds.length > 0
            ? await prisma.fabricColour.findMany({ where: { id: { in: allFcIds } }, select: { id: true, currentBalance: true } })
            : [];
        const balanceMap = new Map(updatedColours.map(c => [c.id, c.currentBalance]));

        // 7. Update sheet: refresh System Balance, verify, then clear entry columns
        const now = new Date().toISOString().slice(0, 19);
        const sheetUpdates: Array<{ range: string; values: (string | number)[][] }> = [];

        // All processed rows (adjustments + matching): update balance, clear Physical Count & Status
        const allSheetRows = [...pendingAdjustments.map(a => a.sheetRow), ...matchingRows];
        for (const sheetRow of allSheetRows) {
            const info = sheetRowToFc.get(sheetRow);
            if (!info) continue;
            const newBalance = balanceMap.get(info.fabricColourId) ?? info.physicalCount;

            // Push fresh System Balance
            sheetUpdates.push({
                range: `'${tabName}'!F${sheetRow}`,
                values: [[newBalance]],
            });
            // Clear Physical Count (col G) — sheet is clean for next stock count
            sheetUpdates.push({
                range: `'${tabName}'!G${sheetRow}`,
                values: [['']],
            });
            // Clear Notes (col I)
            sheetUpdates.push({
                range: `'${tabName}'!I${sheetRow}`,
                values: [['']],
            });
            // Clear Status (col J)
            sheetUpdates.push({
                range: `'${tabName}'!J${sheetRow}`,
                values: [['']],
            });
        }

        // Also clear the Count Date + Time fields (clean for next round)
        sheetUpdates.push({
            range: `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.DATE_CELL}`,
            values: [['']],
        });
        sheetUpdates.push({
            range: `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.TIME_CELL}`,
            values: [['']],
        });

        if (sheetUpdates.length > 0) {
            await batchWriteRanges(ORDERS_MASTERSHEET_ID, sheetUpdates);
            sheetsLogger.info({ sheetUpdates: sheetUpdates.length }, 'importFabricBalances: pushed balances & cleared entry columns');
        }

        const skippedCount = Object.values(skipReasons).reduce((a, b) => a + b, 0);

        const result: ImportFabricBalancesResult = {
            startedAt,
            rowsWithCounts,
            adjustmentsCreated: pendingAdjustments.length,
            alreadyMatching: matchingRows.length,
            skipped: skippedCount,
            skipReasons,
            adjustments: adjustmentResults,
            durationMs: Date.now() - start,
            error: null,
        };

        importFabricBalancesState.lastRunAt = new Date();
        importFabricBalancesState.lastResult = result;
        pushRecentRun(importFabricBalancesState, {
            startedAt, durationMs: result.durationMs, count: result.adjustmentsCreated, error: null,
        });

        sheetsLogger.info({
            adjustmentsCreated: result.adjustmentsCreated,
            alreadyMatching: result.alreadyMatching,
            skipped: result.skipped,
            durationMs: result.durationMs,
        }, 'triggerImportFabricBalances completed');

        return result;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ error: message }, 'triggerImportFabricBalances failed');

        const result: ImportFabricBalancesResult = {
            startedAt, rowsWithCounts: 0, adjustmentsCreated: 0,
            alreadyMatching: 0, skipped: 0, skipReasons: {},
            adjustments: [], durationMs: Date.now() - start, error: message,
        };

        importFabricBalancesState.lastRunAt = new Date();
        importFabricBalancesState.lastResult = result;
        pushRecentRun(importFabricBalancesState, {
            startedAt, durationMs: result.durationMs, count: 0, error: message,
        });

        return result;
    } finally {
        importFabricBalancesState.isRunning = false;
    }
}

// ============================================
// JOB: FABRIC INWARD (LIVE) — PREVIEW & IMPORT
// ============================================

/**
 * Builds a content-based reference ID for fabric inward rows.
 * Format: sheet:fabric-inward-live:{code}:{qty}:{date}:{supplier}
 */
function buildFabricInwardRefId(
    fabricCode: string,
    qty: number,
    dateStr: string,
    supplier: string
): string {
    const datePart = dateStr.replace(/[/\-.\s]/g, '').slice(0, 8) || 'nodate';
    const supplierPart = supplier.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return `${REF_PREFIX.FABRIC_INWARD_LIVE}:${fabricCode}:${qty}:${datePart}:${supplierPart}`;
}

/**
 * Parse a numeric value that may be a float (fabric quantities can be decimal).
 */
/**
 * Parse fabric quantity — allows decimals (meters/kg) but rejects Infinity/NaN/negative.
 * Returns 0 for empty/invalid, -2 for Infinity/NaN.
 */
function parseFabricQty(value: string | undefined): number {
    if (!value?.trim()) return 0;
    const num = Number(value.trim());
    if (!Number.isFinite(num)) return -2;
    return num > 0 ? num : 0;
}

/**
 * Preview Fabric Inward (Live) — dry run.
 * Reads the tab, validates rows, writes status column, returns preview.
 */
async function previewFabricInward(): Promise<FabricInwardPreviewResult | null> {
    if (fabricInwardState.isRunning) {
        sheetsLogger.debug('Fabric inward already in progress, skipping preview');
        return null;
    }

    fabricInwardState.isRunning = true;
    const startTime = Date.now();

    try {
        const tab = LIVE_TABS.FABRIC_INWARD;
        sheetsLogger.info({ tab }, 'Preview: reading fabric inward live tab');

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:K`);
        if (rows.length <= 1) {
            return {
                tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0,
                validationErrors: {}, affectedFabricCodes: [],
                durationMs: Date.now() - startTime,
            };
        }

        // Fetch all active fabric colours for validation
        const allFabricColours = await prisma.fabricColour.findMany({
            where: { isActive: true },
            select: { id: true, code: true, colourName: true, fabric: { select: { name: true, unit: true, material: { select: { name: true } } } } },
        });
        const fabricByCode = new Map(allFabricColours.map(fc => [fc.code, fc]));

        // Parse rows
        interface FabricInwardParsed {
            rowIndex: number;
            fabricCode: string;
            material: string;
            fabric: string;
            colour: string;
            qty: number;
            unit: string;
            costPerUnit: number;
            supplier: string;
            dateStr: string;
            date: Date | null;
            notes: string;
            referenceId: string;
        }

        const parsed: FabricInwardParsed[] = [];
        const seenRefs = new Set<string>();

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const fabricCode = String(row[FABRIC_INWARD_LIVE_COLS.FABRIC_CODE] ?? '').trim();
            if (!fabricCode) continue;

            // Skip already-ingested rows
            const status = String(row[FABRIC_INWARD_LIVE_COLS.STATUS] ?? '').trim();
            if (status.startsWith(INGESTED_PREFIX)) continue;

            const qty = parseFabricQty(String(row[FABRIC_INWARD_LIVE_COLS.QTY] ?? ''));
            const costPerUnit = parseFabricQty(String(row[FABRIC_INWARD_LIVE_COLS.COST_PER_UNIT] ?? ''));
            const supplier = String(row[FABRIC_INWARD_LIVE_COLS.SUPPLIER] ?? '').trim();
            const dateStr = String(row[FABRIC_INWARD_LIVE_COLS.DATE] ?? '').trim();
            const notes = String(row[FABRIC_INWARD_LIVE_COLS.NOTES] ?? '').trim();
            const material = String(row[FABRIC_INWARD_LIVE_COLS.MATERIAL] ?? '').trim();
            const fabric = String(row[FABRIC_INWARD_LIVE_COLS.FABRIC] ?? '').trim();
            const colour = String(row[FABRIC_INWARD_LIVE_COLS.COLOUR] ?? '').trim();
            const unit = String(row[FABRIC_INWARD_LIVE_COLS.UNIT] ?? '').trim();

            let refId = buildFabricInwardRefId(fabricCode, qty, dateStr, supplier);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            parsed.push({
                rowIndex: i, fabricCode, material, fabric, colour,
                qty, unit, costPerUnit, supplier, dateStr, date: parseSheetDate(dateStr),
                notes, referenceId: refId,
            });
        }

        if (parsed.length === 0) {
            return {
                tab, totalRows: 0, valid: 0, invalid: 0, duplicates: 0,
                validationErrors: {}, affectedFabricCodes: [],
                durationMs: Date.now() - startTime,
            };
        }

        // Validate
        const validRows: FabricInwardParsed[] = [];
        const validationErrors: Record<string, number> = {};
        const rowErrors = new Map<string, string>();

        for (const p of parsed) {
            const reasons: string[] = [];

            if (!fabricByCode.has(p.fabricCode)) {
                reasons.push(`Unknown fabric code: ${p.fabricCode}`);
            }
            if (p.qty <= 0) {
                reasons.push('Qty must be > 0');
            }
            if (p.costPerUnit <= 0) {
                reasons.push('Cost per unit must be > 0');
            }
            if (!p.supplier) {
                reasons.push('Supplier is required');
            }
            if (!p.date) {
                reasons.push('Date is required (DD/MM/YYYY)');
            }

            if (reasons.length === 0) {
                validRows.push(p);
            } else {
                for (const reason of reasons) {
                    validationErrors[reason] = (validationErrors[reason] ?? 0) + 1;
                }
                rowErrors.set(p.referenceId, reasons.join('; '));
            }
        }

        // Dedup against existing FabricColourTransactions
        const existingRefs = await findExistingFabricReferenceIds(validRows.map(r => r.referenceId));
        const newRows = validRows.filter(r => !existingRefs.has(r.referenceId));
        const duplicates = validRows.length - newRows.length;

        // Write status column K
        const importErrors: Array<{ rowIndex: number; error: string }> = [];
        for (const p of parsed) {
            const errorText = rowErrors.get(p.referenceId);
            if (errorText) {
                importErrors.push({ rowIndex: p.rowIndex, error: errorText });
            } else if (existingRefs.has(p.referenceId)) {
                importErrors.push({ rowIndex: p.rowIndex, error: 'ok (already in ERP)' });
            } else {
                importErrors.push({ rowIndex: p.rowIndex, error: 'ok' });
            }
        }
        await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, importErrors, 'K');

        const affectedFabricCodes = [...new Set(newRows.map(r => r.fabricCode))];

        // Build preview rows
        const previewRows: FabricInwardPreviewRow[] = parsed.map(p => {
            const errorText = rowErrors.get(p.referenceId);
            const isDupe = existingRefs.has(p.referenceId);
            return {
                fabricCode: p.fabricCode,
                material: p.material,
                fabric: p.fabric,
                colour: p.colour,
                qty: p.qty,
                unit: p.unit,
                costPerUnit: p.costPerUnit,
                supplier: p.supplier,
                date: p.dateStr,
                notes: p.notes,
                status: errorText ? 'invalid' as const : isDupe ? 'duplicate' as const : 'ready' as const,
                ...(errorText ? { error: errorText } : {}),
            };
        });

        sheetsLogger.info({
            tab, total: parsed.length, valid: validRows.length,
            invalid: parsed.length - validRows.length, duplicates, new: newRows.length,
        }, 'Preview fabric inward complete');

        return {
            tab,
            totalRows: parsed.length,
            valid: newRows.length,
            invalid: parsed.length - validRows.length,
            duplicates,
            validationErrors,
            affectedFabricCodes,
            durationMs: Date.now() - startTime,
            previewRows,
        };
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message }, 'Preview fabric inward failed');
        throw err;
    } finally {
        fabricInwardState.isRunning = false;
    }
}

/**
 * Import Fabric Inward (Live) — actual import.
 * Creates FabricColourTransactions and marks rows as DONE.
 */
async function triggerFabricInward(): Promise<FabricInwardResult | null> {
    if (fabricInwardState.isRunning) {
        sheetsLogger.debug('Fabric inward already in progress, skipping');
        return null;
    }

    fabricInwardState.isRunning = true;
    const startTime = Date.now();

    const result: FabricInwardResult = {
        startedAt: new Date().toISOString(),
        imported: 0,
        skipped: 0,
        rowsMarkedDone: 0,
        suppliersCreated: 0,
        errors: 0,
        durationMs: 0,
        error: null,
        validationErrors: {},
    };

    try {
        const tab = LIVE_TABS.FABRIC_INWARD;
        sheetsLogger.info({ tab }, 'Starting fabric inward import');

        const rows = await readRange(ORDERS_MASTERSHEET_ID, `'${tab}'!A:K`);
        if (rows.length <= 1) {
            result.durationMs = Date.now() - startTime;
            fabricInwardState.lastRunAt = new Date();
            fabricInwardState.lastResult = result;
            pushRecentRun(fabricInwardState, {
                startedAt: result.startedAt, durationMs: result.durationMs,
                count: 0, error: null,
            });
            return result;
        }

        // Fetch all active fabric colours
        const allFabricColours = await prisma.fabricColour.findMany({
            where: { isActive: true },
            select: { id: true, code: true, fabric: { select: { unit: true } } },
        });
        const fabricByCode = new Map(allFabricColours.map(fc => [fc.code, fc]));

        const adminUserId = await getAdminUserId();

        // Parse and validate
        interface ParsedFabricRow {
            rowIndex: number;
            material: string;
            fabric: string;
            colour: string;
            fabricCode: string;
            qty: number;
            costPerUnit: number;
            supplier: string;
            dateStr: string;
            date: Date | null;
            notes: string;
            referenceId: string;
        }

        const parsed: ParsedFabricRow[] = [];
        const seenRefs = new Set<string>();

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const fabricCode = String(row[FABRIC_INWARD_LIVE_COLS.FABRIC_CODE] ?? '').trim();
            const material = String(row[FABRIC_INWARD_LIVE_COLS.MATERIAL] ?? '').trim();

            // Skip completely empty rows (no data at all)
            if (!fabricCode && !material) continue;

            const status = String(row[FABRIC_INWARD_LIVE_COLS.STATUS] ?? '').trim();
            if (status.startsWith(INGESTED_PREFIX)) continue;

            const fabric = String(row[FABRIC_INWARD_LIVE_COLS.FABRIC] ?? '').trim();
            const colour = String(row[FABRIC_INWARD_LIVE_COLS.COLOUR] ?? '').trim();
            const qty = parseFabricQty(String(row[FABRIC_INWARD_LIVE_COLS.QTY] ?? ''));
            const costPerUnit = parseFabricQty(String(row[FABRIC_INWARD_LIVE_COLS.COST_PER_UNIT] ?? ''));
            const supplier = String(row[FABRIC_INWARD_LIVE_COLS.SUPPLIER] ?? '').trim();
            const dateStr = String(row[FABRIC_INWARD_LIVE_COLS.DATE] ?? '').trim();
            const notes = String(row[FABRIC_INWARD_LIVE_COLS.NOTES] ?? '').trim();

            let refId = buildFabricInwardRefId(fabricCode, qty, dateStr, supplier);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            parsed.push({
                rowIndex: i, material, fabric, colour, fabricCode,
                qty, costPerUnit, supplier, dateStr,
                date: parseSheetDate(dateStr), notes, referenceId: refId,
            });
        }

        // Validate
        const now = new Date();
        const maxFuture = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
        const maxPast = new Date(now.getTime() - MAX_PAST_DAYS * 24 * 60 * 60 * 1000);
        const validRows: ParsedFabricRow[] = [];
        const fabricImportErrors: Array<{ rowIndex: number; error: string }> = [];

        for (const p of parsed) {
            const reasons: string[] = [];

            if (!p.material) reasons.push('missing Material (A)');
            if (!p.fabric) reasons.push('missing Fabric (B)');
            if (!p.colour) reasons.push('missing Colour (C)');
            if (!p.fabricCode) reasons.push('missing Fabric Code (D)');
            else if (!fabricByCode.has(p.fabricCode)) reasons.push(`Unknown fabric code: ${p.fabricCode}`);
            if (p.qty === -2) reasons.push('Qty is not a valid number');
            if (p.qty === 0) reasons.push('Qty must be > 0');
            if (p.qty > 0 && p.qty > MAX_QTY_PER_ROW) reasons.push(`Qty ${p.qty} exceeds max ${MAX_QTY_PER_ROW}`);
            if (p.costPerUnit === -2) reasons.push('Cost is not a valid number');
            if (p.costPerUnit <= 0 && p.costPerUnit !== -2) reasons.push('Cost per unit must be > 0');
            if (!p.supplier) reasons.push('Supplier is required');
            if (!p.dateStr) reasons.push('Date is required');
            else if (!p.date) reasons.push(`Invalid date format "${p.dateStr}" — use DD/MM/YYYY`);
            if (p.date && p.date > maxFuture) reasons.push(`Date too far in future (max ${MAX_FUTURE_DAYS} days)`);
            if (p.date && p.date < maxPast) reasons.push(`Date too old (max ${MAX_PAST_DAYS} days in past)`);

            if (reasons.length === 0) {
                validRows.push(p);
            } else {
                result.skipped++;
                fabricImportErrors.push({ rowIndex: p.rowIndex, error: reasons.join('; ') });
                for (const reason of reasons) {
                    result.validationErrors[reason] = (result.validationErrors[reason] ?? 0) + 1;
                }
            }
        }

        // Write validation errors back to sheet column K
        if (fabricImportErrors.length > 0) {
            await writeImportErrors(ORDERS_MASTERSHEET_ID, tab, fabricImportErrors, 'K');
        }

        // Dedup
        const existingRefs = await findExistingFabricReferenceIds(validRows.map(r => r.referenceId));
        const newRows = validRows.filter(r => {
            if (existingRefs.has(r.referenceId)) {
                result.skipped++;
                return false;
            }
            return true;
        });

        if (newRows.length === 0) {
            result.durationMs = Date.now() - startTime;
            fabricInwardState.lastRunAt = new Date();
            fabricInwardState.lastResult = result;
            pushRecentRun(fabricInwardState, {
                startedAt: result.startedAt, durationMs: result.durationMs,
                count: 0, error: null,
            });
            return result;
        }

        // Find or create parties (case-insensitive)
        const supplierNames = [...new Set(newRows.map(r => r.supplier))];
        const supplierMap = new Map<string, string>(); // name (lowercase) → id

        for (const name of supplierNames) {
            const nameLower = name.toLowerCase();
            const existing = await prisma.party.findFirst({
                where: { name: { equals: name, mode: 'insensitive' } },
                select: { id: true },
            });
            if (existing) {
                supplierMap.set(nameLower, existing.id);
            } else {
                const created = await prisma.party.create({
                    data: { name, category: 'fabric' },
                    select: { id: true },
                });
                supplierMap.set(nameLower, created.id);
                result.suppliersCreated++;
                sheetsLogger.info({ supplier: name }, 'Created new party');
            }
        }

        // Create FabricColourTransactions
        const affectedFabricColourIds = new Set<string>();
        const importedRows: Array<{ rowIndex: number; referenceId: string }> = [];

        for (const row of newRows) {
            try {
                const fc = fabricByCode.get(row.fabricCode)!;
                const unit = normalizeFabricUnit(fc.fabric?.unit ?? null);
                const partyId = supplierMap.get(row.supplier.toLowerCase())!;

                await prisma.fabricColourTransaction.create({
                    data: {
                        fabricColourId: fc.id,
                        txnType: FABRIC_TXN_TYPE.INWARD,
                        qty: row.qty,
                        unit,
                        reason: 'supplier_receipt',
                        costPerUnit: row.costPerUnit,
                        partyId,
                        referenceId: row.referenceId,
                        notes: row.notes || `${OFFLOAD_NOTES_PREFIX} ${tab}`,
                        createdById: adminUserId,
                        createdAt: row.date!, // Validated as non-null during validation step
                    },
                });

                affectedFabricColourIds.add(fc.id);
                importedRows.push({ rowIndex: row.rowIndex, referenceId: row.referenceId });
                result.imported++;
            } catch (txnError: unknown) {
                const message = txnError instanceof Error ? txnError.message : String(txnError);
                sheetsLogger.error({ fabricCode: row.fabricCode, error: message }, 'Failed to create fabric inward txn');
                result.errors++;
            }
        }

        // Mark imported rows as DONE in column K
        if (importedRows.length > 0) {
            await markRowsIngested(ORDERS_MASTERSHEET_ID, tab, importedRows, 'K', result);
        }

        // Invalidate fabric balance cache
        if (affectedFabricColourIds.size > 0) {
            try {
                const { fabricColourBalanceCache } = await import('@coh/shared/services/inventory');
                fabricColourBalanceCache.invalidate([...affectedFabricColourIds]);
            } catch (cacheErr: unknown) {
                sheetsLogger.warn({ error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) }, 'Failed to invalidate fabric balance cache');
            }
        }

        result.durationMs = Date.now() - startTime;
        fabricInwardState.lastRunAt = new Date();
        fabricInwardState.lastResult = result;
        pushRecentRun(fabricInwardState, {
            startedAt: result.startedAt, durationMs: result.durationMs,
            count: result.imported, error: result.error,
        });

        sheetsLogger.info({
            durationMs: result.durationMs,
            imported: result.imported,
            skipped: result.skipped,
            suppliersCreated: result.suppliersCreated,
            errors: result.errors,
        }, 'Fabric inward import completed');

        return result;
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        sheetsLogger.error({ error: err.message, stack: err.stack }, 'Fabric inward import failed');
        result.error = err.message;
        result.durationMs = Date.now() - startTime;
        fabricInwardState.lastResult = result;
        pushRecentRun(fabricInwardState, {
            startedAt: result.startedAt, durationMs: result.durationMs,
            count: result.imported, error: result.error,
        });
        return result;
    } finally {
        fabricInwardState.isRunning = false;
    }
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
    triggerCleanupDoneRows,
    triggerMigrateFormulas,
    triggerPushBalances,
    triggerPushFabricBalances,
    triggerImportFabricBalances,
    getBufferCounts,
    previewIngestInward,
    previewIngestOutward,
    previewPushBalances,
    previewFabricInward,
    triggerFabricInward,
};

export type { IngestInwardResult, IngestOutwardResult, IngestPreviewResult, MoveShippedResult, CleanupDoneResult, MigrateFormulasResult, PushBalancesResult, PushFabricBalancesResult, ImportFabricBalancesResult, PushBalancesPreviewResult, OffloadStatus, RunSummary, BalanceVerificationResult, BalanceSnapshot, InwardPreviewRow, OutwardPreviewRow, FabricInwardResult, FabricInwardPreviewResult, FabricInwardPreviewRow };
