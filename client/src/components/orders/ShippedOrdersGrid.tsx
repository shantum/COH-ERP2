/**
 * ShippedOrdersGrid component
 * AG Grid implementation for shipped orders with row grouping by ship date
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Undo2, CheckCircle, AlertTriangle, Package, ExternalLink, Radio, Archive, Columns, RotateCcw } from 'lucide-react';
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

// All column IDs for visibility/order persistence
const ALL_COLUMN_IDS = [
    'orderNumber', 'customerName', 'city', 'itemCount', 'totalAmount',
    'orderDate', 'shippedAt', 'deliveredAt', 'deliveryDays',
    'shopifyPaymentMethod', 'shopifyFinancialStatus', 'codRemittedAt', 'shopifyShipmentStatus', 'shopifyDeliveredAt', 'shopifyLink',
    'courier', 'awbNumber', 'daysInTransit', 'expectedDeliveryDate', 'deliveryAttempts',
    'courierStatusCode', 'trackingStatus', 'lastScanLocation', 'lastScanAt', 'lastScanStatus',
    'actions'
];

const DEFAULT_HEADERS: Record<string, string> = {
    orderNumber: 'Order', customerName: 'Customer', city: 'City', itemCount: 'Items',
    totalAmount: 'Total', orderDate: 'Ordered', shippedAt: 'Shipped', deliveredAt: 'Delivered',
    deliveryDays: 'Del Days', shopifyPaymentMethod: 'Payment', shopifyFinancialStatus: 'Paid',
    codRemittedAt: 'COD Paid', shopifyShipmentStatus: 'Status', shopifyDeliveredAt: 'Delivered',
    shopifyLink: 'Link', courier: 'Courier', awbNumber: 'AWB', daysInTransit: 'Days',
    expectedDeliveryDate: 'EDD', deliveryAttempts: 'OFD', courierStatusCode: 'Code',
    trackingStatus: 'Status', lastScanLocation: 'Location', lastScanAt: 'Scan Time',
    lastScanStatus: 'Last Status', actions: 'Actions'
};

// Column visibility dropdown component
const ColumnVisibilityDropdown = ({
    visibleColumns,
    onToggleColumn,
    onResetAll,
}: {
    visibleColumns: Set<string>;
    onToggleColumn: (colId: string) => void;
    onResetAll: () => void;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div ref={dropdownRef} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50"
            >
                <Columns size={12} />
                Columns
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                    <div className="p-2 border-b">
                        <button onClick={onResetAll} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                            <RotateCcw size={10} />
                            Reset All
                        </button>
                    </div>
                    <div className="p-2 space-y-1">
                        {ALL_COLUMN_IDS.filter(id => id !== 'actions').map((colId) => (
                            <label key={colId} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                                <input
                                    type="checkbox"
                                    checked={visibleColumns.has(colId)}
                                    onChange={() => onToggleColumn(colId)}
                                    className="w-3 h-3"
                                />
                                {DEFAULT_HEADERS[colId] || colId}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

interface ShippedOrdersGridProps {
    orders: any[];
    onUnship: (orderId: string) => void;
    onMarkDelivered: (orderId: string) => void;
    onMarkRto: (orderId: string) => void;
    onArchive?: (orderId: string) => void;
    onViewOrder?: (order: any) => void;
    onSelectCustomer?: (customer: any) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;
    isUnshipping?: boolean;
    isMarkingDelivered?: boolean;
    isMarkingRto?: boolean;
    isArchiving?: boolean;
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

    // Courier-specific tracking URLs
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
    // Default to iThink Logistics tracking
    return `https://www.ithinklogistics.com/tracking/${awb}`;
}

// Tracking status badge component
function TrackingStatusBadge({ status, daysInTransit, ofdCount }: { status: string; daysInTransit?: number; ofdCount?: number }) {
    const configs: Record<string, { bg: string; text: string; label: string; icon: any }> = {
        in_transit: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Transit', icon: Package },
        manifested: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Manifested', icon: Package },
        picked_up: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Picked Up', icon: Package },
        reached_destination: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'At Hub', icon: Package },
        out_for_delivery: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Out for Delivery', icon: Package },
        undelivered: { bg: 'bg-red-100', text: 'text-red-700', label: 'NDR', icon: AlertTriangle },
        delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered', icon: CheckCircle },
        delivery_delayed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Delayed', icon: AlertTriangle },
        rto_pending: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO Pending', icon: AlertTriangle },
        rto_initiated: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO', icon: AlertTriangle },
        rto_in_transit: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'RTO In Transit', icon: Package },
        rto_delivered: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received', icon: CheckCircle },
        rto_received: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received', icon: CheckCircle },
        cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled', icon: AlertTriangle },
    };
    const config = configs[status] || configs.in_transit;
    const Icon = config.icon;

    // Show OFD count for NDR/undelivered
    const showOfd = (status === 'undelivered' || status === 'out_for_delivery') && ofdCount && ofdCount > 0;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            <Icon size={12} />
            {config.label}
            {showOfd ? ` (${ofdCount})` : (status === 'in_transit' && daysInTransit ? ` (${daysInTransit}d)` : '')}
        </span>
    );
}

export function ShippedOrdersGrid({
    orders,
    onUnship,
    onMarkDelivered,
    onMarkRto,
    onArchive,
    onViewOrder,
    onSelectCustomer,
    onTrack,
    isUnshipping,
    isMarkingDelivered,
    isMarkingRto,
    isArchiving,
    shopDomain,
}: ShippedOrdersGridProps) {
    // Grid ref for API access
    const gridRef = useRef<AgGridReact>(null);

    // Column visibility state (persisted to localStorage)
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('shippedGridVisibleColumns');
        if (saved) {
            try { return new Set(JSON.parse(saved)); } catch { return new Set(ALL_COLUMN_IDS); }
        }
        return new Set(ALL_COLUMN_IDS);
    });

    // Column order state (persisted to localStorage)
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('shippedGridColumnOrder');
        if (saved) {
            try { return JSON.parse(saved); } catch { return ALL_COLUMN_IDS; }
        }
        return ALL_COLUMN_IDS;
    });

    // Save to localStorage
    useEffect(() => {
        localStorage.setItem('shippedGridVisibleColumns', JSON.stringify([...visibleColumns]));
    }, [visibleColumns]);

    useEffect(() => {
        localStorage.setItem('shippedGridColumnOrder', JSON.stringify(columnOrder));
    }, [columnOrder]);

    // Column handlers
    const handleToggleColumn = useCallback((colId: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev);
            if (next.has(colId)) next.delete(colId); else next.add(colId);
            return next;
        });
    }, []);

    const handleColumnMoved = useCallback(() => {
        const api = gridRef.current?.api;
        if (!api) return;
        const newOrder = api.getAllDisplayedColumns()
            .map(col => col.getColId())
            .filter((id): id is string => id !== undefined);
        if (newOrder.length > 0) setColumnOrder(newOrder);
    }, []);

    const handleResetAll = useCallback(() => {
        setVisibleColumns(new Set(ALL_COLUMN_IDS));
        setColumnOrder([...ALL_COLUMN_IDS]);
    }, []);

    // Transform orders for grid with grouping field and Shopify cache data
    const rowData = useMemo(() => {
        return orders.map((order) => {
            const cache = order.shopifyCache || {};

            // Calculate delivery days (from shipping to delivery)
            let deliveryDays: number | null = null;
            const shippedDate = order.shippedAt ? new Date(order.shippedAt) : null;
            const deliveredDate = order.deliveredAt ? new Date(order.deliveredAt) :
                                  cache.deliveredAt ? new Date(cache.deliveredAt) : null;
            if (shippedDate && deliveredDate) {
                deliveryDays = Math.round((deliveredDate.getTime() - shippedDate.getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                ...order,
                city: parseCity(order.shippingAddress),
                itemCount: order.orderLines?.length || 0,
                itemSummary: order.orderLines
                    ?.slice(0, 2)
                    .map((l: any) => l.sku?.variation?.product?.name || 'Item')
                    .join(', ') + (order.orderLines?.length > 2 ? '...' : ''),
                // Calculated delivery days
                deliveryDays,
                // Shopify cache fields for display
                trackingUrl: cache.trackingUrl,
                shopifyTrackingNumber: cache.trackingNumber,
                shopifyTrackingCompany: cache.trackingCompany,
                shopifyShipmentStatus: cache.shipmentStatus,
                shopifyDeliveredAt: cache.deliveredAt,
                shopifyFulfillmentUpdatedAt: cache.fulfillmentUpdatedAt,
                shopifyFulfillmentStatus: cache.fulfillmentStatus,
                shopifyFinancialStatus: cache.financialStatus,
                shopifyPaymentMethod: cache.paymentMethod || order.paymentMethod,
            };
        });
    }, [orders]);

    const columnDefs = useMemo<ColDef[]>(() => [
        // ═══════════════════════════════════════════════════════════════════
        // ERP DATA - Internal order and customer information
        // ═══════════════════════════════════════════════════════════════════
        {
            headerName: 'ERP',
            headerClass: 'bg-slate-100 font-semibold text-slate-700',
            children: [
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
                    width: 120,
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
                    width: 85,
                },
                {
                    field: 'itemCount',
                    headerName: 'Items',
                    width: 50,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-gray-600" title={params.data?.itemSummary}>
                            {params.value}
                        </span>
                    ),
                },
                {
                    field: 'totalAmount',
                    headerName: 'Total',
                    width: 75,
                    valueFormatter: (params: ValueFormatterParams) =>
                        params.value ? `₹${Number(params.value).toLocaleString()}` : '-',
                },
                {
                    field: 'orderDate',
                    headerName: 'Ordered',
                    width: 70,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-xs text-gray-600">{formatDate(params.value)}</span>
                    ),
                },
                {
                    field: 'shippedAt',
                    headerName: 'Shipped',
                    width: 70,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-xs text-gray-600">{formatDate(params.value)}</span>
                    ),
                },
                {
                    field: 'deliveredAt',
                    headerName: 'Delivered',
                    width: 70,
                    cellRenderer: (params: ICellRendererParams) => {
                        const date = params.value || params.data?.shopifyDeliveredAt;
                        if (!date) return <span className="text-gray-400 text-xs">-</span>;
                        return (
                            <span className="text-xs text-green-600">{formatDate(date)}</span>
                        );
                    },
                },
                {
                    field: 'deliveryDays',
                    headerName: 'Del Days',
                    width: 60,
                    cellRenderer: (params: ICellRendererParams) => {
                        const days = params.value;
                        if (days === null || days === undefined) return <span className="text-gray-400 text-xs">-</span>;
                        // Color code: green for fast (<5), amber for normal (5-10), red for slow (>10)
                        const colorClass = days <= 4 ? 'text-green-600' :
                                          days <= 7 ? 'text-gray-600' :
                                          days <= 10 ? 'text-amber-600' : 'text-red-600';
                        return (
                            <span className={`text-xs font-medium ${colorClass}`}>
                                {days}d
                            </span>
                        );
                    },
                },
            ],
        },

        // ═══════════════════════════════════════════════════════════════════
        // SHOPIFY DATA - Fulfillment info from Shopify
        // ═══════════════════════════════════════════════════════════════════
        {
            headerName: 'Shopify',
            headerClass: 'bg-green-50 font-semibold text-green-700',
            children: [
                {
                    field: 'shopifyPaymentMethod',
                    headerName: 'Payment',
                    width: 65,
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
                    field: 'shopifyFinancialStatus',
                    headerName: 'Paid',
                    width: 70,
                    cellRenderer: (params: ICellRendererParams) => {
                        const status = params.value;
                        if (!status) return <span className="text-gray-400 text-xs">-</span>;

                        const statusColors: Record<string, string> = {
                            'paid': 'bg-green-100 text-green-700',
                            'partially_paid': 'bg-amber-100 text-amber-700',
                            'pending': 'bg-gray-100 text-gray-600',
                            'refunded': 'bg-purple-100 text-purple-700',
                            'partially_refunded': 'bg-purple-100 text-purple-700',
                            'voided': 'bg-red-100 text-red-700',
                        };
                        const colorClass = statusColors[status] || 'bg-gray-100 text-gray-600';
                        const label = status === 'partially_paid' ? 'Partial' :
                                      status === 'partially_refunded' ? 'Part Ref' :
                                      status.charAt(0).toUpperCase() + status.slice(1);

                        return (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${colorClass}`}>
                                {label}
                            </span>
                        );
                    },
                },
                {
                    field: 'codRemittedAt',
                    headerName: 'COD Paid',
                    width: 75,
                    cellRenderer: (params: ICellRendererParams) => {
                        const order = params.data;
                        if (!order) return null;
                        // Only show for COD orders
                        const isCod = (order.shopifyPaymentMethod || order.paymentMethod || '').toLowerCase() === 'cod';
                        if (!isCod) return <span className="text-gray-300 text-xs">-</span>;

                        if (order.codRemittedAt) {
                            const date = new Date(order.codRemittedAt);
                            const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                            return (
                                <span
                                    className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700"
                                    title={`UTR: ${order.codRemittanceUtr || '-'}\nAmount: ₹${order.codRemittedAmount || '-'}`}
                                >
                                    {dateStr}
                                </span>
                            );
                        }
                        return (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                Pending
                            </span>
                        );
                    },
                },
                {
                    field: 'shopifyShipmentStatus',
                    headerName: 'Status',
                    width: 90,
                    cellRenderer: (params: ICellRendererParams) => {
                        const status = params.value;
                        if (!status) return <span className="text-gray-400 text-xs">-</span>;

                        const statusColors: Record<string, string> = {
                            'in_transit': 'bg-blue-100 text-blue-700',
                            'out_for_delivery': 'bg-amber-100 text-amber-700',
                            'delivered': 'bg-green-100 text-green-700',
                            'attempted_delivery': 'bg-red-100 text-red-700',
                            'failure': 'bg-red-100 text-red-700',
                        };
                        const colorClass = statusColors[status] || 'bg-gray-100 text-gray-600';
                        const label = status.replace(/_/g, ' ');

                        return (
                            <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${colorClass}`}>
                                {label}
                            </span>
                        );
                    },
                },
                {
                    field: 'shopifyDeliveredAt',
                    headerName: 'Delivered',
                    width: 75,
                    cellRenderer: (params: ICellRendererParams) => {
                        const date = params.value || params.data?.deliveredAt;
                        return <span className="text-xs text-gray-600">{formatDate(date)}</span>;
                    },
                },
                {
                    colId: 'shopifyLink',
                    headerName: 'Link',
                    width: 55,
                    sortable: false,
                    cellRenderer: (params: ICellRendererParams) => {
                        const order = params.data;
                        if (!order?.shopifyOrderId) return <span className="text-gray-400 text-xs">-</span>;
                        if (!shopDomain) return <span className="text-gray-400 text-xs">-</span>;

                        const shopifyUrl = `https://${shopDomain}/admin/orders/${order.shopifyOrderId}`;
                        return (
                            <a
                                href={shopifyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
                                title="Open in Shopify"
                            >
                                <ExternalLink size={11} />
                            </a>
                        );
                    },
                },
            ],
        },

        // ═══════════════════════════════════════════════════════════════════
        // iTHINK LOGISTICS DATA - Real-time tracking from courier API
        // ═══════════════════════════════════════════════════════════════════
        {
            headerName: 'iThink Logistics',
            headerClass: 'bg-blue-50 font-semibold text-blue-700',
            children: [
                {
                    field: 'courier',
                    headerName: 'Courier',
                    width: 80,
                    cellRenderer: (params: ICellRendererParams) => {
                        const courier = params.value || params.data?.shopifyTrackingCompany;
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
                    width: 120,
                    cellRenderer: (params: ICellRendererParams) => {
                        const awb = params.value || params.data?.shopifyTrackingNumber;
                        const courier = params.data?.courier || params.data?.shopifyTrackingCompany;
                        const shopifyTrackingUrl = params.data?.trackingUrl;
                        if (!awb) return <span className="text-gray-400">-</span>;

                        // Use Shopify URL if available, otherwise generate based on courier
                        const trackingUrl = shopifyTrackingUrl || getTrackingUrl(awb, courier);

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
                    field: 'daysInTransit',
                    headerName: 'Days',
                    width: 48,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className={`text-xs ${params.value > 7 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                            {params.value}d
                        </span>
                    ),
                },
                {
                    field: 'expectedDeliveryDate',
                    headerName: 'EDD',
                    width: 65,
                    cellRenderer: (params: ICellRendererParams) => {
                        const date = params.value;
                        if (!date) return <span className="text-gray-400 text-xs">-</span>;
                        const edd = new Date(date);
                        const today = new Date();
                        const isPast = edd < today;
                        return (
                            <span className={`text-xs ${isPast ? 'text-red-600' : 'text-gray-600'}`}>
                                {formatDate(date)}
                            </span>
                        );
                    },
                },
                {
                    field: 'deliveryAttempts',
                    headerName: 'OFD',
                    width: 42,
                    cellRenderer: (params: ICellRendererParams) => {
                        const attempts = params.value || 0;
                        if (attempts === 0) return <span className="text-gray-400 text-xs">-</span>;
                        return (
                            <span className={`text-xs font-medium ${attempts >= 3 ? 'text-red-600' : attempts >= 2 ? 'text-amber-600' : 'text-gray-600'}`}>
                                {attempts}
                            </span>
                        );
                    },
                },
                {
                    field: 'courierStatusCode',
                    headerName: 'Code',
                    width: 48,
                    cellRenderer: (params: ICellRendererParams) => {
                        const code = params.value;
                        if (!code) return <span className="text-gray-400 text-xs">-</span>;
                        const codeColors: Record<string, string> = {
                            'DL': 'bg-green-100 text-green-700',
                            'OFD': 'bg-amber-100 text-amber-700',
                            'IT': 'bg-blue-100 text-blue-700',
                            'UD': 'bg-red-100 text-red-700',
                            'RTP': 'bg-purple-100 text-purple-700',
                            'RTI': 'bg-purple-100 text-purple-700',
                        };
                        const colorClass = codeColors[code] || 'bg-gray-100 text-gray-600';
                        return (
                            <span className={`text-xs px-1 py-0.5 rounded font-mono ${colorClass}`}>
                                {code}
                            </span>
                        );
                    },
                },
                {
                    field: 'trackingStatus',
                    headerName: 'Status',
                    width: 120,
                    cellRenderer: (params: ICellRendererParams) => {
                        const order = params.data;
                        // Only show iThink status if we have actual courier data
                        // lastTrackingUpdate is set on sync attempt, but courierStatusCode/lastScanAt
                        // are only set when we get real data from the courier
                        const hasRealTrackingData = order?.courierStatusCode || order?.lastScanAt;
                        if (!hasRealTrackingData) {
                            return <span className="text-gray-400 text-xs">No data</span>;
                        }
                        return (
                            <TrackingStatusBadge
                                status={params.value || 'in_transit'}
                                daysInTransit={order?.daysInTransit}
                                ofdCount={order?.deliveryAttempts}
                            />
                        );
                    },
                },
                {
                    field: 'lastScanLocation',
                    headerName: 'Location',
                    width: 140,
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
                    headerName: 'Scan Time',
                    width: 75,
                    cellRenderer: (params: ICellRendererParams) => {
                        const date = params.value;
                        if (!date) return <span className="text-gray-400 text-xs">-</span>;
                        const d = new Date(date);
                        const now = new Date();
                        const hoursDiff = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60));
                        const isOld = hoursDiff > 48;
                        const exactTime = d.toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                        });
                        return (
                            <span
                                className={`text-xs ${isOld ? 'text-amber-600' : 'text-gray-600'}`}
                                title={exactTime}
                            >
                                {formatRelativeTime(d)}
                            </span>
                        );
                    },
                },
                {
                    field: 'lastScanStatus',
                    headerName: 'Last Status',
                    width: 100,
                    cellRenderer: (params: ICellRendererParams) => {
                        const status = params.value;
                        if (!status) return <span className="text-gray-400 text-xs">-</span>;
                        return (
                            <span className="text-xs text-gray-600 truncate" title={status}>
                                {status}
                            </span>
                        );
                    },
                },
            ],
        },

        // ═══════════════════════════════════════════════════════════════════
        // ACTIONS - Pinned to right so always visible
        // ═══════════════════════════════════════════════════════════════════
        {
            colId: 'actions',
            headerName: 'Actions',
            width: 130,
            sortable: false,
            pinned: 'right',
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;

                const status = order.trackingStatus || 'in_transit';
                const canMarkDelivered = status === 'in_transit' || status === 'delivery_delayed';
                const canMarkRto = status === 'in_transit' || status === 'delivery_delayed';
                const awb = order.awbNumber || order.shopifyTrackingNumber;

                return (
                    <div className="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                        {awb && onTrack && (
                            <button
                                onClick={() => onTrack(awb, order.orderNumber)}
                                className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Live tracking"
                            >
                                <Radio size={14} />
                            </button>
                        )}
                        {canMarkDelivered && (
                            <button
                                onClick={() => onMarkDelivered(order.id)}
                                disabled={isMarkingDelivered}
                                className="p-1.5 rounded-md hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50"
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
                                className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                title="Mark as RTO"
                            >
                                <AlertTriangle size={14} />
                            </button>
                        )}
                        {onArchive && (
                            <button
                                onClick={() => {
                                    if (confirm(`Archive order ${order.orderNumber}? This will move it to the archived tab.`)) {
                                        onArchive(order.id);
                                    }
                                }}
                                disabled={isArchiving}
                                className="p-1.5 rounded-md hover:bg-purple-50 text-gray-400 hover:text-purple-600 transition-colors disabled:opacity-50"
                                title="Archive order"
                            >
                                <Archive size={14} />
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (confirm(`Undo shipping for ${order.orderNumber}? This will move it back to open orders.`)) {
                                    onUnship(order.id);
                                }
                            }}
                            disabled={isUnshipping}
                            className="p-1.5 rounded-md hover:bg-amber-50 text-gray-400 hover:text-orange-600 transition-colors disabled:opacity-50"
                            title="Undo shipping"
                        >
                            <Undo2 size={14} />
                        </button>
                    </div>
                );
            },
        },
    ], [onUnship, onMarkDelivered, onMarkRto, onArchive, onViewOrder, onSelectCustomer, onTrack, isUnshipping, isMarkingDelivered, isMarkingRto, isArchiving, shopDomain]);

    // Apply visibility to columns (including children in groups)
    const processedColumnDefs = useMemo(() => {
        return columnDefs.map(col => {
            const colAny = col as any;
            if (colAny.children && Array.isArray(colAny.children)) {
                return {
                    ...col,
                    children: colAny.children.map((child: any) => ({
                        ...child,
                        hide: child.colId ? !visibleColumns.has(child.colId) : (child.field ? !visibleColumns.has(child.field) : false),
                    })),
                };
            }
            const colId = col.colId || colAny.field;
            return { ...col, hide: colId ? !visibleColumns.has(colId) : false };
        });
    }, [columnDefs, visibleColumns]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        resizable: true,
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
        <div className="space-y-2">
            <div className="flex justify-end">
                <ColumnVisibilityDropdown
                    visibleColumns={visibleColumns}
                    onToggleColumn={handleToggleColumn}
                    onResetAll={handleResetAll}
                />
            </div>
            <div className="border rounded" style={{ height: '500px', width: '100%' }}>
                <AgGridReact
                    ref={gridRef}
                    rowData={rowData}
                    columnDefs={processedColumnDefs}
                    defaultColDef={defaultColDef}
                    theme={compactTheme}
                    getRowStyle={getRowStyle}
                    animateRows={true}
                    onColumnMoved={handleColumnMoved}
                    maintainColumnOrder={true}
                />
            </div>
        </div>
    );
}

export default ShippedOrdersGrid;
