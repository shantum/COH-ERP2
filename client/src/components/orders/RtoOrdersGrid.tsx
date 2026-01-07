/**
 * RtoOrdersGrid component
 * AG Grid implementation for RTO (Return to Origin) orders
 */

import { useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Package, AlertTriangle, CheckCircle, ExternalLink, Radio, Eye } from 'lucide-react';
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

interface RtoOrdersGridProps {
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

// Helper to format relative time (XX ago)
function formatRelativeTime(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
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

// RTO Status badge component
function RtoStatusBadge({ status, daysInRto }: { status: string; daysInRto?: number }) {
    const configs: Record<string, { bg: string; text: string; label: string; icon: any }> = {
        rto_in_transit: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'RTO In Transit', icon: Package },
        rto_delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'RTO Delivered', icon: CheckCircle },
        rto_initiated: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'RTO Initiated', icon: AlertTriangle },
    };
    const config = configs[status] || configs.rto_in_transit;
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            <Icon size={12} />
            {config.label}
            {status === 'rto_in_transit' && daysInRto ? ` (${daysInRto}d)` : ''}
        </span>
    );
}

export function RtoOrdersGrid({
    orders,
    onViewOrder,
    onSelectCustomer,
    onTrack,
    shopDomain,
}: RtoOrdersGridProps) {
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
            headerName: 'Total',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value ? `₹${Number(params.value).toLocaleString()}` : '-',
        },
        {
            field: 'paymentMethod',
            headerName: 'Payment',
            width: 70,
            cellRenderer: (params: ICellRendererParams) => {
                const method = params.value;
                if (!method) return <span className="text-gray-400">-</span>;
                const isCod = method.toLowerCase() === 'cod';
                return (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                        isCod ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                    }`}>
                        {method}
                    </span>
                );
            },
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
            field: 'trackingStatus',
            headerName: 'RTO Status',
            width: 140,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                return (
                    <RtoStatusBadge
                        status={params.value || 'rto_in_transit'}
                        daysInRto={order?.daysInRto}
                    />
                );
            },
        },
        {
            field: 'rtoInitiatedAt',
            headerName: 'RTO Started',
            width: 90,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs text-gray-600">{formatDate(params.value)}</span>
            ),
        },
        {
            field: 'daysInRto',
            headerName: 'Days',
            width: 55,
            cellRenderer: (params: ICellRendererParams) => {
                const days = params.value || 0;
                const colorClass = days <= 5 ? 'text-gray-600' :
                                  days <= 10 ? 'text-amber-600' : 'text-red-600';
                return (
                    <span className={`text-xs font-medium ${colorClass}`}>
                        {days}d
                    </span>
                );
            },
        },
        {
            field: 'lastScanLocation',
            headerName: 'Last Location',
            width: 150,
            cellRenderer: (params: ICellRendererParams) => {
                const location = params.value;
                if (!location) return <span className="text-gray-400 text-xs">-</span>;
                return (
                    <span className="text-xs text-gray-600 truncate" title={location}>
                        {location}
                    </span>
                );
            },
        },
        {
            field: 'lastScanAt',
            headerName: 'Last Scan',
            width: 80,
            cellRenderer: (params: ICellRendererParams) => {
                const date = params.value;
                if (!date) return <span className="text-gray-400 text-xs">-</span>;
                return (
                    <span className="text-xs text-gray-600" title={new Date(date).toLocaleString()}>
                        {formatRelativeTime(date)}
                    </span>
                );
            },
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
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onViewOrder?.(order)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                            title="View order"
                        >
                            <Eye size={14} />
                        </button>
                        {awb && onTrack && (
                            <button
                                onClick={() => onTrack(awb, order.orderNumber)}
                                className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600"
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
                                className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600"
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
        const status = params.data?.trackingStatus;
        if (status === 'rto_delivered') return { backgroundColor: '#f0fdf4' }; // Light green for delivered
        if (status === 'rto_in_transit') return { backgroundColor: '#fef9c3' }; // Light yellow for in transit
        return undefined;
    }, []);

    if (!orders?.length) {
        return (
            <div className="text-center text-gray-400 py-12 border rounded">
                No RTO orders
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

export default RtoOrdersGrid;
