/**
 * ProductionCell - Cell for managing production batches
 * Reuses ProductionDatePopover for calendar functionality
 */

import { memo, type MutableRefObject } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';
import { ProductionDatePopover } from './ProductionDatePopover';
import { Check } from 'lucide-react';

interface ProductionCellProps {
    row: FlattenedOrderRow;
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
    isDateLocked: (date: string) => boolean;
}

export const ProductionCell = memo(function ProductionCell({ row, handlersRef, isDateLocked }: ProductionCellProps) {
    if (!row) return null;

    const { onCreateBatch, onUpdateBatch, onDeleteBatch } = handlersRef.current;
    const hasStock = row.skuStock >= row.qty;
    const isPending = row.lineStatus === 'pending';
    const isAllocated = row.lineStatus === 'allocated';

    // Show for pending lines that need production (no stock, customized, or already has batch)
    if (isPending && (row.productionBatchId || !hasStock || row.isCustomized)) {
        return (
            <ProductionDatePopover
                currentDate={row.productionDate}
                isLocked={isDateLocked}
                hasExistingBatch={!!row.productionBatchId}
                variant="pending"
                onSelectDate={(date) => {
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
                }}
                onClear={() => {
                    if (row.productionBatchId) {
                        onDeleteBatch(row.productionBatchId);
                    }
                }}
            />
        );
    }

    // Show production date for allocated lines (read-only, green styling)
    if (isAllocated && row.productionDate) {
        const formatDisplayDate = (dateStr: string) => {
            const date = new Date(dateStr + 'T00:00:00');
            return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        };

        const getRelativeDay = (dateStr: string) => {
            const date = new Date(dateStr + 'T00:00:00');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Tomorrow';
            if (diffDays === -1) return 'Yesterday';
            if (diffDays < -1) return `${Math.abs(diffDays)}d ago`;
            return `In ${diffDays}d`;
        };

        return (
            <div className="flex items-center">
                <span
                    className="relative text-xs w-[82px] py-1 rounded-md flex items-center justify-center bg-emerald-50 text-emerald-700"
                    title={`Production: ${formatDisplayDate(row.productionDate)}`}
                >
                    <Check size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-70" />
                    <span className="flex flex-col items-center leading-tight">
                        <span className="font-medium text-[11px]">{formatDisplayDate(row.productionDate)}</span>
                        <span className="text-[9px] opacity-75">{getRelativeDay(row.productionDate)}</span>
                    </span>
                </span>
            </div>
        );
    }

    // Don't show anything for other states
    return null;
}, (prev, next) => (
    prev.row.lineId === next.row.lineId &&
    prev.row.lineStatus === next.row.lineStatus &&
    prev.row.productionBatchId === next.row.productionBatchId &&
    prev.row.productionDate === next.row.productionDate &&
    prev.row.skuStock === next.row.skuStock &&
    prev.row.qty === next.row.qty &&
    prev.row.isCustomized === next.row.isCustomized
));
