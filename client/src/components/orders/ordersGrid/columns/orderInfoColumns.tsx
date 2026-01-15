/**
 * Order Info Columns
 *
 * Columns: orderDate, orderAge, shipByDate, orderNumber, customerName, city, orderValue
 */

import type {
    ColDef,
    ICellRendererParams,
    ValueFormatterParams,
    ValueGetterParams,
    ValueSetterParams,
    EditableCallbackParams,
} from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';
import { formatDateTime } from '../../../../utils/orderHelpers';
import { calculateOrderTotal } from '../../../../utils/orderPricing';

/**
 * Build order info column definitions
 */
export function buildOrderInfoColumns(ctx: ColumnBuilderContext): ColDef[] {
    const { getHeaderName, onViewOrder, onSelectCustomer, onUpdateShipByDate } = ctx;

    return [
        // Order Date
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

        // Order Age (days since order)
        {
            colId: 'orderAge',
            headerName: getHeaderName('orderAge'),
            field: 'orderDate',
            width: 60,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine || !params.data?.orderDate) return null;
                const orderDate = new Date(params.data.orderDate);
                return Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (params.value === null) return null;
                const days = params.value as number;
                let colorClass = 'text-gray-500';
                if (days > 5) colorClass = 'text-red-600 font-semibold';
                else if (days >= 3) colorClass = 'text-amber-600 font-medium';
                return <span className={`text-xs ${colorClass}`}>{days}d</span>;
            },
            sortable: true,
        },

        // Ship By Date (editable)
        {
            colId: 'shipByDate',
            headerName: getHeaderName('shipByDate'),
            field: 'shipByDate',
            width: 100,
            editable: (params: EditableCallbackParams) => !!params.data?.isFirstLine && !!onUpdateShipByDate,
            cellEditor: 'agDateStringCellEditor',
            cellEditorParams: {
                min: new Date().toISOString().split('T')[0],
            },
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return '';
                const shipByDate = params.data.order?.shipByDate;
                if (!shipByDate) return '';
                return new Date(shipByDate).toISOString().split('T')[0];
            },
            valueSetter: (params: ValueSetterParams) => {
                if (params.data?.isFirstLine && params.data.order?.id && onUpdateShipByDate) {
                    const newDate = params.newValue || null;
                    onUpdateShipByDate(params.data.order.id, newDate);
                }
                return true;
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const shipByDate = params.data.order?.shipByDate;
                const isEditable = !!onUpdateShipByDate;

                if (!shipByDate) {
                    return (
                        <span className={`text-gray-300 ${isEditable ? 'cursor-pointer hover:text-gray-500' : ''}`} title={isEditable ? 'Click to set ship by date' : ''}>
                            {isEditable ? '+ Set' : '—'}
                        </span>
                    );
                }

                const date = new Date(shipByDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const shipDate = new Date(shipByDate);
                shipDate.setHours(0, 0, 0, 0);
                const daysUntil = Math.ceil((shipDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                let colorClass = 'text-gray-600';
                let bgClass = '';
                let daysLabel = '';

                if (daysUntil < 0) {
                    colorClass = 'text-red-700 font-semibold';
                    bgClass = 'bg-red-100 px-1.5 py-0.5 rounded';
                    daysLabel = ` (-${Math.abs(daysUntil)}d)`;
                } else if (daysUntil === 0) {
                    colorClass = 'text-amber-700 font-semibold';
                    bgClass = 'bg-amber-100 px-1.5 py-0.5 rounded';
                    daysLabel = ' (today)';
                } else if (daysUntil <= 2) {
                    colorClass = 'text-amber-600';
                    daysLabel = ` (${daysUntil}d)`;
                } else {
                    daysLabel = ` (${daysUntil}d)`;
                }

                const formatted = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const tooltip = isEditable ? 'Click to edit' : '';

                return (
                    <span className={`text-xs ${colorClass} ${bgClass} ${isEditable ? 'cursor-pointer' : ''}`} title={tooltip}>
                        {formatted}<span className="text-[10px] opacity-75">{daysLabel}</span>
                    </span>
                );
            },
            sortable: true,
        },

        // Order Number (clickable to view)
        {
            colId: 'orderNumber',
            headerName: getHeaderName('orderNumber'),
            field: 'orderNumber',
            width: 110,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const isExchange = params.data.order?.isExchange;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onViewOrder(params.data.order?.id);
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-mono text-xs"
                            title="View order details"
                        >
                            {params.value}
                        </button>
                        {isExchange && (
                            <span
                                className="inline-flex items-center justify-center w-4 h-4 bg-amber-100 text-amber-700 rounded text-[9px] font-bold"
                                title="Exchange Order"
                            >
                                E
                            </span>
                        )}
                    </div>
                );
            },
            cellClass: 'text-xs',
        },

        // Customer Name (clickable to filter)
        {
            colId: 'customerName',
            headerName: getHeaderName('customerName'),
            field: 'customerName',
            width: 150,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.data?.isFirstLine) return null;
                const order = params.data.order;
                const customerId = order?.customerId;
                const fullName = params.value || '';
                return (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (customerId) onSelectCustomer(customerId);
                        }}
                        className={`text-left truncate max-w-full block ${customerId
                            ? 'text-blue-600 hover:text-blue-800 hover:underline'
                            : 'text-gray-700'
                            }`}
                        title={fullName}
                        disabled={!customerId}
                    >
                        {fullName}
                    </button>
                );
            },
            cellClass: 'text-xs',
        },

        // City
        {
            colId: 'city',
            headerName: getHeaderName('city'),
            field: 'city',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.data?.isFirstLine ? params.value || '' : '',
            cellClass: 'text-xs text-gray-500',
        },

        // Order Value (calculated total)
        {
            colId: 'orderValue',
            headerName: getHeaderName('orderValue'),
            width: 80,
            valueGetter: (params: ValueGetterParams) => {
                if (!params.data?.isFirstLine) return null;
                return calculateOrderTotal(params.data.order).total;
            },
            valueFormatter: (params: ValueFormatterParams) => {
                if (!params.data?.isFirstLine || params.value === null) return '';
                return `₹${Math.round(params.value).toLocaleString('en-IN')}`;
            },
            cellClass: 'text-xs',
        },
    ];
}
