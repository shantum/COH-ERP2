/**
 * Balance operations — readInventorySnapshot, compareSnapshots, updateSheetBalances, pushBalancesCore,
 * triggerPushBalances, previewPushBalances, triggerCleanupDoneRows, triggerMigrateFormulas
 */

import prisma from '../../lib/prisma.js';
import { sheetsLogger } from '../../utils/logger.js';
import {
    readRange,
    readRangeWithSerials,
    writeRange,
    batchWriteRanges,
    deleteRowsBatch,
    getSheetId,
    removeOurProtections,
} from '../googleSheetsClient.js';
import {
    ORDERS_MASTERSHEET_ID,
    OFFICE_LEDGER_ID,
    LIVE_TABS,
    LEDGER_TABS,
    INVENTORY_TAB,
    INWARD_LIVE_COLS,
    OUTWARD_LIVE_COLS,
    FABRIC_INWARD_LIVE_COLS,
    CLEANUP_RETENTION_DAYS,
    INVENTORY_BALANCE_FORMULA_TEMPLATE,
    LIVE_BALANCE_FORMULA_V2_TEMPLATE,
    INGESTED_PREFIX,
} from '../../config/sync/sheets/index.js';
import type {
    BalanceSnapshot,
    BalanceVerificationResult,
    PushBalancesResult,
    PushBalancesPreviewResult,
    CleanupDoneResult,
    MigrateFormulasResult,
} from './state.js';
import {
    pushBalancesState,
    cleanupDoneState,
    migrateFormulasState,
} from './state.js';
import {
    parseSheetDate,
    groupIntoRanges,
    pushRecentRun,
} from './helpers.js';

// ============================================
// BALANCE VERIFICATION — snapshot + compare
// ============================================

/**
 * Read a snapshot of ALL SKU balances from the Inventory tab (cols A–R).
 * Returns a Map of skuCode → { c, d, e, r } for every row with a non-empty SKU.
 * Col R (index 17) = ERP currentBalance as written by the worker.
 */
export async function readInventorySnapshot(): Promise<BalanceSnapshot> {
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
export function compareSnapshots(
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

export async function updateSheetBalances(
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
// PUSH BALANCES (standalone)
// ============================================

/**
 * Preview push balances — read-only comparison of DB vs sheet values.
 * No concurrency guard needed since it doesn't mutate anything.
 */
export async function previewPushBalances(): Promise<PushBalancesPreviewResult> {
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

/**
 * Core push balances logic — pushes ALL SKU balances to both sheets.
 * Extracted so both triggerPushBalances and cycle runners can call it.
 */
export async function pushBalancesCore(): Promise<{ skusUpdated: number; errors: number }> {
    const skus = await prisma.sku.findMany({
        select: { id: true, skuCode: true, currentBalance: true },
    });

    sheetsLogger.info({ skuCount: skus.length }, 'Push balances: fetched all SKUs');

    const balanceByCode = new Map<string, number>();
    for (const sku of skus) {
        balanceByCode.set(sku.skuCode, sku.currentBalance);
    }

    let totalUpdated = 0;
    let errors = 0;

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
        errors++;
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
        errors++;
    }

    return { skusUpdated: totalUpdated, errors };
}

/**
 * Clean up DONE rows from a single sheet tab.
 * Extracted so both triggerCleanupDoneRows and cycle runners can call it.
 */
export async function cleanupSingleTab(
    tabName: string,
    dateColIndex: number,
    statusColIndex: number,
    readRange_: string
): Promise<{ deleted: number; error?: string }> {
    try {
        const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, readRange_, [dateColIndex]);
        const toDelete: number[] = [];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_RETENTION_DAYS);

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const status = String(row[statusColIndex] ?? '').trim();
            if (!status.startsWith(INGESTED_PREFIX)) continue;

            const dateStr = String(row[dateColIndex] ?? '');
            const rowDate = parseSheetDate(dateStr);
            if (rowDate && rowDate < cutoffDate) {
                toDelete.push(i);
            }
        }

        if (toDelete.length > 0) {
            // Remove warning-only protections on rows being deleted
            try {
                await removeOurProtections(ORDERS_MASTERSHEET_ID, tabName, toDelete);
            } catch (protErr: unknown) {
                sheetsLogger.warn(
                    { tab: tabName, error: protErr instanceof Error ? protErr.message : String(protErr) },
                    'Failed to remove protections before cleanup (non-fatal)'
                );
            }

            const sheetId = await getSheetId(ORDERS_MASTERSHEET_ID, tabName);
            await deleteRowsBatch(ORDERS_MASTERSHEET_ID, sheetId, toDelete);
            sheetsLogger.info({ tab: tabName, deleted: toDelete.length }, 'Cleaned up DONE rows');
        }

        return { deleted: toDelete.length };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sheetsLogger.error({ tab: tabName, error: message }, 'Failed to cleanup DONE rows');
        return { deleted: 0, error: `${tabName} cleanup failed: ${message}` };
    }
}

export async function triggerPushBalances(): Promise<PushBalancesResult | null> {
    if (pushBalancesState.isRunning) {
        sheetsLogger.warn('triggerPushBalances skipped — already running');
        return null;
    }

    pushBalancesState.isRunning = true;
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
        const coreResult = await pushBalancesCore();

        const result: PushBalancesResult = {
            startedAt,
            skusUpdated: coreResult.skusUpdated,
            errors: coreResult.errors,
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
// JOB 4: CLEANUP DONE ROWS
// ============================================

export async function triggerCleanupDoneRows(): Promise<CleanupDoneResult | null> {
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
        sheetsLogger.info({ retentionDays: CLEANUP_RETENTION_DAYS }, 'Starting DONE row cleanup');

        const inward = await cleanupSingleTab(LIVE_TABS.INWARD, INWARD_LIVE_COLS.DATE, INWARD_LIVE_COLS.IMPORT_ERRORS, `'${LIVE_TABS.INWARD}'!A:J`);
        result.inwardDeleted = inward.deleted;
        if (inward.error) result.errors.push(inward.error);

        const outward = await cleanupSingleTab(LIVE_TABS.OUTWARD, OUTWARD_LIVE_COLS.OUTWARD_DATE, OUTWARD_LIVE_COLS.IMPORT_ERRORS, `'${LIVE_TABS.OUTWARD}'!A:AG`);
        result.outwardDeleted = outward.deleted;
        if (outward.error) result.errors.push(outward.error);

        const fabric = await cleanupSingleTab(LIVE_TABS.FABRIC_INWARD, FABRIC_INWARD_LIVE_COLS.DATE, FABRIC_INWARD_LIVE_COLS.STATUS, `'${LIVE_TABS.FABRIC_INWARD}'!A:K`);
        result.fabricInwardDeleted = fabric.deleted;
        if (fabric.error) result.errors.push(fabric.error);

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

export async function triggerMigrateFormulas(): Promise<MigrateFormulasResult | null> {
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
