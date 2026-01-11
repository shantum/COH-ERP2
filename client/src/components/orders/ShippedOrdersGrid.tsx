/**
 * ShippedOrdersGrid component
 * AG Grid implementation for shipped orders with row grouping by ship date
 */

import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Undo2, ExternalLink, Archive, MoreHorizontal, CheckCircle, AlertTriangle, Package } from 'lucide-react';
import { parseCity } from '../../utils/orderHelpers';
import { compactTheme, formatDate, formatRelativeTime, getTrackingUrl } from '../../utils/agGridHelpers';
import { useGridState, getColumnOrderFromApi, applyColumnWidths } from '../../hooks/useGridState';
import { ColumnVisibilityDropdown } from '../common/grid/ColumnVisibilityDropdown';
import { TrackingStatusBadge } from '../common/grid/TrackingStatusBadge';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// All column IDs for visibility/order persistence
const ALL_COLUMN_IDS = [
    'orderNumber', 'customerName', 'city', 'itemCount', 'totalAmount',
    'orderDate', 'shippedAt', 'deliveredAt', 'deliveryDays',
    'paymentMethod', 'shopifyFinancialStatus', 'codRemittedAt', 'shopifyLink',
    'courier', 'awbNumber', 'daysInTransit', 'expectedDeliveryDate', 'deliveryAttempts',
    'courierStatusCode', 'trackingStatus', 'lastScanLocation', 'lastScanAt', 'lastScanStatus',
    'actions'
];

const DEFAULT_HEADERS: Record<string, string> = {
    orderNumber: 'Order', customerName: 'Customer', city: 'City', itemCount: 'Items',
    totalAmount: 'Total', orderDate: 'Ordered', shippedAt: 'Shipped', deliveredAt: 'Delivered',
    deliveryDays: 'Del Days', paymentMethod: 'Payment', shopifyFinancialStatus: 'Paid',
    codRemittedAt: 'COD Paid',
    shopifyLink: 'Link', courier: 'Courier', awbNumber: 'AWB', daysInTransit: 'Days',
    expectedDeliveryDate: 'EDD', deliveryAttempts: 'OFD', courierStatusCode: 'Code',
    trackingStatus: 'Status', lastScanLocation: 'Location', lastScanAt: 'Scan Time',
    lastScanStatus: 'Last Status', actions: 'Actions'
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

// Helper to format date with time
function formatDateTime(date: string | null | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// Action menu dropdown for shipped orders
function ShippedActionMenu({
    order,
    onMarkDelivered,
    onMarkRto,
    onArchive,
    onUnship,
    isMarkingDelivered,
    isMarkingRto,
    isArchiving,
    isUnshipping,
}: {
    order: any;
    onMarkDelivered: (id: string) => void;
    onMarkRto: (id: string) => void;
    onArchive?: (id: string) => void;
    onUnship: (id: string) => void;
    isMarkingDelivered?: boolean;
    isMarkingRto?: boolean;
    isArchiving?: boolean;
    isUnshipping?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isOpen &&
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        // Always attach listener, check isOpen inside handler
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.right - 160,
            });
        }
        setIsOpen(!isOpen);
    };

    const status = order.trackingStatus || 'in_transit';
    const canMarkDelivered = status === 'in_transit' || status === 'delivery_delayed' || status === 'out_for_delivery';
    const canMarkRto = status === 'in_transit' || status === 'delivery_delayed' || status === 'out_for_delivery';

    return (
        <>
            <button
                ref={buttonRef}
                onClick={handleOpen}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="More actions"
            >
                <MoreHorizontal size={14} />
            </button>
            {isOpen && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px]"
                    style={{ top: position.top, left: position.left }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {canMarkDelivered && (
                        <button
                            onClick={() => { onMarkDelivered(order.id); setIsOpen(false); }}
                            disabled={isMarkingDelivered}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-green-50 text-green-600 disabled:opacity-50"
                        >
                            <CheckCircle size={12} />
                            Mark Delivered
                        </button>
                    )}
                    {canMarkRto && (
                        <button
                            onClick={() => {
                                if (confirm(`Mark ${order.orderNumber} as RTO?`)) {
                                    onMarkRto(order.id);
                                    setIsOpen(false);
                                }
                            }}
                            disabled={isMarkingRto}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-red-50 text-red-600 disabled:opacity-50"
                        >
                            <AlertTriangle size={12} />
                            Mark as RTO
                        </button>
                    )}
                    {onArchive && (
                        <button
                            onClick={() => {
                                if (confirm(`Archive ${order.orderNumber}?`)) {
                                    onArchive(order.id);
                                    setIsOpen(false);
                                }
                            }}
                            disabled={isArchiving}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 text-gray-600 disabled:opacity-50"
                        >
                            <Archive size={12} />
                            Archive
                        </button>
                    )}
                    <div className="my-1 border-t border-gray-100" />
                    <button
                        onClick={() => {
                            if (confirm(`Undo shipping for ${order.orderNumber}?\nThis moves it back to open orders.`)) {
                                onUnship(order.id);
                                setIsOpen(false);
                            }
                        }}
                        disabled={isUnshipping}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-amber-50 text-amber-600 disabled:opacity-50"
                    >
                        <Undo2 size={12} />
                        Undo Shipping
                    </button>
                </div>,
                document.body
            )}
        </>
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

    // Use shared grid state hook
    const {
        visibleColumns,
        columnWidths,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
        handleColumnResized,
    } = useGridState({
        gridId: 'shippedGrid',
        allColumnIds: ALL_COLUMN_IDS,
    });

    // Handle column moved event from AG-Grid
    const onColumnMoved = useCallback(() => {
        const api = gridRef.current?.api;
        if (!api) return;
        const newOrder = getColumnOrderFromApi(api);
        handleColumnMoved(newOrder);
    }, [handleColumnMoved]);

    // Handle column resize event from AG-Grid
    const onColumnResized = useCallback((event: any) => {
        if (event.finished && event.columns?.length) {
            event.columns.forEach((col: any) => {
                const colId = col.getColId();
                const width = col.getActualWidth();
                if (colId && width) {
                    handleColumnResized(colId, width);
                }
            });
        }
    }, [handleColumnResized]);

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
                // Shopify cache fields for display (read-only reference data)
                trackingUrl: cache.trackingUrl,
                shopifyFulfillmentStatus: cache.fulfillmentStatus,
                shopifyFinancialStatus: cache.financialStatus,
            };
        });
    }, [orders]);

    const columnDefs = useMemo<ColDef[]>(() => [
        // ERP DATA - Internal order and customer information
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
                    width: 100,
                    sort: 'desc' as const,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-xs text-gray-600">{formatDateTime(params.value)}</span>
                    ),
                },
                {
                    field: 'deliveredAt',
                    headerName: 'Delivered',
                    width: 100,
                    cellRenderer: (params: ICellRendererParams) => {
                        const date = params.value || params.data?.shopifyDeliveredAt;
                        if (!date) return <span className="text-gray-400 text-xs">-</span>;
                        return (
                            <span className="text-xs text-green-600">{formatDateTime(date)}</span>
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

        // SHOPIFY DATA - Financial info from Shopify
        {
            headerName: 'Shopify',
            headerClass: 'bg-green-50 font-semibold text-green-700',
            children: [
                {
                    field: 'paymentMethod',
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
                        const isCod = (order.paymentMethod || '').toLowerCase() === 'cod';
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

        // iTHINK LOGISTICS DATA - Real-time tracking from courier API
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

        // ACTIONS - Pinned to right so always visible
        {
            colId: 'actions',
            headerName: '',
            width: 100,
            sortable: false,
            pinned: 'right',
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;

                const awb = order.awbNumber || order.shopifyTrackingNumber;
                const courier = order.courier || order.shopifyTrackingCompany;
                const trackingUrl = order.trackingUrl || getTrackingUrl(awb, courier);
                const status = order.trackingStatus || 'in_transit';
                const isDelivered = status === 'delivered';

                return (
                    <div className="flex items-center gap-1">
                        {/* Primary action: Track button or status indicator */}
                        {awb && trackingUrl ? (
                            <a
                                href={trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                title={`Track on ${courier || 'courier website'}`}
                            >
                                <Package size={11} />
                                Track
                            </a>
                        ) : isDelivered ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-green-50 text-green-600">
                                <CheckCircle size={11} />
                                Done
                            </span>
                        ) : (
                            <span className="text-gray-300 text-xs">—</span>
                        )}
                        {/* Secondary actions dropdown */}
                        <ShippedActionMenu
                            order={order}
                            onMarkDelivered={onMarkDelivered}
                            onMarkRto={onMarkRto}
                            onArchive={onArchive}
                            onUnship={onUnship}
                            isMarkingDelivered={isMarkingDelivered}
                            isMarkingRto={isMarkingRto}
                            isArchiving={isArchiving}
                            isUnshipping={isUnshipping}
                        />
                    </div>
                );
            },
        },
    ], [onUnship, onMarkDelivered, onMarkRto, onArchive, onViewOrder, onSelectCustomer, onTrack, isUnshipping, isMarkingDelivered, isMarkingRto, isArchiving, shopDomain]);

    // Apply visibility and saved widths to columns (including children in groups)
    const processedColumnDefs = useMemo(() => {
        const withVisibility = columnDefs.map(col => {
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
        return applyColumnWidths(withVisibility, columnWidths);
    }, [columnDefs, visibleColumns, columnWidths]);

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
                    columnIds={ALL_COLUMN_IDS}
                    columnHeaders={DEFAULT_HEADERS}
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
                    onColumnMoved={onColumnMoved}
                    onColumnResized={onColumnResized}
                    maintainColumnOrder={true}
                />
            </div>
        </div>
    );
}

export default ShippedOrdersGrid;
