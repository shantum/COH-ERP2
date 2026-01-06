/**
 * ArchivedOrdersGrid component
 * AG Grid implementation for archived orders with row grouping by archive month
 */

import { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Undo2 } from 'lucide-react';
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

interface ArchivedOrdersGridProps {
    orders: any[];
    onRestore: (orderId: string) => void;
    isRestoring?: boolean;
}

// Status badge component for final order status
function FinalStatusBadge({ status }: { status: string }) {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
        delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered' },
        shipped: { bg: 'bg-green-100', text: 'text-green-700', label: 'Shipped' },
        cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelled' },
        returned: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Returned' },
        open: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Was Open' },
    };
    const config = configs[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status };

    return (
        <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            {config.label}
        </span>
    );
}

export function ArchivedOrdersGrid({
    orders,
    onRestore,
    isRestoring,
}: ArchivedOrdersGridProps) {
    // Transform orders for grid with grouping field
    const rowData = useMemo(() => {
        return orders.map((order) => ({
            ...order,
            archiveMonthGroup: order.archivedAt
                ? new Date(order.archivedAt).toLocaleDateString('en-IN', {
                    month: 'long',
                    year: 'numeric',
                })
                : 'Unknown',
            city: parseCity(order.shippingAddress),
            itemCount: order.orderLines?.length || 0,
            itemSummary: order.orderLines
                ?.slice(0, 2)
                .map((l: any) => l.sku?.variation?.product?.name || 'Item')
                .join(', ') + (order.orderLines?.length > 2 ? '...' : ''),
            orderDateFormatted: order.orderDate
                ? new Date(order.orderDate).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                })
                : '-',
        }));
    }, [orders]);

    const columnDefs = useMemo<ColDef[]>(() => [
        {
            field: 'archiveMonthGroup',
            headerName: 'Archive Month',
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
        },
        {
            field: 'city',
            headerName: 'City',
            width: 100,
        },
        {
            field: 'orderDateFormatted',
            headerName: 'Order Date',
            width: 110,
        },
        {
            field: 'itemCount',
            headerName: 'Items',
            width: 70,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-gray-600" title={params.data?.itemSummary}>
                    {params.value}
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
            field: 'status',
            headerName: 'Final Status',
            width: 100,
            cellRenderer: (params: ICellRendererParams) => (
                <FinalStatusBadge status={params.value} />
            ),
        },
        {
            field: 'channel',
            headerName: 'Channel',
            width: 90,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs capitalize text-gray-600">
                    {params.value?.replace('_', ' ') || '-'}
                </span>
            ),
        },
        {
            colId: 'actions',
            headerName: 'Actions',
            width: 80,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;

                return (
                    <button
                        onClick={() => {
                            if (confirm(`Restore order ${order.orderNumber}?`)) {
                                onRestore(order.id);
                            }
                        }}
                        disabled={isRestoring}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                        <Undo2 size={12} /> Restore
                    </button>
                );
            },
        },
    ], [onRestore, isRestoring]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        resizable: true,
    }), []);

    const autoGroupColumnDef = useMemo<ColDef>(() => ({
        headerName: 'Archive Month',
        minWidth: 180,
        cellRendererParams: {
            suppressCount: false,
        },
    }), []);

    const getRowStyle = useCallback((params: any) => {
        const status = params.data?.status;
        if (status === 'cancelled') return { backgroundColor: '#fef2f2' };
        if (status === 'delivered' || status === 'shipped') return { backgroundColor: '#f0fdf4' };
        return undefined;
    }, []);

    if (!orders?.length) {
        return (
            <div className="text-center text-gray-400 py-12 border rounded">
                No archived orders
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
                groupDefaultExpanded={0}
            />
        </div>
    );
}

export default ArchivedOrdersGrid;
