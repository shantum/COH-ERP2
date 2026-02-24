/**
 * Fabric operations — triggerFabricInward, previewFabricInward, triggerPushFabricBalances, triggerImportFabricBalances
 */

import prisma from '../../lib/prisma.js';
import { sheetsLogger } from '../../utils/logger.js';
import { FABRIC_TXN_TYPE } from '../../utils/patterns/types.js';
import {
    readRange,
    readRangeWithSerials,
    writeRange,
    batchWriteRanges,
} from '../googleSheetsClient.js';
import {
    ORDERS_MASTERSHEET_ID,
    LIVE_TABS,
    MASTERSHEET_TABS,
    FABRIC_INWARD_LIVE_COLS,
    FABRIC_BALANCES_HEADERS,
    FABRIC_BALANCES_COLS,
    FABRIC_BALANCES_COUNT_DATETIME,
    OFFLOAD_NOTES_PREFIX,
    INGESTED_PREFIX,
    MAX_QTY_PER_ROW,
    MAX_FUTURE_DAYS,
    MAX_PAST_DAYS,
} from '../../config/sync/sheets/index.js';
import { generateFabricColourCode } from '@coh/shared/domain';
import type {
    FabricInwardResult,
    FabricInwardPreviewResult,
    FabricInwardPreviewRow,
    PushFabricBalancesResult,
    ImportFabricBalancesResult,
} from './state.js';
import {
    fabricInwardState,
    pushFabricBalancesState,
    importFabricBalancesState,
} from './state.js';
import {
    getAdminUserId,
    parseSheetDate,
    parseSheetDateTime,
    findExistingFabricReferenceIds,
    normalizeFabricUnit,
    writeImportErrors,
    markRowsIngested,
    pushRecentRun,
    parseFabricQty,
    buildFabricInwardRefId,
} from './helpers.js';

// ============================================
// PREVIEW FABRIC INWARD
// ============================================

export async function previewFabricInward(): Promise<FabricInwardPreviewResult | null> {
    if (fabricInwardState.isRunning) {
        sheetsLogger.debug('Fabric inward already in progress, skipping preview');
        return null;
    }

    fabricInwardState.isRunning = true;
    const startTime = Date.now();

    try {
        const tab = LIVE_TABS.FABRIC_INWARD;
        sheetsLogger.info({ tab }, 'Preview: reading fabric inward live tab');

        const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tab}'!A:K`, [FABRIC_INWARD_LIVE_COLS.DATE]);
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
            const parsedDate = parseSheetDate(dateStr);

            let refId = buildFabricInwardRefId(fabricCode, qty, dateStr, supplier, parsedDate);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            parsed.push({
                rowIndex: i, fabricCode, material, fabric, colour,
                qty, unit, costPerUnit, supplier, dateStr, date: parsedDate,
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

// ============================================
// TRIGGER FABRIC INWARD
// ============================================

export async function triggerFabricInward(): Promise<FabricInwardResult | null> {
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

        const rows = await readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tab}'!A:K`, [FABRIC_INWARD_LIVE_COLS.DATE]);
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
            const parsedDate = parseSheetDate(dateStr);

            let refId = buildFabricInwardRefId(fabricCode, qty, dateStr, supplier, parsedDate);
            if (seenRefs.has(refId)) {
                let counter = 2;
                while (seenRefs.has(`${refId}:${counter}`)) counter++;
                refId = `${refId}:${counter}`;
            }
            seenRefs.add(refId);

            parsed.push({
                rowIndex: i, material, fabric, colour, fabricCode,
                qty, costPerUnit, supplier, dateStr,
                date: parsedDate, notes, referenceId: refId,
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
// PUSH FABRIC BALANCES TO SHEET
// ============================================

export async function triggerPushFabricBalances(): Promise<PushFabricBalancesResult | null> {
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
// IMPORT FABRIC BALANCES FROM SHEET
// ============================================

export async function triggerImportFabricBalances(): Promise<ImportFabricBalancesResult | null> {
    if (importFabricBalancesState.isRunning) {
        sheetsLogger.warn('triggerImportFabricBalances skipped — already running');
        return null;
    }

    importFabricBalancesState.isRunning = true;
    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
        const tabName = MASTERSHEET_TABS.FABRIC_BALANCES;

        // 1. Read the sheet + Count Date (serial) + Time cells
        const [rows, countDateSerialRows, countDateFormattedRows, countTimeRows] = await Promise.all([
            readRange(ORDERS_MASTERSHEET_ID, `'${tabName}'!A:J`),
            readRangeWithSerials(ORDERS_MASTERSHEET_ID, `'${tabName}'!${FABRIC_BALANCES_COUNT_DATETIME.DATE_CELL}`, [0]),
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
        // Try serial number first (from UNFORMATTED_VALUE), fall back to formatted text
        const countDateSerialStr = String(countDateSerialRows?.[0]?.[0] ?? '').trim();
        const countDateFormattedStr = String(countDateFormattedRows?.[0]?.[0] ?? '').trim();
        const countDateStr = countDateSerialStr || countDateFormattedStr;
        const countTimeStr = String(countTimeRows?.[0]?.[0] ?? '').trim();

        // If we got a serial number for the date, parse it directly and add time
        let countDateTime: Date | null = null;
        const serialDate = parseSheetDate(countDateSerialStr);
        if (serialDate && countTimeStr) {
            // Parse time and apply to the serial-parsed date
            const timeMatch = countTimeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
            if (timeMatch) {
                let hours = Number(timeMatch[1]);
                const minutes = Number(timeMatch[2] || 0);
                const ampm = timeMatch[3]?.toLowerCase();
                if (ampm === 'pm' && hours < 12) hours += 12;
                if (ampm === 'am' && hours === 12) hours = 0;
                serialDate.setHours(hours, minutes, 0, 0);
            }
            countDateTime = serialDate;
        } else if (serialDate) {
            countDateTime = serialDate;
        } else {
            // Fall back to text-based parsing
            const combinedDateTimeStr = countTimeStr ? `${countDateFormattedStr} ${countTimeStr}` : countDateFormattedStr;
            countDateTime = parseSheetDateTime(combinedDateTimeStr);
        }

        if (!countDateTime) {
            const displayStr = countTimeStr ? `${countDateFormattedStr} ${countTimeStr}` : countDateFormattedStr;
            const errorMsg = !countDateStr
                ? 'Count Date (cell M1) is empty. Pick the date when the physical count was taken.'
                : `Could not parse count date/time: "${displayStr}". Pick a date in M1 and time in O1.`;
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

        const countDateTimeStr = countTimeStr ? `${countDateFormattedStr} ${countTimeStr}` : countDateFormattedStr;

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
