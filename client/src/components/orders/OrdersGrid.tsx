/**
 * OrdersGrid Component
 * AG-Grid spreadsheet UI for orders with 30+ columns, inline editing, and status tracking
 *
 * COLUMN ORGANIZATION (by responsibility):
 * - Order Info: orderDate, orderAge, shipByDate, orderNumber, customerName, city, orderValue
 * - Payment: discountCode, paymentMethod, customerNotes, customerOrderCount, customerLtv
 * - Line Items: skuCode, productName, customize, qty, skuStock, fabricBalance
 * - Fulfillment Actions: allocate, production, notes, pick, pack, ship, trackingStatus
 * - Tracking: shopifyStatus, shopifyAwb, shopifyCourier, awb, courier
 * - Management: cancelLine column for cancel/uncancel
 *
 * KEY HELPER FUNCTIONS:
 * - TrackingStatusBadge: Color-coded shipment status (in_transit, delivered, rto, etc.)
 * - ProductionDatePopover: Calendar picker for batch production scheduling
 * - ColumnVisibilityDropdown: Toggle/reorder columns with localStorage persistence
 * - StatusLegend: Visual guide to row colors (pending, allocated, packed, etc.)
 *
 * ROW STYLING:
 * - Each row = one order line with order-level header row
 * - isFirstLine distinguishes header (aggregated order info) vs continuation (line items)
 * - Color-coded by lineStatus: green=shipped, blue=packed, teal=picked, etc.
 * - Border left indicators for urgency (red >5 days, amber 3-5 days)
 * - Struck-through for cancelled lines
 *
 * STATE PERSISTENCE:
 * - Column visibility: localStorage['ordersGridVisibleColumns']
 * - Column order: localStorage['ordersGridColumnOrder']
 * - Column widths: localStorage['ordersGridColumnWidths']
 * - Custom headers: localStorage['ordersGridHeaders']
 * - Reset all via ColumnVisibilityDropdown
 *
 * @component
 * @param {Object} props - Component props
 * @param {Array} props.rows - Flattened order rows with lineId, orderId, lineStatus, etc.
 * @param {Array<string>} props.lockedDates - Production dates that cannot be edited
 * @param {Function} props.onAllocate - (lineId) => allocate inventory
 * @param {Function} props.onPick - (lineId) => pick from stock
 * @param {Function} props.onPack - (lineId) => pack order
 * @param {Function} props.onMarkShippedLine - (lineId, data) => mark line as shipped visually
 * @param {Function} props.onUpdateLineTracking - (lineId, {awbNumber, courier}) => update tracking
 * @param {Function} props.onShip - (order) => ship order with full workflow
 * @param {Function} props.onViewOrder - (orderId) => open order detail panel
 * @param {Function} props.onCancelLine - (lineId) => cancel line
 * @param {Function} props.onCancelOrder - (orderId, reason) => cancel entire order
 * @returns {Object} { gridComponent, columnVisibilityDropdown, statusLegend, ... }
 *
 * @example
 * const {
 *   gridComponent,
 *   columnVisibilityDropdown,
 *   statusLegend
 * } = OrdersGrid({
 *   rows: flattenedOrderData,
 *   lockedDates,
 *   onAllocate,
 *   onPick,
 *   onPack,
 *   // ... 20+ handlers
 * });
 * return <>{gridComponent}</>;
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Check, X, CheckCircle, AlertCircle, Settings, Wrench, Calendar, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { formatDateTime, DEFAULT_HEADERS, DEFAULT_VISIBLE_COLUMNS } from '../../utils/orderHelpers';
import { calculateOrderTotal } from '../../utils/orderPricing';
import type { FlattenedOrderRow } from '../../utils/orderHelpers';
import { compactThemeSmall } from '../../utils/agGridHelpers';
import { TrackingStatusBadge } from '../common/grid/TrackingStatusBadge';
import { ColumnVisibilityDropdown } from '../common/grid/ColumnVisibilityDropdown';
import { useGridState } from '../../hooks/useGridState';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Production date popover component
function ProductionDatePopover({
    currentDate,
    isLocked,
    onSelectDate,
    onClear,
    hasExistingBatch,
}: {
    currentDate: string | null;
    isLocked: (date: string) => boolean;
    onSelectDate: (date: string) => void;
    onClear: () => void;
    hasExistingBatch: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Calculate position when opening
    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPopoverPosition({
                top: rect.bottom + window.scrollY + 4,
                left: rect.left + window.scrollX,
            });
        }
        setIsOpen(!isOpen);
    };

    // Quick date helpers
    const getDateString = (daysFromNow: number) => {
        const date = new Date();
        date.setDate(date.getDate() + daysFromNow);
        return date.toISOString().split('T')[0];
    };

    const formatDisplayDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    const handleDateSelect = (date: string) => {
        if (isLocked(date)) {
            alert(`Production date ${date} is locked.`);
            return;
        }
        onSelectDate(date);
        setIsOpen(false);
    };

    const quickDates = [
        { label: 'Today', days: 0 },
        { label: '+1', days: 1 },
        { label: '+2', days: 2 },
        { label: '+3', days: 3 },
        { label: '+5', days: 5 },
        { label: '+7', days: 7 },
    ];

    return (
        <div className="inline-block">
            <button
                ref={buttonRef}
                onClick={handleOpen}
                className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${
                    currentDate
                        ? isLocked(currentDate)
                            ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
                            : 'bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200'
                        : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200'
                }`}
                title={currentDate ? `Production: ${formatDisplayDate(currentDate)}` : 'Set production date'}
            >
                <Calendar size={10} />
                {currentDate ? formatDisplayDate(currentDate) : 'Set'}
            </button>

            {isOpen && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[180px]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Quick date buttons */}
                    <div className="flex flex-wrap gap-1 mb-2">
                        {quickDates.map(({ label, days }) => {
                            const dateStr = getDateString(days);
                            const locked = isLocked(dateStr);
                            const isSelected = currentDate === dateStr;
                            return (
                                <button
                                    key={days}
                                    onClick={() => handleDateSelect(dateStr)}
                                    disabled={locked}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        isSelected
                                            ? 'bg-orange-500 text-white'
                                            : locked
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700'
                                    }`}
                                    title={locked ? 'Date is locked' : formatDisplayDate(dateStr)}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Calendar input for custom date */}
                    <div className="border-t border-gray-100 pt-2">
                        <input
                            type="date"
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-300 focus:border-orange-300"
                            min={new Date().toISOString().split('T')[0]}
                            value={currentDate || ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleDateSelect(e.target.value);
                                }
                            }}
                        />
                    </div>

                    {/* Clear button */}
                    {hasExistingBatch && currentDate && (
                        <div className="border-t border-gray-100 pt-2 mt-2">
                            <button
                                onClick={() => {
                                    onClear();
                                    setIsOpen(false);
                                }}
                                className="w-full text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 flex items-center justify-center gap-1"
                            >
                                <X size={10} />
                                Remove from production
                            </button>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}

// View type for unified order views (RTO and COD Pending are now filters within Shipped)
export type OrderViewType = 'open' | 'shipped' | 'archived' | 'cancelled';

// All column IDs in display order (includes post-ship columns)
const ALL_COLUMN_IDS = [
    'orderDate', 'orderAge', 'shipByDate', 'orderNumber', 'customerName', 'city', 'orderValue',
    'discountCode', 'paymentMethod', 'rtoHistory', 'customerNotes', 'customerOrderCount',
    'customerLtv', 'skuCode', 'productName', 'customize', 'qty', 'skuStock', 'fabricBalance',
    'allocate', 'production', 'notes', 'pick', 'pack', 'ship', 'cancelLine', 'shopifyStatus',
    'shopifyAwb', 'shopifyCourier', 'awb', 'courier', 'trackingStatus',
    // Post-ship columns (for shipped/archived views)
    'shippedAt', 'deliveredAt', 'deliveryDays', 'daysInTransit',
    'rtoInitiatedAt', 'daysInRto', 'daysSinceDelivery', 'codRemittedAt',
    'archivedAt', 'finalStatus',
];

// Row status legend component
const StatusLegend = () => {
    const [isOpen, setIsOpen] = useState(false);
    const legendRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const statuses = [
        { color: '#f9fafb', border: '#d1d5db', label: 'Pending (no stock)', desc: 'Waiting for inventory' },
        { color: '#fef3c7', border: '#f59e0b', label: 'In Production', desc: 'Has production date set' },
        { color: '#f0fdf4', border: '#86efac', label: 'Ready to Allocate', desc: 'Has stock available' },
        { color: '#f3e8ff', border: '#a855f7', label: 'Allocated', desc: 'Stock reserved' },
        { color: '#ccfbf1', border: '#14b8a6', label: 'Picked', desc: 'Ready to pack' },
        { color: '#dbeafe', border: '#3b82f6', label: 'Packed', desc: 'Ready to ship - enter AWB' },
        { color: '#bbf7d0', border: '#10b981', label: 'Marked Shipped', desc: 'Pending batch process' },
    ];

    return (
        <div className="relative" ref={legendRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
                title="Show status legend"
            >
                <span className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #bbf7d0 100%)', border: '1px solid #93c5fd' }} />
                <span>Legend</span>
            </button>
            {isOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 min-w-[240px]">
                    <div className="text-xs font-medium text-gray-600 mb-2">Row Status Colors</div>
                    <div className="space-y-1.5">
                        {statuses.map((status) => (
                            <div key={status.label} className="flex items-center gap-2">
                                <div
                                    className="w-4 h-4 rounded flex-shrink-0"
                                    style={{
                                        backgroundColor: status.color,
                                        borderLeft: `3px solid ${status.border}`,
                                    }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-gray-700">{status.label}</div>
                                    <div className="text-[10px] text-gray-500">{status.desc}</div>
                                </div>
                            </div>
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

// Common courier options
const COURIER_OPTIONS = [
    'Delhivery',
    'BlueDart',
    'DTDC',
    'Ekart',
    'Xpressbees',
    'Shadowfax',
    'Ecom Express',
    'Other',
];

/**
 * Props for OrdersGrid. Handles 20+ action handlers for order fulfillment workflow.
 * - rows: Flattened order data (order header row + multiple line rows per order)
 * - lockedDates: Production dates that cannot be edited in date picker
 * - allocatingLines: Set of lineIds currently being toggled (prevent double-click)
 * - currentView: Which view is being displayed (affects column visibility and actions)
 * - All on* handlers support both fulfilled and unfulfilled line states
 */
interface OrdersGridProps {
    rows: FlattenedOrderRow[];
    lockedDates: string[];
    // Current view determines which columns and actions are shown
    currentView?: OrderViewType;
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    onPack: (lineId: string) => void;
    onUnpack: (lineId: string) => void;
    // Ship line directly (simplified flow: packed → shipped)
    onShipLine?: (lineId: string, data: { awbNumber: string; courier: string }) => void;
    // Legacy mark shipped (deprecated - use onShipLine)
    onMarkShippedLine: (lineId: string, data?: { awbNumber?: string; courier?: string }) => void;
    onUnmarkShippedLine: (lineId: string) => void;
    onUpdateLineTracking: (lineId: string, data: { awbNumber?: string; courier?: string }) => void;
    onShip?: (order: any) => void;
    onCreateBatch: (data: any) => void;
    onUpdateBatch: (id: string, data: any) => void;
    onDeleteBatch: (id: string) => void;
    onUpdateLineNotes: (lineId: string, notes: string) => void;
    onViewOrder: (orderId: string) => void;
    onEditOrder: (order: any) => void;
    onCancelOrder: (id: string, reason?: string) => void;
    onDeleteOrder: (id: string) => void;
    onCloseOrder?: (id: string) => void;  // Close order (move to shipped view)
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
    onUpdateShipByDate?: (orderId: string, date: string | null) => void;
    onForceShipOrder?: (orderId: string, data: { awbNumber: string; courier: string }) => void;
    // Post-ship action handlers (for shipped/rto/cod-pending/archived views)
    onUnship?: (orderId: string) => void;
    onMarkDelivered?: (orderId: string) => void;
    onMarkRto?: (orderId: string) => void;
    onUnarchive?: (orderId: string) => void;
    onTrack?: (awbNumber: string, orderNumber: string) => void;
    onMarkCodRemitted?: (orderId: string) => void;
    onMarkRtoReceived?: (orderId: string) => void;
    // Loading states
    allocatingLines: Set<string>;
    isCancellingOrder: boolean;
    isCancellingLine: boolean;
    isUncancellingLine: boolean;
    isDeletingOrder: boolean;
    isClosingOrder?: boolean;
    isUnshipping?: boolean;
    isMarkingDelivered?: boolean;
    isMarkingRto?: boolean;
    isUnarchiving?: boolean;
    isAdmin?: boolean;
}

export function OrdersGrid({
    rows,
    lockedDates,
    currentView = 'open',
    onAllocate,
    onUnallocate,
    onPick,
    onUnpick,
    onPack,
    onUnpack,
    onShipLine,
    onMarkShippedLine: _onMarkShippedLine,  // Deprecated - use onShipLine
    onUnmarkShippedLine: _onUnmarkShippedLine,  // Deprecated
    onUpdateLineTracking,
    onShip: _onShip,
    onCreateBatch,
    onUpdateBatch,
    onDeleteBatch,
    onUpdateLineNotes,
    onViewOrder,
    onEditOrder: _onEditOrder,
    onCancelOrder: _onCancelOrder,
    onDeleteOrder: _onDeleteOrder,
    onCloseOrder: _onCloseOrder,
    onCancelLine,
    onUncancelLine,
    onSelectCustomer,
    onCustomize,
    onEditCustomization,
    onRemoveCustomization,
    onUpdateShipByDate,
    onForceShipOrder,
    // Post-ship action handlers (for future implementation)
    onUnship: _onUnship,
    onMarkDelivered: _onMarkDelivered,
    onMarkRto: _onMarkRto,
    onUnarchive: _onUnarchive,
    onTrack: _onTrack,
    onMarkCodRemitted,
    onMarkRtoReceived: _onMarkRtoReceived,
    // Loading states
    allocatingLines,
    isCancellingOrder,
    isCancellingLine,
    isUncancellingLine,
    isDeletingOrder,
    isClosingOrder: _isClosingOrder,
    isUnshipping: _isUnshipping,
    isMarkingDelivered: _isMarkingDelivered,
    isMarkingRto: _isMarkingRto,
    isUnarchiving: _isUnarchiving,
    isAdmin,
}: OrdersGridProps) {
    // Grid ref for API access
    const gridRef = useRef<AgGridReact>(null);

    // Track previous row data to detect lineStatus changes
    const prevRowsRef = useRef<Map<string, string>>(new Map());

    // Force AG-Grid to refresh row styles when lineStatus changes
    // AG-Grid caches getRowStyle results, so we need to explicitly redraw changed rows
    useEffect(() => {
        const api = gridRef.current?.api;
        if (!api || !rows.length) return;

        // Build map of current lineStatus values
        const currentStatuses = new Map<string, string>();
        const changedRowIds: string[] = [];

        for (const row of rows) {
            const rowId = row.lineId || `order-${row.orderId}-header`;
            const status = row.lineStatus || '';
            currentStatuses.set(rowId, status);

            // Check if status changed from previous render
            const prevStatus = prevRowsRef.current.get(rowId);
            if (prevStatus !== undefined && prevStatus !== status) {
                changedRowIds.push(rowId);
            }
        }

        // Update ref for next comparison
        prevRowsRef.current = currentStatuses;

        // If any rows changed status, redraw them to update row styling
        if (changedRowIds.length > 0) {
            const rowNodes = changedRowIds
                .map(id => api.getRowNode(id))
                .filter((node): node is NonNullable<typeof node> => node != null);

            if (rowNodes.length > 0) {
                api.redrawRows({ rowNodes });
            }
        }
    }, [rows]);

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

    // Use shared grid state hook for column preferences
    const {
        visibleColumns,
        columnOrder,
        columnWidths,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
        handleColumnResized,
        // User preferences
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        // Admin-only
        isManager,
        savePreferencesToServer,
    } = useGridState({
        gridId: 'ordersGrid',
        allColumnIds: ALL_COLUMN_IDS,
        defaultHiddenColumns: ALL_COLUMN_IDS.filter(id => !DEFAULT_VISIBLE_COLUMNS.includes(id)),
    });

    // Wrapper to handle AG-Grid column moved events
    const onColumnMoved = useCallback((event: any) => {
        if (!event.finished || !event.api) return;
        const newOrder = event.api.getAllDisplayedColumns()
            .map((col: any) => col.getColId())
            .filter((id: string) => ALL_COLUMN_IDS.includes(id));
        handleColumnMoved(newOrder);
    }, [handleColumnMoved]);

    // Wrapper to handle AG-Grid column resized events
    const onColumnResized = useCallback((event: any) => {
        if (!event.finished || !event.columns?.length) return;
        event.columns.forEach((col: any) => {
            const colId = col.getColId();
            const width = col.getActualWidth();
            if (colId && width) {
                handleColumnResized(colId, width);
            }
        });
    }, [handleColumnResized]);

    const setCustomHeader = useCallback((colId: string, headerName: string) => {
        setCustomHeaders((prev) => {
            const updated = { ...prev, [colId]: headerName };
            localStorage.setItem('ordersGridHeaders', JSON.stringify(updated));
            return updated;
        });
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
                colId: 'shipByDate',
                headerName: getHeaderName('shipByDate'),
                field: 'shipByDate',
                width: 100,
                editable: (params: EditableCallbackParams) => !!params.data?.isFirstLine && !!onUpdateShipByDate,
                cellEditor: 'agDateStringCellEditor',
                cellEditorParams: {
                    min: new Date().toISOString().split('T')[0], // Today as minimum
                },
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    const shipByDate = params.data.order?.shipByDate;
                    if (!shipByDate) return '';
                    // Return YYYY-MM-DD format for the date editor
                    return new Date(shipByDate).toISOString().split('T')[0];
                },
                valueSetter: (params: ValueSetterParams) => {
                    if (params.data?.isFirstLine && params.data.order?.id && onUpdateShipByDate) {
                        const newDate = params.newValue || null;
                        onUpdateShipByDate(params.data.order.id, newDate);
                    }
                    return true;
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const shipByDate = params.data.order?.shipByDate;

                    // Show pencil icon hint for editable cells
                    const isEditable = !!onUpdateShipByDate;

                    if (!shipByDate) {
                        return (
                            <span className={`text-gray-300 ${isEditable ? 'cursor-pointer hover:text-gray-500' : ''}`} title={isEditable ? 'Click to set ship by date' : ''}>
                                {isEditable ? '+ Set' : '—'}
                            </span>
                        );
                    }

                    const date = new Date(shipByDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const shipDate = new Date(shipByDate);
                    shipDate.setHours(0, 0, 0, 0);
                    const daysUntil = Math.ceil((shipDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                    let colorClass = 'text-gray-600';
                    let bgClass = '';
                    let daysLabel = '';

                    if (daysUntil < 0) {
                        colorClass = 'text-red-700 font-semibold';
                        bgClass = 'bg-red-100 px-1.5 py-0.5 rounded';
                        daysLabel = ` (-${Math.abs(daysUntil)}d)`;
                    } else if (daysUntil === 0) {
                        colorClass = 'text-amber-700 font-semibold';
                        bgClass = 'bg-amber-100 px-1.5 py-0.5 rounded';
                        daysLabel = ' (today)';
                    } else if (daysUntil <= 2) {
                        colorClass = 'text-amber-600';
                        daysLabel = ` (${daysUntil}d)`;
                    } else {
                        daysLabel = ` (${daysUntil}d)`;
                    }

                    const formatted = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const tooltip = isEditable ? 'Click to edit' : '';

                    return (
                        <span className={`text-xs ${colorClass} ${bgClass} ${isEditable ? 'cursor-pointer' : ''}`} title={tooltip}>
                            {formatted}<span className="text-[10px] opacity-75">{daysLabel}</span>
                        </span>
                    );
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
                    const isExchange = params.data.order?.isExchange;
                    return (
                        <div className="flex items-center gap-1">
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
                            {isExchange && (
                                <span
                                    className="inline-flex items-center justify-center w-4 h-4 bg-amber-100 text-amber-700 rounded text-[9px] font-bold"
                                    title="Exchange Order"
                                >
                                    E
                                </span>
                            )}
                        </div>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'customerName',
                headerName: getHeaderName('customerName'),
                field: 'customerName',
                width: 150,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    const customerId = order?.customerId;
                    const fullName = params.value || '';
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (customerId) onSelectCustomer(customerId);
                            }}
                            className={`text-left truncate max-w-full block ${customerId
                                ? 'text-blue-600 hover:text-blue-800 hover:underline'
                                : 'text-gray-700'
                                }`}
                            title={fullName}
                            disabled={!customerId}
                        >
                            {fullName}
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
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return null;
                    return calculateOrderTotal(params.data.order).total;
                },
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
                            className={`text-xs px-1.5 py-0.5 rounded ${isCod ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                                }`}
                        >
                            {isCod ? 'COD' : 'Prepaid'}
                        </span>
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'rtoHistory',
                headerName: getHeaderName('rtoHistory'),
                width: 200,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    return params.data.order?.customerRtoCount || 0;
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const rtoCount = params.data.order?.customerRtoCount || 0;
                    const orderCount = params.data.customerOrderCount || 0;
                    const paymentMethod = params.data.order?.shopifyCache?.paymentMethod
                        || params.data.order?.paymentMethod || '';
                    const isCod = paymentMethod.toLowerCase().includes('cod');

                    // COD orders with RTO history - highest priority warning
                    if (isCod && rtoCount > 0) {
                        return (
                            <span
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium border border-red-200"
                                title={`This customer has ${rtoCount} prior COD RTO${rtoCount > 1 ? 's' : ''}`}
                            >
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                {rtoCount} RTO
                            </span>
                        );
                    }

                    // First-time customer with COD - verification warning
                    if (isCod && orderCount <= 1) {
                        return (
                            <span className="text-xs text-amber-600">
                                1st Order + COD - Confirm before shipping
                            </span>
                        );
                    }

                    // For prepaid orders with RTO history, show subtle indicator
                    if (rtoCount > 0) {
                        return (
                            <span className="text-xs text-gray-400" title={`${rtoCount} prior RTO${rtoCount > 1 ? 's' : ''} (prepaid - refunded)`}>
                                {rtoCount}
                            </span>
                        );
                    }

                    return null;
                },
                cellClass: 'text-center',
                headerTooltip: 'RTO Risk (COD verification)',
            },
            {
                colId: 'customerNotes',
                headerName: getHeaderName('customerNotes'),
                width: 180,
                autoHeight: true,
                wrapText: true,
                valueGetter: (params: ValueGetterParams) =>
                    params.data?.isFirstLine ? params.data.order?.shopifyCache?.customerNotes || '' : '',
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const notes = params.data.order?.shopifyCache?.customerNotes || '';
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
                width: 85,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const orderCount = params.data.customerOrderCount || 0;
                    const ltv = params.data.customerLtv || 0;
                    const tier = params.data.order?.customerTier || 'bronze';

                    // First order customer - show NEW badge
                    if (orderCount <= 1) {
                        return (
                            <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200"
                                title={`First order customer`}
                            >
                                ✨ NEW
                            </span>
                        );
                    }

                    // Returning customer - show order count with tier color
                    const tierStyles: Record<string, { bg: string; border: string; icon: string }> = {
                        platinum: { bg: 'bg-purple-100 text-purple-700', border: 'border-purple-300', icon: '💎' },
                        gold: { bg: 'bg-amber-100 text-amber-700', border: 'border-amber-300', icon: '⭐' },
                        silver: { bg: 'bg-slate-100 text-slate-600', border: 'border-slate-300', icon: '🥈' },
                        bronze: { bg: 'bg-orange-100 text-orange-700', border: 'border-orange-300', icon: '' },
                    };
                    const style = tierStyles[tier] || tierStyles.bronze;

                    return (
                        <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${style.bg} border ${style.border}`}
                            title={`${tier.charAt(0).toUpperCase() + tier.slice(1)} tier • ${orderCount} orders • ₹${ltv.toLocaleString()} lifetime value`}
                        >
                            {style.icon && <span>{style.icon}</span>}
                            {orderCount} orders
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
                minWidth: 220,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
                    const fullText = `${row.productName} - ${row.colorName} - ${row.size}`;
                    return (
                        <span
                            className="text-xs truncate block"
                            title={fullText}
                        >
                            {fullText}
                        </span>
                    );
                },
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

                    const hasStock = row.skuStock >= row.qty;
                    const isAllocated =
                        row.lineStatus === 'allocated' ||
                        row.lineStatus === 'picked' ||
                        row.lineStatus === 'packed';
                    const isPending = row.lineStatus === 'pending';

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
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${row.lineStatus === 'allocated'
                                    ? 'bg-purple-500 border-purple-500 text-white hover:bg-purple-600 shadow-sm'
                                    : 'bg-purple-200 border-purple-200 text-purple-600'
                                    }`}
                                title={row.lineStatus === 'allocated' ? 'Click to unallocate' : `Status: ${row.lineStatus}`}
                            >
                                <Check size={12} strokeWidth={3} />
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
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${canAllocate
                                ? 'border-purple-400 bg-white hover:bg-purple-100 hover:border-purple-500 cursor-pointer shadow-sm'
                                : 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-40'
                                }`}
                            title={canAllocate ? 'Click to allocate' : 'No stock available'}
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
                width: 90,
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
                        return (
                            <ProductionDatePopover
                                currentDate={row.productionDate}
                                isLocked={isDateLocked}
                                hasExistingBatch={!!row.productionBatchId}
                                onSelectDate={(date) => {
                                    if (row.productionBatchId) {
                                        // Update existing batch
                                        onUpdateBatch(row.productionBatchId, { batchDate: date });
                                    } else {
                                        // Create new batch
                                        onCreateBatch({
                                            skuId: row.skuId,
                                            qtyPlanned: row.qty,
                                            priority: 'order_fulfillment',
                                            sourceOrderLineId: row.lineId,
                                            batchDate: date,
                                            notes: `For ${row.orderNumber}`,
                                        });
                                    }
                                }}
                                onClear={() => {
                                    if (row.productionBatchId) {
                                        onDeleteBatch(row.productionBatchId);
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
                        return <span className="text-gray-300">—</span>;
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
                    // Include shipped in picked state (it must have been picked)
                    const isPicked = ['picked', 'packed', 'shipped'].includes(row.lineStatus);

                    if (isPicked) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (row.lineStatus === 'picked') onUnpick(row.lineId);
                                }}
                                disabled={isToggling || row.lineStatus !== 'picked'}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${row.lineStatus === 'picked'
                                    ? 'bg-teal-500 border-teal-500 text-white hover:bg-teal-600 shadow-sm'
                                    : 'bg-teal-200 border-teal-200 text-teal-600'
                                    }`}
                                title={row.lineStatus === 'picked' ? 'Click to unpick' : row.lineStatus === 'shipped' ? 'Shipped' : 'Packed'}
                            >
                                <Check size={12} strokeWidth={3} />
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
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${canPick
                                ? 'border-teal-400 bg-white hover:bg-teal-100 hover:border-teal-500 cursor-pointer shadow-sm'
                                : 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-40'
                                }`}
                            title={canPick ? 'Click to pick' : 'Not allocated yet'}
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
                    // Include shipped in packed state (it must have been packed)
                    const isPacked = ['packed', 'shipped'].includes(row.lineStatus);

                    if (isPacked) {
                        const isShipped = row.lineStatus === 'shipped';
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isShipped) onUnpack(row.lineId);
                                }}
                                disabled={isToggling || isShipped}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${
                                    isShipped
                                        ? 'bg-blue-200 border-blue-200 text-blue-600 cursor-not-allowed'
                                        : 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600 shadow-sm'
                                }`}
                                title={isShipped ? 'Already shipped' : 'Click to unpack'}
                            >
                                <Check size={12} strokeWidth={3} />
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
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all ${canPack
                                ? 'border-blue-400 bg-white hover:bg-blue-100 hover:border-blue-500 cursor-pointer shadow-sm'
                                : 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-40'
                                }`}
                            title={canPack ? 'Click to pack' : 'Not picked yet'}
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

                    const isPacked = row.lineStatus === 'packed';
                    const isShipped = row.lineStatus === 'shipped';

                    // Already shipped - show green filled checkbox
                    if (isShipped) {
                        return (
                            <div
                                className="w-5 h-5 rounded border-2 bg-green-500 border-green-500 text-white flex items-center justify-center mx-auto shadow-sm"
                                title="Shipped"
                            >
                                <Check size={12} strokeWidth={3} />
                            </div>
                        );
                    }

                    // Packed - show empty checkbox (can ship)
                    // Clicking will trigger ship with Shopify AWB or prompt for AWB
                    if (isPacked) {
                        const shopifyAwb = row.shopifyAwb || row.awbNumber;
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (shopifyAwb) {
                                        // Has AWB - ship directly
                                        onShipLine?.(row.lineId, { awbNumber: shopifyAwb, courier: row.courier || 'Unknown' });
                                    } else {
                                        // No AWB - prompt for it
                                        const awb = prompt('AWB Number (required):');
                                        if (!awb?.trim()) return;
                                        const courier = prompt('Courier:') || 'Unknown';
                                        onShipLine?.(row.lineId, { awbNumber: awb.trim(), courier });
                                    }
                                }}
                                className="w-5 h-5 rounded border-2 border-green-400 bg-white hover:bg-green-100 hover:border-green-500 flex items-center justify-center mx-auto cursor-pointer shadow-sm"
                                title={shopifyAwb ? `Ship with AWB: ${shopifyAwb}` : 'Click to ship (will prompt for AWB)'}
                            />
                        );
                    }

                    // Admin can force ship any line
                    if (isAdmin && onForceShipOrder) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const awbNumber = prompt('AWB Number (required):');
                                    if (!awbNumber?.trim()) return;
                                    const courier = prompt('Courier (required):');
                                    if (!courier?.trim()) return;
                                    if (confirm(`Force ship this order?\n\nThis will mark ALL lines as shipped WITHOUT inventory deduction.\nAWB: ${awbNumber}\nCourier: ${courier}`)) {
                                        onForceShipOrder(row.orderId, { awbNumber: awbNumber.trim(), courier: courier.trim() });
                                    }
                                }}
                                className="w-5 h-5 rounded border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 hover:border-amber-500 flex items-center justify-center mx-auto cursor-pointer shadow-sm"
                                title="Admin: Force ship (no inventory)"
                            />
                        );
                    }

                    // Not packed yet - show disabled checkbox
                    return (
                        <div
                            className="w-5 h-5 rounded border-2 border-gray-200 bg-gray-100 flex items-center justify-center mx-auto opacity-40"
                            title="Pack first"
                        />
                    );
                },
                cellClass: 'text-center',
            },
            {
                colId: 'cancelLine',
                headerName: getHeaderName('cancelLine'),
                width: 35,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row || !row.lineId) return null;

                    const isCancelled = row.lineStatus === 'cancelled';
                    const isToggling = isCancellingLine || isUncancellingLine;

                    // Cancelled - show red X (can restore)
                    if (isCancelled) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onUncancelLine(row.lineId);
                                }}
                                disabled={isToggling}
                                className="w-5 h-5 rounded border-2 bg-red-500 border-red-500 text-white flex items-center justify-center mx-auto hover:bg-red-600 hover:border-red-600 shadow-sm disabled:opacity-50"
                                title="Click to restore line"
                            >
                                <X size={12} strokeWidth={3} />
                            </button>
                        );
                    }

                    // Not cancelled - show empty checkbox (can cancel)
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onCancelLine(row.lineId);
                            }}
                            disabled={isToggling}
                            className="w-5 h-5 rounded border-2 border-red-300 bg-white hover:bg-red-50 hover:border-red-400 flex items-center justify-center mx-auto cursor-pointer shadow-sm disabled:opacity-50"
                            title="Click to cancel line"
                        />
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
                    // Use shopifyCache only - deprecated order.shopifyFulfillmentStatus removed
                    const status = params.data.order?.shopifyCache?.fulfillmentStatus;
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
                colId: 'shopifyAwb',
                headerName: getHeaderName('shopifyAwb'),
                width: 130,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    return params.data.order?.shopifyCache?.trackingNumber || '';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const awb = params.data.order?.shopifyCache?.trackingNumber;
                    if (!awb) return null; // Clean empty state
                    return (
                        <span className="font-mono text-xs text-gray-600" title={awb}>
                            {awb.length > 14 ? awb.substring(0, 14) + '...' : awb}
                        </span>
                    );
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'shopifyCourier',
                headerName: getHeaderName('shopifyCourier'),
                width: 100,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    return params.data.order?.shopifyCache?.trackingCompany || '';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const courier = params.data.order?.shopifyCache?.trackingCompany;
                    if (!courier) return null; // Clean empty state
                    return <span className="text-xs text-gray-600">{courier}</span>;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'awb',
                headerName: getHeaderName('awb'),
                width: 140,
                editable: (params: EditableCallbackParams) => {
                    const status = params.data?.lineStatus;
                    return ['packed', 'shipped'].includes(status);
                },
                valueGetter: (params: ValueGetterParams) => {
                    // Get line-level AWB from the order line
                    const lineId = params.data?.lineId;
                    const orderLines = params.data?.order?.orderLines || [];
                    const line = orderLines.find((l: any) => l.id === lineId);
                    return line?.awbNumber || '';
                },
                valueSetter: (params: ValueSetterParams) => {
                    // Double-check status before calling API to prevent stale data issues
                    const status = params.data?.lineStatus;
                    if (!['packed', 'shipped'].includes(status)) {
                        console.warn('Cannot update AWB - line status is:', status);
                        return false;
                    }
                    if (params.data?.lineId) {
                        // Directly update the row data so AG-Grid shows the value immediately
                        const orderLines = params.data?.order?.orderLines || [];
                        const line = orderLines.find((l: any) => l.id === params.data.lineId);
                        if (line) {
                            line.awbNumber = params.newValue || '';
                        }
                        // Call API to persist
                        onUpdateLineTracking(params.data.lineId, { awbNumber: params.newValue || '' });
                    }
                    return true;
                },
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row?.lineId) return null;

                    const lineId = row.lineId;
                    const orderLines = row.order?.orderLines || [];
                    const line = orderLines.find((l: any) => l.id === lineId);
                    const lineAwb = line?.awbNumber || '';
                    const expectedAwb = row.order?.shopifyCache?.trackingNumber || '';

                    // Check if cell is editable
                    const isEditable = ['packed', 'shipped'].includes(row.lineStatus);

                    // Determine match status
                    const hasExpected = !!expectedAwb;
                    const hasLine = !!lineAwb;
                    const isMatch = hasExpected && hasLine && lineAwb.toLowerCase() === expectedAwb.toLowerCase();
                    const isMismatch = hasExpected && hasLine && !isMatch;

                    if (!hasLine) {
                        // Show prominent input hint for editable cells
                        if (isEditable) {
                            return (
                                <div className="flex items-center gap-1.5 text-blue-500">
                                    <span className="text-xs font-medium">Scan AWB</span>
                                    <div className="w-4 h-4 rounded border-2 border-dashed border-blue-300 flex items-center justify-center">
                                        <span className="text-[10px]">⌨</span>
                                    </div>
                                </div>
                            );
                        }
                        // Non-editable: show nothing instead of dash
                        return null;
                    }

                    return (
                        <div className="flex items-center gap-1">
                            <span
                                className={`font-mono text-xs ${isMismatch ? 'text-amber-700 font-medium' : isMatch ? 'text-green-700 font-medium' : 'text-gray-700'}`}
                                title={lineAwb}
                            >
                                {lineAwb.length > 12 ? lineAwb.substring(0, 12) + '...' : lineAwb}
                            </span>
                            {isMatch && <CheckCircle size={12} className="text-green-500 flex-shrink-0" />}
                            {isMismatch && <span title={`Expected: ${expectedAwb}`}><AlertCircle size={12} className="text-amber-500 flex-shrink-0" /></span>}
                        </div>
                    );
                },
                cellClass: (params: CellClassParams) => {
                    const status = params.data?.lineStatus;
                    const editable = ['packed', 'shipped'].includes(status);
                    return editable ? 'text-xs cursor-text' : 'text-xs';
                },
            },
            {
                colId: 'courier',
                headerName: getHeaderName('courier'),
                width: 100,
                editable: (params: EditableCallbackParams) => {
                    const status = params.data?.lineStatus;
                    return ['packed', 'shipped'].includes(status);
                },
                cellEditor: 'agSelectCellEditor',
                cellEditorParams: {
                    values: COURIER_OPTIONS,
                },
                valueGetter: (params: ValueGetterParams) => {
                    const lineId = params.data?.lineId;
                    const orderLines = params.data?.order?.orderLines || [];
                    const line = orderLines.find((l: any) => l.id === lineId);
                    return line?.courier || '';
                },
                valueSetter: (params: ValueSetterParams) => {
                    // Double-check status before calling API to prevent stale data issues
                    const status = params.data?.lineStatus;
                    if (!['packed', 'shipped'].includes(status)) {
                        console.warn('Cannot update courier - line status is:', status);
                        return false;
                    }
                    if (params.data?.lineId) {
                        // Directly update the row data so AG-Grid shows the value immediately
                        const orderLines = params.data?.order?.orderLines || [];
                        const line = orderLines.find((l: any) => l.id === params.data.lineId);
                        if (line) {
                            line.courier = params.newValue || '';
                        }
                        // Call API to persist
                        onUpdateLineTracking(params.data.lineId, { courier: params.newValue || '' });
                    }
                    return true;
                },
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row?.lineId) return null;

                    const lineId = row.lineId;
                    const orderLines = row.order?.orderLines || [];
                    const line = orderLines.find((l: any) => l.id === lineId);
                    const courier = line?.courier || '';
                    const isEditable = ['packed', 'shipped'].includes(row.lineStatus);

                    if (!courier) {
                        if (isEditable) {
                            return (
                                <div className="flex items-center gap-1 text-gray-400">
                                    <span className="text-xs">Select</span>
                                    <ChevronDown size={12} />
                                </div>
                            );
                        }
                        // Non-editable: show nothing
                        return null;
                    }

                    return <span className="text-xs font-medium text-blue-700">{courier}</span>;
                },
                cellClass: (params: CellClassParams) => {
                    const status = params.data?.lineStatus;
                    const editable = ['packed', 'shipped'].includes(status);
                    return editable ? 'text-xs cursor-pointer' : 'text-xs';
                },
            },
            {
                colId: 'trackingStatus',
                headerName: getHeaderName('trackingStatus'),
                width: 110,
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    // Show tracking status if any tracking data exists
                    const hasTrackingData = order?.trackingStatus || order?.courierStatusCode || order?.lastScanAt || order?.lastTrackingUpdate;
                    if (!hasTrackingData) {
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
            // ========================================
            // POST-SHIP COLUMNS (for shipped/rto/cod-pending/archived views)
            // ========================================
            {
                colId: 'shippedAt',
                headerName: getHeaderName('shippedAt'),
                field: 'order.shippedAt',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine || !params.value) return '';
                    const dt = formatDateTime(params.value);
                    return dt.date;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'deliveredAt',
                headerName: getHeaderName('deliveredAt'),
                field: 'order.deliveredAt',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine || !params.value) return '';
                    const dt = formatDateTime(params.value);
                    return dt.date;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'deliveryDays',
                headerName: getHeaderName('deliveryDays'),
                width: 60,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    if (!order?.shippedAt || !order?.deliveredAt) return null;
                    const shipped = new Date(order.shippedAt);
                    const delivered = new Date(order.deliveredAt);
                    return Math.ceil((delivered.getTime() - shipped.getTime()) / (1000 * 60 * 60 * 24));
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (params.value === null) return null;
                    const days = params.value as number;
                    let colorClass = 'text-green-600';
                    if (days > 7) colorClass = 'text-red-600';
                    else if (days > 5) colorClass = 'text-amber-600';
                    return <span className={`text-xs ${colorClass}`}>{days}d</span>;
                },
                sortable: true,
            },
            {
                colId: 'daysInTransit',
                headerName: getHeaderName('daysInTransit'),
                width: 60,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    if (!order?.shippedAt || order?.deliveredAt) return null; // Don't show if already delivered
                    const shipped = new Date(order.shippedAt);
                    return Math.floor((Date.now() - shipped.getTime()) / (1000 * 60 * 60 * 24));
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (params.value === null) return null;
                    const days = params.value as number;
                    let colorClass = 'text-gray-600';
                    if (days > 10) colorClass = 'text-red-600 font-semibold';
                    else if (days > 7) colorClass = 'text-amber-600';
                    return <span className={`text-xs ${colorClass}`}>{days}d</span>;
                },
                sortable: true,
            },
            {
                colId: 'rtoInitiatedAt',
                headerName: getHeaderName('rtoInitiatedAt'),
                field: 'order.rtoInitiatedAt',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine || !params.value) return '';
                    const dt = formatDateTime(params.value);
                    return dt.date;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'daysInRto',
                headerName: getHeaderName('daysInRto'),
                width: 60,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    if (!order?.rtoInitiatedAt) return null;
                    const rtoDate = new Date(order.rtoInitiatedAt);
                    return Math.floor((Date.now() - rtoDate.getTime()) / (1000 * 60 * 60 * 24));
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (params.value === null) return null;
                    const days = params.value as number;
                    let colorClass = 'text-gray-600';
                    if (days > 14) colorClass = 'text-red-600 font-semibold';
                    else if (days > 7) colorClass = 'text-amber-600';
                    return <span className={`text-xs ${colorClass}`}>{days}d RTO</span>;
                },
                sortable: true,
            },
            {
                colId: 'daysSinceDelivery',
                headerName: getHeaderName('daysSinceDelivery'),
                width: 70,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    if (!order?.deliveredAt) return null;
                    const delivered = new Date(order.deliveredAt);
                    return Math.floor((Date.now() - delivered.getTime()) / (1000 * 60 * 60 * 24));
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (params.value === null) return null;
                    const days = params.value as number;
                    let colorClass = 'text-green-600';
                    let bgClass = 'bg-green-50';
                    if (days > 14) {
                        colorClass = 'text-red-600 font-semibold';
                        bgClass = 'bg-red-50';
                    } else if (days > 7) {
                        colorClass = 'text-amber-600';
                        bgClass = 'bg-amber-50';
                    }
                    return <span className={`text-xs ${colorClass} ${bgClass} px-1.5 py-0.5 rounded`}>{days}d</span>;
                },
                sortable: true,
            },
            {
                colId: 'codRemittedAt',
                headerName: getHeaderName('codRemittedAt'),
                field: 'order.codRemittedAt',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine || !params.value) return '';
                    const dt = formatDateTime(params.value);
                    return dt.date;
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.data?.isFirstLine) return null;
                    const order = params.data.order;
                    if (order?.codRemittedAt) {
                        const dt = formatDateTime(order.codRemittedAt);
                        return <span className="text-xs text-green-600">{dt.date}</span>;
                    }
                    // Show "Mark Remitted" button for COD pending
                    if (order?.paymentMethod === 'COD' && order?.trackingStatus === 'delivered' && onMarkCodRemitted) {
                        return (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onMarkCodRemitted(order.id);
                                }}
                                className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
                            >
                                Mark Remitted
                            </button>
                        );
                    }
                    return null;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'archivedAt',
                headerName: getHeaderName('archivedAt'),
                field: 'order.archivedAt',
                width: 100,
                valueFormatter: (params: ValueFormatterParams) => {
                    if (!params.data?.isFirstLine || !params.value) return '';
                    const dt = formatDateTime(params.value);
                    return dt.date;
                },
                cellClass: 'text-xs',
            },
            {
                colId: 'finalStatus',
                headerName: getHeaderName('finalStatus'),
                width: 100,
                valueGetter: (params: ValueGetterParams) => {
                    if (!params.data?.isFirstLine) return '';
                    const order = params.data.order;
                    return order?.terminalStatus || order?.trackingStatus || '';
                },
                cellRenderer: (params: ICellRendererParams) => {
                    if (!params.value) return null;
                    const status = params.value as string;
                    const statusStyles: Record<string, string> = {
                        delivered: 'bg-green-100 text-green-700',
                        rto_received: 'bg-purple-100 text-purple-700',
                        cancelled: 'bg-red-100 text-red-700',
                        returned: 'bg-orange-100 text-orange-700',
                        shipped: 'bg-blue-100 text-blue-700',
                    };
                    const style = statusStyles[status] || 'bg-gray-100 text-gray-700';
                    const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    return <span className={`text-xs px-1.5 py-0.5 rounded ${style}`}>{label}</span>;
                },
            },
        ].map(col => ({
            ...col,
            hide: !visibleColumns.has(col.colId!),
        })) as ColDef[],
        [
            allocatingLines,
            lockedDates,
            getHeaderName,
            isCancellingOrder,
            isCancellingLine,
            isUncancellingLine,
            isDeletingOrder,
            visibleColumns,
            onCustomize,
            onEditCustomization,
            onRemoveCustomization,
            onCancelLine,
            onUncancelLine,
            // Post-ship handlers
            onMarkCodRemitted,
            currentView,
        ]
    );

    // Sort column defs by saved order and apply saved widths
    const orderedColumnDefs = useMemo((): ColDef[] => {
        const colDefMap = new Map(columnDefs.map(col => [col.colId, col]));
        const ordered: ColDef[] = [];

        // Add columns in saved order
        columnOrder.forEach(colId => {
            const col = colDefMap.get(colId);
            if (col) {
                // Apply saved width if available
                const savedWidth = columnWidths[colId];
                ordered.push(savedWidth ? { ...col, width: savedWidth } as ColDef : col);
                colDefMap.delete(colId);
            }
        });

        // Add any remaining columns (new columns not in saved order)
        colDefMap.forEach(col => {
            const savedWidth = col.colId ? columnWidths[col.colId] : undefined;
            ordered.push(savedWidth ? { ...col, width: savedWidth } as ColDef : col);
        });

        return ordered;
    }, [columnDefs, columnOrder, columnWidths]);

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

        // Cancelled - clearly struck through and grayed
        if (row.lineStatus === 'cancelled') {
            return {
                backgroundColor: '#f3f4f6',
                color: '#9ca3af',
                textDecoration: 'line-through',
                opacity: 0.6,
            };
        }

        // Shipped - DONE state, very distinct green with strikethrough
        if (row.lineStatus === 'shipped') {
            return {
                backgroundColor: '#bbf7d0',  // Green-200 - strong green
                textDecoration: 'line-through',
                borderLeft: '4px solid #10b981',  // Emerald-500
            };
        }

        // Packed - READY TO SHIP, bright distinct blue
        if (row.lineStatus === 'packed') {
            return {
                backgroundColor: '#dbeafe',  // Blue-100
                borderLeft: '4px solid #3b82f6',  // Blue-500
            };
        }

        // Picked - Ready to pack, teal tint
        if (row.lineStatus === 'picked') {
            return {
                backgroundColor: '#ccfbf1',  // Teal-100
                borderLeft: '4px solid #14b8a6',  // Teal-500
            };
        }

        // Allocated - Ready to pick, light purple
        if (row.lineStatus === 'allocated') {
            return {
                backgroundColor: '#f3e8ff',  // Purple-100
                borderLeft: '4px solid #a855f7',  // Purple-500
            };
        }

        // Customized lines in pending - special orange styling
        if (row.isCustomized && row.lineStatus === 'pending') {
            return {
                backgroundColor: '#fff7ed',  // Orange-50
                borderLeft: '4px solid #f97316',  // Orange-500
            };
        }

        // Pending with stock - actionable, subtle green tint
        const hasStock = row.skuStock >= row.qty;
        const isPending = row.lineStatus === 'pending';
        const hasProductionDate = !!row.productionBatchId;

        if (hasStock && isPending) {
            return {
                backgroundColor: '#f0fdf4',  // Green-50
                borderLeft: '4px solid #86efac',  // Green-300 (soft)
            };
        }

        // Pending without stock but has production date - amber
        if (hasProductionDate && isPending) {
            return {
                backgroundColor: '#fef3c7',  // Amber-100
                borderLeft: '4px solid #f59e0b',  // Amber-500
            };
        }

        // Pending without stock - blocked, dim/gray
        if (isPending && !hasStock) {
            return {
                backgroundColor: '#f9fafb',  // Gray-50
                color: '#6b7280',  // Gray-500
                borderLeft: '4px solid #d1d5db',  // Gray-300
            };
        }

        return undefined;
    }, []);

    // Add class for non-first lines to hide row separator, and urgency/status classes
    const getRowClass = useCallback((params: any): string => {
        const row = params.data;
        if (!row) return '';

        const classes = [row.isFirstLine ? 'order-first-line' : 'order-continuation-line'];

        // Line status classes (shipped takes priority, then cancelled)
        if (row.lineStatus === 'shipped') {
            classes.push('line-shipped');
        } else if (row.lineStatus === 'cancelled') {
            classes.push('line-cancelled');
        }

        // Calculate order age for urgency indicator (only on first line to avoid repetition)
        // Don't show urgency on shipped/cancelled lines
        if (row.isFirstLine && row.orderDate && !['shipped', 'cancelled'].includes(row.lineStatus)) {
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
                    /* Line marked as shipped - dark green background, strikethrough text */
                    .ag-row.line-shipped {
                        background-color: #dcfce7 !important;
                    }
                    .ag-row.line-shipped .ag-cell {
                        text-decoration: line-through;
                        color: #166534 !important;
                    }
                    /* Line cancelled - red background, strikethrough text */
                    .ag-row.line-cancelled {
                        background-color: #fee2e2 !important;
                    }
                    .ag-row.line-cancelled .ag-cell {
                        text-decoration: line-through;
                        color: #991b1b !important;
                    }
                `}</style>
                <div className="table-scroll-container border rounded">
                    <div style={{ minWidth: '1200px', height: 'calc(100vh - 280px)', minHeight: '400px' }}>
                        <AgGridReact
                            ref={gridRef}
                            rowData={rows}
                            columnDefs={orderedColumnDefs}
                            defaultColDef={defaultColDef}
                            getRowId={getRowId}
                            getRowStyle={getRowStyle}
                            getRowClass={getRowClass}
                            theme={compactThemeSmall}
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
                            onColumnMoved={onColumnMoved}
                            onColumnResized={onColumnResized}
                            maintainColumnOrder={true}
                        />
                    </div>
                </div>
            </>
        ),
        columnVisibilityDropdown: (
            <ColumnVisibilityDropdown
                visibleColumns={visibleColumns}
                onToggleColumn={handleToggleColumn}
                onResetAll={handleResetAll}
                columnIds={ALL_COLUMN_IDS}
                columnHeaders={{ ...DEFAULT_HEADERS, ...customHeaders }}
            />
        ),
        statusLegend: <StatusLegend />,
        customHeaders,
        resetHeaders,
        // User preferences
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        // Admin-only
        isManager,
        savePreferencesToServer,
    };
}

export default OrdersGrid;
