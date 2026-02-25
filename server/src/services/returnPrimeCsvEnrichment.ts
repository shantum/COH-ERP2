/**
 * Return Prime CSV Enrichment Service
 *
 * Imports CSV export rows that contain fields not available in the Return Prime API
 * (for example: customer_comment, inspection_notes).
 *
 * Upserts by request number (RET/EXC serial) for idempotency.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { Prisma, type ReturnPrimeCsvEnrichment } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
import { classifyReturnCommentsBatch } from './aiClassifier.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'returnprime-csv-enrichment' });

const NULLISH_VALUES = new Set(['', 'na', 'n/a', 'null', '[]', '{}', '-', '--']);

interface CsvRecord extends Record<string, string | undefined> {
    serial_number?: string;
    type?: string;
    status?: string;
    reason?: string;
    customer_comment?: string;
    inspection_notes?: string;
    notes?: string;
    refund_status?: string;
    requested_refund_mode?: string;
    actual_refund_mode?: string;
    refunded_at?: string;
    pickup_awb?: string;
    pickup_logistics?: string;
}

export interface ReturnPrimeCsvNormalizedRow {
    requestNumber: string;
    requestType: string | null;
    status: string | null;
    csvReason: string | null;
    customerComment: string | null;
    inspectionNotes: string | null;
    notes: string | null;
    refundStatus: string | null;
    requestedRefundMode: string | null;
    actualRefundMode: string | null;
    refundedAtRaw: string | null;
    pickupAwb: string | null;
    pickupLogistics: string | null;
    rawRow: Prisma.InputJsonValue;
}

export interface ReturnPrimeCsvParsedResult {
    parsedRows: number;
    validRows: ReturnPrimeCsvNormalizedRow[];
    skippedRows: number;
    duplicateRequestNumbers: number;
}

export interface ReturnPrimeCsvPreviewRow {
    requestNumber: string;
    requestType: string | null;
    status: string | null;
    action: 'create' | 'update' | 'unchanged';
    customerComment: string | null;
    inspectionNotes: string | null;
    notes: string | null;
    pickupAwb: string | null;
    pickupLogistics: string | null;
    existingCustomerComment: string | null;
    existingInspectionNotes: string | null;
    existingNotes: string | null;
}

export interface ReturnPrimeCsvPreviewResult {
    parsedRows: number;
    validRows: number;
    skippedRows: number;
    duplicateRequestNumbers: number;
    distinctRequestNumbers: number;
    creates: number;
    updates: number;
    unchanged: number;
    matchedReturnPrimeRequests: number;
    matchedOrderLines: number;
    wouldEnrichOrderLines: number;
    rows: ReturnPrimeCsvPreviewRow[];
}

export interface ImportReturnPrimeCsvOptions {
    csvPath: string;
    dryRun?: boolean;
    enrichOrderLines?: boolean;
}

export interface ImportReturnPrimeCsvRowsOptions {
    rows: ReturnPrimeCsvNormalizedRow[];
    sourceFile: string;
    parsedRows?: number;
    skippedRows?: number;
    duplicateRequestNumbers?: number;
    dryRun?: boolean;
    enrichOrderLines?: boolean;
}

export interface ImportReturnPrimeCsvResult {
    csvPath?: string;
    sourceFile: string;
    dryRun: boolean;
    parsedRows: number;
    validRows: number;
    skippedRows: number;
    duplicateRequestNumbers: number;
    distinctRequestNumbers: number;
    existingEnrichmentRows: number;
    matchedReturnPrimeRequests: number;
    created: number;
    updated: number;
    unchanged: number;
    orderLinesEnriched: number;
}

function normalizeCell(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (NULLISH_VALUES.has(trimmed.toLowerCase())) return null;
    return trimmed;
}

function normalizeRequestNumber(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;
    return normalized;
}

const TRACKED_FIELDS: Array<keyof ReturnPrimeCsvNormalizedRow> = [
    'requestType',
    'status',
    'csvReason',
    'customerComment',
    'inspectionNotes',
    'notes',
    'refundStatus',
    'requestedRefundMode',
    'actualRefundMode',
    'refundedAtRaw',
    'pickupAwb',
    'pickupLogistics',
];

function hasRowChanges(
    existing: ReturnPrimeCsvEnrichment,
    incoming: ReturnPrimeCsvNormalizedRow
): boolean {
    return TRACKED_FIELDS.some((field) => {
        const existingValue = existing[field as keyof ReturnPrimeCsvEnrichment] as string | null;
        const incomingValue = incoming[field] as string | null;
        return (existingValue ?? null) !== (incomingValue ?? null);
    });
}

export function parseReturnPrimeCsvFromString(rawCsv: string): ReturnPrimeCsvParsedResult {
    const records = parse(rawCsv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
    }) as CsvRecord[];

    const rowsByRequestNumber = new Map<string, ReturnPrimeCsvNormalizedRow>();
    let skippedRows = 0;
    let duplicateRequestNumbers = 0;

    for (const rec of records) {
        const requestNumber = normalizeRequestNumber(normalizeCell(rec.serial_number));
        if (!requestNumber) {
            skippedRows++;
            continue;
        }

        const normalized: ReturnPrimeCsvNormalizedRow = {
            requestNumber,
            requestType: normalizeCell(rec.type)?.toLowerCase() ?? null,
            status: normalizeCell(rec.status)?.toLowerCase() ?? null,
            csvReason: normalizeCell(rec.reason),
            customerComment: normalizeCell(rec.customer_comment),
            inspectionNotes: normalizeCell(rec.inspection_notes),
            notes: normalizeCell(rec.notes),
            refundStatus: normalizeCell(rec.refund_status)?.toLowerCase() ?? null,
            requestedRefundMode: normalizeCell(rec.requested_refund_mode)?.toLowerCase() ?? null,
            actualRefundMode: normalizeCell(rec.actual_refund_mode)?.toLowerCase() ?? null,
            refundedAtRaw: normalizeCell(rec.refunded_at),
            pickupAwb: normalizeCell(rec.pickup_awb),
            pickupLogistics: normalizeCell(rec.pickup_logistics),
            rawRow: JSON.parse(JSON.stringify(rec)) as Prisma.InputJsonValue,
        };

        if (rowsByRequestNumber.has(requestNumber)) {
            duplicateRequestNumbers++;
        }
        // Last row wins for duplicates (deterministic idempotent behavior)
        rowsByRequestNumber.set(requestNumber, normalized);
    }

    return {
        parsedRows: records.length,
        validRows: Array.from(rowsByRequestNumber.values()),
        skippedRows,
        duplicateRequestNumbers,
    };
}

async function estimateOrderLineEnrichment(
    rows: ReturnPrimeCsvNormalizedRow[]
): Promise<{ matchedOrderLines: number; wouldEnrichOrderLines: number }> {
    const requestNumbers = rows.map((r) => r.requestNumber);
    if (requestNumbers.length === 0) {
        return { matchedOrderLines: 0, wouldEnrichOrderLines: 0 };
    }

    const incomingByRequest = new Map(rows.map((r) => [r.requestNumber, r]));
    const prisma = await getPrisma();
    const lines = await prisma.orderLine.findMany({
        where: { returnPrimeRequestNumber: { in: requestNumbers } },
        select: {
            id: true,
            returnPrimeRequestNumber: true,
            returnReasonDetail: true,
            returnConditionNotes: true,
            returnNotes: true,
            returnAwbNumber: true,
            returnCourier: true,
            returnRefundMethod: true,
        },
    });

    let wouldEnrichOrderLines = 0;
    for (const line of lines) {
        if (!line.returnPrimeRequestNumber) continue;
        const incoming = incomingByRequest.get(line.returnPrimeRequestNumber);
        if (!incoming) continue;

        const incomingRefundMode =
            incoming.actualRefundMode || incoming.requestedRefundMode;
        const mappedRefundMethod = incomingRefundMode === 'store_credit'
            ? 'store_credit'
            : (incomingRefundMode === 'bank_transfer' || incomingRefundMode === 'pay_to_source')
                ? 'bank_transfer'
                : null;

        const wouldUpdate =
            (!line.returnReasonDetail && !!incoming.customerComment) ||
            (!line.returnConditionNotes && !!incoming.inspectionNotes) ||
            (!line.returnNotes && !!incoming.notes) ||
            (!line.returnAwbNumber && !!incoming.pickupAwb) ||
            (!line.returnCourier && !!incoming.pickupLogistics) ||
            (!line.returnRefundMethod && !!mappedRefundMethod);

        if (wouldUpdate) {
            wouldEnrichOrderLines++;
        }
    }

    return { matchedOrderLines: lines.length, wouldEnrichOrderLines };
}

export async function previewReturnPrimeCsvRows(
    parsed: ReturnPrimeCsvParsedResult
): Promise<ReturnPrimeCsvPreviewResult> {
    const requestNumbers = parsed.validRows.map((r) => r.requestNumber);
    const prisma = await getPrisma();

    const [existingRows, matchedReturnPrimeRequests, orderLineEstimation] = requestNumbers.length > 0
        ? await Promise.all([
            prisma.returnPrimeCsvEnrichment.findMany({
                where: { requestNumber: { in: requestNumbers } },
            }),
            prisma.returnPrimeRequest.count({
                where: { rpRequestNumber: { in: requestNumbers } },
            }),
            estimateOrderLineEnrichment(parsed.validRows),
        ])
        : [[], 0, { matchedOrderLines: 0, wouldEnrichOrderLines: 0 }];

    const existingMap = new Map(existingRows.map((r) => [r.requestNumber, r]));

    let creates = 0;
    let updates = 0;
    let unchanged = 0;

    const rows: ReturnPrimeCsvPreviewRow[] = parsed.validRows.map((row) => {
        const existing = existingMap.get(row.requestNumber);
        let action: 'create' | 'update' | 'unchanged' = 'create';

        if (existing) {
            action = hasRowChanges(existing, row) ? 'update' : 'unchanged';
        }

        if (action === 'create') creates++;
        else if (action === 'update') updates++;
        else unchanged++;

        return {
            requestNumber: row.requestNumber,
            requestType: row.requestType,
            status: row.status,
            action,
            customerComment: row.customerComment,
            inspectionNotes: row.inspectionNotes,
            notes: row.notes,
            pickupAwb: row.pickupAwb,
            pickupLogistics: row.pickupLogistics,
            existingCustomerComment: existing?.customerComment ?? null,
            existingInspectionNotes: existing?.inspectionNotes ?? null,
            existingNotes: existing?.notes ?? null,
        };
    });

    return {
        parsedRows: parsed.parsedRows,
        validRows: parsed.validRows.length,
        skippedRows: parsed.skippedRows,
        duplicateRequestNumbers: parsed.duplicateRequestNumbers,
        distinctRequestNumbers: requestNumbers.length,
        creates,
        updates,
        unchanged,
        matchedReturnPrimeRequests,
        matchedOrderLines: orderLineEstimation.matchedOrderLines,
        wouldEnrichOrderLines: orderLineEstimation.wouldEnrichOrderLines,
        rows,
    };
}

async function enrichOrderLinesFromCsv(
    requestNumbers: string[]
): Promise<number> {
    if (requestNumbers.length === 0) return 0;

    const prisma = await getPrisma();
    const sqlList = Prisma.join(requestNumbers);

    const enrichedCount = await prisma.$executeRaw`
        UPDATE "OrderLine" ol
        SET
            "returnReasonDetail" = COALESCE(ol."returnReasonDetail", e."customerComment"),
            "returnConditionNotes" = COALESCE(ol."returnConditionNotes", e."inspectionNotes"),
            "returnNotes" = COALESCE(ol."returnNotes", e."notes"),
            "returnAwbNumber" = COALESCE(ol."returnAwbNumber", e."pickupAwb"),
            "returnCourier" = COALESCE(ol."returnCourier", e."pickupLogistics"),
            "returnRefundMethod" = COALESCE(
                ol."returnRefundMethod",
                CASE
                    WHEN lower(COALESCE(NULLIF(e."actualRefundMode", ''), NULLIF(e."requestedRefundMode", ''))) = 'store_credit'
                        THEN 'store_credit'
                    WHEN lower(COALESCE(NULLIF(e."actualRefundMode", ''), NULLIF(e."requestedRefundMode", ''))) IN ('bank_transfer', 'pay_to_source')
                        THEN 'bank_transfer'
                    ELSE NULL
                END
            )
        FROM "ReturnPrimeCsvEnrichment" e
        WHERE ol."returnPrimeRequestNumber" = e."requestNumber"
          AND e."requestNumber" IN (${sqlList})
          AND (
              (ol."returnReasonDetail" IS NULL AND e."customerComment" IS NOT NULL) OR
              (ol."returnConditionNotes" IS NULL AND e."inspectionNotes" IS NOT NULL) OR
              (ol."returnNotes" IS NULL AND e."notes" IS NOT NULL) OR
              (ol."returnAwbNumber" IS NULL AND e."pickupAwb" IS NOT NULL) OR
              (ol."returnCourier" IS NULL AND e."pickupLogistics" IS NOT NULL) OR
              (
                  ol."returnRefundMethod" IS NULL AND
                  lower(COALESCE(NULLIF(e."actualRefundMode", ''), NULLIF(e."requestedRefundMode", ''))) IN ('store_credit', 'bank_transfer', 'pay_to_source')
              )
          )
    `;

    // AI-classify return reasons for lines that now have a customer comment
    // but still have 'other' or null category
    const linesToClassify = await prisma.orderLine.findMany({
        where: {
            returnPrimeRequestNumber: { in: requestNumbers },
            returnReasonDetail: { not: null },
            OR: [
                { returnReasonCategory: 'other' },
                { returnReasonCategory: null },
            ],
        },
        select: { id: true, returnReasonDetail: true },
    });

    const classifiable = linesToClassify.filter(l => {
        const comment = l.returnReasonDetail?.trim().toLowerCase();
        return comment && comment !== 'others' && comment !== 'na' && comment !== 'n/a' && comment.length > 2;
    });

    if (classifiable.length > 0) {
        const classifications = await classifyReturnCommentsBatch(
            classifiable.map(l => ({ id: l.id, comment: l.returnReasonDetail! }))
        );

        const updates = [...classifications.entries()].filter(([, cat]) => cat !== 'other');
        if (updates.length > 0) {
            await prisma.$transaction(
                updates.map(([id, category]) =>
                    prisma.orderLine.update({
                        where: { id },
                        data: { returnReasonCategory: category },
                    })
                )
            );
            log.info({ classified: updates.length, total: classifiable.length }, 'AI-classified return reasons from CSV enrichment');
        }
    }

    return Number(enrichedCount);
}

export async function importReturnPrimeCsvEnrichmentFromRows(
    options: ImportReturnPrimeCsvRowsOptions
): Promise<ImportReturnPrimeCsvResult> {
    const rows = options.rows;
    const sourceFile = options.sourceFile;
    const dryRun = options.dryRun === true;
    const enrichOrderLines = options.enrichOrderLines !== false;
    const parsedRows = options.parsedRows ?? rows.length;
    const skippedRows = options.skippedRows ?? 0;
    const duplicateRequestNumbers = options.duplicateRequestNumbers ?? 0;
    const requestNumbers = rows.map((r) => r.requestNumber);
    const prisma = await getPrisma();

    const [existingRows, matchedReturnPrimeRequests] = requestNumbers.length > 0
        ? await Promise.all([
            prisma.returnPrimeCsvEnrichment.findMany({
                where: { requestNumber: { in: requestNumbers } },
            }),
            prisma.returnPrimeRequest.count({
                where: { rpRequestNumber: { in: requestNumbers } },
            }),
        ])
        : [[], 0];

    const existingMap = new Map(existingRows.map((r) => [r.requestNumber, r]));

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    if (!dryRun) {
        for (const row of rows) {
            const existing = existingMap.get(row.requestNumber);
            if (!existing) {
                await prisma.returnPrimeCsvEnrichment.create({
                    data: {
                        requestNumber: row.requestNumber,
                        requestType: row.requestType,
                        status: row.status,
                        csvReason: row.csvReason,
                        customerComment: row.customerComment,
                        inspectionNotes: row.inspectionNotes,
                        notes: row.notes,
                        refundStatus: row.refundStatus,
                        requestedRefundMode: row.requestedRefundMode,
                        actualRefundMode: row.actualRefundMode,
                        refundedAtRaw: row.refundedAtRaw,
                        pickupAwb: row.pickupAwb,
                        pickupLogistics: row.pickupLogistics,
                        sourceFile,
                        rawRow: row.rawRow,
                        importedAt: new Date(),
                    },
                });
                created++;
                continue;
            }

            if (hasRowChanges(existing, row)) {
                await prisma.returnPrimeCsvEnrichment.update({
                    where: { requestNumber: row.requestNumber },
                    data: {
                        requestType: row.requestType,
                        status: row.status,
                        csvReason: row.csvReason,
                        customerComment: row.customerComment,
                        inspectionNotes: row.inspectionNotes,
                        notes: row.notes,
                        refundStatus: row.refundStatus,
                        requestedRefundMode: row.requestedRefundMode,
                        actualRefundMode: row.actualRefundMode,
                        refundedAtRaw: row.refundedAtRaw,
                        pickupAwb: row.pickupAwb,
                        pickupLogistics: row.pickupLogistics,
                        sourceFile,
                        rawRow: row.rawRow,
                        importedAt: new Date(),
                    },
                });
                updated++;
            } else {
                unchanged++;
            }
        }
    } else {
        for (const row of rows) {
            const existing = existingMap.get(row.requestNumber);
            if (!existing) created++;
            else if (hasRowChanges(existing, row)) updated++;
            else unchanged++;
        }
    }

    const orderLinesEnriched = (!dryRun && enrichOrderLines)
        ? await enrichOrderLinesFromCsv(requestNumbers)
        : 0;

    const result: ImportReturnPrimeCsvResult = {
        sourceFile,
        dryRun,
        parsedRows,
        validRows: rows.length,
        skippedRows,
        duplicateRequestNumbers,
        distinctRequestNumbers: requestNumbers.length,
        existingEnrichmentRows: existingRows.length,
        matchedReturnPrimeRequests,
        created,
        updated,
        unchanged,
        orderLinesEnriched,
    };

    log.info(result, 'Return Prime CSV enrichment import complete');
    return result;
}

export async function importReturnPrimeCsvEnrichment(
    options: ImportReturnPrimeCsvOptions
): Promise<ImportReturnPrimeCsvResult> {
    const csvPath = options.csvPath;
    const sourceFile = path.basename(csvPath);
    const rawCsv = readFileSync(csvPath, 'utf-8');
    const parsed = parseReturnPrimeCsvFromString(rawCsv);

    const result = await importReturnPrimeCsvEnrichmentFromRows({
        rows: parsed.validRows,
        sourceFile,
        parsedRows: parsed.parsedRows,
        skippedRows: parsed.skippedRows,
        duplicateRequestNumbers: parsed.duplicateRequestNumbers,
        dryRun: options.dryRun,
        enrichOrderLines: options.enrichOrderLines,
    });

    return {
        ...result,
        csvPath,
    };
}
