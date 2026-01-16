/**
 * Line Item Columns
 *
 * Columns: skuCode, productName, customize, qty, skuStock, fabricBalance
 */

import type {
    ColDef,
    ICellRendererParams,
    ValueFormatterParams,
} from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';
import { Wrench, Pencil, Trash2, Settings } from 'lucide-react';

/**
 * Build line item column definitions
 */
export function buildLineItemColumns(ctx: ColumnBuilderContext): ColDef[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // SKU Code
        {
            colId: 'skuCode',
            headerName: getHeaderName('skuCode'),
            field: 'skuCode',
            width: 100,
            cellClass: 'text-xs font-mono text-gray-500',
        },

        // Product Name (with color and size)
        {
            colId: 'productName',
            headerName: getHeaderName('productName'),
            field: 'productName',
            flex: 1,
            minWidth: 220,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const fullText = `${row.productName} - ${row.colorName} - ${row.size}`;
                return (
                    <span
                        className="text-xs truncate block"
                        title={fullText}
                    >
                        {fullText}
                    </span>
                );
            },
            cellClass: 'text-xs',
        },

        // Customize (customization status and actions)
        {
            colId: 'customize',
            headerName: getHeaderName('customize'),
            width: 100,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || !row.lineId) return null;

                // Build tooltip text with customization details
                const buildTooltip = () => {
                    const lines: string[] = [];
                    const typeLabels: Record<string, string> = {
                        length: 'Length Adjustment',
                        size: 'Size Modification',
                        measurements: 'Custom Measurements',
                        other: 'Other',
                    };
                    lines.push(`Type: ${typeLabels[row.customizationType] || row.customizationType || 'Unknown'}`);
                    lines.push(`Value: ${row.customizationValue || '-'}`);
                    if (row.customizationNotes) {
                        lines.push(`Notes: ${row.customizationNotes}`);
                    }
                    if (row.originalSkuCode) {
                        lines.push(`Original SKU: ${row.originalSkuCode}`);
                    }
                    return lines.join('\n');
                };

                // If customized and NOT pending (already allocated/picked/packed), show read-only badge
                if (row.isCustomized && row.customSkuCode && row.lineStatus !== 'pending') {
                    return (
                        <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700"
                            title={buildTooltip()}
                        >
                            <Wrench size={10} />
                            {row.customSkuCode.split('-').pop()}
                        </span>
                    );
                }

                // If customized and pending, show badge with edit/remove actions
                if (row.isCustomized && row.customSkuCode && row.lineStatus === 'pending') {
                    return (
                        <div className="flex items-center gap-1">
                            <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 cursor-help"
                                title={buildTooltip()}
                            >
                                <Wrench size={10} />
                                {row.customSkuCode.split('-').pop()}
                            </span>
                            {/* Edit button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const { onEditCustomization } = handlersRef.current;
                                    if (onEditCustomization) {
                                        onEditCustomization(row.lineId, {
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
                                className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                                title="Edit customization"
                            >
                                <Pencil size={10} />
                            </button>
                            {/* Remove button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const { onRemoveCustomization } = handlersRef.current;
                                    if (onRemoveCustomization) {
                                        onRemoveCustomization(row.lineId, row.customSkuCode);
                                    }
                                }}
                                className="p-0.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                                title="Remove customization"
                            >
                                <Trash2 size={10} />
                            </button>
                        </div>
                    );
                }

                // Not customized and pending: show customize button
                if (row.lineStatus === 'pending') {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const { onCustomize } = handlersRef.current;
                                if (onCustomize) {
                                    onCustomize(row.lineId, {
                                        lineId: row.lineId,
                                        skuCode: row.skuCode,
                                        productName: row.productName,
                                        colorName: row.colorName,
                                        size: row.size,
                                        qty: row.qty,
                                    });
                                }
                            }}
                            className="p-1 rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50"
                            title="Add customization"
                        >
                            <Settings size={14} />
                        </button>
                    );
                }

                return null;
            },
            cellClass: 'text-center',
        },

        // Quantity
        {
            colId: 'qty',
            headerName: getHeaderName('qty'),
            field: 'qty',
            width: 45,
            cellClass: 'text-xs text-center',
        },

        // SKU Stock (with color coding)
        {
            colId: 'skuStock',
            headerName: getHeaderName('skuStock'),
            field: 'skuStock',
            width: 45,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                const stock = params.value ?? 0;
                const hasStock = stock >= row?.qty;
                return (
                    <span className={hasStock ? 'text-green-600' : 'text-red-500'}>
                        {stock}
                    </span>
                );
            },
            cellClass: 'text-xs text-center',
        },

        // Fabric Balance
        {
            colId: 'fabricBalance',
            headerName: getHeaderName('fabricBalance'),
            field: 'fabricBalance',
            width: 55,
            valueFormatter: (params: ValueFormatterParams) => `${params.value?.toFixed(0)}m`,
            cellClass: 'text-xs text-center text-gray-500',
        },
    ];
}
