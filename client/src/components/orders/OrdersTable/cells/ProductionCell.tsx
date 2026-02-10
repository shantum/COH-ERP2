// @ts-nocheck
/**
 * ProductionCell - Cell for managing production batches
 * Reuses ProductionDatePopover for calendar functionality
 */

import { memo, type MutableRefObject } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';
import { ProductionDatePopover } from './ProductionDatePopover';
import { Check } from 'lucide-react';
import { formatProductionDate, getRelativeDay } from '../utils/dateFormatters';

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
        const handleSelectDate = (date: string) => {
            // Show warning for out-of-stock fabric before scheduling production
            if (row.isFabricOutOfStock === true) {
                const confirmed = window.confirm(
                    `Warning: The fabric for this item is marked as Out of Stock.\n\n` +
                    `Are you sure you want to schedule production for ${date}?`
                );
                if (!confirmed) return;
            }

            if (row.productionBatchId) {
                onUpdateBatch(row.productionBatchId, { batchDate: date });
            } else {
                onCreateBatch({
                    skuId: row.skuId ?? undefined,
                    qtyPlanned: row.qty,
                    priority: 'order_fulfillment',
                    sourceOrderLineId: row.lineId ?? undefined,
                    batchDate: date,
                    notes: `For ${row.orderNumber}`,
                });
            }
        };

        return (
            <ProductionDatePopover
                currentDate={row.productionDate}
                isLocked={isDateLocked}
                hasExistingBatch={!!row.productionBatchId}
                variant="pending"
                isFabricOutOfStock={row.isFabricOutOfStock === true}
                onSelectDate={handleSelectDate}
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
        return (
            <div className="flex items-center">
                <span
                    className="relative text-xs w-[82px] py-1 rounded-md flex items-center justify-center bg-emerald-50 text-emerald-700"
                    title={`Production: ${formatProductionDate(row.productionDate)}`}
                >
                    <Check size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-70" />
                    <span className="flex flex-col items-center leading-tight">
                        <span className="font-medium text-[11px]">{formatProductionDate(row.productionDate)}</span>
                        <span className="text-[9px] opacity-75">{getRelativeDay(row.productionDate)}</span>
                    </span>
                </span>
            </div>
        );
    }

    // Don't show anything for other states
    return null;
});
