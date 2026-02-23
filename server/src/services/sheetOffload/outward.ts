/**
 * Outward ingestion pipeline — ingestOutwardLive, triggerIngestOutward, previewIngestOutward, validateOutwardRows, linkOutwardToOrders, triggerMoveShipped
 */

import prisma from '../../lib/prisma.js';
import { sheetsLogger } from '../../utils/logger.js';
import { TXN_TYPE } from '../../utils/patterns/types.js';
import type { TxnReason } from '../../utils/patterns/types.js';
import {
    readRange,
    readRangeWithSerials,
    writeRange,
    batchWriteRanges,
    deleteRowsBatch,
    getSheetId,
} from '../googleSheetsClient.js';
import {
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    MASTERSHEET_TABS,
    OUTWARD_LIVE_COLS,
    ORDERS_FROM_COH_COLS,
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
    BATCH_SIZE,
    INGESTED_PREFIX,
    MAX_QTY_PER_ROW,
    MAX_FUTURE_DAYS,
    MAX_PAST_DAYS,
} from '../../config/sync/sheets.js';
import type {
    IngestOutwardResult,
    IngestPreviewResult,
    OutwardPreviewRow,
    MoveShippedResult,
    ParsedRow,
    OrderMapEntry,
    LinkableOutward,
    BalanceSnapshot,
    StepTracker,
} from './state.js';
import {
    ingestOutwardState,
    moveShippedState,
} from './state.js';
import {
    getAdminUserId,
    parseSheetDate,
    parseQty,
    mapDestinationToReason,
    buildReferenceId,
    writeImportErrors,
    bulkLookupSkus,
    validateOutwardRows,
    findExistingReferenceIds,
    markRowsIngested,
    invalidateCaches,
    pushRecentRun,
    groupIntoRanges,
} from './helpers.js';
import {
    readInventorySnapshot,
    compareSnapshots,
    updateSheetBalances,
} from './balances.js';

// ============================================
// PHASE B: INGEST OUTWARD (LIVE)
// ============================================

export async function ingestOutwardLive(
    result: IngestOutwardResult,
    tracker?: StepTracker
): Promise<{ affectedSkuIds: Set<string>; linkableItems: LinkableOutward[]; orderMap: Map<string, OrderMapEntry> }> {
    const tab = LIVE_TABS.OUTWARD;
    const affectedSkuIds = new Set<string>();
    const linkableItems: LinkableOutward[] = [];

    // --- Step: Read sheet rows ---
    const readStart = tracker?.start('Read sheet rows') ?? 0;

    sheetsLogger.info({ tab }, 'Reading outward live tab');

    const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AG`, [OUTWARD_LIVE_COLS.ORDER_DATE, OUTWARD_LIVE_COLS.OUTWARD_DATE]);
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        tracker?.done('Read sheet rows', readStart, '0 rows');
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

        const parsedDate = parseSheetDate(outwardDateStr) ?? parseSheetDate(orderDateStr);

        let refId = buildReferenceId(REF_PREFIX.OUTWARD_LIVE, skuCode, qty, dateStr, orderNo || dest, parsedDate);
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
            date: parsedDate,
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
        tracker?.done('Read sheet rows', readStart, '0 pending rows');
        return { affectedSkuIds, linkableItems, orderMap: new Map() };
    }

    tracker?.done('Read sheet rows', readStart, `${parsed.length} rows`);

    // --- Step: Validate rows ---
    const validateStart = tracker?.start('Validate rows') ?? 0;

    const existingRefs = await findExistingReferenceIds(parsed.map(r => r.referenceId));
    const newRows = parsed.filter(r => !existingRefs.has(r.referenceId));

    if (newRows.length === 0) {
        sheetsLogger.info({ tab, total: parsed.length }, 'All rows already ingested');
        tracker?.done('Validate rows', validateStart, `0 new, ${parsed.length} dupe`);
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

    tracker?.done('Validate rows', validateStart, `${validRows.length} valid, ${newRows.length - validRows.length} skipped`);

    // --- Step: DB write ---
    const dbWriteStart = tracker?.start('DB write') ?? 0;

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

    if (result.errors > 0) {
        tracker?.fail('DB write', dbWriteStart, `${result.errors} batch errors`);
    } else {
        tracker?.done('DB write', dbWriteStart, `${successfulRows.length} created`);
    }

    // --- Step: Mark DONE ---
    const markStart = tracker?.start('Mark DONE') ?? 0;

    // Mark successfully ingested rows + already-deduped rows as DONE
    const dupeRows = parsed.filter(r => existingRefs.has(r.referenceId));
    const rowsToMark = [
        ...successfulRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
        ...dupeRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
    ];
    await markRowsIngested(ORDERS_MASTERSHEET_ID, tab, rowsToMark, 'AG', result);

    tracker?.done('Mark DONE', markStart, `${rowsToMark.length} rows`);

    return { affectedSkuIds, linkableItems, orderMap };
}

// ============================================
// PHASE B2: LINK OUTWARD TO ORDER LINES
// ============================================

const LINKABLE_STATUSES = ['pending', 'allocated', 'picked', 'packed'];

export async function linkOutwardToOrders(
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
// JOB 2: TRIGGER INGEST OUTWARD
// ============================================

export async function triggerIngestOutward(): Promise<IngestOutwardResult | null> {
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

export async function previewIngestOutward(): Promise<IngestPreviewResult | null> {
    if (ingestOutwardState.isRunning) {
        sheetsLogger.debug('Ingest outward already in progress, skipping preview');
        return null;
    }

    ingestOutwardState.isRunning = true;
    const startTime = Date.now();

    try {
        const tab = LIVE_TABS.OUTWARD;
        sheetsLogger.info({ tab }, 'Preview: reading outward live tab');

        const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tab}'!A:AG`, [OUTWARD_LIVE_COLS.ORDER_DATE, OUTWARD_LIVE_COLS.OUTWARD_DATE]);
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

            const parsedDate = parseSheetDate(outwardDateStr) ?? parseSheetDate(orderDateStr);

            let refId = buildReferenceId(REF_PREFIX.OUTWARD_LIVE, skuCode, qty, dateStr, orderNo || dest, parsedDate);
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
                date: parsedDate,
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

export async function triggerMoveShipped(): Promise<MoveShippedResult | null> {
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
