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
import { Prisma } from '@prisma/client';
import { getPrisma } from '@coh/shared/services/db';
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

interface NormalizedRow {
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

export interface ImportReturnPrimeCsvOptions {
    csvPath: string;
    dryRun?: boolean;
    enrichOrderLines?: boolean;
}

export interface ImportReturnPrimeCsvResult {
    csvPath: string;
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
    if (!(normalized.startsWith('RET') || normalized.startsWith('EXC'))) return normalized;
    return normalized;
}

function parseAndNormalizeRows(rawCsv: string): {
    parsedRows: number;
    validRows: NormalizedRow[];
    skippedRows: number;
    duplicateRequestNumbers: number;
} {
    const records = parse(rawCsv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
    }) as CsvRecord[];

    const rowsByRequestNumber = new Map<string, NormalizedRow>();
    let skippedRows = 0;
    let duplicateRequestNumbers = 0;

    for (const rec of records) {
        const requestNumber = normalizeRequestNumber(normalizeCell(rec.serial_number));
        if (!requestNumber) {
            skippedRows++;
            continue;
        }

        const normalized: NormalizedRow = {
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

    return Number(enrichedCount);
}

export async function importReturnPrimeCsvEnrichment(
    options: ImportReturnPrimeCsvOptions
): Promise<ImportReturnPrimeCsvResult> {
    const csvPath = options.csvPath;
    const sourceFile = path.basename(csvPath);
    const dryRun = options.dryRun === true;
    const enrichOrderLines = options.enrichOrderLines !== false;

    const rawCsv = readFileSync(csvPath, 'utf-8');
    const normalized = parseAndNormalizeRows(rawCsv);
    const requestNumbers = normalized.validRows.map((r) => r.requestNumber);
    const prisma = await getPrisma();

    const [existingEnrichment, matchedReturnPrimeRequests] = requestNumbers.length > 0
        ? await Promise.all([
            prisma.returnPrimeCsvEnrichment.findMany({
                where: { requestNumber: { in: requestNumbers } },
                select: { requestNumber: true },
            }),
            prisma.returnPrimeRequest.count({
                where: { rpRequestNumber: { in: requestNumbers } },
            }),
        ])
        : [[], 0];

    const existingSet = new Set(existingEnrichment.map((e) => e.requestNumber));

    let created = 0;
    let updated = 0;

    if (!dryRun) {
        for (const row of normalized.validRows) {
            await prisma.returnPrimeCsvEnrichment.upsert({
                where: { requestNumber: row.requestNumber },
                create: {
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
                update: {
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

            if (existingSet.has(row.requestNumber)) {
                updated++;
            } else {
                created++;
            }
        }
    }

    const orderLinesEnriched = (!dryRun && enrichOrderLines)
        ? await enrichOrderLinesFromCsv(requestNumbers)
        : 0;

    const result: ImportReturnPrimeCsvResult = {
        csvPath,
        sourceFile,
        dryRun,
        parsedRows: normalized.parsedRows,
        validRows: normalized.validRows.length,
        skippedRows: normalized.skippedRows,
        duplicateRequestNumbers: normalized.duplicateRequestNumbers,
        distinctRequestNumbers: requestNumbers.length,
        existingEnrichmentRows: existingSet.size,
        matchedReturnPrimeRequests,
        created,
        updated,
        orderLinesEnriched,
    };

    log.info(result, 'Return Prime CSV enrichment import complete');
    return result;
}
