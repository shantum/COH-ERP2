/**
 * Fabrics Route - /fabrics
 *
 * Consolidated fabrics page: overview, transactions, reconciliation,
 * invoices, trims, and services — all in one place.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { FabricsSearchParams } from '@coh/shared';
import { getFabricColourStockAnalysis } from '../../server/functions/fabricColours';
import { getFabricStockHealth } from '../../server/functions/fabricColours';
import type { FabricStockHealthResponse } from '../../server/functions/fabricColours';

const FabricsPage = lazy(() => import('../../pages/Fabrics'));

export interface FabricsLoaderData {
    analysis: Awaited<ReturnType<typeof getFabricColourStockAnalysis>>;
    health: FabricStockHealthResponse;
    error: string | null;
}

export const Route = createFileRoute('/_authenticated/fabrics')({
    validateSearch: (search) => FabricsSearchParams.parse(search),
    loader: async ({ context }): Promise<FabricsLoaderData> => {
        // Skip data fetch if auth failed during SSR — client will redirect to login
        if (!context.user) {
            return {
                analysis: { success: true, analysis: [] },
                health: { data: [], totalBalance: 0 },
                error: null,
            };
        }
        try {
            const [analysis, health] = await Promise.all([
                getFabricColourStockAnalysis({ data: {} }),
                getFabricStockHealth(),
            ]);
            return { analysis, health, error: null };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load fabrics data';
            return {
                analysis: { success: true, analysis: [] },
                health: { data: [], totalBalance: 0 },
                error: message,
            };
        }
    },
    component: FabricsPage,
});
