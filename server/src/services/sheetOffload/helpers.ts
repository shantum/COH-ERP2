/**
 * Shared helper functions for the sheet offload worker.
 * Parsing, validation, SKU lookup, reference IDs, sheet marking, cache invalidation.
 */

import prisma from '../../lib/prisma.js';
import { sheetsLogger } from '../../utils/logger.js';
import { TXN_TYPE } from '../../utils/patterns/types.js';
import type { TxnReason } from '../../utils/patterns/types.js';
import { inventoryBalanceCache } from '../inventoryBalanceCache.js';
import { broadcastOrderUpdate } from '../../routes/sse.js';
import {
    serialToDate,
    batchWriteRanges,
} from '../googleSheetsClient.js';
import {
    INWARD_SOURCE_MAP,
    VALID_INWARD_LIVE_SOURCES,
    DEFAULT_INWARD_REASON,
    OUTWARD_DESTINATION_MAP,
    DEFAULT_OUTWARD_REASON,
    INGESTED_PREFIX,
    MAX_QTY_PER_ROW,
    MAX_FUTURE_DAYS,
    MAX_PAST_DAYS,
    INWARD_LIVE_COLS,
    REF_PREFIX,
} from '../../config/sync/sheets.js';
import type {
    ParsedRow,
    SkuLookupInfo,
    OrderMapEntry,
    OutwardValidationResult,
    MarkTracker,
    RunSummary,
    JobState,
} from './state.js';
import {
    cachedAdminUserId,
    setCachedAdminUserId,
    MAX_RECENT_RUNS,
} from './state.js';

// ============================================
// HELPERS
// ============================================

export async function getAdminUserId(): Promise<string> {
    if (cachedAdminUserId) return cachedAdminUserId;

    const admin = await prisma.user.findFirst({
        where: { role: 'admin' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });

    if (!admin) {
        throw new Error('No admin user found — cannot create inventory transactions');
    }

    setCachedAdminUserId(admin.id);
    return admin.id;
}

/**
 * Parse a date string from the sheet.
 * Live tabs use DD/MM/YYYY format (set via column formatting).
 * Also handles MM/DD/YYYY and ISO for robustness.
 */
export function parseSheetDate(value: string | undefined): Date | null {
    if (!value?.trim()) return null;

    const trimmed = value.trim();

    // Serial number from UNFORMATTED_VALUE (e.g., "46063" or "46063.0")
    // readRangeWithSerials passes serial numbers as strings for date columns
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (num >= 1 && num <= 200000) {
            const d = serialToDate(num);
            if (d) return d;
        }
    }

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
export function parseSheetDateTime(value: string | undefined): Date | null {
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
export function parseQty(value: string | undefined): number {
    if (!value?.trim()) return 0;
    const raw = Number(value.trim());
    if (!Number.isFinite(raw)) return -2; // Infinity or NaN
    if (raw !== Math.floor(raw)) return -1; // fractional like 2.5
    return raw > 0 ? raw : 0;
}

export function mapSourceToReason(source: string): TxnReason {
    const normalized = source.toLowerCase().trim();
    return INWARD_SOURCE_MAP[normalized] ?? DEFAULT_INWARD_REASON;
}

export function mapDestinationToReason(destination: string): TxnReason {
    const normalized = destination.toLowerCase().trim();
    return OUTWARD_DESTINATION_MAP[normalized] ?? DEFAULT_OUTWARD_REASON;
}

/**
 * Content-based referenceId — stable across row deletions.
 */
export function buildReferenceId(
    prefix: string,
    skuCode: string,
    qty: number,
    dateStr: string,
    extra: string = '',
    parsedDate?: Date | null
): string {
    // Prefer canonical DDMMYYYY from parsed Date (stable regardless of input format)
    let datePart: string;
    if (parsedDate) {
        const dd = String(parsedDate.getDate()).padStart(2, '0');
        const mm = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const yyyy = String(parsedDate.getFullYear());
        datePart = `${dd}${mm}${yyyy}`;
    } else {
        datePart = dateStr.replace(/[/\-.\s]/g, '').slice(0, 8) || 'nodate';
    }
    const extraPart = extra ? `:${extra.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}` : '';
    return `${prefix}:${skuCode}:${qty}:${datePart}${extraPart}`;
}

/**
 * Write error strings to the Import Errors column for parsed rows.
 * Valid rows get empty string (clears stale errors), invalid rows get their error message.
 */
export async function writeImportErrors(
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

export async function bulkLookupSkus(skuCodes: string[]): Promise<Map<string, SkuLookupInfo>> {
    if (skuCodes.length === 0) return new Map();
    const unique = [...new Set(skuCodes)];
    const skus = await prisma.sku.findMany({
        where: { skuCode: { in: unique } },
        select: { id: true, skuCode: true, variationId: true, fabricConsumption: true, isActive: true },
    });
    return new Map(skus.map(s => [s.skuCode, { id: s.id, variationId: s.variationId, fabricConsumption: s.fabricConsumption, isActive: s.isActive }]));
}

/**
 * Pre-ingestion validation for outward rows.
 */
export async function validateOutwardRows(
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

export async function findExistingReferenceIds(referenceIds: string[]): Promise<Set<string>> {
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

export async function findExistingFabricReferenceIds(referenceIds: string[]): Promise<Set<string>> {
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
export function normalizeFabricUnit(unit: string | null): string {
    if (!unit) return 'meter';
    const lower = unit.toLowerCase().trim();
    if (lower === 'm') return 'meter';
    return lower || 'meter';
}

export function groupIntoRanges(
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
 * Writes "DONE:{referenceId}" to the status column for each ingested row.
 * Non-destructive — rows stay on the sheet but are excluded by formulas.
 */
export async function markRowsIngested(
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

export function invalidateCaches(): void {
    inventoryBalanceCache.invalidateAll();
    broadcastOrderUpdate({ type: 'inventory_updated' });
    sheetsLogger.info('Caches invalidated and SSE broadcast sent');
}

export function pushRecentRun(state: JobState<unknown>, summary: RunSummary): void {
    state.recentRuns.unshift(summary);
    if (state.recentRuns.length > MAX_RECENT_RUNS) {
        state.recentRuns.length = MAX_RECENT_RUNS;
    }
}

export function validateInwardRow(
    parsed: ParsedRow,
    rawRow: unknown[],
    skuMap: Map<string, SkuLookupInfo>,
    activeSkuCodes: Set<string>,
    lastReconDate: Date | null,
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
        if (lastReconDate && parsed.date <= lastReconDate) {
            const recoStr = lastReconDate.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
            reasons.push(`Date is before last reconciliation (${recoStr}) — backdated entries not allowed`);
        }
    }

    // Source validation
    if (parsed.source && !VALID_INWARD_LIVE_SOURCES.some((s: string) => s === source)) {
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

/**
 * Parse fabric quantity — allows decimals (meters/kg) but rejects Infinity/NaN/negative.
 * Returns 0 for empty/invalid, -2 for Infinity/NaN.
 */
export function parseFabricQty(value: string | undefined): number {
    if (!value?.trim()) return 0;
    const num = Number(value.trim());
    if (!Number.isFinite(num)) return -2;
    return num > 0 ? num : 0;
}

/**
 * Builds a content-based reference ID for fabric inward rows.
 * Format: sheet:fabric-inward-live:{code}:{qty}:{date}:{supplier}
 */
export function buildFabricInwardRefId(
    fabricCode: string,
    qty: number,
    dateStr: string,
    supplier: string,
    parsedDate?: Date | null
): string {
    let datePart: string;
    if (parsedDate) {
        const dd = String(parsedDate.getDate()).padStart(2, '0');
        const mm = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const yyyy = String(parsedDate.getFullYear());
        datePart = `${dd}${mm}${yyyy}`;
    } else {
        datePart = dateStr.replace(/[/\-.\s]/g, '').slice(0, 8) || 'nodate';
    }
    const supplierPart = supplier.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return `${REF_PREFIX.FABRIC_INWARD_LIVE}:${fabricCode}:${qty}:${datePart}:${supplierPart}`;
}
