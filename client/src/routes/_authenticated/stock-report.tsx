/**
 * Stock Report Route - /stock-report
 *
 * Monthly stock snapshots: Opening + Inward - Outward = Closing
 * with reason breakdowns per SKU.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { StockReportSearchParams } from '@coh/shared';
import { getMonthlySnapshot, getSnapshotSummary, type SnapshotResult, type SnapshotSummary } from '../../server/functions/stockSnapshots';

const StockReport = lazy(() => import('../../pages/StockReport'));

export interface StockReportLoaderData {
    snapshot: SnapshotResult | null;
    summary: SnapshotSummary | null;
    error: string | null;
}

export const Route = createFileRoute('/_authenticated/stock-report')({
    validateSearch: (search) => StockReportSearchParams.parse(search),
    loaderDeps: ({ search }) => ({
        year: search.year,
        month: search.month,
        search: search.search,
        category: search.category,
        rollup: search.rollup,
        page: search.page,
        limit: search.limit,
    }),
    loader: async ({ deps }): Promise<StockReportLoaderData> => {
        // Default to current month in IST
        const now = new Date();
        const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
        const year = deps.year ?? istNow.getUTCFullYear();
        const month = deps.month ?? (istNow.getUTCMonth() + 1);

        try {
            const [snapshot, summary] = await Promise.all([
                getMonthlySnapshot({
                    data: {
                        year,
                        month,
                        ...(deps.search ? { search: deps.search } : {}),
                        ...(deps.category ? { category: deps.category } : {}),
                        rollup: deps.rollup,
                        page: deps.page,
                        limit: deps.limit,
                    },
                }),
                getSnapshotSummary({
                    data: { year, month },
                }),
            ]);
            return { snapshot, summary, error: null };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load stock report';
            return { snapshot: null, summary: null, error: message };
        }
    },
    component: StockReport,
});
