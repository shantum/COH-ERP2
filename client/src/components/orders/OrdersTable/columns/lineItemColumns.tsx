/**
 * Line Item Columns - TanStack Table column definitions
 * Columns: productName, customize, qty, skuStock, fabricBalance
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import type { OrdersTableContext } from '../types';
import { DEFAULT_COLUMN_WIDTHS } from '../constants';
import {
    ProductNameCell,
    QtyStockCell,
    AssignStockCell,
} from '../cells';
import { Sparkles, Edit3 } from 'lucide-react';

export function buildLineItemColumns(ctx: OrdersTableContext): ColumnDef<FlattenedOrderRow>[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Product Name
        {
            id: 'productName',
            header: getHeaderName('productName'),
            size: DEFAULT_COLUMN_WIDTHS.productName,
            cell: ({ row }) => <ProductNameCell row={row.original} />,
            enableSorting: true,
        },

        // Customize
        {
            id: 'customize',
            header: getHeaderName('customize'),
            size: DEFAULT_COLUMN_WIDTHS.customize,
            cell: ({ row }) => {
                const data = row.original;
                if (!data?.lineId) return null;

                const { onCustomize, onEditCustomization, onRemoveCustomization } = handlersRef.current;

                // If customized, show edit button
                if (data.isCustomized) {
                    const customInfo = [
                        data.customizationType,
                        data.customizationValue,
                    ].filter(Boolean).join(': ');

                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onEditCustomization && data.lineId) {
                                    onEditCustomization(data.lineId, {
                                        lineId: data.lineId,
                                        skuCode: data.skuCode,
                                        productName: data.productName,
                                        colorName: data.colorName,
                                        size: data.size,
                                        qty: data.qty,
                                        customizationType: data.customizationType,
                                        customizationValue: data.customizationValue,
                                        customizationNotes: data.customizationNotes,
                                    });
                                }
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if (onRemoveCustomization && data.lineId && confirm('Remove customization?')) {
                                    onRemoveCustomization(data.lineId, data.skuCode);
                                }
                            }}
                            className="flex items-center gap-1 px-1 py-0 rounded bg-orange-100 text-orange-700 hover:bg-orange-200"
                            title={customInfo || 'Click to edit, right-click to remove'}
                        >
                            <Sparkles size={10} />
                            <span className="truncate max-w-[40px]">
                                {data.customizationType || 'Custom'}
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
                                if (data.lineId) {
                                    onCustomize(data.lineId, {
                                        lineId: data.lineId,
                                        skuCode: data.skuCode,
                                        productName: data.productName,
                                        colorName: data.colorName,
                                        size: data.size,
                                        qty: data.qty,
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
            },
        },

        // Quantity + Stock (combined)
        {
            id: 'qty',
            header: getHeaderName('qty'),
            size: DEFAULT_COLUMN_WIDTHS.qty,
            cell: ({ row }) => <QtyStockCell row={row.original} />,
            enableSorting: true,
            sortingFn: (a, b) => (a.original.qty || 0) - (b.original.qty || 0),
        },

        // Assign Stock
        {
            id: 'assignStock',
            header: getHeaderName('assignStock'),
            size: DEFAULT_COLUMN_WIDTHS.assignStock,
            cell: ({ row }) => <AssignStockCell row={row.original} handlersRef={handlersRef} />,
            enableSorting: false,
        },

        // Fabric Balance
        {
            id: 'fabricBalance',
            header: getHeaderName('fabricBalance'),
            size: DEFAULT_COLUMN_WIDTHS.fabricBalance,
            cell: ({ row }) => {
                const balance = row.original.fabricBalance || 0;
                return (
                    <span className={balance > 0 ? 'text-green-600' : 'text-gray-400'}>
                        {balance > 0 ? balance.toFixed(1) : '-'}
                    </span>
                );
            },
            enableSorting: true,
        },
    ];
}
