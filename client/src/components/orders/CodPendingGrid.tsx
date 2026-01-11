/**
 * CodPendingGrid component
 * AG Grid implementation for COD orders awaiting payment
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Clock, AlertTriangle, CheckCircle, ExternalLink, Radio, Eye } from 'lucide-react';
import { parseCity } from '../../utils/orderHelpers';
import { compactTheme, formatDateTime, getTrackingUrl } from '../../utils/agGridHelpers';
import { ColumnVisibilityDropdown } from '../common/grid/ColumnVisibilityDropdown';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// All column IDs for persistence
const ALL_COLUMN_IDS = [
    'orderNumber', 'customerName', 'city', 'itemCount', 'totalAmount',
    'courier', 'awbNumber', 'deliveredAt', 'daysSinceDelivery', 'shippedAt', 'actions'
];

const DEFAULT_HEADERS: Record<string, string> = {
    orderNumber: 'Order', customerName: 'Customer', city: 'City', itemCount: 'Items',
    totalAmount: 'COD Amount', courier: 'Courier', awbNumber: 'AWB', deliveredAt: 'Delivered',
    daysSinceDelivery: 'Waiting', shippedAt: 'Shipped', actions: 'Actions'
};

interface CodPendingGridProps {
    orders: any[];
    onViewOrder?: (order: any) => void;
    onSelectCustomer?: (customer: any) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;
    shopDomain?: string;
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
    const gridRef = useRef<AgGridReact>(null);

    // Column visibility state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('codPendingGridVisibleColumns');
        if (saved) { try { return new Set(JSON.parse(saved)); } catch { return new Set(ALL_COLUMN_IDS); } }
        return new Set(ALL_COLUMN_IDS);
    });

    // Column order state
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('codPendingGridColumnOrder');
        if (saved) { try { return JSON.parse(saved); } catch { return ALL_COLUMN_IDS; } }
        return ALL_COLUMN_IDS;
    });

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('codPendingGridColumnWidths');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    });

    useEffect(() => { localStorage.setItem('codPendingGridVisibleColumns', JSON.stringify([...visibleColumns])); }, [visibleColumns]);
    useEffect(() => { localStorage.setItem('codPendingGridColumnOrder', JSON.stringify(columnOrder)); }, [columnOrder]);
    useEffect(() => { localStorage.setItem('codPendingGridColumnWidths', JSON.stringify(columnWidths)); }, [columnWidths]);

    const handleToggleColumn = useCallback((colId: string) => {
        setVisibleColumns(prev => { const next = new Set(prev); if (next.has(colId)) next.delete(colId); else next.add(colId); return next; });
    }, []);

    const handleColumnMoved = useCallback(() => {
        const api = gridRef.current?.api;
        if (!api) return;
        const newOrder = api.getAllDisplayedColumns().map(col => col.getColId()).filter((id): id is string => id !== undefined);
        if (newOrder.length > 0) setColumnOrder(newOrder);
    }, []);

    const handleColumnResized = useCallback((event: any) => {
        if (event.finished && event.columns?.length) {
            event.columns.forEach((col: any) => {
                const colId = col.getColId();
                const width = col.getActualWidth();
                if (colId && width) {
                    setColumnWidths(prev => ({ ...prev, [colId]: width }));
                }
            });
        }
    }, []);

    const handleResetAll = useCallback(() => {
        setVisibleColumns(new Set(ALL_COLUMN_IDS));
        setColumnOrder([...ALL_COLUMN_IDS]);
        setColumnWidths({});
        localStorage.removeItem('codPendingGridColumnWidths');
    }, []);

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
            width: 100,
            sort: 'desc' as const,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs text-gray-600">{formatDateTime(params.value)}</span>
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
        },
        {
            field: 'shippedAt',
            headerName: 'Shipped',
            width: 100,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs text-gray-500">{formatDateTime(params.value)}</span>
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

    // Apply visibility and order to columns
    const processedColumnDefs = useMemo(() => {
        // First apply visibility
        const visibleDefs = columnDefs.map(col => {
            const colId = col.colId || (col as any).field;
            return { ...col, hide: colId ? !visibleColumns.has(colId) : false };
        });
        // Then apply ordering and saved widths
        const colMap = new Map(visibleDefs.map(col => [col.colId || (col as any).field, col]));
        const ordered: ColDef[] = [];
        for (const colId of columnOrder) {
            const col = colMap.get(colId);
            if (col) {
                const savedWidth = columnWidths[colId];
                ordered.push(savedWidth ? { ...col, width: savedWidth } : col);
                colMap.delete(colId);
            }
        }
        for (const col of colMap.values()) {
            const colId = col.colId || (col as any).field;
            const savedWidth = colId ? columnWidths[colId] : undefined;
            ordered.push(savedWidth ? { ...col, width: savedWidth } : col);
        }
        return ordered;
    }, [columnDefs, visibleColumns, columnOrder, columnWidths]);

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
            <div className="flex justify-end p-2 border-b bg-gray-50">
                <ColumnVisibilityDropdown
                    visibleColumns={visibleColumns}
                    onToggleColumn={handleToggleColumn}
                    onResetAll={handleResetAll}
                    columnIds={ALL_COLUMN_IDS}
                    columnHeaders={DEFAULT_HEADERS}
                />
            </div>
            <div style={{ height: 'calc(100% - 40px)' }}>
                <AgGridReact
                    ref={gridRef}
                    rowData={rowData}
                    columnDefs={processedColumnDefs}
                    defaultColDef={defaultColDef}
                    theme={compactTheme}
                    getRowStyle={getRowStyle}
                    animateRows={true}
                    onColumnMoved={handleColumnMoved}
                    onColumnResized={handleColumnResized}
                    maintainColumnOrder={true}
                />
            </div>
        </div>
    );
}

export default CodPendingGrid;
