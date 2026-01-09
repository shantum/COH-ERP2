/**
 * CancelledOrdersGrid component
 * AG Grid implementation for cancelled orders
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Undo2, Eye, ExternalLink, Columns, RotateCcw, XCircle } from 'lucide-react';
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

// All column IDs for persistence
const ALL_COLUMN_IDS = [
    'orderNumber', 'customerName', 'city', 'items', 'totalAmount',
    'paymentMethod', 'channel', 'orderDate', 'actions'
];

const DEFAULT_HEADERS: Record<string, string> = {
    orderNumber: 'Order', customerName: 'Customer', city: 'City', items: 'Items',
    totalAmount: 'Total', paymentMethod: 'Payment', channel: 'Channel',
    orderDate: 'Order Date', actions: 'Actions'
};

// Column visibility dropdown
const ColumnVisibilityDropdown = ({
    visibleColumns, onToggleColumn, onResetAll,
}: { visibleColumns: Set<string>; onToggleColumn: (colId: string) => void; onResetAll: () => void; }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div ref={dropdownRef} className="relative">
            <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1 text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50">
                <Columns size={12} /> Columns
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                    <div className="p-2 border-b">
                        <button onClick={onResetAll} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                            <RotateCcw size={10} /> Reset All
                        </button>
                    </div>
                    <div className="p-2 space-y-1">
                        {ALL_COLUMN_IDS.filter(id => id !== 'actions').map(colId => (
                            <label key={colId} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                                <input type="checkbox" checked={visibleColumns.has(colId)} onChange={() => onToggleColumn(colId)} className="w-3 h-3" />
                                {DEFAULT_HEADERS[colId] || colId}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

interface CancelledOrdersGridProps {
    orders: any[];
    onViewOrder?: (order: any) => void;
    onSelectCustomer?: (customer: any) => void;
    onRestore?: (orderId: string) => void;
    isRestoring?: boolean;
    shopDomain?: string;
}

// Helper to format date
function formatDate(date: string | null | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
    });
}

// Line status badge component
function LineStatusBadge({ status }: { status: string }) {
    const configs: Record<string, { bg: string; text: string }> = {
        cancelled: { bg: 'bg-red-100', text: 'text-red-700' },
        pending: { bg: 'bg-gray-100', text: 'text-gray-600' },
        allocated: { bg: 'bg-blue-100', text: 'text-blue-700' },
        picked: { bg: 'bg-purple-100', text: 'text-purple-700' },
        packed: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
        shipped: { bg: 'bg-green-100', text: 'text-green-700' },
    };
    const config = configs[status] || configs.pending;

    return (
        <span className={`text-xs px-1 py-0.5 rounded ${config.bg} ${config.text}`}>
            {status}
        </span>
    );
}

export function CancelledOrdersGrid({
    orders,
    onViewOrder,
    onSelectCustomer,
    onRestore,
    isRestoring,
    shopDomain,
}: CancelledOrdersGridProps) {
    const gridRef = useRef<AgGridReact>(null);

    // Column visibility state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('cancelledGridVisibleColumns');
        if (saved) { try { return new Set(JSON.parse(saved)); } catch { return new Set(ALL_COLUMN_IDS); } }
        return new Set(ALL_COLUMN_IDS);
    });

    // Column order state
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('cancelledGridColumnOrder');
        if (saved) { try { return JSON.parse(saved); } catch { return ALL_COLUMN_IDS; } }
        return ALL_COLUMN_IDS;
    });

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('cancelledGridColumnWidths');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    });

    useEffect(() => { localStorage.setItem('cancelledGridVisibleColumns', JSON.stringify([...visibleColumns])); }, [visibleColumns]);
    useEffect(() => { localStorage.setItem('cancelledGridColumnOrder', JSON.stringify(columnOrder)); }, [columnOrder]);
    useEffect(() => { localStorage.setItem('cancelledGridColumnWidths', JSON.stringify(columnWidths)); }, [columnWidths]);

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
        if (event.finished && event.column) {
            const colId = event.column.getColId();
            const width = event.column.getActualWidth();
            if (colId && width) {
                setColumnWidths(prev => ({ ...prev, [colId]: width }));
            }
        }
    }, []);

    const handleResetAll = useCallback(() => {
        setVisibleColumns(new Set(ALL_COLUMN_IDS));
        setColumnOrder([...ALL_COLUMN_IDS]);
        setColumnWidths({});
        localStorage.removeItem('cancelledGridColumnWidths');
    }, []);

    // Transform orders for grid
    const rowData = useMemo(() => {
        return orders.map((order) => ({
            ...order,
            city: parseCity(order.shippingAddress),
            itemCount: order.orderLines?.length || 0,
            // Build item summary with line statuses
            itemDetails: order.orderLines?.map((l: any) => ({
                name: l.sku?.variation?.product?.name || 'Unknown',
                size: l.sku?.size || '-',
                qty: l.qty,
                status: l.lineStatus,
            })) || [],
        }));
    }, [orders]);

    const columnDefs = useMemo<ColDef[]>(() => [
        {
            field: 'orderNumber',
            headerName: 'Order',
            width: 90,
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onViewOrder?.(order)}
                            className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                            {params.value}
                        </button>
                        <XCircle size={12} className="text-red-400" title="Cancelled" />
                    </div>
                );
            },
        },
        {
            field: 'customerName',
            headerName: 'Customer',
            width: 140,
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
                            {params.value || '-'}
                        </button>
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
            field: 'items',
            headerName: 'Items',
            width: 220,
            cellRenderer: (params: ICellRendererParams) => {
                const details = params.data?.itemDetails || [];
                if (details.length === 0) return <span className="text-gray-400">-</span>;

                return (
                    <div className="flex flex-wrap gap-1">
                        {details.slice(0, 3).map((item: any, idx: number) => (
                            <span key={idx} className="flex items-center gap-1 text-xs">
                                <span className="truncate max-w-[100px]" title={item.name}>
                                    {item.name}
                                </span>
                                <span className="text-gray-400">({item.size})</span>
                                <span className="text-gray-500">×{item.qty}</span>
                                <LineStatusBadge status={item.status} />
                            </span>
                        ))}
                        {details.length > 3 && (
                            <span className="text-xs text-gray-400">+{details.length - 3} more</span>
                        )}
                    </div>
                );
            },
        },
        {
            field: 'totalAmount',
            headerName: 'Total',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value ? `₹${Number(params.value).toLocaleString()}` : '₹0',
        },
        {
            field: 'paymentMethod',
            headerName: 'Payment',
            width: 75,
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
            field: 'channel',
            headerName: 'Channel',
            width: 75,
            cellRenderer: (params: ICellRendererParams) => {
                const channel = params.value;
                if (!channel) return <span className="text-gray-400">-</span>;
                const isShopify = channel === 'shopify';
                return (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                        isShopify ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                        {channel}
                    </span>
                );
            },
        },
        {
            field: 'orderDate',
            headerName: 'Order Date',
            width: 90,
            sort: 'desc' as const,
            cellRenderer: (params: ICellRendererParams) => (
                <span className="text-xs text-gray-600">{formatDate(params.value)}</span>
            ),
        },
        {
            colId: 'actions',
            headerName: 'Actions',
            width: 100,
            sortable: false,
            pinned: 'right',
            cellRenderer: (params: ICellRendererParams) => {
                const order = params.data;
                if (!order) return null;

                return (
                    <div className="flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => onViewOrder?.(order)}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            title="View order"
                        >
                            <Eye size={14} />
                        </button>
                        <button
                            onClick={() => {
                                if (confirm(`Restore order ${order.orderNumber}?`)) {
                                    onRestore?.(order.id);
                                }
                            }}
                            disabled={isRestoring}
                            className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                            title="Restore order"
                        >
                            <Undo2 size={14} />
                        </button>
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
    ], [onViewOrder, onSelectCustomer, onRestore, isRestoring, shopDomain]);

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

    if (!orders?.length) {
        return (
            <div className="text-center text-gray-400 py-12 border rounded">
                No cancelled orders
            </div>
        );
    }

    return (
        <div className="border rounded" style={{ height: '500px', width: '100%' }}>
            <div className="flex justify-between items-center p-2 border-b bg-gray-50">
                <span className="text-xs text-gray-500">
                    {orders.length} cancelled order{orders.length !== 1 ? 's' : ''}
                </span>
                <ColumnVisibilityDropdown
                    visibleColumns={visibleColumns}
                    onToggleColumn={handleToggleColumn}
                    onResetAll={handleResetAll}
                />
            </div>
            <div style={{ height: 'calc(100% - 40px)' }}>
                <AgGridReact
                    ref={gridRef}
                    rowData={rowData}
                    columnDefs={processedColumnDefs}
                    defaultColDef={defaultColDef}
                    theme={compactTheme}
                    animateRows={true}
                    onColumnMoved={handleColumnMoved}
                    onColumnResized={handleColumnResized}
                    maintainColumnOrder={true}
                />
            </div>
        </div>
    );
}

export default CancelledOrdersGrid;
