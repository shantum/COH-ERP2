/**
 * Tailor Performance Server Functions
 *
 * Aggregates inward inventory transactions by tailor number
 * to compute production metrics, SKU breakdowns, and monthly trends.
 *
 * Split handling: entries like "7/5", "7 & 14" split qty equally between tailors.
 * Non-numeric entries (RTO, Adjustment, etc.) are excluded.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';

// ============================================
// TYPES
// ============================================

export interface TailorSummary {
    tailorNumber: string;
    totalPcs: number;
    mrpValue: number;
    productionCost: number;
    firstInward: string;
    lastInward: string;
    activeMonths: number;
}

export interface TailorMonthly {
    month: string;
    [tailorNumber: string]: number | string;
}

export interface TailorSkuRow {
    skuCode: string;
    productName: string;
    size: string;
    pieces: number;
    mrpValue: number;
    cost: number;
}

export interface TailorPerformanceData {
    summary: TailorSummary[];
    monthly: TailorMonthly[];
    skuByTailor: Record<string, TailorSkuRow[]>;
}

// ============================================
// HELPERS
// ============================================

const SEPARATOR = /[/&,]/;

/** Parse tailor number field into individual tailor credits */
function parseTailorCredits(
    tailorNumber: string,
    qty: number,
    mrp: number,
    cost: number,
): { tailor: string; qty: number; mrp: number; cost: number }[] {
    const parts = tailorNumber
        .split(SEPARATOR)
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s));
    if (parts.length === 0) return [];
    const share = 1 / parts.length;
    return parts.map((t) => ({
        tailor: t,
        qty: qty * share,
        mrp: mrp * share,
        cost: cost * share,
    }));
}

function periodToDate(period: string): Date | null {
    if (period === 'all') return null;
    const now = new Date();
    const months = period === '12m' ? 12 : period === '6m' ? 6 : period === '3m' ? 3 : 1;
    now.setMonth(now.getMonth() - months);
    return now;
}

// ============================================
// INPUT SCHEMA
// ============================================

const tailorPerformanceInput = z.object({
    period: z.enum(['all', '12m', '6m', '3m', '1m']).catch('all'),
});

// ============================================
// SERVER FUNCTION
// ============================================

export const getTailorPerformance = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => tailorPerformanceInput.parse(input))
    .handler(async ({ data }): Promise<TailorPerformanceData> => {
        const { getKysely } = await import('@coh/shared/services/db');
        const db = await getKysely();

        const startDate = periodToDate(data.period);

        // Fetch all inward transactions with tailor numbers
        let query = db
            .selectFrom('InventoryTransaction as it')
            .innerJoin('Sku as s', 's.id', 'it.skuId')
            .innerJoin('Variation as v', 'v.id', 's.variationId')
            .innerJoin('Product as p', 'p.id', 'v.productId')
            .select([
                'it.tailorNumber',
                'it.qty',
                'it.createdAt',
                's.skuCode',
                's.mrp',
                's.bomCost',
                's.size',
                'p.name as productName',
            ])
            .where('it.txnType', '=', 'inward')
            .where('it.tailorNumber', 'is not', null)
            .where('it.tailorNumber', '!=', '');

        if (startDate) {
            query = query.where('it.createdAt', '>=', startDate);
        }

        const rows = await query.execute();

        // Process rows with split logic
        const tailorMap = new Map<
            string,
            {
                totalPcs: number;
                mrpValue: number;
                productionCost: number;
                firstInward: Date;
                lastInward: Date;
                months: Set<string>;
                skus: Map<string, { skuCode: string; productName: string; size: string; pieces: number; mrpValue: number; cost: number }>;
            }
        >();

        const monthlyMap = new Map<string, Map<string, number>>();

        for (const row of rows) {
            const tailorNumber = row.tailorNumber as string;
            const qty = row.qty as number;
            const mrp = (row.mrp as number) ?? 0;
            const bomCost = (row.bomCost as number) ?? 0;
            const createdAt = new Date(row.createdAt as string | Date);
            const skuCode = row.skuCode as string;
            const productName = (row.productName as string) ?? '';
            const size = (row.size as string) ?? '';

            const rowMrpValue = qty * mrp;
            const rowCost = qty * bomCost;

            const credits = parseTailorCredits(tailorNumber, qty, rowMrpValue, rowCost);
            if (credits.length === 0) continue;

            const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;

            for (const credit of credits) {
                // Summary
                let entry = tailorMap.get(credit.tailor);
                if (!entry) {
                    entry = {
                        totalPcs: 0,
                        mrpValue: 0,
                        productionCost: 0,
                        firstInward: createdAt,
                        lastInward: createdAt,
                        months: new Set(),
                        skus: new Map(),
                    };
                    tailorMap.set(credit.tailor, entry);
                }
                entry.totalPcs += credit.qty;
                entry.mrpValue += credit.mrp;
                entry.productionCost += credit.cost;
                if (createdAt < entry.firstInward) entry.firstInward = createdAt;
                if (createdAt > entry.lastInward) entry.lastInward = createdAt;
                entry.months.add(monthKey);

                // SKU breakdown
                const skuKey = `${skuCode}-${size}`;
                let skuEntry = entry.skus.get(skuKey);
                if (!skuEntry) {
                    skuEntry = { skuCode, productName, size, pieces: 0, mrpValue: 0, cost: 0 };
                    entry.skus.set(skuKey, skuEntry);
                }
                skuEntry.pieces += credit.qty;
                skuEntry.mrpValue += credit.mrp;
                skuEntry.cost += credit.cost;

                // Monthly
                if (!monthlyMap.has(monthKey)) {
                    monthlyMap.set(monthKey, new Map());
                }
                const monthTailors = monthlyMap.get(monthKey)!;
                monthTailors.set(credit.tailor, (monthTailors.get(credit.tailor) ?? 0) + credit.qty);
            }
        }

        // Build summary array sorted by totalPcs desc
        const summary: TailorSummary[] = Array.from(tailorMap.entries())
            .map(([tailorNumber, d]) => ({
                tailorNumber,
                totalPcs: Math.round(d.totalPcs * 100) / 100,
                mrpValue: Math.round(d.mrpValue),
                productionCost: Math.round(d.productionCost),
                firstInward: d.firstInward.toISOString(),
                lastInward: d.lastInward.toISOString(),
                activeMonths: d.months.size,
            }))
            .sort((a, b) => b.totalPcs - a.totalPcs);

        // Top 6 tailors for chart stacking
        const top6 = summary.slice(0, 6).map((s) => s.tailorNumber);

        // Build monthly array sorted by month
        const monthly: TailorMonthly[] = Array.from(monthlyMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([monthKey, tailors]) => {
                const [year, month] = monthKey.split('-');
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const label = `${monthNames[parseInt(month) - 1]} ${year.slice(2)}`;

                const row: TailorMonthly = { month: label };
                let othersTotal = 0;

                for (const [tailor, pcs] of tailors.entries()) {
                    if (top6.includes(tailor)) {
                        row[tailor] = Math.round(pcs * 100) / 100;
                    } else {
                        othersTotal += pcs;
                    }
                }
                row['others'] = Math.round(othersTotal * 100) / 100;
                return row;
            });

        // Build SKU breakdown by tailor
        const skuByTailor: Record<string, TailorSkuRow[]> = {};
        for (const [tailorNumber, d] of tailorMap.entries()) {
            skuByTailor[tailorNumber] = Array.from(d.skus.values())
                .map((s) => ({
                    ...s,
                    pieces: Math.round(s.pieces * 100) / 100,
                    mrpValue: Math.round(s.mrpValue),
                    cost: Math.round(s.cost),
                }))
                .sort((a, b) => b.pieces - a.pieces);
        }

        return { summary, monthly, skuByTailor };
    });
