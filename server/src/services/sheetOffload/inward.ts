/**
 * Inward ingestion pipeline — ingestInwardLive, triggerIngestInward, previewIngestInward, validateInwardRow, deductFabricForSamplingRows
 */

import prisma from '../../lib/prisma.js';
import { sheetsLogger } from '../../utils/logger.js';
import { TXN_TYPE, FABRIC_TXN_TYPE } from '../../utils/patterns/types.js';
import {
    readRangeWithSerials,
} from '../googleSheetsClient.js';
import {
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    INWARD_LIVE_COLS,
    FABRIC_DEDUCT_SOURCES,
    REF_PREFIX,
    OFFLOAD_NOTES_PREFIX,
    BATCH_SIZE,
    INGESTED_PREFIX,
} from '../../config/sync/sheets.js';
import type {
    IngestInwardResult,
    IngestPreviewResult,
    InwardPreviewRow,
    ParsedRow,
    SkuLookupInfo,
    BalanceSnapshot,
    StepTracker,
} from './state.js';
import {
    ingestInwardState,
} from './state.js';
import {
    getAdminUserId,
    parseSheetDate,
    parseQty,
    mapSourceToReason,
    buildReferenceId,
    writeImportErrors,
    bulkLookupSkus,
    findExistingReferenceIds,
    findExistingFabricReferenceIds,
    normalizeFabricUnit,
    markRowsIngested,
    invalidateCaches,
    pushRecentRun,
    validateInwardRow,
} from './helpers.js';
import {
    readInventorySnapshot,
    compareSnapshots,
    updateSheetBalances,
} from './balances.js';

// ============================================
// FABRIC DEDUCTION FOR SAMPLING INWARDS
// ============================================

/**
 * After sampling inward rows are created, deduct fabric used.
 * Formula: fabric qty = row.qty × BOM consumption (SkuBomLine > VariationBomLine > Product.defaultFabricConsumption > 1.5)
 * Creates FabricColourTransaction (outward) records.
 */
export async function deductFabricForSamplingRows(
    successfulRows: ParsedRow[],
    skuMap: Map<string, SkuLookupInfo>,
    adminUserId: string,
    lastReconDate: Date | null
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

    // Batch lookup fabric consumption quantities from BOM
    // Priority: SkuBomLine.quantity > VariationBomLine.quantity > Product.defaultFabricConsumption > 1.5
    const skuIds = samplingRows
        .map(r => skuMap.get(r.skuCode)?.id)
        .filter((id): id is string => !!id);

    // Get variation-level fabric BOM quantities
    const variationBomLines = await prisma.variationBomLine.findMany({
        where: {
            variationId: { in: variationIds },
            role: { code: 'main', type: { code: 'FABRIC' } },
        },
        select: { variationId: true, quantity: true },
    });
    const variationQtyMap = new Map(
        variationBomLines.map(l => [l.variationId, l.quantity])
    );

    // Get SKU-level fabric BOM quantity overrides
    const skuBomLines = skuIds.length > 0
        ? await prisma.skuBomLine.findMany({
            where: {
                skuId: { in: skuIds },
                role: { code: 'main', type: { code: 'FABRIC' } },
            },
            select: { skuId: true, quantity: true },
        })
        : [];
    const skuQtyMap = new Map(
        skuBomLines.map(l => [l.skuId, l.quantity])
    );

    // Get product default fabric consumption for each variation
    const variationsWithProduct = await prisma.variation.findMany({
        where: { id: { in: variationIds } },
        select: { id: true, product: { select: { defaultFabricConsumption: true } } },
    });
    const productDefaultByVariation = new Map(
        variationsWithProduct.map(v => [v.id, v.product.defaultFabricConsumption])
    );

    /** Get effective fabric consumption for a SKU from BOM */
    const getFabricConsumption = (skuInfo: { id: string; variationId: string }): number => {
        const skuQty = skuQtyMap.get(skuInfo.id);
        if (skuQty != null && skuQty > 0) return skuQty;
        const varQty = variationQtyMap.get(skuInfo.variationId);
        if (varQty != null && varQty > 0) return varQty;
        const productDefault = productDefaultByVariation.get(skuInfo.variationId);
        if (productDefault != null && productDefault > 0) return productDefault;
        return 1.5; // ultimate fallback
    };

    // Dedup: check existing referenceIds in FabricColourTransaction
    const existingFabricRefs = await findExistingFabricReferenceIds(
        samplingRows.map(r => r.referenceId)
    );

    // Skip rows dated before the last reconciliation — those balances were
    // already verified by physical count, so deducting again would double-count
    if (lastReconDate) {
        sheetsLogger.debug({ lastReconDate: lastReconDate.toISOString() }, 'Fabric deduction: will skip rows dated before last reconciliation');
    }

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
    let skippedBeforeRecon = 0;

    for (const row of samplingRows) {
        // Skip duplicates
        if (existingFabricRefs.has(row.referenceId)) {
            skippedDuplicate++;
            continue;
        }

        // Skip rows dated before the last reconciliation
        if (lastReconDate && row.date! <= lastReconDate) {
            skippedBeforeRecon++;
            continue;
        }

        const skuInfo = skuMap.get(row.skuCode);
        if (!skuInfo) continue;

        // Look up fabric assignment
        const fabric = fabricMap.get(skuInfo.variationId);
        if (!fabric) {
            skippedNoFabric++;
            sheetsLogger.debug({ skuCode: row.skuCode, variationId: skuInfo.variationId }, 'No fabric assigned — skipping fabric deduction');
            continue;
        }

        // Get fabric consumption from BOM (SkuBomLine > VariationBomLine > Product.defaultFabricConsumption > 1.5)
        const consumption = getFabricConsumption(skuInfo);
        if (consumption <= 0) {
            skippedZeroConsumption++;
            continue;
        }

        const fabricQty = row.qty * consumption;

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
        skippedBeforeRecon,
        affectedFabricColours: affectedFabricColourIds.size,
    }, 'Fabric deduction for sampling inwards complete');
}

// ============================================
// PHASE A: INGEST INWARD (LIVE)
// ============================================

export async function ingestInwardLive(result: IngestInwardResult, tracker?: StepTracker): Promise<Set<string>> {
    const tab = LIVE_TABS.INWARD;
    const affectedSkuIds = new Set<string>();

    // --- Step: Read sheet rows ---
    const readStart = tracker?.start('Read sheet rows') ?? 0;

    sheetsLogger.info({ tab }, 'Reading inward live tab');

    const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tab}'!A:J`, [INWARD_LIVE_COLS.DATE]);
    if (rows.length <= 1) {
        sheetsLogger.info({ tab }, 'No data rows');
        tracker?.done('Read sheet rows', readStart, '0 rows');
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
        const parsedDate = parseSheetDate(dateStr);

        let refId = buildReferenceId(REF_PREFIX.INWARD_LIVE, skuCode, qty, dateStr, source, parsedDate);
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
        tracker?.done('Read sheet rows', readStart, '0 pending rows');
        return affectedSkuIds;
    }

    tracker?.done('Read sheet rows', readStart, `${parsed.length} rows`);

    // --- Step: Validate rows ---
    const validateStart = tracker?.start('Validate rows') ?? 0;

    // --- Step 2: Bulk lookup SKUs + last reconciliation date for validation ---
    const skuMap = await bulkLookupSkus(parsed.map(r => r.skuCode));
    const activeSkuCodes = new Set<string>(
        [...skuMap.entries()].filter(([, info]) => info.isActive).map(([code]) => code)
    );

    const lastRecon = await prisma.fabricColourTransaction.findFirst({
        where: { reason: 'reconciliation' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });
    const lastReconDate = lastRecon?.createdAt ?? null;

    // --- Step 3: Validate each row ---
    const validRows: ParsedRow[] = [];
    const validationErrors: Record<string, number> = {};
    const importErrors: Array<{ rowIndex: number; error: string }> = [];
    let invalidCount = 0;

    for (const p of parsed) {
        const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap, activeSkuCodes, lastReconDate);
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
        tracker?.done('Validate rows', validateStart, `0 valid, ${invalidCount} invalid`);
        return affectedSkuIds;
    }

    // --- Step 4: Dedup valid rows against existing transactions ---
    const existingRefs = await findExistingReferenceIds(validRows.map(r => r.referenceId));
    const newRows = validRows.filter(r => !existingRefs.has(r.referenceId));

    tracker?.done('Validate rows', validateStart, `${newRows.length} new, ${validRows.length - newRows.length} dupe, ${invalidCount} invalid`);

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

    // --- Step: DB write ---
    const dbWriteStart = tracker?.start('DB write') ?? 0;

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

    if (result.errors > 0) {
        tracker?.fail('DB write', dbWriteStart, `${result.errors} batch errors`);
    } else {
        tracker?.done('DB write', dbWriteStart, `${successfulRows.length} created`);
    }

    // --- Step 6: Auto-deduct fabric for sampling inwards ---
    if (successfulRows.length > 0) {
        try {
            await deductFabricForSamplingRows(successfulRows, skuMap, adminUserId, lastReconDate);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            sheetsLogger.error({ error: message }, 'Fabric deduction failed (non-fatal)');
        }
    }


    // --- Step: Mark DONE ---
    const markStart = tracker?.start('Mark DONE') ?? 0;

    // Mark successfully ingested rows + already-deduped rows as DONE
    const dupeRows = validRows.filter(r => existingRefs.has(r.referenceId));
    const rowsToMark = [
        ...successfulRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
        ...dupeRows.map(r => ({ rowIndex: r.rowIndex, referenceId: r.referenceId })),
    ];
    await markRowsIngested(ORDERS_MASTERSHEET_ID, tab, rowsToMark, 'J', result);

    tracker?.done('Mark DONE', markStart, `${rowsToMark.length} rows`);

    return affectedSkuIds;
}

// ============================================
// JOB 1: TRIGGER INGEST INWARD
// ============================================

export async function triggerIngestInward(): Promise<IngestInwardResult | null> {
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

export async function previewIngestInward(): Promise<IngestPreviewResult | null> {
    if (ingestInwardState.isRunning) {
        sheetsLogger.debug('Ingest inward already in progress, skipping preview');
        return null;
    }

    ingestInwardState.isRunning = true;
    const startTime = Date.now();

    try {
        const tab = LIVE_TABS.INWARD;
        sheetsLogger.info({ tab }, 'Preview: reading inward live tab');

        const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tab}'!A:J`, [INWARD_LIVE_COLS.DATE]);
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
            const parsedDate = parseSheetDate(dateStr);

            let refId = buildReferenceId(REF_PREFIX.INWARD_LIVE, skuCode, qty, dateStr, source, parsedDate);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            const barcode = String(row[INWARD_LIVE_COLS.BARCODE] ?? '').trim();
            const userNotes = String(row[INWARD_LIVE_COLS.NOTES] ?? '').trim();

            parsed.push({
                rowIndex: i, skuCode, qty, date: parsedDate,
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

        const previewLastRecon = await prisma.fabricColourTransaction.findFirst({
            where: { reason: 'reconciliation' },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        const previewLastReconDate = previewLastRecon?.createdAt ?? null;

        const validRows: ParsedRow[] = [];
        const validationErrors: Record<string, number> = {};
        const rowErrors = new Map<string, string>(); // referenceId → error text

        for (const p of parsed) {
            const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap, activeSkuCodes, previewLastReconDate);
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
            const reasons = validateInwardRow(p, rows[p.rowIndex], skuMap, activeSkuCodes, previewLastReconDate);
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
