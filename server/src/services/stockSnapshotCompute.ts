/**
 * Stock Snapshot Computation Service
 *
 * Computes monthly stock snapshots: Opening + Inward - Outward = Closing
 * with reason breakdowns. Past months are saved to DB, current month computed live.
 *
 * Uses Kysely for aggregation queries (leverages existing indexes on
 * InventoryTransaction.createdAt and [skuId, txnType]).
 */

import { sql } from 'kysely';
import { kysely } from '../db/index.js';
import { prisma } from '../db/index.js';
import { monthBoundariesIST, nowIST } from '../utils/dateHelpers.js';
import { snapshotLogger } from '../utils/logger.js';

// ============================================
// TYPES
// ============================================

interface SkuAggregation {
    totalInward: number;
    totalOutward: number;
    inwardBreakdown: Record<string, number>;
    outwardBreakdown: Record<string, number>;
}

export interface MonthSnapshotRow {
    skuId: string;
    openingStock: number;
    totalInward: number;
    totalOutward: number;
    closingStock: number;
    inwardBreakdown: Record<string, number>;
    outwardBreakdown: Record<string, number>;
}

export interface ComputeResult {
    year: number;
    month: number;
    skusProcessed: number;
    durationMs: number;
    error?: string;
}

export interface BackfillResult {
    monthsProcessed: number;
    totalSkusProcessed: number;
    durationMs: number;
    error?: string;
}

// ============================================
// CORE: Aggregate transactions for a date range
// ============================================

/**
 * Aggregates InventoryTransaction rows for a given time range,
 * grouped by skuId + txnType + reason.
 */
async function computeMonthAggregations(
    monthStart: Date,
    monthEnd: Date
): Promise<Map<string, SkuAggregation>> {
    const rows = await kysely
        .selectFrom('InventoryTransaction')
        .select([
            'InventoryTransaction.skuId',
            'InventoryTransaction.txnType',
            'InventoryTransaction.reason',
            sql<number>`COALESCE(SUM("InventoryTransaction"."qty"), 0)::int`.as('totalQty'),
        ])
        .where('InventoryTransaction.createdAt', '>=', monthStart)
        .where('InventoryTransaction.createdAt', '<', monthEnd)
        .groupBy([
            'InventoryTransaction.skuId',
            'InventoryTransaction.txnType',
            'InventoryTransaction.reason',
        ])
        .execute();

    const map = new Map<string, SkuAggregation>();

    for (const row of rows) {
        let agg = map.get(row.skuId);
        if (!agg) {
            agg = { totalInward: 0, totalOutward: 0, inwardBreakdown: {}, outwardBreakdown: {} };
            map.set(row.skuId, agg);
        }

        const qty = Number(row.totalQty);
        const reason = row.reason ?? 'unknown';

        if (row.txnType === 'inward') {
            agg.totalInward += qty;
            agg.inwardBreakdown[reason] = (agg.inwardBreakdown[reason] ?? 0) + qty;
        } else if (row.txnType === 'outward') {
            agg.totalOutward += qty;
            agg.outwardBreakdown[reason] = (agg.outwardBreakdown[reason] ?? 0) + qty;
        }
    }

    return map;
}

// ============================================
// CORE: Get opening stocks from previous month
// ============================================

/**
 * Reads previous month's closing stock from MonthlyStockSnapshot.
 * Returns Map<skuId, closingStock>. Missing SKUs default to 0.
 */
async function getOpeningStocks(
    year: number,
    month: number
): Promise<Map<string, number>> {
    // Previous month
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthDate = new Date(Date.UTC(prevYear, prevMonth - 1, 1));

    const snapshots = await prisma.monthlyStockSnapshot.findMany({
        where: { month: prevMonthDate },
        select: { skuId: true, closingStock: true },
    });

    const map = new Map<string, number>();
    for (const snap of snapshots) {
        map.set(snap.skuId, snap.closingStock);
    }
    return map;
}

// ============================================
// CORE: Compute and save a single month
// ============================================

/**
 * Orchestrates computation for one month and upserts results to DB.
 */
export async function computeAndSaveMonth(
    year: number,
    month: number
): Promise<ComputeResult> {
    const startTime = Date.now();
    snapshotLogger.info({ year, month }, 'Computing snapshot');

    try {
        const { start, end } = monthBoundariesIST(year, month);
        const monthDate = new Date(Date.UTC(year, month - 1, 1));

        // Step 1: Get opening stocks from previous month's snapshots
        const openingMap = await getOpeningStocks(year, month);

        // Step 2: Aggregate this month's transactions
        const aggMap = await computeMonthAggregations(start, end);

        // Step 3: Merge — include SKUs with either opening stock or transactions
        const allSkuIds = new Set<string>([...openingMap.keys(), ...aggMap.keys()]);
        const rows: MonthSnapshotRow[] = [];

        for (const skuId of allSkuIds) {
            const opening = openingMap.get(skuId) ?? 0;
            const agg = aggMap.get(skuId);
            const totalInward = agg?.totalInward ?? 0;
            const totalOutward = agg?.totalOutward ?? 0;
            const closing = opening + totalInward - totalOutward;

            // Skip rows where everything is zero (no point storing them)
            if (opening === 0 && totalInward === 0 && totalOutward === 0) continue;

            rows.push({
                skuId,
                openingStock: opening,
                totalInward,
                totalOutward,
                closingStock: closing,
                inwardBreakdown: agg?.inwardBreakdown ?? {},
                outwardBreakdown: agg?.outwardBreakdown ?? {},
            });
        }

        // Step 4: Upsert in batches of 2000
        const BATCH_SIZE = 2000;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);

            // Use raw SQL for bulk upsert (Prisma doesn't support upsertMany)
            if (batch.length > 0) {
                const values = batch.map(r =>
                    sql`(gen_random_uuid(), ${r.skuId}, ${monthDate}, ${r.openingStock}, ${r.totalInward}, ${r.totalOutward}, ${r.closingStock}, ${JSON.stringify(r.inwardBreakdown)}::jsonb, ${JSON.stringify(r.outwardBreakdown)}::jsonb, NOW())`
                );

                await sql`
                    INSERT INTO "MonthlyStockSnapshot" ("id", "skuId", "month", "openingStock", "totalInward", "totalOutward", "closingStock", "inwardBreakdown", "outwardBreakdown", "computedAt")
                    VALUES ${sql.join(values, sql`, `)}
                    ON CONFLICT ("skuId", "month") DO UPDATE SET
                        "openingStock" = EXCLUDED."openingStock",
                        "totalInward" = EXCLUDED."totalInward",
                        "totalOutward" = EXCLUDED."totalOutward",
                        "closingStock" = EXCLUDED."closingStock",
                        "inwardBreakdown" = EXCLUDED."inwardBreakdown",
                        "outwardBreakdown" = EXCLUDED."outwardBreakdown",
                        "computedAt" = NOW()
                `.execute(kysely);
            }
        }

        const durationMs = Date.now() - startTime;
        snapshotLogger.info({ year, month, skusProcessed: rows.length, durationMs }, 'Snapshot saved');

        return { year, month, skusProcessed: rows.length, durationMs };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        snapshotLogger.error({ year, month, error: message }, 'Snapshot compute failed');
        return { year, month, skusProcessed: 0, durationMs: Date.now() - startTime, error: message };
    }
}

// ============================================
// LIVE: Compute current (incomplete) month
// ============================================

/**
 * Computes the current month's data on-the-fly without saving.
 * Useful because the month isn't complete yet — numbers change daily.
 */
export async function computeCurrentMonthLive(): Promise<MonthSnapshotRow[]> {
    const ist = nowIST();
    const year = ist.getUTCFullYear();
    const month = ist.getUTCMonth() + 1; // 1-based

    const { start, end } = monthBoundariesIST(year, month);

    // Opening = previous month's closing
    const openingMap = await getOpeningStocks(year, month);

    // Transactions so far this month
    const aggMap = await computeMonthAggregations(start, end);

    const allSkuIds = new Set<string>([...openingMap.keys(), ...aggMap.keys()]);
    const rows: MonthSnapshotRow[] = [];

    for (const skuId of allSkuIds) {
        const opening = openingMap.get(skuId) ?? 0;
        const agg = aggMap.get(skuId);
        const totalInward = agg?.totalInward ?? 0;
        const totalOutward = agg?.totalOutward ?? 0;
        const closing = opening + totalInward - totalOutward;

        if (opening === 0 && totalInward === 0 && totalOutward === 0) continue;

        rows.push({
            skuId,
            openingStock: opening,
            totalInward,
            totalOutward,
            closingStock: closing,
            inwardBreakdown: agg?.inwardBreakdown ?? {},
            outwardBreakdown: agg?.outwardBreakdown ?? {},
        });
    }

    return rows;
}

// ============================================
// BACKFILL: Process all historical months
// ============================================

/**
 * Finds the earliest transaction and loops month-by-month, computing
 * and saving snapshots sequentially (each depends on previous closing).
 */
export async function backfillAll(): Promise<BackfillResult> {
    const startTime = Date.now();
    snapshotLogger.info('Starting full backfill');

    try {
        // Find earliest transaction
        const earliest = await prisma.inventoryTransaction.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
        });

        if (!earliest) {
            snapshotLogger.info('No transactions found, nothing to backfill');
            return { monthsProcessed: 0, totalSkusProcessed: 0, durationMs: Date.now() - startTime };
        }

        // Get IST month of earliest transaction
        const ist = nowIST();
        const currentYear = ist.getUTCFullYear();
        const currentMonth = ist.getUTCMonth() + 1;

        // Start from the month of the earliest transaction (in IST)
        const earliestIST = new Date(earliest.createdAt.getTime() + 5.5 * 60 * 60 * 1000);
        let year = earliestIST.getUTCFullYear();
        let month = earliestIST.getUTCMonth() + 1;

        let monthsProcessed = 0;
        let totalSkusProcessed = 0;

        // Loop through each month up to (but NOT including) current month
        while (year < currentYear || (year === currentYear && month < currentMonth)) {
            const result = await computeAndSaveMonth(year, month);
            monthsProcessed++;
            totalSkusProcessed += result.skusProcessed;

            if (result.error) {
                snapshotLogger.error({ year, month, error: result.error }, 'Backfill month failed, stopping');
                break;
            }

            // Advance to next month
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
        }

        const durationMs = Date.now() - startTime;
        snapshotLogger.info({ monthsProcessed, totalSkusProcessed, durationMs }, 'Backfill complete');

        return { monthsProcessed, totalSkusProcessed, durationMs };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        snapshotLogger.error({ error: message }, 'Backfill failed');
        return { monthsProcessed: 0, totalSkusProcessed: 0, durationMs: Date.now() - startTime, error: message };
    }
}
