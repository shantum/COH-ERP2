/**
 * ShippedOrdersGrid component
 * AG Grid implementation for shipped orders with row grouping by ship date
 */

import { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Undo2, CheckCircle, AlertTriangle, Package } from 'lucide-react';
import { parseCity } from '../../utils/orderHelpers';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Custom compact theme
const compactTheme = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 32,
    headerHeight: 36,
});

interface ShippedOrdersGridProps {
    orders: any[];
    onUnship: (orderId: string) => void;
    onMarkDelivered: (orderId: string) => void;
    onMarkRto: (orderId: string) => void;
    isUnshipping?: boolean;
    isMarkingDelivered?: boolean;
    isMarkingRto?: boolean;
}

// Tracking status badge component
function TrackingStatusBadge({ status, daysInTransit }: { status: string; daysInTransit?: number }) {
    const configs: Record<string, { bg: string; text: string; label: string; icon: any }> = {
        in_transit: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Transit', icon: Package },
        delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered', icon: CheckCircle },
        delivery_delayed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Delayed', icon: AlertTriangle },
        rto_initiated: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO', icon: AlertTriangle },
        rto_received: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received', icon: CheckCircle },
    };
    const config = configs[status] || configs.in_transit;
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            <Icon size={12} />
            {config.label}
            {status === 'in_transit' && daysInTransit ? ` (${daysInTransit}d)` : ''}
        </span>
    );
}

export function ShippedOrdersGrid({
    orders,
    onUnship,
    onMarkDelivered,
    onMarkRto,
    isUnshipping,
    isMarkingDelivered,
    isMarkingRto,
}: ShippedOrdersGridProps) {
    // Transform orders for grid with grouping field
    const rowData = useMemo(() => {
        return orders.map((order) => ({
            ...order,
            shipDateGroup: order.shippedAt
                ? new Date(order.shippedAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                })
                : 'Unknown',
            city: parseCity(order.shippingAddress),
            itemCount: order.orderLines?.length || 0,
            itemSummary: order.orderLines
                ?.slice(0, 2)
                .map((l: any) => l.sku?.variation?.product?.name || 'Item')
                .join(', ') + (order.orderLines?.length > 2 ? '...' : ''),
        }));
    }, [orders]);

    const columnDefs = useMemo<ColDef[]>(() => [
        {
            field: 'shipDateGroup',
            headerName: 'Ship Date',
            rowGroup: true,
            hide: true,
        },
        {
            field: 'orderNumber',
            headerName: 'Order',
            width: 100,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="font-mono text-xs text-gray-600">{params.value}</span>
            ),
        },
        {
            field: 'customerName',
            headerName: 'Customer',
            width: 150,
            cellRenderer: (params: ICellRendererParams) => (
                <div className="truncate">
                    <span className="text-gray-900">{params.value}</span>
                    {params.data?.customerTier && (
                        <span className={`ml-1 text-xs px-1 rounded ${
                            params.data.customerTier === 'vip' ? 'bg-purple-100 text-purple-700' :
                            params.data.customerTier === 'loyal' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                        }`}>
                            {params.data.customerTier}
                        </span>
                    )}
                </div>
            ),
        },
        {
            field: 'city',
            headerName: 'City',
            width: 100,
        },
        {
            field: 'itemCount',
            headerName: 'Items',
            width: 70,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-gray-600" title={params.data?.itemSummary}>
                    {params.value} item{params.value !== 1 ? 's' : ''}
                </span>
            ),
        },
        {
            field: 'totalAmount',
            headerName: 'Total',
            width: 90,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value ? `₹${Number(params.value).toLocaleString()}` : '-',
        },
        {
            field: 'courier',
            headerName: 'Courier',
            width: 90,
            cellRenderer: (params: ICellRendererParams) =>
                params.value ? (
                    <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        {params.value}
                    </span>
                ) : null,
        },
        {
            field: 'awbNumber',
            headerName: 'AWB',
            width: 120,
            cellRenderer: (params: ICellRendererParams) =>
                params.value ? (
                    <span className="font-mono text-xs text-gray-500">{params.value}</span>
                ) : null,
        },
        {
            field: 'daysInTransit',
            headerName: 'Days',
            width: 60,
            cellRenderer: (params: ICellRendererParams) => (
                <span className={`text-xs ${params.value > 7 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                    {params.value}d
                </span>
            ),
        },
        {
            field: 'trackingStatus',
            headerName: 'Status',
            width: 130,
            cellRenderer: (params: ICellRendererParams) => (
                <TrackingStatusBadge
                    status={params.value || 'in_transit'}
                    daysInTransit={params.data?.daysInTransit}
                />
            ),
        },
        {
            colId: 'actions',
            headerName: 'Actions',
            width: 140,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;

                const status = order.trackingStatus || 'in_transit';
                const canMarkDelivered = status === 'in_transit' || status === 'delivery_delayed';
                const canMarkRto = status === 'in_transit' || status === 'delivery_delayed';

                return (
                    <div className="flex items-center gap-1">
                        {canMarkDelivered && (
                            <button
                                onClick={() => onMarkDelivered(order.id)}
                                disabled={isMarkingDelivered}
                                className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600"
                                title="Mark as Delivered"
                            >
                                <CheckCircle size={14} />
                            </button>
                        )}
                        {canMarkRto && (
                            <button
                                onClick={() => {
                                    if (confirm(`Mark order ${order.orderNumber} as RTO?`)) {
                                        onMarkRto(order.id);
                                    }
                                }}
                                disabled={isMarkingRto}
                                className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                                title="Mark as RTO"
                            >
                                <AlertTriangle size={14} />
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (confirm(`Undo shipping for ${order.orderNumber}? This will move it back to open orders.`)) {
                                    onUnship(order.id);
                                }
                            }}
                            disabled={isUnshipping}
                            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-orange-600"
                            title="Undo shipping"
                        >
                            <Undo2 size={14} />
                        </button>
                    </div>
                );
            },
        },
    ], [onUnship, onMarkDelivered, onMarkRto, isUnshipping, isMarkingDelivered, isMarkingRto]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        resizable: true,
    }), []);

    const autoGroupColumnDef = useMemo<ColDef>(() => ({
        headerName: 'Ship Date',
        minWidth: 180,
        cellRendererParams: {
            suppressCount: false,
        },
    }), []);

    const getRowStyle = useCallback((params: any) => {
        const status = params.data?.trackingStatus;
        if (status === 'delivered') return { backgroundColor: '#f0fdf4' };
        if (status === 'delivery_delayed') return { backgroundColor: '#fffbeb' };
        if (status === 'rto_initiated' || status === 'rto_received') return { backgroundColor: '#fef2f2' };
        return undefined;
    }, []);

    if (!orders?.length) {
        return (
            <div className="text-center text-gray-400 py-12 border rounded">
                No shipped orders
            </div>
        );
    }

    return (
        <div className="border rounded" style={{ height: '500px', width: '100%' }}>
            <AgGridReact
                rowData={rowData}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                autoGroupColumnDef={autoGroupColumnDef}
                groupDisplayType="groupRows"
                theme={compactTheme}
                getRowStyle={getRowStyle}
                animateRows={true}
                groupDefaultExpanded={1}
            />
        </div>
    );
}

export default ShippedOrdersGrid;
