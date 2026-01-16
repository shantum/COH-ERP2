/**
 * Post-Ship Columns
 *
 * Columns: shippedAt, deliveredAt, deliveryDays, daysInTransit, rtoInitiatedAt,
 *          daysInRto, daysSinceDelivery, codRemittedAt, finalStatus
 */

import type {
    ColDef,
    ICellRendererParams,
    ValueGetterParams,
    ValueFormatterParams,
} from 'ag-grid-community';
import type { ColumnBuilderContext } from '../types';
import { formatDateTime } from '../../../../utils/orderHelpers';
import {
    getThresholdTextClass,
    getFinalStatusClasses,
    getTrackingStatusLabel,
} from '../formatting';

/**
 * Build post-ship column definitions
 * These columns are primarily shown in shipped/rto/cod-pending/archived views
 */
export function buildPostShipColumns(ctx: ColumnBuilderContext): ColDef[] {
    const { getHeaderName, handlersRef } = ctx;

    return [
        // Shipped At
        {
            colId: 'shippedAt',
            headerName: getHeaderName('shippedAt'),
            width: 100,
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-computed line field (O(1)) with order-level fallback
                return params.data?.lineShippedAt || params.data?.order?.shippedAt || null;
            },
            valueFormatter: (params: ValueFormatterParams) => {
                if (!params.value) return '';
                const dt = formatDateTime(params.value);
                return dt.date;
            },
            cellClass: 'text-xs',
        },

        // Delivered At
        {
            colId: 'deliveredAt',
            headerName: getHeaderName('deliveredAt'),
            width: 100,
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-computed line field (O(1)) with order-level fallback
                return params.data?.lineDeliveredAt || params.data?.order?.deliveredAt || null;
            },
            valueFormatter: (params: ValueFormatterParams) => {
                if (!params.value) return '';
                const dt = formatDateTime(params.value);
                return dt.date;
            },
            cellClass: 'text-xs',
        },

        // Delivery Days (shipped to delivered)
        {
            colId: 'deliveryDays',
            headerName: getHeaderName('deliveryDays'),
            width: 60,
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-computed line fields (O(1)) with order-level fallback
                const shippedAt = params.data?.lineShippedAt || params.data?.order?.shippedAt;
                const deliveredAt = params.data?.lineDeliveredAt || params.data?.order?.deliveredAt;
                if (!shippedAt || !deliveredAt) return null;
                const shipped = new Date(shippedAt);
                const delivered = new Date(deliveredAt);
                return Math.ceil((delivered.getTime() - shipped.getTime()) / (1000 * 60 * 60 * 24));
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (params.value === null) return null;
                const days = params.value as number;
                const colorClass = getThresholdTextClass(days, 'deliveryDays');
                return <span className={`text-xs ${colorClass}`}>{days}d</span>;
            },
            sortable: true,
        },

        // Days In Transit (shipped but not delivered)
        {
            colId: 'daysInTransit',
            headerName: getHeaderName('daysInTransit'),
            width: 60,
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-computed line fields (O(1)) with order-level fallback
                const shippedAt = params.data?.lineShippedAt || params.data?.order?.shippedAt;
                const deliveredAt = params.data?.lineDeliveredAt || params.data?.order?.deliveredAt;
                if (!shippedAt || deliveredAt) return null; // Don't show if already delivered
                const shipped = new Date(shippedAt);
                return Math.floor((Date.now() - shipped.getTime()) / (1000 * 60 * 60 * 24));
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (params.value === null) return null;
                const days = params.value as number;
                const colorClass = getThresholdTextClass(days, 'daysInTransit');
                return <span className={`text-xs ${colorClass}`}>{days}d</span>;
            },
            sortable: true,
        },

        // RTO Initiated At
        {
            colId: 'rtoInitiatedAt',
            headerName: getHeaderName('rtoInitiatedAt'),
            field: 'order.rtoInitiatedAt',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) => {
                if (!params.value) return '';
                const dt = formatDateTime(params.value);
                return dt.date;
            },
            cellClass: 'text-xs',
        },

        // Days In RTO
        {
            colId: 'daysInRto',
            headerName: getHeaderName('daysInRto'),
            width: 60,
            valueGetter: (params: ValueGetterParams) => {
                const order = params.data?.order;
                if (!order?.rtoInitiatedAt) return null;
                const rtoDate = new Date(order.rtoInitiatedAt);
                return Math.floor((Date.now() - rtoDate.getTime()) / (1000 * 60 * 60 * 24));
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (params.value === null) return null;
                const days = params.value as number;
                const colorClass = getThresholdTextClass(days, 'daysInRto');
                return <span className={`text-xs ${colorClass}`}>{days}d RTO</span>;
            },
            sortable: true,
        },

        // Days Since Delivery
        {
            colId: 'daysSinceDelivery',
            headerName: getHeaderName('daysSinceDelivery'),
            width: 70,
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-computed line field (O(1)) with order-level fallback
                const deliveredAt = params.data?.lineDeliveredAt || params.data?.order?.deliveredAt;
                if (!deliveredAt) return null;
                const delivered = new Date(deliveredAt);
                return Math.floor((Date.now() - delivered.getTime()) / (1000 * 60 * 60 * 24));
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (params.value === null) return null;
                const days = params.value as number;
                const classes = getThresholdTextClass(days, 'daysSinceDelivery');
                return <span className={`text-xs ${classes} px-1.5 py-0.5 rounded`}>{days}d</span>;
            },
            sortable: true,
        },

        // COD Remitted At
        {
            colId: 'codRemittedAt',
            headerName: getHeaderName('codRemittedAt'),
            field: 'order.codRemittedAt',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) => {
                if (!params.value) return '';
                const dt = formatDateTime(params.value);
                return dt.date;
            },
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data?.order;
                if (order?.codRemittedAt) {
                    const dt = formatDateTime(order.codRemittedAt);
                    return <span className="text-xs text-green-600">{dt.date}</span>;
                }
                // Show "Mark Remitted" button only on first line (order-level action)
                const { onMarkCodRemitted } = handlersRef.current;
                if (params.data?.isFirstLine && order?.paymentMethod === 'COD' && order?.trackingStatus === 'delivered' && onMarkCodRemitted) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onMarkCodRemitted(order.id);
                            }}
                            className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
                        >
                            Mark Remitted
                        </button>
                    );
                }
                return null;
            },
            cellClass: 'text-xs',
        },

        // Final Status
        {
            colId: 'finalStatus',
            headerName: getHeaderName('finalStatus'),
            width: 100,
            valueGetter: (params: ValueGetterParams) => {
                // Use pre-computed line field (O(1)), fallback to order-level for backward compatibility
                return params.data?.lineTrackingStatus || params.data?.order?.terminalStatus || params.data?.order?.trackingStatus || '';
            },
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.value) return null;
                const status = params.value as string;
                const style = getFinalStatusClasses(status);
                const label = getTrackingStatusLabel(status) ||
                    status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return <span className={`text-xs px-1.5 py-0.5 rounded ${style}`}>{label}</span>;
            },
        },
    ];
}
