/**
 * MobileOrdersView - Main mobile orders container
 *
 * Switches between two prototype views:
 * - Option 1: Card-based swipe interface
 * - Option 3: List with bottom sheet
 *
 * iPhone optimized with:
 * - Safe area insets
 * - 44pt minimum touch targets
 * - Momentum scrolling
 * - Native-feeling interactions
 */

import { memo, useState, useCallback } from 'react';
import { LayoutList, LayoutGrid, ArrowLeft } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import { MobileOrderCard } from './MobileOrderCard';
import { MobileOrdersList } from './MobileOrdersList';

type ViewMode = 'cards' | 'list';

interface MobileOrdersViewProps {
    rows: FlattenedOrderRow[];
    onCreateBatch: (params: {
        skuId: string | null;
        qtyPlanned: number;
        priority: string;
        sourceOrderLineId: string | null;
        batchDate: string;
        notes: string;
    }) => void;
    onUpdateBatch: (id: string, params: { batchDate: string }) => void;
    onDeleteBatch: (id: string) => void;
    onCancelLines: (lineIds: string[]) => void;
    isDateLocked: (date: string) => boolean;
    onBack?: () => void;
}

export const MobileOrdersView = memo(function MobileOrdersView({
    rows,
    onCreateBatch,
    onUpdateBatch,
    onDeleteBatch,
    onCancelLines,
    isDateLocked,
    onBack,
}: MobileOrdersViewProps) {
    const [viewMode, setViewMode] = useState<ViewMode>('cards');

    // Card view handlers
    const handleSelectDate = useCallback((lineId: string, date: string) => {
        const row = rows.find(r => r.lineId === lineId);
        if (!row) return;

        if (row.productionBatchId) {
            onUpdateBatch(row.productionBatchId, { batchDate: date });
        } else {
            onCreateBatch({
                skuId: row.skuId,
                qtyPlanned: row.qty,
                priority: 'order_fulfillment',
                sourceOrderLineId: row.lineId,
                batchDate: date,
                notes: `For ${row.orderNumber}`,
            });
        }
    }, [rows, onCreateBatch, onUpdateBatch]);

    const handleClearDate = useCallback((batchId: string) => {
        onDeleteBatch(batchId);
    }, [onDeleteBatch]);

    const handleCancelSingle = useCallback((lineId: string) => {
        onCancelLines([lineId]);
    }, [onCancelLines]);

    // List view handlers
    const handleAssignDates = useCallback((lineIds: string[], date: string) => {
        lineIds.forEach(lineId => {
            const row = rows.find(r => r.lineId === lineId);
            if (!row) return;

            if (row.productionBatchId) {
                onUpdateBatch(row.productionBatchId, { batchDate: date });
            } else {
                onCreateBatch({
                    skuId: row.skuId,
                    qtyPlanned: row.qty,
                    priority: 'order_fulfillment',
                    sourceOrderLineId: row.lineId,
                    batchDate: date,
                    notes: `For ${row.orderNumber}`,
                });
            }
        });
    }, [rows, onCreateBatch, onUpdateBatch]);

    // Filter to pending orders for production assignment
    const pendingRows = rows.filter(r =>
        r.lineStatus === 'pending' &&
        (!r.skuStock || r.skuStock < r.qty || r.isCustomized || r.productionBatchId)
    );

    return (
        <div
            className="h-[100dvh] flex flex-col bg-slate-50 overflow-hidden"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
            }}
        >
            {/* Header */}
            <header className="flex-shrink-0 bg-white border-b border-slate-200">
                <div className="flex items-center justify-between px-4 h-14">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-11 h-11 -ml-2 flex items-center justify-center rounded-xl active:bg-slate-100 transition-colors"
                        >
                            <ArrowLeft size={22} className="text-slate-700" />
                        </button>
                    )}
                    <h1 className="text-lg font-semibold text-slate-900 flex-1 text-center">
                        Production
                    </h1>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                        <button
                            onClick={() => setViewMode('cards')}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                                viewMode === 'cards'
                                    ? 'bg-white shadow-sm text-orange-600'
                                    : 'text-slate-500'
                            }`}
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                                viewMode === 'list'
                                    ? 'bg-white shadow-sm text-orange-600'
                                    : 'text-slate-500'
                            }`}
                        >
                            <LayoutList size={18} />
                        </button>
                    </div>
                </div>

                {/* Stats bar */}
                <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-xs">
                    <span className="text-slate-500">
                        <strong className="text-slate-900">{pendingRows.length}</strong> need production
                    </span>
                    <span className="text-slate-500">
                        <strong className="text-slate-900">{rows.filter(r => r.productionDate).length}</strong> scheduled
                    </span>
                </div>
            </header>

            {/* Content */}
            {viewMode === 'cards' ? (
                <div
                    className="flex-1 overflow-y-auto overscroll-contain"
                    style={{
                        WebkitOverflowScrolling: 'touch',
                        paddingBottom: 'env(safe-area-inset-bottom, 20px)',
                    }}
                >
                    {pendingRows.map((row) => (
                        <MobileOrderCard
                            key={row.lineId || `${row.orderId}-${row.skuCode}`}
                            row={row}
                            onSelectDate={handleSelectDate}
                            onClearDate={handleClearDate}
                            onCancel={handleCancelSingle}
                            isDateLocked={isDateLocked}
                        />
                    ))}

                    {pendingRows.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                                <LayoutGrid size={28} strokeWidth={1.5} />
                            </div>
                            <p className="font-medium text-slate-600">All caught up!</p>
                            <p className="text-sm mt-1">No orders need production scheduling</p>
                        </div>
                    )}
                </div>
            ) : (
                <MobileOrdersList
                    rows={rows}
                    onAssignDates={handleAssignDates}
                    onCancel={onCancelLines}
                    isDateLocked={isDateLocked}
                />
            )}
        </div>
    );
});

export default MobileOrdersView;
