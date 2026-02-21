/**
 * Fabric Report Route - /fabric-report
 *
 * Daily fabric stock report: summary cards, reorder alerts,
 * consumption chart, activity, and stock overview.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { FabricReportSearchParams } from '@coh/shared';
import { getFabricColourStockAnalysis } from '../../server/functions/fabricColours';
import { getFabricStockHealth } from '../../server/functions/fabricColours';
import { getAllFabricColourTransactions } from '../../server/functions/fabricColours';
import type { FabricStockHealthResponse } from '../../server/functions/fabricColours';

const FabricReport = lazy(() => import('../../pages/FabricReport'));

/** Yesterday boundaries in IST */
function getYesterdayRange() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + istOffset);
    const todayIST = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());
    const yesterdayIST = new Date(todayIST.getTime() - 24 * 60 * 60 * 1000);
    // Convert back to UTC for DB query
    const start = new Date(yesterdayIST.getTime() - istOffset);
    const end = new Date(todayIST.getTime() - istOffset);
    return { start, end };
}

export interface FabricReportLoaderData {
    analysis: Awaited<ReturnType<typeof getFabricColourStockAnalysis>>;
    health: FabricStockHealthResponse;
    yesterdayTransactions: Awaited<ReturnType<typeof getAllFabricColourTransactions>>;
    error: string | null;
}

export const Route = createFileRoute('/_authenticated/fabric-report')({
    validateSearch: (search) => FabricReportSearchParams.parse(search),
    loader: async (): Promise<FabricReportLoaderData> => {
        const { start, end } = getYesterdayRange();

        try {
            const [analysis, health, yesterdayTransactions] = await Promise.all([
                getFabricColourStockAnalysis({ data: {} }),
                getFabricStockHealth(),
                getAllFabricColourTransactions({
                    data: {
                        startDate: start.toISOString(),
                        endDate: end.toISOString(),
                        limit: 200,
                        offset: 0,
                    },
                }),
            ]);
            return { analysis, health, yesterdayTransactions, error: null };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load fabric report';
            return {
                analysis: { success: true, analysis: [] },
                health: { data: [], totalBalance: 0 },
                yesterdayTransactions: { success: true, transactions: [], total: 0, page: 1, pageSize: 200 },
                error: message,
            };
        }
    },
    component: FabricReport,
});
