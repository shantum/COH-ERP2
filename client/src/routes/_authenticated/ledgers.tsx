/**
 * Ledgers Route - /ledgers
 *
 * Server-side search, filtering, and pagination for inventory transactions.
 * Two tabs: Inward, Outward. Materials moved to /fabrics.
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { LedgersSearchParams } from '@coh/shared';
import { getLedgerTransactions, type LedgerTransactionsResult } from '../../server/functions/inventory';

const Ledgers = lazy(() => import('../../pages/Ledgers'));

export interface LedgersLoaderData {
    ledger: LedgerTransactionsResult | null;
    error: string | null;
}

export const Route = createFileRoute('/_authenticated/ledgers')({
    validateSearch: (search) => LedgersSearchParams.parse(search),
    loaderDeps: ({ search }) => ({
        tab: search.tab,
        search: search.search,
        reason: search.reason,
        location: search.location,
        origin: search.origin,
        page: search.page,
        limit: search.limit,
    }),
    loader: async ({ deps, context }): Promise<LedgersLoaderData> => {
        // Skip data fetch if auth failed during SSR — client will redirect to login
        if (!context.user) {
            return { ledger: null, error: null };
        }
        try {
            const offset = (deps.page - 1) * deps.limit;
            const ledger = await getLedgerTransactions({
                data: {
                    txnType: deps.tab,
                    ...(deps.search ? { search: deps.search } : {}),
                    ...(deps.reason ? { reason: deps.reason } : {}),
                    ...(deps.location ? { location: deps.location } : {}),
                    origin: deps.origin,
                    limit: deps.limit,
                    offset,
                },
            });
            return { ledger, error: null };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load ledger data';
            return { ledger: null, error: message };
        }
    },
    component: Ledgers,
});
