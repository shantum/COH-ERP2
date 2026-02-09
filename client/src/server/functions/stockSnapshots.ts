/**
 * Stock Snapshot Server Functions
 *
 * Monthly stock report: Opening + Inward - Outward = Closing
 * with reason breakdowns per SKU or rolled up by product.
 *
 * IMPORTANT: All DB imports are dynamic to prevent Node.js code
 * from being bundled into the client. Uses getKysely()/getPrisma()
 * from @coh/shared — NOT direct server imports.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';

// ============================================
// INPUT SCHEMAS
// ============================================

const getMonthlySnapshotSchema = z.object({
    year: z.number().int().positive(),
    month: z.number().int().min(1).max(12),
    search: z.string().optional(),
    category: z.string().optional(),
    rollup: z.enum(['sku', 'product']).default('sku'),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(500).default(100),
});

const getSnapshotSummarySchema = z.object({
    year: z.number().int().positive(),
    month: z.number().int().min(1).max(12),
});

const getSkuTrendSchema = z.object({
    skuId: z.string().min(1),
    months: z.number().int().positive().max(24).default(12),
});

// ============================================
// OUTPUT TYPES
// ============================================

export interface SnapshotRow {
    skuId: string;
    skuCode: string;
    productName: string;
    colorName: string;
    size: string;
    openingStock: number;
    totalInward: number;
    totalOutward: number;
    closingStock: number;
    inwardBreakdown: Record<string, number>;
    outwardBreakdown: Record<string, number>;
}

export interface SnapshotResult {
    items: SnapshotRow[];
    total: number;
    page: number;
    limit: number;
    isLive: boolean; // true if current (incomplete) month
}

export interface SnapshotSummary {
    totalOpening: number;
    totalInward: number;
    totalOutward: number;
    totalClosing: number;
    skuCount: number;
    topInwardReasons: Record<string, number>;
    topOutwardReasons: Record<string, number>;
    isLive: boolean;
}

export interface AvailableMonth {
    year: number;
    month: number;
    label: string; // "Jan 2026"
}

export interface SkuTrendPoint {
    year: number;
    month: number;
    label: string;
    openingStock: number;
    totalInward: number;
    totalOutward: number;
    closingStock: number;
}

// ============================================
// HELPERS
// ============================================

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function isCurrentMonth(year: number, month: number): boolean {
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    return istNow.getUTCFullYear() === year && istNow.getUTCMonth() + 1 === month;
}

function monthBoundariesIST(year: number, month: number): { start: Date; end: Date } {
    return {
        start: new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS),
        end: new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS),
    };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(year: number, month: number): string {
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

// ============================================
// LIVE COMPUTATION (inline — no server import)
// ============================================

interface RawSnapshotRow {
    skuId: string;
    openingStock: number;
    totalInward: number;
    totalOutward: number;
    closingStock: number;
    inwardBreakdown: Record<string, number>;
    outwardBreakdown: Record<string, number>;
}

/**
 * Compute current month's snapshot on the fly using getKysely()
 * This runs inside server functions — safe for production builds.
 */
async function computeLive(year: number, month: number): Promise<RawSnapshotRow[]> {
    const { getKysely } = await import('@coh/shared/services/db');
    const db = await getKysely();
    const { sql } = await import('kysely');
    const prisma = await getPrisma();

    const { start, end } = monthBoundariesIST(year, month);

    // 1. Aggregate transactions for this month
    const txnRows = await db
        .selectFrom('InventoryTransaction')
        .select([
            'InventoryTransaction.skuId',
            'InventoryTransaction.txnType',
            'InventoryTransaction.reason',
            sql<number>`COALESCE(SUM("InventoryTransaction"."qty"), 0)::int`.as('totalQty'),
        ])
        .where('InventoryTransaction.createdAt', '>=', start)
        .where('InventoryTransaction.createdAt', '<', end)
        .groupBy([
            'InventoryTransaction.skuId',
            'InventoryTransaction.txnType',
            'InventoryTransaction.reason',
        ])
        .execute();

    // Build aggregation map
    const aggMap = new Map<string, { totalInward: number; totalOutward: number; inwardBreakdown: Record<string, number>; outwardBreakdown: Record<string, number> }>();
    for (const row of txnRows) {
        let agg = aggMap.get(row.skuId);
        if (!agg) {
            agg = { totalInward: 0, totalOutward: 0, inwardBreakdown: {}, outwardBreakdown: {} };
            aggMap.set(row.skuId, agg);
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

    // 2. Get opening stocks from previous month's snapshots
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthDate = new Date(Date.UTC(prevYear, prevMonth - 1, 1));

    const prevSnapshots = await prisma.monthlyStockSnapshot.findMany({
        where: { month: prevMonthDate },
        select: { skuId: true, closingStock: true },
    });
    const openingMap = new Map(prevSnapshots.map(s => [s.skuId, s.closingStock]));

    // 3. Merge
    const allSkuIds = new Set([...openingMap.keys(), ...aggMap.keys()]);
    const rows: RawSnapshotRow[] = [];

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
// SERVER FUNCTIONS
// ============================================

/**
 * Get monthly snapshot data — main table data
 * For past months: reads from MonthlyStockSnapshot table
 * For current month: computes live from transactions
 */
export const getMonthlySnapshot = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getMonthlySnapshotSchema> =>
            getMonthlySnapshotSchema.parse(input)
    )
    .handler(async ({ data }): Promise<SnapshotResult> => {
        const { year, month, search, category, rollup, page, limit } = data;
        const prisma = await getPrisma();
        const isLive = isCurrentMonth(year, month);

        let rawRows: RawSnapshotRow[];

        if (isLive) {
            rawRows = await computeLive(year, month);
        } else {
            const monthDate = new Date(Date.UTC(year, month - 1, 1));
            const snapshots = await prisma.monthlyStockSnapshot.findMany({
                where: { month: monthDate },
                select: {
                    skuId: true,
                    openingStock: true,
                    totalInward: true,
                    totalOutward: true,
                    closingStock: true,
                    inwardBreakdown: true,
                    outwardBreakdown: true,
                },
            });
            rawRows = snapshots.map(s => ({
                ...s,
                inwardBreakdown: (s.inwardBreakdown ?? {}) as Record<string, number>,
                outwardBreakdown: (s.outwardBreakdown ?? {}) as Record<string, number>,
            }));
        }

        // Fetch SKU details for all relevant skuIds
        const skuIds = rawRows.map(r => r.skuId);
        const skus = await prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: {
                id: true,
                skuCode: true,
                size: true,
                variation: {
                    select: {
                        colorName: true,
                        product: {
                            select: {
                                id: true,
                                name: true,
                                category: true,
                            },
                        },
                    },
                },
            },
        });
        const skuMap = new Map(skus.map(s => [s.id, s]));

        // Build enriched rows
        let enriched: SnapshotRow[] = rawRows
            .map(r => {
                const sku = skuMap.get(r.skuId);
                if (!sku) return null;
                return {
                    skuId: r.skuId,
                    skuCode: sku.skuCode,
                    productName: sku.variation.product.name,
                    colorName: sku.variation.colorName,
                    size: sku.size,
                    openingStock: r.openingStock,
                    totalInward: r.totalInward,
                    totalOutward: r.totalOutward,
                    closingStock: r.closingStock,
                    inwardBreakdown: r.inwardBreakdown,
                    outwardBreakdown: r.outwardBreakdown,
                    _category: sku.variation.product.category,
                    _productId: sku.variation.product.id,
                };
            })
            .filter((r): r is SnapshotRow & { _category: string; _productId: string } => r !== null);

        // Apply search filter
        if (search) {
            const q = search.toLowerCase();
            enriched = enriched.filter(r =>
                r.skuCode.toLowerCase().includes(q) ||
                r.productName.toLowerCase().includes(q) ||
                r.colorName.toLowerCase().includes(q)
            );
        }

        // Apply category filter
        if (category) {
            enriched = enriched.filter(r => (r as SnapshotRow & { _category: string })._category === category);
        }

        // Product rollup
        if (rollup === 'product') {
            const productMap = new Map<string, SnapshotRow & { _category: string; _productId: string }>();
            for (const row of enriched) {
                const extRow = row as SnapshotRow & { _category: string; _productId: string };
                const existing = productMap.get(extRow._productId);
                if (existing) {
                    existing.openingStock += row.openingStock;
                    existing.totalInward += row.totalInward;
                    existing.totalOutward += row.totalOutward;
                    existing.closingStock += row.closingStock;
                    for (const [k, v] of Object.entries(row.inwardBreakdown)) {
                        existing.inwardBreakdown[k] = (existing.inwardBreakdown[k] ?? 0) + v;
                    }
                    for (const [k, v] of Object.entries(row.outwardBreakdown)) {
                        existing.outwardBreakdown[k] = (existing.outwardBreakdown[k] ?? 0) + v;
                    }
                } else {
                    productMap.set(extRow._productId, {
                        ...row,
                        size: 'All',
                        skuCode: row.productName,
                        inwardBreakdown: { ...row.inwardBreakdown },
                        outwardBreakdown: { ...row.outwardBreakdown },
                        _category: extRow._category,
                        _productId: extRow._productId,
                    });
                }
            }
            enriched = Array.from(productMap.values());
        }

        // Sort by closing stock descending
        enriched.sort((a, b) => b.closingStock - a.closingStock);

        const total = enriched.length;
        const offset = (page - 1) * limit;
        const items = enriched.slice(offset, offset + limit).map(r => {
            const { _category, _productId, ...clean } = r as SnapshotRow & { _category?: string | null; _productId?: string };
            return clean;
        });

        return { items, total, page, limit, isLive };
    });

/**
 * Get summary totals for the month
 */
export const getSnapshotSummary = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getSnapshotSummarySchema> =>
            getSnapshotSummarySchema.parse(input)
    )
    .handler(async ({ data }): Promise<SnapshotSummary> => {
        const { year, month } = data;
        const prisma = await getPrisma();
        const isLive = isCurrentMonth(year, month);

        let rows: RawSnapshotRow[];

        if (isLive) {
            rows = await computeLive(year, month);
        } else {
            const monthDate = new Date(Date.UTC(year, month - 1, 1));
            const snapshots = await prisma.monthlyStockSnapshot.findMany({
                where: { month: monthDate },
                select: {
                    skuId: true,
                    openingStock: true,
                    totalInward: true,
                    totalOutward: true,
                    closingStock: true,
                    inwardBreakdown: true,
                    outwardBreakdown: true,
                },
            });
            rows = snapshots.map(s => ({
                ...s,
                inwardBreakdown: (s.inwardBreakdown ?? {}) as Record<string, number>,
                outwardBreakdown: (s.outwardBreakdown ?? {}) as Record<string, number>,
            }));
        }

        let totalOpening = 0;
        let totalInward = 0;
        let totalOutward = 0;
        let totalClosing = 0;
        const topInwardReasons: Record<string, number> = {};
        const topOutwardReasons: Record<string, number> = {};

        for (const row of rows) {
            totalOpening += row.openingStock;
            totalInward += row.totalInward;
            totalOutward += row.totalOutward;
            totalClosing += row.closingStock;

            for (const [k, v] of Object.entries(row.inwardBreakdown)) {
                topInwardReasons[k] = (topInwardReasons[k] ?? 0) + v;
            }
            for (const [k, v] of Object.entries(row.outwardBreakdown)) {
                topOutwardReasons[k] = (topOutwardReasons[k] ?? 0) + v;
            }
        }

        return {
            totalOpening,
            totalInward,
            totalOutward,
            totalClosing,
            skuCount: rows.length,
            topInwardReasons,
            topOutwardReasons,
            isLive,
        };
    });

/**
 * Get available months that have snapshot data
 */
export const getAvailableMonths = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<AvailableMonth[]> => {
        const prisma = await getPrisma();

        const snapshots = await prisma.monthlyStockSnapshot.findMany({
            distinct: ['month'],
            select: { month: true },
            orderBy: { month: 'desc' },
        });

        const months: AvailableMonth[] = snapshots.map(s => {
            const d = s.month;
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth() + 1;
            return { year: y, month: m, label: monthLabel(y, m) };
        });

        const istNow = new Date(Date.now() + IST_OFFSET_MS);
        const curYear = istNow.getUTCFullYear();
        const curMonth = istNow.getUTCMonth() + 1;

        if (!months.some(m => m.year === curYear && m.month === curMonth)) {
            months.unshift({ year: curYear, month: curMonth, label: `${monthLabel(curYear, curMonth)} (Live)` });
        }

        return months;
    });

/**
 * Get trend data for a single SKU (last N months)
 */
export const getSkuTrend = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator(
        (input: unknown): z.infer<typeof getSkuTrendSchema> =>
            getSkuTrendSchema.parse(input)
    )
    .handler(async ({ data }): Promise<SkuTrendPoint[]> => {
        const { skuId, months: monthCount } = data;
        const prisma = await getPrisma();

        const snapshots = await prisma.monthlyStockSnapshot.findMany({
            where: { skuId },
            orderBy: { month: 'desc' },
            take: monthCount,
            select: {
                month: true,
                openingStock: true,
                totalInward: true,
                totalOutward: true,
                closingStock: true,
            },
        });

        return snapshots
            .reverse()
            .map(s => {
                const y = s.month.getUTCFullYear();
                const m = s.month.getUTCMonth() + 1;
                return {
                    year: y,
                    month: m,
                    label: monthLabel(y, m),
                    openingStock: s.openingStock,
                    totalInward: s.totalInward,
                    totalOutward: s.totalOutward,
                    closingStock: s.closingStock,
                };
            });
    });
