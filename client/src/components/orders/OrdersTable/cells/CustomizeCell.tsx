/**
 * CustomizeCell - Add/edit customization button for order lines
 * Shows sparkle icon for customized items, edit icon for non-customized
 */

import { memo } from 'react';
import { Sparkles, Edit3 } from 'lucide-react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { DynamicColumnHandlers } from '../types';

interface CustomizeCellProps {
    row: FlattenedOrderRow;
    handlersRef: React.MutableRefObject<DynamicColumnHandlers>;
}

export const CustomizeCell = memo(function CustomizeCell({ row, handlersRef }: CustomizeCellProps) {
    if (!row?.lineId) return null;

    const { onCustomize } = handlersRef.current;

    // If customized, show edit button
    if (row.isCustomized) {
        const customInfo = [
            row.customizationType,
            row.customizationValue,
        ].filter(Boolean).join(': ');

        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (handlersRef.current.onEditCustomization && row.lineId) {
                        handlersRef.current.onEditCustomization(row.lineId, {
                            lineId: row.lineId,
                            skuCode: row.skuCode,
                            productName: row.productName,
                            colorName: row.colorName,
                            size: row.size,
                            qty: row.qty,
                            customizationType: row.customizationType,
                            customizationValue: row.customizationValue,
                            customizationNotes: row.customizationNotes,
                        });
                    }
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (handlersRef.current.onRemoveCustomization && row.lineId && confirm('Remove customization?')) {
                        handlersRef.current.onRemoveCustomization(row.lineId, row.skuCode);
                    }
                }}
                className="flex items-center gap-1 px-1 py-0 rounded bg-orange-100 text-orange-700 hover:bg-orange-200"
                title={customInfo || 'Click to edit, right-click to remove'}
            >
                <Sparkles size={10} />
                <span className="truncate max-w-[40px]">
                    {row.customizationType || 'Custom'}
                </span>
            </button>
        );
    }

    // Not customized - show add button if handler available
    if (onCustomize) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (row.lineId) {
                        handlersRef.current.onCustomize?.(row.lineId, {
                            lineId: row.lineId,
                            skuCode: row.skuCode,
                            productName: row.productName,
                            colorName: row.colorName,
                            size: row.size,
                            qty: row.qty,
                        });
                    }
                }}
                className="flex items-center gap-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 px-1.5 py-0.5 rounded"
                title="Add customization"
            >
                <Edit3 size={10} />
            </button>
        );
    }

    return null;
});
