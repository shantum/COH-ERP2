/**
 * ArchivedOrdersGrid component
 * AG Grid implementation for archived orders with all shipped order columns
 */

import { useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Undo2, ExternalLink, CheckCircle, AlertTriangle, Package, Save } from 'lucide-react';
import { parseCity } from '../../utils/orderHelpers';
import { compactTheme, formatDate } from '../../utils/agGridHelpers';
import { ColumnVisibilityDropdown } from '../common/grid/ColumnVisibilityDropdown';
import { useGridState, getColumnOrderFromApi } from '../../hooks/useGridState';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// All column IDs for persistence
const ALL_COLUMN_IDS = [
    'orderNumber', 'customerName', 'city', 'itemCount', 'totalAmount',
    'orderDate', 'shippedAt', 'deliveredAt', 'deliveryDays', 'archivedAt',
    'paymentMethod', 'shopifyFinancialStatus', 'codRemittedAt', 'shopifyLink',
    'courier', 'awbNumber', 'trackingStatus', 'courierStatusCode',
    'status', 'channel', 'actions'
];

const DEFAULT_HEADERS: Record<string, string> = {
    orderNumber: 'Order', customerName: 'Customer', city: 'City', itemCount: 'Items',
    totalAmount: 'Total', orderDate: 'Ordered', shippedAt: 'Shipped', deliveredAt: 'Delivered',
    deliveryDays: 'Del Days', archivedAt: 'Archived', paymentMethod: 'Payment',
    shopifyFinancialStatus: 'Paid', codRemittedAt: 'COD Paid', shopifyLink: 'Link',
    courier: 'Courier', awbNumber: 'AWB', trackingStatus: 'Status', courierStatusCode: 'Code',
    status: 'Final Status', channel: 'Channel', actions: 'Actions'
};

interface ArchivedOrdersGridProps {
    orders: any[];
    totalCount: number;
    onRestore: (orderId: string) => void;
    onViewOrder?: (order: any) => void;
    onSelectCustomer?: (customer: any) => void;
    isRestoring?: boolean;
    shopDomain?: string;
    sortBy: 'orderDate' | 'archivedAt';
    onSortChange: (sortBy: 'orderDate' | 'archivedAt') => void;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
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

// Status badge component for final order status
function FinalStatusBadge({ status }: { status: string }) {
    const configs: Record<string, { bg: string; text: string; label: string; icon?: any }> = {
        delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered', icon: CheckCircle },
        shipped: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Shipped', icon: Package },
        archived: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Archived' },
        cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelled', icon: AlertTriangle },
        returned: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Returned' },
        rto_received: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
        open: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Was Open' },
    };
    const config = configs[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            {Icon && <Icon size={12} />}
            {config.label}
        </span>
    );
}

// Tracking status badge component
function TrackingStatusBadge({ status }: { status: string }) {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
        in_transit: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Transit' },
        delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered' },
        delivery_delayed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Delayed' },
        rto_initiated: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO' },
        rto_in_transit: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'RTO Transit' },
        rto_delivered: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
        rto_received: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'RTO Received' },
        undelivered: { bg: 'bg-red-100', text: 'text-red-700', label: 'NDR' },
    };
    const config = configs[status] || { bg: 'bg-gray-100', text: 'text-gray-600', label: status || '-' };

    return (
        <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
            {config.label}
        </span>
    );
}

export function ArchivedOrdersGrid({
    orders,
    totalCount,
    onRestore,
    onViewOrder,
    onSelectCustomer,
    isRestoring,
    shopDomain,
    sortBy,
    onSortChange,
    pageSize,
    onPageSizeChange,
}: ArchivedOrdersGridProps) {
    const gridRef = useRef<AgGridReact>(null);

    // Use shared grid state hook with server sync
    const {
        visibleColumns,
        columnOrder,
        columnWidths,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
        handleColumnResized,
        isManager,
        hasUnsavedChanges,
        isSavingPrefs,
        savePreferencesToServer,
    } = useGridState({
        gridId: 'archivedGrid',
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

    // Handle save preferences to server (managers only)
    const handleSavePreferences = useCallback(async () => {
        const success = await savePreferencesToServer();
        if (success) {
            alert('Column preferences saved for all users');
        } else {
            alert('Failed to save preferences');
        }
    }, [savePreferencesToServer]);

    // Transform orders for grid with grouping field
    const rowData = useMemo(() => {
        return orders.map((order) => ({
            ...order,
            // Group by archive month or order month based on sort
            groupField: sortBy === 'archivedAt'
                ? (order.archivedAt
                    ? new Date(order.archivedAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
                    : 'Unknown')
                : (order.orderDate
                    ? new Date(order.orderDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
                    : 'Unknown'),
            city: parseCity(order.shippingAddress),
            itemCount: order.orderLines?.length || 0,
            itemSummary: order.orderLines
                ?.slice(0, 2)
                .map((l: any) => l.sku?.variation?.product?.name || 'Item')
                .join(', ') + (order.orderLines?.length > 2 ? '...' : ''),
        }));
    }, [orders, sortBy]);

    const columnDefs = useMemo<ColDef[]>(() => [
        // Row grouping column (hidden)
        {
            field: 'groupField',
            headerName: sortBy === 'archivedAt' ? 'Archive Month' : 'Order Month',
            rowGroup: true,
            hide: true,
        },

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
                    colId: 'totalAmount',
                    headerName: 'Total',
                    width: 75,
                    valueGetter: (params) =>
                        // Prefer shopifyCache.totalPrice (generated column), fallback to totalAmount
                        params.data?.shopifyCache?.totalPrice ?? params.data?.totalAmount ?? 0,
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
                {
                    field: 'archivedAt',
                    headerName: 'Archived',
                    width: 100,
                    sort: 'desc' as const,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-xs text-gray-500">{formatDateTime(params.value)}</span>
                    ),
                },
            ],
        },

        // ═══════════════════════════════════════════════════════════════════
        // SHOPIFY DATA - Payment and fulfillment info
        // ═══════════════════════════════════════════════════════════════════
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

        // ═══════════════════════════════════════════════════════════════════
        // TRACKING DATA - Shipping and delivery info
        // ═══════════════════════════════════════════════════════════════════
        {
            headerName: 'Tracking',
            headerClass: 'bg-blue-50 font-semibold text-blue-700',
            children: [
                {
                    field: 'courier',
                    headerName: 'Courier',
                    width: 80,
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
                    width: 110,
                    cellRenderer: (params: ICellRendererParams) => {
                        const awb = params.value;
                        if (!awb) return <span className="text-gray-400">-</span>;
                        return <span className="font-mono text-xs text-gray-500">{awb}</span>;
                    },
                },
                {
                    field: 'trackingStatus',
                    headerName: 'Status',
                    width: 100,
                    cellRenderer: (params: ICellRendererParams) => {
                        const status = params.value;
                        if (!status) return <span className="text-gray-400 text-xs">-</span>;
                        return <TrackingStatusBadge status={status} />;
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
            ],
        },

        // ═══════════════════════════════════════════════════════════════════
        // STATUS & ACTIONS
        // ═══════════════════════════════════════════════════════════════════
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
            width: 70,
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
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                    >
                        <Undo2 size={12} /> Restore
                    </button>
                );
            },
        },
    ], [onRestore, onViewOrder, onSelectCustomer, isRestoring, shopDomain, sortBy]);

    // Apply visibility to columns (including children in groups)
    const processedColumnDefs = useMemo(() => {
        return columnDefs.map(col => {
            const colAny = col as any;
            if (colAny.children && Array.isArray(colAny.children)) {
                return {
                    ...col,
                    children: colAny.children.map((child: any) => {
                        const childColId = child.colId || child.field;
                        const savedWidth = childColId ? columnWidths[childColId] : undefined;
                        return {
                            ...child,
                            hide: child.colId ? !visibleColumns.has(child.colId) : (child.field ? !visibleColumns.has(child.field) : false),
                            ...(savedWidth ? { width: savedWidth } : {}),
                        };
                    }),
                };
            }
            const colId = col.colId || colAny.field;
            const savedWidth = colId ? columnWidths[colId] : undefined;
            return {
                ...col,
                hide: colId ? !visibleColumns.has(colId) : false,
                ...(savedWidth ? { width: savedWidth } : {}),
            };
        });
    }, [columnDefs, visibleColumns, columnWidths]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        resizable: true,
    }), []);

    const autoGroupColumnDef = useMemo<ColDef>(() => ({
        headerName: sortBy === 'archivedAt' ? 'Archive Month' : 'Order Month',
        minWidth: 180,
        cellRendererParams: {
            suppressCount: false,
        },
    }), [sortBy]);

    const getRowStyle = useCallback((params: any) => {
        const status = params.data?.status;
        if (status === 'cancelled') return { backgroundColor: '#fef2f2' };
        if (status === 'delivered' || status === 'shipped') return { backgroundColor: '#f0fdf4' };
        if (status === 'rto_received' || status === 'returned') return { backgroundColor: '#faf5ff' };
        return undefined;
    }, []);

    if (!orders?.length) {
        return (
            <div className="space-y-4">
                {/* Sort Controls */}
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600">Sort by:</span>
                    <button
                        onClick={() => onSortChange('archivedAt')}
                        className={`px-3 py-1 rounded ${sortBy === 'archivedAt' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                        Archive Date
                    </button>
                    <button
                        onClick={() => onSortChange('orderDate')}
                        className={`px-3 py-1 rounded ${sortBy === 'orderDate' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                        Order Date
                    </button>
                </div>
                <div className="text-center text-gray-400 py-12 border rounded">
                    No archived orders
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Sort Controls and Column Selector */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600">Sort by:</span>
                    <button
                        onClick={() => onSortChange('archivedAt')}
                        className={`px-3 py-1 rounded ${sortBy === 'archivedAt' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                        Archive Date
                    </button>
                    <button
                        onClick={() => onSortChange('orderDate')}
                        className={`px-3 py-1 rounded ${sortBy === 'orderDate' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                    >
                        Order Date
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <ColumnVisibilityDropdown
                        visibleColumns={visibleColumns}
                        onToggleColumn={handleToggleColumn}
                        onResetAll={handleResetAll}
                        columnIds={ALL_COLUMN_IDS}
                        columnHeaders={DEFAULT_HEADERS}
                    />
                    {isManager && hasUnsavedChanges && (
                        <button
                            onClick={handleSavePreferences}
                            disabled={isSavingPrefs}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 border border-blue-200"
                            title="Save current column visibility and order for all users"
                        >
                            <Save size={12} />
                            {isSavingPrefs ? 'Saving...' : 'Sync columns'}
                        </button>
                    )}
                </div>
            </div>

            <div className="border rounded" style={{ height: '550px', width: '100%' }}>
                <AgGridReact
                    ref={gridRef}
                    rowData={rowData}
                    columnDefs={processedColumnDefs}
                    defaultColDef={defaultColDef}
                    autoGroupColumnDef={autoGroupColumnDef}
                    groupDisplayType="groupRows"
                    theme={compactTheme}
                    getRowStyle={getRowStyle}
                    animateRows={true}
                    groupDefaultExpanded={0}
                    onColumnMoved={onColumnMoved}
                    onColumnResized={onColumnResized}
                    maintainColumnOrder={true}
                    pagination={true}
                    paginationPageSize={pageSize}
                    paginationPageSizeSelector={[100, 500, 1000, 2500]}
                    onPaginationChanged={(event) => {
                        const newPageSize = event.api.paginationGetPageSize();
                        if (newPageSize !== pageSize) {
                            onPageSizeChange(newPageSize);
                        }
                    }}
                />
            </div>
            {/* Total count indicator */}
            <div className="text-sm text-gray-500 text-right">
                Loaded {orders.length.toLocaleString()} of {totalCount.toLocaleString()} total archived orders
            </div>
        </div>
    );
}

export default ArchivedOrdersGrid;
