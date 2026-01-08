/**
 * CodPendingGrid component
 * AG Grid implementation for COD orders awaiting payment
 */

import { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Clock, AlertTriangle, CheckCircle, ExternalLink, Radio, Eye } from 'lucide-react';
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

interface CodPendingGridProps {
    orders: any[];
    onViewOrder?: (order: any) => void;
    onSelectCustomer?: (customer: any) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;
    shopDomain?: string;
}

// Helper to format dates
function formatDate(date: string | null | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
    });
}

// Generate tracking URL based on courier
function getTrackingUrl(awb: string, courier?: string): string | null {
    if (!awb) return null;
    const courierLower = (courier || '').toLowerCase();

    if (courierLower.includes('delhivery')) {
        return `https://www.delhivery.com/track/package/${awb}`;
    }
    if (courierLower.includes('bluedart')) {
        return `https://www.bluedart.com/tracking/${awb}`;
    }
    if (courierLower.includes('ekart')) {
        return `https://ekartlogistics.com/track/${awb}`;
    }
    if (courierLower.includes('xpressbees')) {
        return `https://www.xpressbees.com/shipment/tracking?awb=${awb}`;
    }
    if (courierLower.includes('dtdc')) {
        return `https://www.dtdc.in/tracking.asp?strCnno=${awb}`;
    }
    if (courierLower.includes('ecom')) {
        return `https://www.ecomexpress.in/tracking/?awb=${awb}`;
    }
    return `https://www.ithinklogistics.com/tracking/${awb}`;
}

// Days waiting badge component with color coding
function DaysWaitingBadge({ days }: { days: number }) {
    const getConfig = () => {
        if (days <= 7) {
            return { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle };
        }
        if (days <= 14) {
            return { bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock };
        }
        return { bg: 'bg-red-100', text: 'text-red-700', icon: AlertTriangle };
    };

    const config = getConfig();
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            <Icon size={12} />
            {days}d
        </span>
    );
}

export function CodPendingGrid({
    orders,
    onViewOrder,
    onSelectCustomer,
    onTrack,
    shopDomain,
}: CodPendingGridProps) {
    // Transform orders for grid
    const rowData = useMemo(() => {
        return orders.map((order) => ({
            ...order,
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
            field: 'orderNumber',
            headerName: 'Order',
            width: 85,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;
                return (
                    <button
                        onClick={() => onViewOrder?.(order)}
                        className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                        {params.value}
                    </button>
                );
            },
        },
        {
            field: 'customerName',
            headerName: 'Customer',
            width: 130,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;
                return (
                    <div className="truncate">
                        <button
                            onClick={() => onSelectCustomer?.({
                                id: order.customerId,
                                name: order.customerName,
                                email: order.customerEmail,
                                phone: order.customerPhone,
                            })}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                            {params.value}
                        </button>
                        {order.customerTier && (
                            <span className={`ml-1 text-xs px-1 rounded ${
                                order.customerTier === 'vip' ? 'bg-purple-100 text-purple-700' :
                                order.customerTier === 'loyal' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                            }`}>
                                {order.customerTier}
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            field: 'city',
            headerName: 'City',
            width: 100,
        },
        {
            field: 'itemCount',
            headerName: 'Items',
            width: 55,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-gray-600" title={params.data?.itemSummary}>
                    {params.value}
                </span>
            ),
        },
        {
            field: 'totalAmount',
            headerName: 'COD Amount',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value ? `₹${Number(params.value).toLocaleString()}` : '-',
            cellClass: 'font-medium text-amber-700',
        },
        {
            field: 'courier',
            headerName: 'Courier',
            width: 90,
            cellRenderer: (params: ICellRendererParams) => {
                const courier = params.value;
                return courier ? (
                    <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        {courier}
                    </span>
                ) : <span className="text-gray-400">-</span>;
            },
        },
        {
            field: 'awbNumber',
            headerName: 'AWB',
            width: 130,
            cellRenderer: (params: ICellRendererParams) => {
                const awb = params.value;
                const courier = params.data?.courier;
                if (!awb) return <span className="text-gray-400">-</span>;

                const trackingUrl = getTrackingUrl(awb, courier);

                if (trackingUrl) {
                    return (
                        <a
                            href={trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                            title={`Track on ${courier || 'courier website'}`}
                        >
                            {awb}
                            <ExternalLink size={10} />
                        </a>
                    );
                }
                return <span className="font-mono text-xs text-gray-500">{awb}</span>;
            },
        },
        {
            field: 'deliveredAt',
            headerName: 'Delivered',
            width: 90,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs text-gray-600">{formatDate(params.value)}</span>
            ),
        },
        {
            field: 'daysSinceDelivery',
            headerName: 'Waiting',
            width: 80,
            cellRenderer: (params: ICellRendererParams) => {
                const days = params.value || 0;
                return <DaysWaitingBadge days={days} />;
            },
            sort: 'desc',
        },
        {
            field: 'shippedAt',
            headerName: 'Shipped',
            width: 80,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs text-gray-500">{formatDate(params.value)}</span>
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

                const awb = order.awbNumber;

                return (
                    <div className="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => onViewOrder?.(order)}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            title="View order"
                        >
                            <Eye size={14} />
                        </button>
                        {awb && onTrack && (
                            <button
                                onClick={() => onTrack(awb, order.orderNumber)}
                                className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Live tracking"
                            >
                                <Radio size={14} />
                            </button>
                        )}
                        {shopDomain && order.shopifyOrderId && (
                            <a
                                href={`https://${shopDomain}/admin/orders/${order.shopifyOrderId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-md hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                                title="Open in Shopify"
                            >
                                <ExternalLink size={14} />
                            </a>
                        )}
                    </div>
                );
            },
        },
    ], [onViewOrder, onSelectCustomer, onTrack, shopDomain]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        resizable: true,
    }), []);

    const getRowStyle = useCallback((params: any) => {
        const days = params.data?.daysSinceDelivery || 0;
        if (days > 14) return { backgroundColor: '#fef2f2' }; // Light red for overdue
        if (days > 7) return { backgroundColor: '#fffbeb' }; // Light amber for aging
        return { backgroundColor: '#f0fdf4' }; // Light green for recent
    }, []);

    if (!orders?.length) {
        return (
            <div className="text-center text-gray-400 py-12 border rounded">
                No COD orders pending payment
            </div>
        );
    }

    return (
        <div className="border rounded" style={{ height: '500px', width: '100%' }}>
            <AgGridReact
                rowData={rowData}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                theme={compactTheme}
                getRowStyle={getRowStyle}
                animateRows={true}
            />
        </div>
    );
}

export default CodPendingGrid;
