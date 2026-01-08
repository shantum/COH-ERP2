/**
 * OrdersGrid component
 * AG Grid implementation for orders with all column definitions and row styling
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
    ColDef,
    ICellRendererParams,
    RowStyle,
    ValueFormatterParams,
    ValueGetterParams,
    ValueSetterParams,
    CellClassParams,
    EditableCallbackParams,
} from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { Check, X, Pencil, Ban, Archive, Trash2, Undo2, Columns, RotateCcw, Package, Truck, CheckCircle, AlertCircle, RotateCw, Settings, Wrench } from 'lucide-react';
import { formatDateTime, DEFAULT_HEADERS } from '../../utils/orderHelpers';
import type { FlattenedOrderRow } from '../../utils/orderHelpers';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Custom compact theme based on Quartz
const compactTheme = themeQuartz.withParams({
    spacing: 4,
    fontSize: 12,
    headerFontSize: 12,
    rowHeight: 28,
    headerHeight: 32,
});

// Tracking status badge component (matches ShippedOrdersGrid)
function TrackingStatusBadge({ status, daysInTransit, ofdCount }: { status: string; daysInTransit?: number; ofdCount?: number }) {
    const configs: Record<string, { bg: string; text: string; label: string; icon: any }> = {
        in_transit: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Transit', icon: Package },
        manifested: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Manifested', icon: Package },
        out_for_delivery: { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'Out for Delivery', icon: Truck },
        delivered: { bg: 'bg-green-100', text: 'text-green-700', label: 'Delivered', icon: CheckCircle },
        delivery_delayed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Delayed', icon: AlertCircle },
        rto_initiated: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO', icon: RotateCw },
        rto_in_transit: { bg: 'bg-red-100', text: 'text-red-700', label: 'RTO Transit', icon: RotateCw },
        rto_received: { bg: 'bg-red-200', text: 'text-red-800', label: 'RTO Received', icon: RotateCw },
    };

    const config = configs[status] || configs.in_transit;
    const Icon = config.icon;

    // Warning indicators
    const isDelayed = daysInTransit && daysInTransit > 7;
    const hasMultipleOfd = ofdCount && ofdCount >= 2;

    return (
        <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
                <Icon size={10} />
                {config.label}
            </span>
            {isDelayed && !['delivered', 'rto_received'].includes(status) && (
                <span className="text-amber-500" title={`${daysInTransit} days in transit`}>⚠️</span>
            )}
            {hasMultipleOfd && (
                <span className="text-red-500 text-xs" title={`${ofdCount} delivery attempts`}>({ofdCount})</span>
            )}
        </div>
    );
}

// All column IDs in display order
const ALL_COLUMN_IDS = [
    'orderDate', 'orderAge', 'orderNumber', 'customerName', 'city', 'orderValue',
    'discountCode', 'paymentMethod', 'customerNotes', 'customerOrderCount',
    'customerLtv', 'skuCode', 'productName', 'customize', 'qty', 'skuStock', 'fabricBalance',
    'allocate', 'production', 'notes', 'pick', 'pack', 'ship', 'shopifyStatus',
    'awb', 'courier', 'trackingStatus', 'actions'
];

// Column visibility dropdown component
const ColumnVisibilityDropdown = ({
    visibleColumns,
    onToggleColumn,
    onResetAll,
    getHeaderName,
}: {
    visibleColumns: Set<string>;
    onToggleColumn: (colId: string) => void;
    onResetAll: () => void;
    getHeaderName: (colId: string) => string;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
                title="Show/hide columns"
            >
                <Columns size={14} />
                <span>Columns</span>
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px] max-h-[400px] overflow-y-auto">
                    <div className="p-2 border-b border-gray-100 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600">Columns</span>
                        <button
                            onClick={() => {
                                onResetAll();
                                setIsOpen(false);
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                            title="Reset visibility and order"
                        >
                            <RotateCcw size={10} />
                            Reset All
                        </button>
                    </div>
                    <div className="px-2 py-1 text-xs text-gray-400 border-b border-gray-100">
                        Drag column headers to reorder
                    </div>
                    <div className="p-1">
                        {ALL_COLUMN_IDS.map((colId) => (
                            <label
                                key={colId}
                                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={visibleColumns.has(colId)}
                                    onChange={() => onToggleColumn(colId)}
                                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-xs text-gray-700">{getHeaderName(colId)}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// Editable header component
const EditableHeader = (props: any) => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(props.displayName);

    const handleDoubleClick = () => setEditing(true);

    const handleBlur = () => {
        setEditing(false);
        if (value !== props.displayName) {
            props.setCustomHeader(props.column.colId, value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            setEditing(false);
            props.setCustomHeader(props.column.colId, value);
        } else if (e.key === 'Escape') {
            setEditing(false);
            setValue(props.displayName);
        }
    };

    if (editing) {
        return (
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full px-1 py-0 text-xs border rounded bg-white"
                style={{ minWidth: '30px' }}
            />
        );
    }

    return (
        <div
            onDoubleClick={handleDoubleClick}
            className="cursor-pointer truncate"
            title={`${props.displayName} (double-click to edit)`}
        >
            {props.displayName}
        </div>
    );
};

interface OrdersGridProps {
    rows: FlattenedOrderRow[];
    lockedDates: string[];
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    onPack: (lineId: string) => void;
    onUnpack: (lineId: string) => void;
    onShippingCheck: (lineId: string, order: any) => void;
    onQuickShip?: (orderId: string) => void;
    onCreateBatch: (data: any) => void;
    onUpdateBatch: (id: string, data: any) => void;
    onDeleteBatch: (id: string) => void;
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onViewOrder: (orderId: string) => void;
    onEditOrder: (order: any) => void;
    onCancelOrder: (id: string, reason?: string) => void;
    onArchiveOrder: (id: string) => void;
    onDeleteOrder: (id: string) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    onSelectCustomer: (customerId: string) => void;
    onCustomize?: (lineId: string, lineData: {
        lineId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        qty: number;
    }) => void;
    onEditCustomization?: (lineId: string, lineData: {
        lineId: string;
        skuCode: string;
        productName: string;
        colorName: string;
        size: string;
        qty: number;
        customizationType: string | null;
        customizationValue: string | null;
        customizationNotes: string | null;
    }) => void;
    onRemoveCustomization?: (lineId: string, skuCode: string) => void;
    allocatingLines: Set<string>;
    shippingChecked: Set<string>;
    isCancellingOrder: boolean;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isArchiving: boolean;
    isDeletingOrder: boolean;
}

export function OrdersGrid({
    rows,
    lockedDates,
    onAllocate,
    onUnallocate,
    onPick,
    onUnpick,
    onPack,
    onUnpack,
    onShippingCheck,
    onQuickShip,
    onCreateBatch,
    onUpdateBatch,
    onDeleteBatch,
    onUpdateLineNotes,
    onViewOrder,
    onEditOrder,
    onCancelOrder,
    onArchiveOrder,
    onDeleteOrder,
    onCancelLine,
    onUncancelLine,
    onSelectCustomer,
    onCustomize,
    onEditCustomization,
    onRemoveCustomization,
    allocatingLines,
    shippingChecked,
    isCancellingOrder,
    isCancellingLine,
    isUncancellingLine,
    isArchiving,
    isDeletingOrder,
}: OrdersGridProps) {
    // Grid ref for API access
    const gridRef = useRef<AgGridReact>(null);

    // Stable row ID function - prevents scroll reset on data updates
    const getRowId = useCallback((params: any) => {
        const row = params.data;
        // Use lineId if available (for order line rows), otherwise create unique key from orderId
        return row.lineId || `order-${row.orderId}-header`;
    }, []);

    // Custom headers state
    const [customHeaders, setCustomHeaders] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('ordersGridHeaders');
        return saved ? JSON.parse(saved) : {};
    });

    // Visible columns state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('ordersGridVisibleColumns');
        if (saved) {
            try {
                return new Set(JSON.parse(saved));
            } catch {
                return new Set(ALL_COLUMN_IDS);
            }
        }
        return new Set(ALL_COLUMN_IDS);
    });

    const setCustomHeader = useCallback((colId: string, headerName: string) => {
        setCustomHeaders((prev) => {
            const updated = { ...prev, [colId]: headerName };
            localStorage.setItem('ordersGridHeaders', JSON.stringify(updated));
            return updated;
        });
    }, []);

    const toggleColumnVisibility = useCallback((colId: string) => {
        setVisibleColumns((prev) => {
            const updated = new Set(prev);
            if (updated.has(colId)) {
                updated.delete(colId);
            } else {
                updated.add(colId);
            }
            localStorage.setItem('ordersGridVisibleColumns', JSON.stringify([...updated]));
            return updated;
        });
    }, []);

    const resetColumnVisibility = useCallback(() => {
        const allVisible = new Set(ALL_COLUMN_IDS);
        setVisibleColumns(allVisible);
        localStorage.removeItem('ordersGridVisibleColumns');
    }, []);

    const getHeaderName = useCallback(
        (colId: string) => customHeaders[colId] || DEFAULT_HEADERS[colId] || colId,
        [customHeaders]
    );

    const isDateLocked = (dateStr: string) => lockedDates?.includes(dateStr) || false;

    // Column definitions
    const columnDefs = useMemo<ColDef[]>(
        () => [
            {
                colId: 'orderDate',
                headerName: getHeaderName('orderDate'),
                field: 'orderDate',
                width: 130,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    const dt = formatDateTime(params.value);
                    return `${dt.date} ${dt.time}`;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'orderAge',
                headerName: getHeaderName('orderAge'),
                field: 'orderDate',
                width: 60,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine || !params.data?.orderDate) return null;
                    const orderDate = new Date(params.data.orderDate);
                    return Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (params.value === null) return null;
                    const days = params.value as number;
                    let colorClass = 'text-gray-500';
                    if (days > 5) colorClass = 'text-red-600 font-semibold';
                    else if (days >= 3) colorClass = 'text-amber-600 font-medium';
                    return <span className={`text-xs ${colorClass}`}>{days}d</span>;
                },
                sortable: true,
            },
            {
                colId: 'orderNumber',
                headerName: getHeaderName('orderNumber'),
                field: 'orderNumber',
                width: 110,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onViewOrder(params.data.order?.id);
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline font-mono text-xs"
                            title="View order details"
                        >
                            {params.value}
                        </button>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'customerName',
                headerName: getHeaderName('customerName'),
                field: 'customerName',
                width: 130,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    const customerId = order?.customerId;
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (customerId) onSelectCustomer(customerId);
                            }}
                            className={`text-left truncate max-w-full ${
                                customerId
                                    ? 'text-blue-600 hover:text-blue-800 hover:underline'
                                    : 'text-gray-700'
                            }`}
                            title={params.value}
                            disabled={!customerId}
                        >
                            {params.value}
                        </button>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'city',
                headerName: getHeaderName('city'),
                field: 'city',
                width: 80,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.value || '' : '',
                cellClass: 'text-xs text-gray-500',
            },
            {
                colId: 'orderValue',
                headerName: getHeaderName('orderValue'),
                width: 80,
                valueGetter: (params: ValueGetterParams) =>
                    params.data?.isFirstLine ? params.data.order?.totalAmount || 0 : null,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine || params.value === null) return '';
                    return `₹${Math.round(params.value).toLocaleString('en-IN')}`;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'discountCode',
                headerName: getHeaderName('discountCode'),
                width: 90,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    // Use shopifyCache first, fallback to order field for backward compatibility
                    return params.data.order?.shopifyCache?.discountCodes
                        || params.data.order?.discountCode || '';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const code = params.data.order?.shopifyCache?.discountCodes
                        || params.data.order?.discountCode;
                    if (!code) return null;
                    return (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700">
                            {code}
                        </span>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'paymentMethod',
                headerName: getHeaderName('paymentMethod'),
                width: 70,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    // Use shopifyCache first, fallback to order field for backward compatibility
                    return params.data.order?.shopifyCache?.paymentMethod
                        || params.data.order?.paymentMethod || '';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const method = params.data.order?.shopifyCache?.paymentMethod
                        || params.data.order?.paymentMethod || '';
                    if (!method) return null;
                    const isCod = method.toLowerCase().includes('cod');
                    return (
                        <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                                isCod ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                            }`}
                        >
                            {isCod ? 'COD' : 'Prepaid'}
                        </span>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'customerNotes',
                headerName: getHeaderName('customerNotes'),
                width: 180,
                autoHeight: true,
                wrapText: true,
                valueGetter: (params: ValueGetterParams) =>
                    params.data?.isFirstLine ? params.data.order?.customerNotes || '' : '',
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const notes = params.data.order?.customerNotes || '';
                    if (!notes) return null;
                    return (
                        <span className="text-xs text-purple-600 whitespace-pre-wrap break-words">
                            {notes}
                        </span>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'customerOrderCount',
                headerName: getHeaderName('customerOrderCount'),
                field: 'customerOrderCount',
                width: 40,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.value : '',
                cellClass: 'text-xs text-center text-gray-500',
                headerTooltip: 'Customer Order Count',
            },
            {
                colId: 'customerLtv',
                headerName: getHeaderName('customerLtv'),
                field: 'customerLtv',
                width: 75,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const orderCount = params.data.customerOrderCount || 0;
                    const ltv = params.data.customerLtv || 0;
                    const tier = params.data.order?.customerTier || 'bronze';

                    // First order customer
                    if (orderCount <= 1) {
                        return (
                            <span
                                className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700"
                                title={`First order - ₹${ltv.toLocaleString()}`}
                            >
                                1st
                            </span>
                        );
                    }

                    // Returning customer - show tier badge
                    const tierStyles: Record<string, string> = {
                        platinum: 'bg-purple-100 text-purple-700',
                        gold: 'bg-yellow-100 text-yellow-700',
                        silver: 'bg-gray-200 text-gray-700',
                        bronze: 'bg-orange-100 text-orange-700',
                    };

                    return (
                        <span
                            className={`px-1.5 py-0.5 rounded text-xs font-medium ${tierStyles[tier] || tierStyles.bronze}`}
                            title={`${tier.charAt(0).toUpperCase() + tier.slice(1)} - ₹${ltv.toLocaleString()} (${orderCount} orders)`}
                        >
                            {tier === 'platinum' ? '⭐' : ''}{`₹${(ltv / 1000).toFixed(0)}k`}
                        </span>
                    );
                },
                cellClass: 'text-xs',
                headerTooltip: 'Customer Lifetime Value',
            },
            {
                colId: 'skuCode',
                headerName: getHeaderName('skuCode'),
                field: 'skuCode',
                width: 100,
                cellClass: 'text-xs font-mono text-gray-500',
            },
            {
                colId: 'productName',
                headerName: getHeaderName('productName'),
                field: 'productName',
                flex: 1,
                minWidth: 180,
                valueFormatter: (params: ValueFormatterParams) =>
                    `${params.value} - ${params.data?.colorName} - ${params.data?.size}`,
                cellClass: 'text-xs',
            },
            {
                colId: 'customize',
                headerName: getHeaderName('customize'),
                width: 100,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row || !row.lineId) return null;

                    // Build tooltip text with customization details
                    const buildTooltip = () => {
                        const lines: string[] = [];
                        const typeLabels: Record<string, string> = {
                            length: 'Length Adjustment',
                            size: 'Size Modification',
                            measurements: 'Custom Measurements',
                            other: 'Other',
                        };
                        lines.push(`Type: ${typeLabels[row.customizationType] || row.customizationType || 'Unknown'}`);
                        lines.push(`Value: ${row.customizationValue || '-'}`);
                        if (row.customizationNotes) {
                            lines.push(`Notes: ${row.customizationNotes}`);
                        }
                        if (row.originalSkuCode) {
                            lines.push(`Original SKU: ${row.originalSkuCode}`);
                        }
                        return lines.join('\n');
                    };

                    // If customized and NOT pending (already allocated/picked/packed), show read-only badge
                    if (row.isCustomized && row.customSkuCode && row.lineStatus !== 'pending') {
                        return (
                            <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700"
                                title={buildTooltip()}
                            >
                                <Wrench size={10} />
                                {row.customSkuCode.split('-').pop()}
                            </span>
                        );
                    }

                    // If customized and pending, show badge with edit/remove actions
                    if (row.isCustomized && row.customSkuCode && row.lineStatus === 'pending') {
                        return (
                            <div className="flex items-center gap-1">
                                <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 cursor-help"
                                    title={buildTooltip()}
                                >
                                    <Wrench size={10} />
                                    {row.customSkuCode.split('-').pop()}
                                </span>
                                {/* Edit button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onEditCustomization) {
                                            onEditCustomization(row.lineId, {
                                                lineId: row.lineId,
                                                skuCode: row.skuCode,
                                                productName: row.productName,
                                                colorName: row.colorName,
                                                size: row.size,
                                                qty: row.qty,
                                                customizationType: row.customizationType,
                                                customizationValue: row.customizationValue,
                                                customizationNotes: row.customizationNotes,
                                            });
                                        }
                                    }}
                                    className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                                    title="Edit customization"
                                >
                                    <Pencil size={10} />
                                </button>
                                {/* Remove button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onRemoveCustomization) {
                                            onRemoveCustomization(row.lineId, row.customSkuCode);
                                        }
                                    }}
                                    className="p-0.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                                    title="Remove customization"
                                >
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        );
                    }

                    // Not customized and pending: show customize button
                    if (row.lineStatus === 'pending') {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onCustomize) {
                                        onCustomize(row.lineId, {
                                            lineId: row.lineId,
                                            skuCode: row.skuCode,
                                            productName: row.productName,
                                            colorName: row.colorName,
                                            size: row.size,
                                            qty: row.qty,
                                        });
                                    }
                                }}
                                className="p-1 rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50"
                                title="Add customization"
                            >
                                <Settings size={14} />
                            </button>
                        );
                    }

                    return null;
                },
                cellClass: 'text-center',
            },
            {
                colId: 'qty',
                headerName: getHeaderName('qty'),
                field: 'qty',
                width: 45,
                cellClass: 'text-xs text-center',
            },
            {
                colId: 'skuStock',
                headerName: getHeaderName('skuStock'),
                field: 'skuStock',
                width: 45,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    const stock = params.value ?? 0;
                    const hasStock = stock >= row?.qty;
                    // For customized lines with no stock, show "Custom" hint
                    if (row?.isCustomized && stock === 0) {
                        return (
                            <span className="text-gray-400" title="Custom item - requires production">
                                Custom
                            </span>
                        );
                    }
                    return (
                        <span className={hasStock ? 'text-green-600' : 'text-red-500'}>
                            {stock}
                        </span>
                    );
                },
                cellClass: 'text-xs text-center',
            },
            {
                colId: 'fabricBalance',
                headerName: getHeaderName('fabricBalance'),
                field: 'fabricBalance',
                width: 55,
                valueFormatter: (params: ValueFormatterParams) => `${params.value?.toFixed(0)}m`,
                cellClass: 'text-xs text-center text-gray-500',
            },
            {
                colId: 'allocate',
                headerName: getHeaderName('allocate'),
                width: 50,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row || row.lineStatus === 'cancelled') return null;

                    // For customized lines in pending state, show "Custom" indicator
                    const hasStock = row.skuStock >= row.qty;
                    const isAllocated =
                        row.lineStatus === 'allocated' ||
                        row.lineStatus === 'picked' ||
                        row.lineStatus === 'packed';
                    const isPending = row.lineStatus === 'pending';

                    // For customized items: show "C" badge only if pending AND no stock (production pending)
                    // If stock exists, allow normal allocation flow
                    if (row.isCustomized && isPending && !hasStock) {
                        return (
                            <span
                                className="text-xs text-orange-500 font-medium"
                                title="Custom item - waiting for production"
                            >
                                C
                            </span>
                        );
                    }

                    // Allow allocation for any pending line with stock (including customized)
                    const canAllocate = isPending && hasStock;
                    const isToggling = allocatingLines.has(row.lineId);

                    if (isAllocated) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (row.lineStatus === 'allocated') onUnallocate(row.lineId);
                                }}
                                disabled={isToggling || row.lineStatus !== 'allocated'}
                                className={`w-4 h-4 rounded flex items-center justify-center mx-auto ${
                                    row.lineStatus === 'allocated'
                                        ? 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                        : 'bg-green-100 text-green-600'
                                }`}
                                title={row.lineStatus === 'allocated' ? 'Unallocate' : row.lineStatus}
                            >
                                <Check size={10} />
                            </button>
                        );
                    }

                    // Show checkbox - active if can allocate, inactive otherwise
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (canAllocate) onAllocate(row.lineId);
                            }}
                            disabled={isToggling || !canAllocate}
                            className={`w-4 h-4 rounded border flex items-center justify-center mx-auto ${
                                canAllocate
                                    ? 'border-gray-300 hover:border-purple-400 hover:bg-purple-50 cursor-pointer'
                                    : 'border-gray-200 bg-gray-50 cursor-not-allowed'
                            }`}
                            title={canAllocate ? 'Allocate' : 'No stock available'}
                        >
                            {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                        </button>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'production',
                headerName: getHeaderName('production'),
                width: 120,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const hasStock = row.skuStock >= row.qty;
                    const allLinesAllocated = row.order?.orderLines?.every(
                        (line: any) =>
                            line.lineStatus === 'allocated' ||
                            line.lineStatus === 'picked' ||
                            line.lineStatus === 'packed'
                    );
                    const isAllocated =
                        row.lineStatus === 'allocated' ||
                        row.lineStatus === 'picked' ||
                        row.lineStatus === 'packed';

                    // For customized lines, always show production (must produce custom items)
                    // The condition is: pending + (has batch OR no stock OR is customized)
                    if (row.lineStatus === 'pending' && (row.productionBatchId || !hasStock || row.isCustomized)) {
                        if (row.productionBatchId) {
                            return (
                                <div className="flex items-center gap-0.5">
                                    <input
                                        type="date"
                                        className={`text-xs border rounded px-0.5 py-0 w-24 ${
                                            isDateLocked(row.productionDate || '')
                                                ? 'border-red-200 bg-red-50'
                                                : 'border-orange-200 bg-orange-50'
                                        }`}
                                        value={row.productionDate || ''}
                                        min={new Date().toISOString().split('T')[0]}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                            if (!e.target.value) {
                                                // Clear date - delete the batch
                                                onDeleteBatch(row.productionBatchId);
                                                return;
                                            }
                                            if (isDateLocked(e.target.value)) {
                                                alert(`Production date ${e.target.value} is locked.`);
                                                return;
                                            }
                                            onUpdateBatch(row.productionBatchId, {
                                                batchDate: e.target.value,
                                            });
                                        }}
                                    />
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteBatch(row.productionBatchId);
                                        }}
                                        className="text-gray-400 hover:text-red-500"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            );
                        }
                        return (
                            <input
                                type="date"
                                className="text-xs border border-gray-200 rounded px-0.5 py-0 w-24 text-gray-400 hover:border-orange-300"
                                min={new Date().toISOString().split('T')[0]}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                    if (e.target.value) {
                                        if (isDateLocked(e.target.value)) {
                                            alert(`Date ${e.target.value} is locked.`);
                                            e.target.value = '';
                                            return;
                                        }
                                        onCreateBatch({
                                            skuId: row.skuId,
                                            qtyPlanned: row.qty,
                                            priority: 'order_fulfillment',
                                            sourceOrderLineId: row.lineId,
                                            batchDate: e.target.value,
                                            notes: `For ${row.orderNumber}`,
                                        });
                                    }
                                }}
                            />
                        );
                    } else if (allLinesAllocated) {
                        return <span className="text-green-700 font-medium text-xs">ready</span>;
                    } else if (isAllocated) {
                        return <span className="text-green-600 text-xs">alloc</span>;
                    } else if (hasStock) {
                        return <span className="text-gray-300">-</span>;
                    }
                    return null;
                },
            },
            {
                colId: 'notes',
                headerName: getHeaderName('notes'),
                width: 120,
                editable: (params: EditableCallbackParams) => !!params.data?.lineId,
                valueGetter: (params: ValueGetterParams) => params.data?.lineNotes || '',
                valueSetter: (params: ValueSetterParams) => {
                    if (params.data?.lineId) {
                        onUpdateLineNotes(params.data.lineId, params.newValue || '');
                    }
                    return true;
                },
                cellClass: (params: CellClassParams) => {
                    return params.data?.lineNotes
                        ? 'text-xs text-yellow-700 bg-yellow-50'
                        : 'text-xs text-gray-400';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row?.lineId) return null;
                    const notes = row.lineNotes || '';
                    if (!notes)
                        return <span className="text-gray-300 italic">click to add</span>;
                    return (
                        <span title={notes}>
                            {notes.length > 15 ? notes.substring(0, 15) + '...' : notes}
                        </span>
                    );
                },
            },
            {
                colId: 'pick',
                headerName: getHeaderName('pick'),
                width: 35,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row || row.lineStatus === 'cancelled') return null;
                    const isToggling = allocatingLines.has(row.lineId);
                    const canPick = row.lineStatus === 'allocated';
                    const isPicked = row.lineStatus === 'picked' || row.lineStatus === 'packed';

                    if (isPicked) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (row.lineStatus === 'picked') onUnpick(row.lineId);
                                }}
                                disabled={isToggling || row.lineStatus !== 'picked'}
                                className={`w-4 h-4 rounded flex items-center justify-center mx-auto ${
                                    row.lineStatus === 'picked'
                                        ? 'bg-green-500 text-white hover:bg-green-600'
                                        : 'bg-green-500 text-white'
                                }`}
                                title={row.lineStatus === 'picked' ? 'Unpick' : 'Packed'}
                            >
                                <Check size={10} />
                            </button>
                        );
                    }

                    // Show checkbox - active if allocated, inactive otherwise
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (canPick) onPick(row.lineId);
                            }}
                            disabled={isToggling || !canPick}
                            className={`w-4 h-4 rounded border flex items-center justify-center mx-auto ${
                                canPick
                                    ? 'border-gray-300 hover:border-green-400 hover:bg-green-50 cursor-pointer'
                                    : 'border-gray-200 bg-gray-50 cursor-not-allowed'
                            }`}
                            title={canPick ? 'Pick' : 'Not allocated yet'}
                        >
                            {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                        </button>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'pack',
                headerName: getHeaderName('pack'),
                width: 35,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row || row.lineStatus === 'cancelled') return null;
                    const isToggling = allocatingLines.has(row.lineId);
                    const canPack = row.lineStatus === 'picked';
                    const isPacked = row.lineStatus === 'packed';

                    if (isPacked) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onUnpack(row.lineId);
                                }}
                                disabled={isToggling}
                                className="w-4 h-4 rounded flex items-center justify-center mx-auto bg-blue-500 text-white hover:bg-blue-600"
                                title="Unpack"
                            >
                                <Check size={10} />
                            </button>
                        );
                    }

                    // Show checkbox - active if picked, inactive otherwise
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (canPack) onPack(row.lineId);
                            }}
                            disabled={isToggling || !canPack}
                            className={`w-4 h-4 rounded border flex items-center justify-center mx-auto ${
                                canPack
                                    ? 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
                                    : 'border-gray-200 bg-gray-50 cursor-not-allowed'
                            }`}
                            title={canPack ? 'Pack' : 'Not picked yet'}
                        >
                            {isToggling ? <span className="animate-spin text-xs">·</span> : null}
                        </button>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'ship',
                headerName: getHeaderName('ship'),
                width: 35,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row || row.lineStatus === 'cancelled') return null;

                    const activeLines = row.order?.orderLines?.filter(
                        (line: any) => line.lineStatus !== 'cancelled'
                    ) || [];
                    const allLinesPicked = activeLines.length > 0 && activeLines.every(
                        (line: any) => line.lineStatus === 'picked' || line.lineStatus === 'packed'
                    );
                    const allLinesAllocated = activeLines.length > 0 && activeLines.every(
                        (line: any) =>
                            line.lineStatus === 'allocated' ||
                            line.lineStatus === 'picked' ||
                            line.lineStatus === 'packed'
                    );
                    const isChecked = shippingChecked.has(row.lineId);

                    // Show checkbox - active only if all lines are picked
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (allLinesPicked) onShippingCheck(row.lineId, row.order);
                            }}
                            disabled={!allLinesPicked}
                            className={`w-4 h-4 rounded border flex items-center justify-center mx-auto ${
                                isChecked
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : allLinesPicked
                                        ? 'border-gray-300 hover:border-green-400 hover:bg-green-50 cursor-pointer'
                                        : 'border-gray-200 bg-gray-50 cursor-not-allowed'
                            }`}
                            title={allLinesPicked ? 'Mark for shipping' : allLinesAllocated ? 'Pick all items first' : 'Allocate all items first'}
                        >
                            {isChecked && <Check size={10} />}
                        </button>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'shopifyStatus',
                headerName: getHeaderName('shopifyStatus'),
                width: 80,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    // Use shopifyCache first, fallback to order field for backward compatibility
                    const status = params.data.order?.shopifyCache?.fulfillmentStatus
                        || params.data.order?.shopifyFulfillmentStatus;
                    if (!status || status === '-') return null;

                    const statusStyles: Record<string, string> = {
                        fulfilled: 'bg-green-100 text-green-700',
                        partial: 'bg-yellow-100 text-yellow-700',
                        unfulfilled: 'bg-gray-100 text-gray-600',
                        null: 'bg-gray-100 text-gray-500',
                    };

                    const displayStatus = status?.toLowerCase() || 'unfulfilled';
                    const style = statusStyles[displayStatus] || statusStyles.unfulfilled;

                    return (
                        <span className={`px-1.5 py-0.5 rounded text-xs ${style}`}>
                            {displayStatus}
                        </span>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'awb',
                headerName: getHeaderName('awb'),
                field: 'order.awbNumber',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.data.order?.awbNumber || '' : '',
                cellClass: 'text-xs font-mono text-gray-500',
            },
            {
                colId: 'courier',
                headerName: getHeaderName('courier'),
                field: 'order.courier',
                width: 80,
                valueFormatter: (params: ValueFormatterParams) =>
                    params.data?.isFirstLine ? params.data.order?.courier || '' : '',
                cellClass: 'text-xs text-blue-600',
            },
            {
                colId: 'trackingStatus',
                headerName: getHeaderName('trackingStatus'),
                width: 110,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    // Only show iThink status if we have actual iThink data
                    const hasIThinkData = order?.courierStatusCode || order?.lastScanAt || order?.lastTrackingUpdate;
                    if (!hasIThinkData) {
                        return <span className="text-gray-400 text-xs">-</span>;
                    }
                    return (
                        <TrackingStatusBadge
                            status={order?.trackingStatus || 'in_transit'}
                            daysInTransit={order?.daysInTransit}
                            ofdCount={order?.deliveryAttempts}
                        />
                    );
                },
            },
            {
                colId: 'actions',
                headerName: getHeaderName('actions'),
                width: 100,
                sortable: false,
                resizable: false,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const order = row.order;
                    const isCancelledLine = row.lineStatus === 'cancelled';
                    const hasLineId = row.lineId != null;

                    const lineAction = hasLineId ? (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isCancelledLine) {
                                    onUncancelLine(row.lineId);
                                } else if (
                                    confirm(
                                        `Cancel this line item?\n\n${row.productName} - ${row.skuCode}`
                                    )
                                ) {
                                    onCancelLine(row.lineId);
                                }
                            }}
                            disabled={isCancellingLine || isUncancellingLine}
                            className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
                                isCancelledLine
                                    ? 'text-green-500 hover:text-green-600 hover:bg-green-50'
                                    : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                            }`}
                            title={isCancelledLine ? 'Restore line' : 'Cancel line'}
                        >
                            {isCancelledLine ? <Undo2 size={13} /> : <X size={13} />}
                        </button>
                    ) : null;

                    if (!row.isFirstLine) {
                        return <div className="flex items-center justify-end">{lineAction}</div>;
                    }

                    return (
                        <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEditOrder(order);
                                }}
                                className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Edit order"
                            >
                                <Pencil size={13} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const reason = prompt(
                                        `Cancel order ${order.orderNumber}?\n\nEnter cancellation reason (optional):`
                                    );
                                    if (reason !== null) {
                                        onCancelOrder(order.id, reason || undefined);
                                    }
                                }}
                                disabled={isCancellingOrder}
                                className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                title="Cancel order"
                            >
                                <Ban size={13} />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (
                                        confirm(
                                            `Archive order ${order.orderNumber}?\n\nThis will hide it from the open orders list.`
                                        )
                                    ) {
                                        onArchiveOrder(order.id);
                                    }
                                }}
                                disabled={isArchiving}
                                className="p-1.5 rounded-md hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-50"
                                title="Archive order"
                            >
                                <Archive size={13} />
                            </button>
                            {onQuickShip && order.awbNumber && order.courier && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (
                                            confirm(
                                                `Quick Ship order ${order.orderNumber}?\n\nThis will bypass allocate/pick/pack and mark as shipped directly.`
                                            )
                                        ) {
                                            onQuickShip(order.id);
                                        }
                                    }}
                                    className="p-1.5 rounded-md hover:bg-green-50 text-green-500 hover:text-green-600 transition-colors"
                                    title="Quick Ship (bypass workflow)"
                                >
                                    <Truck size={13} />
                                </button>
                            )}
                            {row.totalLines === 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (
                                            confirm(
                                                `DELETE order ${order.orderNumber}?\n\nThis will permanently remove it from the database.`
                                            )
                                        ) {
                                            onDeleteOrder(order.id);
                                        }
                                    }}
                                    disabled={isDeletingOrder}
                                    className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                    title="Delete order (permanently)"
                                >
                                    <Trash2 size={13} />
                                </button>
                            )}
                            {lineAction}
                        </div>
                    );
                },
            },
        ].map(col => ({
            ...col,
            hide: !visibleColumns.has(col.colId!),
        })),
        [
            allocatingLines,
            shippingChecked,
            lockedDates,
            getHeaderName,
            isCancellingOrder,
            isCancellingLine,
            isUncancellingLine,
            isArchiving,
            isDeletingOrder,
            visibleColumns,
            onCustomize,
            onEditCustomization,
            onRemoveCustomization,
        ]
    );

    // Column order state
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem('ordersGridColumnOrder');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return ALL_COLUMN_IDS;
            }
        }
        return ALL_COLUMN_IDS;
    });

    const handleColumnMoved = useCallback((event: any) => {
        if (!event.finished || !event.api) return;
        const newOrder = event.api.getAllDisplayedColumns()
            .map((col: any) => col.getColId())
            .filter((id: string) => ALL_COLUMN_IDS.includes(id));
        setColumnOrder(newOrder);
        localStorage.setItem('ordersGridColumnOrder', JSON.stringify(newOrder));
    }, []);

    const resetColumnOrder = useCallback(() => {
        setColumnOrder(ALL_COLUMN_IDS);
        localStorage.removeItem('ordersGridColumnOrder');
    }, []);

    // Sort column defs by saved order
    const orderedColumnDefs = useMemo(() => {
        const colDefMap = new Map(columnDefs.map(col => [col.colId, col]));
        const ordered: ColDef[] = [];

        // Add columns in saved order
        columnOrder.forEach(colId => {
            const col = colDefMap.get(colId);
            if (col) {
                ordered.push(col);
                colDefMap.delete(colId);
            }
        });

        // Add any remaining columns (new columns not in saved order)
        colDefMap.forEach(col => ordered.push(col));

        return ordered;
    }, [columnDefs, columnOrder]);

    const defaultColDef = useMemo<ColDef>(
        () => ({
            sortable: true,
            resizable: true,
            suppressMovable: false, // Allow column dragging
            headerComponent: EditableHeader,
            headerComponentParams: { setCustomHeader },
        }),
        [setCustomHeader]
    );

    const resetHeaders = useCallback(() => {
        setCustomHeaders({});
        localStorage.removeItem('ordersGridHeaders');
    }, []);

    const getRowStyle = useCallback((params: any): RowStyle | undefined => {
        const row = params.data;
        if (!row) return undefined;

        if (row.lineStatus === 'cancelled') {
            return { backgroundColor: '#f3f4f6', color: '#9ca3af', textDecoration: 'line-through' };
        }

        // Customized lines get special orange styling with left border
        if (row.isCustomized) {
            return {
                backgroundColor: '#fff7ed',  // Orange-50
                borderLeft: '3px solid #f97316',  // Orange-500
            };
        }

        const activeLines =
            row.order?.orderLines?.filter((line: any) => line.lineStatus !== 'cancelled') || [];
        const allLinesAllocated =
            activeLines.length > 0 &&
            activeLines.every(
                (line: any) =>
                    line.lineStatus === 'allocated' ||
                    line.lineStatus === 'picked' ||
                    line.lineStatus === 'packed'
            );
        const hasStock = row.skuStock >= row.qty;
        const isAllocated =
            row.lineStatus === 'allocated' ||
            row.lineStatus === 'picked' ||
            row.lineStatus === 'packed';
        const isPending = row.lineStatus === 'pending';
        const hasProductionDate = !!row.productionBatchId;

        if (row.lineStatus === 'packed') return { backgroundColor: '#f0fdf4' };
        if (row.lineStatus === 'picked') return { backgroundColor: '#ecfdf5' };
        if (allLinesAllocated) return { backgroundColor: '#bbf7d0' };
        if (isAllocated) return { backgroundColor: '#dcfce7' };
        if (hasStock && isPending) return { backgroundColor: '#f0fdf4' };
        if (hasProductionDate) return { backgroundColor: '#fffbeb' };
        return undefined;
    }, []);

    // Add class for non-first lines to hide row separator, and urgency classes
    const getRowClass = useCallback((params: any): string => {
        const row = params.data;
        if (!row) return '';

        const classes = [row.isFirstLine ? 'order-first-line' : 'order-continuation-line'];

        // Calculate order age for urgency indicator (only on first line to avoid repetition)
        if (row.isFirstLine && row.orderDate) {
            const orderDate = new Date(row.orderDate);
            const daysOld = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysOld > 5) {
                classes.push('order-urgent');
            } else if (daysOld >= 3) {
                classes.push('order-warning');
            }
        }

        return classes.join(' ');
    }, []);

    return {
        gridComponent: (
            <>
                <style>{`
                    /* Hide all row bottom borders by default */
                    .ag-row {
                        border-bottom-color: transparent !important;
                    }
                    /* Show border only on first line of each order */
                    .ag-row.order-first-line {
                        border-top: 1px solid #e5e7eb !important;
                    }
                    /* First row in grid doesn't need top border */
                    .ag-row.order-first-line[row-index="0"] {
                        border-top-color: transparent !important;
                    }
                    /* Order age urgency indicators - red left border for orders > 5 days */
                    .ag-row.order-urgent {
                        border-left: 4px solid #ef4444 !important;
                    }
                    /* Amber left border for orders 3-5 days */
                    .ag-row.order-warning {
                        border-left: 4px solid #f59e0b !important;
                    }
                `}</style>
                <div className="border rounded" style={{ height: '600px', width: '100%' }}>
                    <AgGridReact
                        ref={gridRef}
                        rowData={rows}
                        columnDefs={orderedColumnDefs}
                        defaultColDef={defaultColDef}
                        getRowId={getRowId}
                        getRowStyle={getRowStyle}
                        getRowClass={getRowClass}
                        theme={compactTheme}
                        rowSelection={{
                            mode: 'multiRow',
                            checkboxes: true,
                            headerCheckbox: true,
                            enableClickSelection: true,
                        }}
                        enableCellTextSelection={true}
                        ensureDomOrder={true}
                        suppressRowClickSelection={false}
                        suppressRowHoverHighlight={false}
                        onColumnMoved={handleColumnMoved}
                        maintainColumnOrder={true}
                    />
                </div>
            </>
        ),
        columnVisibilityDropdown: (
            <ColumnVisibilityDropdown
                visibleColumns={visibleColumns}
                onToggleColumn={toggleColumnVisibility}
                onResetAll={() => {
                    resetColumnVisibility();
                    resetColumnOrder();
                }}
                getHeaderName={getHeaderName}
            />
        ),
        customHeaders,
        resetHeaders,
        resetColumnOrder,
    };
}

export default OrdersGrid;
