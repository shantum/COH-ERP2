/**
 * OrdersGrid component
 * AG Grid implementation for orders with all column definitions and row styling
 */

import { useState, useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
    ColDef,
    ICellRendererParams,
    RowStyle,
    ValueFormatterParams,
    ValueGetterParams,
    ValueSetterParams,
    CellClassParams,
    EditableCallbackParams,
} from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Check, X, Pencil, Ban, Archive, Undo2 } from 'lucide-react';
import { formatDateTime, DEFAULT_HEADERS, FlattenedOrderRow } from '../../utils/orderHelpers';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Custom compact theme based on Quartz
const compactTheme = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 28,
    headerHeight: 32,
});

// Editable header component
const EditableHeader = (props: any) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(props.displayName);

    const handleDoubleClick = () => setEditing(true);

    const handleBlur = () => {
        setEditing(false);
        if (value !== props.displayName) {
            props.setCustomHeader(props.column.colId, value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            setEditing(false);
            props.setCustomHeader(props.column.colId, value);
        } else if (e.key === 'Escape') {
            setEditing(false);
            setValue(props.displayName);
        }
    };

    if (editing) {
        return (
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full px-1 py-0 text-xs border rounded bg-white"
                style={{ minWidth: '30px' }}
            />
        );
    }

    return (
        <div
            onDoubleClick={handleDoubleClick}
            className="cursor-pointer truncate"
            title={`${props.displayName} (double-click to edit)`}
        >
            {props.displayName}
        </div>
    );
};

interface OrdersGridProps {
    rows: FlattenedOrderRow[];
    lockedDates: string[];
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    onShippingCheck: (lineId: string, order: any) => void;
    onCreateBatch: (data: any) => void;
    onUpdateBatch: (id: string, data: any) => void;
    onDeleteBatch: (id: string) => void;
    onUpdateNotes: (id: string, notes: string) => void;
    onEditOrder: (order: any) => void;
    onCancelOrder: (id: string, reason?: string) => void;
    onArchiveOrder: (id: string) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    onSelectCustomer: (customerId: string) => void;
    allocatingLines: Set<string>;
    shippingChecked: Set<string>;
    isCancellingOrder: boolean;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isArchiving: boolean;
}

export function OrdersGrid({
    rows,
    lockedDates,
    onAllocate,
    onUnallocate,
    onPick,
    onUnpick,
    onShippingCheck,
    onCreateBatch,
    onUpdateBatch,
    onDeleteBatch,
    onUpdateNotes,
    onEditOrder,
    onCancelOrder,
    onArchiveOrder,
    onCancelLine,
    onUncancelLine,
    onSelectCustomer,
    allocatingLines,
    shippingChecked,
    isCancellingOrder,
    isCancellingLine,
    isUncancellingLine,
    isArchiving,
}: OrdersGridProps) {
    // Custom headers state
    const [customHeaders, setCustomHeaders] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('ordersGridHeaders');
        return saved ? JSON.parse(saved) : {};
    });

    const setCustomHeader = useCallback((colId: string, headerName: string) => {
        setCustomHeaders((prev) => {
            const updated = { ...prev, [colId]: headerName };
            localStorage.setItem('ordersGridHeaders', JSON.stringify(updated));
            return updated;
        });
    }, []);

    const getHeaderName = useCallback(
        (colId: string) => customHeaders[colId] || DEFAULT_HEADERS[colId] || colId,
        [customHeaders]
    );

    const isDateLocked = (dateStr: string) => lockedDates?.includes(dateStr) || false;

    // Column definitions
    const columnDefs = useMemo<ColDef[]>(
        () => [
            {
                colId: 'orderDate',
                headerName: getHeaderName('orderDate'),
                field: 'orderDate',
                width: 130,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    const dt = formatDateTime(params.value);
                    return `${dt.date} ${dt.time}`;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'orderNumber',
                headerName: getHeaderName('orderNumber'),
                field: 'orderNumber',
                width: 110,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.value : '',
                cellClass: 'text-xs font-mono text-gray-600',
            },
            {
                colId: 'customerName',
                headerName: getHeaderName('customerName'),
                field: 'customerName',
                width: 130,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    const customerId = order?.customerId;
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (customerId) onSelectCustomer(customerId);
                            }}
                            className={`text-left truncate max-w-full ${
                                customerId
                                    ? 'text-blue-600 hover:text-blue-800 hover:underline'
                                    : 'text-gray-700'
                            }`}
                            title={params.value}
                            disabled={!customerId}
                        >
                            {params.value}
                        </button>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'city',
                headerName: getHeaderName('city'),
                field: 'city',
                width: 80,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.value || '' : '',
                cellClass: 'text-xs text-gray-500',
            },
            {
                colId: 'paymentMethod',
                headerName: getHeaderName('paymentMethod'),
                width: 70,
                valueGetter: (params: ValueGetterParams) =>
                    params.data?.isFirstLine ? params.data.order?.paymentMethod || '' : '',
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const method = params.data.order?.paymentMethod || '';
                    if (!method) return null;
                    const isCod = method.toLowerCase().includes('cod');
                    return (
                        <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                                isCod ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                            }`}
                        >
                            {isCod ? 'COD' : 'Prepaid'}
                        </span>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'customerNotes',
                headerName: getHeaderName('customerNotes'),
                width: 100,
                valueGetter: (params: ValueGetterParams) =>
                    params.data?.isFirstLine ? params.data.order?.customerNotes || '' : '',
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const notes = params.data.order?.customerNotes || '';
                    if (!notes) return null;
                    return (
                        <span className="text-xs text-purple-600" title={notes}>
                            {notes.length > 12 ? notes.substring(0, 12) + '...' : notes}
                        </span>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'customerOrderCount',
                headerName: getHeaderName('customerOrderCount'),
                field: 'customerOrderCount',
                width: 40,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.value : '',
                cellClass: 'text-xs text-center text-gray-500',
                headerTooltip: 'Customer Order Count',
            },
            {
                colId: 'customerLtv',
                headerName: getHeaderName('customerLtv'),
                field: 'customerLtv',
                width: 70,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    return `₹${(params.value / 1000).toFixed(0)}k`;
                },
                cellClass: 'text-xs text-right text-gray-500',
                headerTooltip: 'Customer Lifetime Value',
            },
            {
                colId: 'skuCode',
                headerName: getHeaderName('skuCode'),
                field: 'skuCode',
                width: 100,
                cellClass: 'text-xs font-mono text-gray-500',
            },
            {
                colId: 'productName',
                headerName: getHeaderName('productName'),
                field: 'productName',
                flex: 1,
                minWidth: 180,
                valueFormatter: (params: ValueFormatterParams) =>
                    `${params.value} - ${params.data?.colorName} - ${params.data?.size}`,
                cellClass: 'text-xs',
            },
            {
                colId: 'qty',
                headerName: getHeaderName('qty'),
                field: 'qty',
                width: 45,
                cellClass: 'text-xs text-center',
            },
            {
                colId: 'skuStock',
                headerName: getHeaderName('skuStock'),
                field: 'skuStock',
                width: 45,
                cellRenderer: (params: ICellRendererParams) => {
                    const hasStock = params.value >= params.data?.qty;
                    return (
                        <span className={hasStock ? 'text-green-600' : 'text-red-500'}>
                            {params.value}
                        </span>
                    );
                },
                cellClass: 'text-xs text-center',
            },
            {
                colId: 'fabricBalance',
                headerName: getHeaderName('fabricBalance'),
                field: 'fabricBalance',
                width: 55,
                valueFormatter: (params: ValueFormatterParams) => `${params.value?.toFixed(0)}m`,
                cellClass: 'text-xs text-center text-gray-500',
            },
            {
                colId: 'allocate',
                headerName: getHeaderName('allocate'),
                width: 40,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const hasStock = row.skuStock >= row.qty;
                    const isAllocated =
                        row.lineStatus === 'allocated' ||
                        row.lineStatus === 'picked' ||
                        row.lineStatus === 'packed';
                    const isPending = row.lineStatus === 'pending';
                    const canAllocate = isPending && hasStock;
                    const isToggling = allocatingLines.has(row.lineId);

                    if (isAllocated) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (row.lineStatus === 'allocated') onUnallocate(row.lineId);
                                }}
                                disabled={isToggling || row.lineStatus !== 'allocated'}
                                className={`w-4 h-4 rounded flex items-center justify-center mx-auto ${
                                    row.lineStatus === 'allocated'
                                        ? 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                        : 'bg-green-100 text-green-600'
                                }`}
                                title={row.lineStatus === 'allocated' ? 'Unallocate' : row.lineStatus}
                            >
                                <Check size={10} />
                            </button>
                        );
                    } else if (canAllocate) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAllocate(row.lineId);
                                }}
                                disabled={isToggling}
                                className="w-4 h-4 rounded border border-gray-300 hover:border-purple-400 hover:bg-purple-50 flex items-center justify-center mx-auto"
                                title="Allocate"
                            >
                                {isToggling ? <span className="animate-spin">·</span> : null}
                            </button>
                        );
                    }
                    return <span className="text-gray-300">-</span>;
                },
                cellClass: 'text-center',
            },
            {
                colId: 'production',
                headerName: getHeaderName('production'),
                width: 120,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const hasStock = row.skuStock >= row.qty;
                    const allLinesAllocated = row.order?.orderLines?.every(
                        (line: any) =>
                            line.lineStatus === 'allocated' ||
                            line.lineStatus === 'picked' ||
                            line.lineStatus === 'packed'
                    );
                    const isAllocated =
                        row.lineStatus === 'allocated' ||
                        row.lineStatus === 'picked' ||
                        row.lineStatus === 'packed';

                    if (row.lineStatus === 'pending' && (row.productionBatchId || !hasStock)) {
                        if (row.productionBatchId) {
                            return (
                                <div className="flex items-center gap-0.5">
                                    <input
                                        type="date"
                                        className={`text-xs border rounded px-0.5 py-0 w-24 ${
                                            isDateLocked(row.productionDate || '')
                                                ? 'border-red-200 bg-red-50'
                                                : 'border-orange-200 bg-orange-50'
                                        }`}
                                        value={row.productionDate || ''}
                                        min={new Date().toISOString().split('T')[0]}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                            if (isDateLocked(e.target.value)) {
                                                alert(`Production date ${e.target.value} is locked.`);
                                                return;
                                            }
                                            onUpdateBatch(row.productionBatchId, {
                                                batchDate: e.target.value,
                                            });
                                        }}
                                    />
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteBatch(row.productionBatchId);
                                        }}
                                        className="text-gray-400 hover:text-red-500"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            );
                        }
                        return (
                            <input
                                type="date"
                                className="text-xs border border-gray-200 rounded px-0.5 py-0 w-24 text-gray-400 hover:border-orange-300"
                                min={new Date().toISOString().split('T')[0]}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                    if (e.target.value) {
                                        if (isDateLocked(e.target.value)) {
                                            alert(`Date ${e.target.value} is locked.`);
                                            e.target.value = '';
                                            return;
                                        }
                                        onCreateBatch({
                                            skuId: row.skuId,
                                            qtyPlanned: row.qty,
                                            priority: 'order_fulfillment',
                                            sourceOrderLineId: row.lineId,
                                            batchDate: e.target.value,
                                            notes: `For ${row.orderNumber}`,
                                        });
                                    }
                                }}
                            />
                        );
                    } else if (allLinesAllocated) {
                        return <span className="text-green-700 font-medium text-xs">ready</span>;
                    } else if (isAllocated) {
                        return <span className="text-green-600 text-xs">alloc</span>;
                    } else if (hasStock) {
                        return <span className="text-gray-300">-</span>;
                    }
                    return null;
                },
            },
            {
                colId: 'notes',
                headerName: getHeaderName('notes'),
                width: 120,
                editable: (params: EditableCallbackParams) => params.data?.isFirstLine,
                valueGetter: (params: ValueGetterParams) =>
                    params.data?.isFirstLine ? params.data.order?.internalNotes || '' : '',
                valueSetter: (params: ValueSetterParams) => {
                    if (params.data?.isFirstLine && params.data?.order) {
                        onUpdateNotes(params.data.order.id, params.newValue);
                    }
                    return true;
                },
                cellClass: (params: CellClassParams) => {
                    if (!params.data?.isFirstLine) return 'text-transparent';
                    return params.data?.order?.internalNotes
                        ? 'text-xs text-yellow-700 bg-yellow-50'
                        : 'text-xs text-gray-400';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row?.isFirstLine) return null;
                    const notes = row.order?.internalNotes || '';
                    if (!notes)
                        return <span className="text-gray-300 italic">click to add</span>;
                    return (
                        <span title={notes}>
                            {notes.length > 15 ? notes.substring(0, 15) + '...' : notes}
                        </span>
                    );
                },
            },
            {
                colId: 'pick',
                headerName: getHeaderName('pick'),
                width: 35,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    if (row.lineStatus === 'cancelled')
                        return <span className="text-gray-300">-</span>;
                    const isToggling = allocatingLines.has(row.lineId);
                    if (row.lineStatus === 'allocated' || row.lineStatus === 'picked') {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    row.lineStatus === 'picked'
                                        ? onUnpick(row.lineId)
                                        : onPick(row.lineId);
                                }}
                                disabled={isToggling}
                                className={`w-4 h-4 rounded flex items-center justify-center mx-auto ${
                                    row.lineStatus === 'picked'
                                        ? 'bg-green-500 text-white'
                                        : 'border border-gray-300 hover:border-green-400'
                                }`}
                            >
                                {row.lineStatus === 'picked' && <Check size={10} />}
                            </button>
                        );
                    }
                    return null;
                },
                cellClass: 'text-center',
            },
            {
                colId: 'ship',
                headerName: getHeaderName('ship'),
                width: 35,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const allLinesAllocated = row.order?.orderLines?.every(
                        (line: any) =>
                            line.lineStatus === 'allocated' ||
                            line.lineStatus === 'picked' ||
                            line.lineStatus === 'packed'
                    );
                    if (allLinesAllocated) {
                        return (
                            <input
                                type="checkbox"
                                checked={shippingChecked.has(row.lineId)}
                                onChange={() => onShippingCheck(row.lineId, row.order)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-3 h-3 rounded border-gray-300 text-green-600 cursor-pointer"
                            />
                        );
                    }
                    return null;
                },
                cellClass: 'text-center',
            },
            {
                colId: 'awb',
                headerName: getHeaderName('awb'),
                field: 'order.awbNumber',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.data.order?.awbNumber || '' : '',
                cellClass: 'text-xs font-mono text-gray-500',
            },
            {
                colId: 'courier',
                headerName: getHeaderName('courier'),
                field: 'order.courier',
                width: 80,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.data.order?.courier || '' : '',
                cellClass: 'text-xs text-blue-600',
            },
            {
                colId: 'actions',
                headerName: getHeaderName('actions'),
                width: 100,
                sortable: false,
                resizable: false,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const order = row.order;
                    const isCancelledLine = row.lineStatus === 'cancelled';

                    const lineAction = (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isCancelledLine) {
                                    onUncancelLine(row.lineId);
                                } else if (
                                    confirm(
                                        `Cancel this line item?\n\n${row.productName} - ${row.skuCode}`
                                    )
                                ) {
                                    onCancelLine(row.lineId);
                                }
                            }}
                            disabled={isCancellingLine || isUncancellingLine}
                            className={`p-1 rounded hover:bg-gray-100 ${
                                isCancelledLine
                                    ? 'text-green-500 hover:text-green-600'
                                    : 'text-gray-400 hover:text-red-500'
                            }`}
                            title={isCancelledLine ? 'Restore line' : 'Cancel line'}
                        >
                            {isCancelledLine ? <Undo2 size={12} /> : <X size={12} />}
                        </button>
                    );

                    if (!row.isFirstLine) {
                        return <div className="flex items-center justify-end">{lineAction}</div>;
                    }

                    return (
                        <div className="flex items-center gap-0.5">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEditOrder(order);
                                }}
                                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600"
                                title="Edit order"
                            >
                                <Pencil size={12} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const reason = prompt(
                                        `Cancel order ${order.orderNumber}?\n\nEnter cancellation reason (optional):`
                                    );
                                    if (reason !== null) {
                                        onCancelOrder(order.id, reason || undefined);
                                    }
                                }}
                                disabled={isCancellingOrder}
                                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"
                                title="Cancel order"
                            >
                                <Ban size={12} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (
                                        confirm(
                                            `Archive order ${order.orderNumber}?\n\nThis will hide it from the open orders list.`
                                        )
                                    ) {
                                        onArchiveOrder(order.id);
                                    }
                                }}
                                disabled={isArchiving}
                                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"
                                title="Archive order"
                            >
                                <Archive size={12} />
                            </button>
                            {lineAction}
                        </div>
                    );
                },
            },
        ],
        [
            allocatingLines,
            shippingChecked,
            lockedDates,
            getHeaderName,
            isCancellingOrder,
            isCancellingLine,
            isUncancellingLine,
            isArchiving,
        ]
    );

    const defaultColDef = useMemo<ColDef>(
        () => ({
            sortable: true,
            resizable: true,
            suppressMovable: true,
            headerComponent: EditableHeader,
            headerComponentParams: { setCustomHeader },
        }),
        [setCustomHeader]
    );

    const resetHeaders = useCallback(() => {
        setCustomHeaders({});
        localStorage.removeItem('ordersGridHeaders');
    }, []);

    const getRowStyle = useCallback((params: any): RowStyle | undefined => {
        const row = params.data;
        if (!row) return undefined;

        if (row.lineStatus === 'cancelled') {
            return { backgroundColor: '#f3f4f6', color: '#9ca3af', textDecoration: 'line-through' };
        }

        const activeLines =
            row.order?.orderLines?.filter((line: any) => line.lineStatus !== 'cancelled') || [];
        const allLinesAllocated =
            activeLines.length > 0 &&
            activeLines.every(
                (line: any) =>
                    line.lineStatus === 'allocated' ||
                    line.lineStatus === 'picked' ||
                    line.lineStatus === 'packed'
            );
        const hasStock = row.skuStock >= row.qty;
        const isAllocated =
            row.lineStatus === 'allocated' ||
            row.lineStatus === 'picked' ||
            row.lineStatus === 'packed';
        const isPending = row.lineStatus === 'pending';
        const hasProductionDate = !!row.productionBatchId;

        if (row.lineStatus === 'packed') return { backgroundColor: '#f0fdf4' };
        if (row.lineStatus === 'picked') return { backgroundColor: '#ecfdf5' };
        if (allLinesAllocated) return { backgroundColor: '#bbf7d0' };
        if (isAllocated) return { backgroundColor: '#dcfce7' };
        if (hasStock && isPending) return { backgroundColor: '#f0fdf4' };
        if (hasProductionDate) return { backgroundColor: '#fffbeb' };
        return undefined;
    }, []);

    return {
        gridComponent: (
            <div className="border rounded" style={{ height: '600px', width: '100%' }}>
                <AgGridReact
                    key={JSON.stringify(customHeaders)}
                    rowData={rows}
                    columnDefs={columnDefs}
                    defaultColDef={defaultColDef}
                    getRowStyle={getRowStyle}
                    theme={compactTheme}
                    rowSelection="multiple"
                    enableCellTextSelection={true}
                    ensureDomOrder={true}
                    cellSelection={true}
                />
            </div>
        ),
        customHeaders,
        resetHeaders,
    };
}

export default OrdersGrid;
