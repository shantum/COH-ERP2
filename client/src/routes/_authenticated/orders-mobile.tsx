/**
 * Mobile Orders Page
 *
 * Access at /orders-mobile to test the mobile prototypes.
 * Switch between Card view (Option 1) and List view (Option 3).
 */

import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { MobileOrdersView } from '../../components/orders/mobile';
import { getOrders } from '../../server/functions/orders';
import { useProductionBatchMutations } from '../../hooks/orders/useProductionBatchMutations';
import type { FlattenedOrderRow } from '../../utils/orderHelpers';

export const Route = createFileRoute('/_authenticated/orders-mobile')({
    component: MobileOrdersPage,
});

const MOBILE_PAGE_SIZE = 50;

function MobileOrdersPage() {
    const getOrdersFn = useServerFn(getOrders);
    const { data: ordersData, isLoading } = useQuery({
        queryKey: ['orders', 'list', 'getOrders', { view: 'all', limit: MOBILE_PAGE_SIZE }],
        queryFn: () => getOrdersFn({ data: { view: 'all', limit: MOBILE_PAGE_SIZE } }),
    });

    const rows = useMemo(() => {
        return (ordersData?.rows || []) as FlattenedOrderRow[];
    }, [ordersData]);

    const production = useProductionBatchMutations({ currentView: 'all' });

    const handleCreateBatch = useCallback((params: {
        skuId: string | null;
        qtyPlanned: number;
        priority: string;
        sourceOrderLineId: string | null;
        batchDate: string;
        notes: string;
    }) => {
        production.createBatch.mutate({
            skuId: params.skuId || undefined,
            qtyPlanned: params.qtyPlanned,
            priority: params.priority as 'low' | 'normal' | 'high' | 'urgent',
            sourceOrderLineId: params.sourceOrderLineId || undefined,
            batchDate: params.batchDate,
            notes: params.notes,
        });
    }, [production.createBatch]);

    const handleUpdateBatch = useCallback((id: string, params: { batchDate: string }) => {
        production.updateBatch.mutate({ id, data: { batchDate: params.batchDate } });
    }, [production.updateBatch]);

    const handleDeleteBatch = useCallback((id: string) => {
        production.deleteBatch.mutate(id);
    }, [production.deleteBatch]);

    // Cancel lines disabled — fulfillment now managed in Google Sheets
    const handleCancelLines = useCallback((_lineIds: string[]) => {
        console.warn('Cancel lines disabled — fulfillment managed in Google Sheets');
    }, []);

    const isDateLocked = useCallback((_date: string) => false, []);

    const handleBack = useCallback(() => {
        window.history.back();
    }, []);

    if (isLoading) {
        return (
            <div className="h-[100dvh] flex items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-slate-500">Loading orders...</span>
                </div>
            </div>
        );
    }

    return (
        <MobileOrdersView
            rows={rows}
            onCreateBatch={handleCreateBatch}
            onUpdateBatch={handleUpdateBatch}
            onDeleteBatch={handleDeleteBatch}
            onCancelLines={handleCancelLines}
            isDateLocked={isDateLocked}
            onBack={handleBack}
        />
    );
}
