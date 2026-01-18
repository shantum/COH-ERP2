/**
 * ProductionCell - Cell for managing production batches
 * Reuses ProductionDatePopover for calendar functionality
 */

import type { MutableRefObject } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';
import { ProductionDatePopover } from './ProductionDatePopover';

interface ProductionCellProps {
    row: FlattenedOrderRow;
    handlersRef: MutableRefObject<DynamicColumnHandlers>;
    isDateLocked: (date: string) => boolean;
}

export function ProductionCell({ row, handlersRef, isDateLocked }: ProductionCellProps) {
    if (!row) return null;

    const { onCreateBatch, onUpdateBatch, onDeleteBatch } = handlersRef.current;
    const hasStock = row.skuStock >= row.qty;

    // Only show for pending lines that need production (no stock, customized, or already has batch)
    if (row.lineStatus === 'pending' && (row.productionBatchId || !hasStock || row.isCustomized)) {
        return (
            <ProductionDatePopover
                currentDate={row.productionDate}
                isLocked={isDateLocked}
                hasExistingBatch={!!row.productionBatchId}
                onSelectDate={(date) => {
                    if (row.productionBatchId) {
                        // Update existing batch
                        onUpdateBatch(row.productionBatchId, { batchDate: date });
                    } else {
                        // Create new batch
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

    // Don't show anything for other states - keeps the UI clean
    return null;
}
