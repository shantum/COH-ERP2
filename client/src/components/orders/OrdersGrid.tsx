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
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { DEFAULT_HEADERS, DEFAULT_VISIBLE_COLUMNS } from '../../utils/orderHelpers';
import type { FlattenedOrderRow } from '../../utils/orderHelpers';
import { compactThemeSmall } from '../../utils/agGridHelpers';
import { ColumnVisibilityDropdown, EditableHeader } from '../common/grid';
import { useGridState } from '../../hooks/useGridState';

// Extracted modules from ordersGrid/
import { ALL_COLUMN_IDS } from './ordersGrid/constants';
import { StatusLegend, getRowStyle, getRowClass, gridRowStyles } from './ordersGrid/helpers';
import { buildAllColumns, type ColumnBuilderContext } from './ordersGrid/columns';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// View type for unified order views
export type OrderViewType = 'open' | 'shipped' | 'rto' | 'cod_pending' | 'archived' | 'cancelled';

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
    // External grid ref for AG-Grid transaction-based updates
    externalGridRef?: React.RefObject<AgGridReact | null>;
    onAllocate: (lineId: string) => void;
    onUnallocate: (lineId: string) => void;
    onPick: (lineId: string) => void;
    onUnpick: (lineId: string) => void;
    onPack: (lineId: string) => void;
    onUnpack: (lineId: string) => void;
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
    externalGridRef,
    onAllocate,
    onUnallocate,
    onPick,
    onUnpick,
    onPack,
    onUnpack,
    onMarkShippedLine,
    onUnmarkShippedLine: _onUnmarkShippedLine,
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
    isUnshipping: _isUnshipping,
    isMarkingDelivered: _isMarkingDelivered,
    isMarkingRto: _isMarkingRto,
    isUnarchiving: _isUnarchiving,
    isAdmin,
}: OrdersGridProps) {
    // Grid ref for API access - use external ref if provided, otherwise create internal one
    const internalGridRef = useRef<AgGridReact>(null);
    const gridRef = externalGridRef || internalGridRef;

    // Track previous lineStatus values for change detection
    // Used by onRowDataUpdated to detect which rows need styling refresh
    const prevStatusMapRef = useRef<Map<string, string>>(new Map());

    // Callback when AG-Grid finishes processing new row data
    // This fires AFTER AG-Grid has updated its internal model, ensuring redrawRows uses correct data
    const onRowDataUpdated = useCallback((event: any) => {
        const api = event.api;
        if (!api) return;

        const changedRowIds: string[] = [];
        const newStatusMap = new Map<string, string>();

        // Iterate through AG-Grid's row nodes (guaranteed to have current data)
        api.forEachNode((node: any) => {
            const row = node.data;
            if (!row) return;

            const rowId = row.lineId || `order-${row.orderId}-header`;
            const status = row.lineStatus || '';
            newStatusMap.set(rowId, status);

            // Check if status changed from previous data update
            const prevStatus = prevStatusMapRef.current.get(rowId);
            if (prevStatus !== undefined && prevStatus !== status) {
                changedRowIds.push(rowId);
            }
        });

        // Update ref for next comparison
        prevStatusMapRef.current = newStatusMap;

        // Redraw changed rows to refresh getRowStyle/getRowClass
        if (changedRowIds.length > 0) {
            const rowNodes = changedRowIds
                .map(id => api.getRowNode(id))
                .filter((node): node is NonNullable<typeof node> => node != null);

            if (rowNodes.length > 0) {
                api.redrawRows({ rowNodes });
            }
        }
    }, []);

    // Refresh fulfillment columns when allocatingLines changes
    // AG-Grid cells don't automatically re-render when React state changes,
    // so we need to explicitly refresh columns that read from handlersRef
    useEffect(() => {
        const api = gridRef.current?.api;
        if (!api) return;

        // Refresh all fulfillment columns that use allocatingLines for loading state
        api.refreshCells({
            columns: ['allocate', 'pick', 'pack', 'ship', 'cancelLine']
        });
    }, [allocatingLines]);

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

    const isDateLocked = useCallback(
        (dateStr: string) => lockedDates?.includes(dateStr) || false,
        [lockedDates]
    );

    // Ref for dynamic handlers - updated every render for latest values
    // This prevents columnContext from rebuilding on every handler/state change
    const handlersRef = useRef<import('./ordersGrid/types').DynamicColumnHandlers>({
        allocatingLines,
        isCancellingLine,
        isUncancellingLine,
        isCancellingOrder,
        isDeletingOrder,
        onAllocate,
        onUnallocate,
        onPick,
        onUnpick,
        onPack,
        onUnpack,
        onMarkShippedLine,
        onUnmarkShippedLine: _onUnmarkShippedLine,
        isAdmin,
        onForceShipOrder,
        onCreateBatch,
        onUpdateBatch,
        onDeleteBatch,
        onUpdateLineNotes,
        onCancelLine,
        onUncancelLine,
        onUpdateLineTracking,
        onCustomize,
        onEditCustomization,
        onRemoveCustomization,
        onMarkCodRemitted,
        onTrack: _onTrack,
        onViewOrder,
        onSelectCustomer,
        onUpdateShipByDate,
    });

    // Update ref every render (direct assignment, no useEffect needed)
    handlersRef.current = {
        allocatingLines,
        isCancellingLine,
        isUncancellingLine,
        isCancellingOrder,
        isDeletingOrder,
        onAllocate,
        onUnallocate,
        onPick,
        onUnpick,
        onPack,
        onUnpack,
        onMarkShippedLine,
        onUnmarkShippedLine: _onUnmarkShippedLine,
        isAdmin,
        onForceShipOrder,
        onCreateBatch,
        onUpdateBatch,
        onDeleteBatch,
        onUpdateLineNotes,
        onCancelLine,
        onUncancelLine,
        onUpdateLineTracking,
        onCustomize,
        onEditCustomization,
        onRemoveCustomization,
        onMarkCodRemitted,
        onTrack: _onTrack,
        onViewOrder,
        onSelectCustomer,
        onUpdateShipByDate,
    };

    // Build column context with STABLE references only
    // Dynamic values accessed via handlersRef.current in cellRenderers
    const columnContext = useMemo<ColumnBuilderContext>(() => ({
        // Static values (rarely change)
        getHeaderName,
        setCustomHeader,
        currentView,
        isDateLocked,
        // Dynamic handlers via ref (always up-to-date, but ref is stable)
        handlersRef,
    }), [getHeaderName, setCustomHeader, currentView, isDateLocked]);

    // Build column definitions from context
    const columnDefs = useMemo<ColDef[]>(() => {
        const cols = buildAllColumns(columnContext);
        return cols.map(col => ({
            ...col,
            hide: !visibleColumns.has(col.colId!),
        }));
    }, [columnContext, visibleColumns]);

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

    return {
        // Expose grid ref for transaction-based updates from SSE
        gridRef,
        gridComponent: (
            <>
                <style>{gridRowStyles}</style>
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
                            onRowDataUpdated={onRowDataUpdated}
                            maintainColumnOrder={true}
                            // Performance optimizations for large datasets
                            rowBuffer={50}                    // Render 50 rows beyond viewport (smoother scroll)
                            debounceVerticalScrollbar={true}  // Debounce scroll events
                            suppressAnimationFrame={false}    // Keep animation frame for smooth updates
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
