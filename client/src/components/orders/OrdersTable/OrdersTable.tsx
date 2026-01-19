/**
 * OrdersTable - Main TanStack Table component for orders
 * Features: Virtualization, row selection, column reordering/resizing, row styling
 */

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    type SortingState,
    type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../lib/utils';
import type { OrdersTableProps, DynamicColumnHandlers, OrdersTableContext } from './types';
import { buildAllColumns, getColumnsForView } from './columns';
import { useOrdersTableState } from './useOrdersTableState';
import { getRowClassName } from './rowStyling';
import { ROW_HEIGHT, DEFAULT_HEADERS, ALL_COLUMN_IDS } from './constants';
import { ColumnVisibilityDropdown } from './toolbar/ColumnVisibilityDropdown';
import { StatusLegend } from './toolbar/StatusLegend';

export function OrdersTable({
    rows,
    lockedDates,
    currentView = 'open',
    onAllocate,
    onUnallocate,
    onPick,
    onUnpick,
    onPack,
    onUnpack,
    onMarkShippedLine,
    onUnmarkShippedLine,
    onUpdateLineTracking,
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
    onViewCustomer,
    onCustomize,
    onEditCustomization,
    onRemoveCustomization,
    onUpdateShipByDate,
    onForceShipLine,
    onTrack,
    onMarkCodRemitted,
    allocatingLines,
    isCancellingOrder,
    isCancellingLine,
    isUncancellingLine,
    isDeletingOrder,
    isAdmin,
}: OrdersTableProps) {
    // Table state from hook
    const {
        columnVisibility,
        columnOrder,
        columnSizing,
        setColumnVisibility,
        setColumnOrder,
        setColumnSizing,
        handleToggleColumn,
        handleResetAll,
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        isManager,
        savePreferencesToServer,
    } = useOrdersTableState();

    // Sorting state
    const [sorting, setSorting] = useState<SortingState>([]);

    // Row selection state
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

    // Scroll position for indicators
    const [scrollPos, setScrollPos] = useState({ x: 0, y: 0, xMax: 1, yMax: 1 });

    // Custom headers state
    const [customHeaders, setCustomHeaders] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('ordersTableHeaders');
        return saved ? JSON.parse(saved) : {};
    });

    // Use ref to avoid recreating getHeaderName callback when customHeaders change
    const customHeadersRef = useRef(customHeaders);
    customHeadersRef.current = customHeaders;

    const getHeaderName = useCallback(
        (colId: string) => customHeadersRef.current[colId] || DEFAULT_HEADERS[colId] || colId,
        [] // No dependencies - uses ref for stable callback
    );

    const setCustomHeader = useCallback((colId: string, headerName: string) => {
        setCustomHeaders((prev) => {
            const updated = { ...prev, [colId]: headerName };
            localStorage.setItem('ordersTableHeaders', JSON.stringify(updated));
            return updated;
        });
    }, []);

    const isDateLocked = useCallback(
        (dateStr: string) => lockedDates?.includes(dateStr) || false,
        [lockedDates]
    );

    // Dynamic handlers ref - updated every render for latest values
    const handlersRef = useRef<DynamicColumnHandlers>({
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
        onUnmarkShippedLine,
        isAdmin,
        onForceShipLine,
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
        onTrack,
        onViewOrder,
        onViewCustomer,
        onUpdateShipByDate,
    });

    // Update ref every render
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
        onUnmarkShippedLine,
        isAdmin,
        onForceShipLine,
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
        onTrack,
        onViewOrder,
        onViewCustomer,
        onUpdateShipByDate,
    };

    // Build column context
    const columnContext = useMemo<OrdersTableContext>(() => ({
        getHeaderName,
        setCustomHeader,
        currentView,
        isDateLocked,
        handlersRef,
    }), [getHeaderName, setCustomHeader, currentView, isDateLocked]);

    // Build and filter columns
    const allColumns = useMemo(() => buildAllColumns(columnContext), [columnContext]);
    const columns = useMemo(
        () => getColumnsForView(allColumns, currentView),
        [allColumns, currentView]
    );

    // Scroll container ref
    const parentRef = useRef<HTMLDivElement>(null);

    // Container width for auto-sizing columns
    const [containerWidth, setContainerWidth] = useState(0);

    // Update scroll position for indicators
    const handleScroll = useCallback(() => {
        const el = parentRef.current;
        if (!el) return;
        setScrollPos({
            x: el.scrollLeft,
            y: el.scrollTop,
            xMax: Math.max(1, el.scrollWidth - el.clientWidth),
            yMax: Math.max(1, el.scrollHeight - el.clientHeight),
        });
    }, []);

    // Track container width for auto-sizing
    useEffect(() => {
        const el = parentRef.current;
        if (!el) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Account for scrollbar width (~8px) and margins
                setContainerWidth(entry.contentRect.width - 16);
            }
        });

        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    // Initialize scroll position on mount
    useEffect(() => {
        handleScroll();
    }, [handleScroll]);

    // Create table instance
    const table = useReactTable({
        data: rows,
        columns,
        state: {
            sorting,
            rowSelection,
            columnVisibility,
            columnOrder,
            columnSizing,
        },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) => row.lineId || `order-${row.orderId}-header`,
        enableRowSelection: true,
        enableMultiRowSelection: true,
        columnResizeMode: 'onChange',
    });

    const { rows: tableRows } = table.getRowModel();

    // Virtualizer for efficient rendering of large lists
    const virtualizer = useVirtualizer({
        count: tableRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 20,
    });

    const virtualRows = virtualizer.getVirtualItems();
    const totalHeight = virtualizer.getTotalSize();

    // Calculate padding for virtual scroll
    const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
    const paddingBottom = virtualRows.length > 0
        ? totalHeight - (virtualRows[virtualRows.length - 1]?.end || 0)
        : 0;

    // Calculate total table width based on visible columns
    const baseTableWidth = table.getVisibleLeafColumns().reduce((sum, col) => sum + col.getSize(), 0);

    // Scale columns to fill container width (only scale up, not down)
    const scaleFactor = containerWidth > baseTableWidth ? containerWidth / baseTableWidth : 1;
    const tableWidth = Math.max(baseTableWidth * scaleFactor, 900);

    // Get scaled column width
    const getScaledColumnWidth = useCallback((col: any) => {
        return Math.round(col.getSize() * scaleFactor);
    }, [scaleFactor]);

    // Calculate scroll indicator positions
    const verticalThumbHeight = Math.max(20, (1 / Math.max(1, totalHeight / (parentRef.current?.clientHeight || 400))) * 100);
    const verticalThumbTop = (scrollPos.y / scrollPos.yMax) * (100 - verticalThumbHeight);
    const horizontalThumbWidth = Math.max(20, (1 / Math.max(1, tableWidth / (parentRef.current?.clientWidth || 800))) * 100);
    const horizontalThumbLeft = (scrollPos.x / scrollPos.xMax) * (100 - horizontalThumbWidth);

    return {
        tableComponent: (
            <div className="border rounded overflow-hidden relative">
                {/* Vertical scroll indicator */}
                <div
                    className="absolute right-0 top-0 bottom-1.5 w-1.5 pointer-events-none z-20"
                    style={{ background: 'rgba(0,0,0,0.05)' }}
                >
                    <div
                        className="absolute right-0 w-1.5 rounded-full"
                        style={{
                            background: 'rgba(0,0,0,0.2)',
                            height: `${verticalThumbHeight}%`,
                            top: `${verticalThumbTop}%`,
                        }}
                    />
                </div>
                {/* Horizontal scroll indicator */}
                <div
                    className="absolute left-0 bottom-0 right-1.5 h-1.5 pointer-events-none z-20"
                    style={{ background: 'rgba(0,0,0,0.05)' }}
                >
                    <div
                        className="absolute bottom-0 h-1.5 rounded-full"
                        style={{
                            background: 'rgba(0,0,0,0.2)',
                            width: `${horizontalThumbWidth}%`,
                            left: `${horizontalThumbLeft}%`,
                        }}
                    />
                </div>
                {/* Single scroll container for both header and body */}
                <div
                    ref={parentRef}
                    className="overflow-auto scrollbar-hide"
                    onScroll={handleScroll}
                    style={{
                        height: 'calc(100vh - 180px)',
                        minHeight: '300px',
                    }}
                >
                    <table
                        className="border-collapse"
                        style={{
                            width: tableWidth,
                            minWidth: '900px',
                            tableLayout: 'fixed',
                            marginRight: '8px',
                            marginBottom: '8px',
                        }}
                    >
                        {/* Define column widths once via colgroup - scaled to fill container */}
                        <colgroup>
                            {table.getVisibleLeafColumns().map((column) => (
                                <col key={column.id} style={{ width: getScaledColumnWidth(column) }} />
                            ))}
                        </colgroup>
                        {/* Sticky header */}
                        <thead className="sticky top-0 z-10 bg-gray-50">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <tr key={headerGroup.id} className="border-b border-gray-200">
                                    {headerGroup.headers.map((header) => (
                                        <th
                                            key={header.id}
                                            className={cn(
                                                'text-left text-xs font-medium text-gray-600 px-1 py-0.5 whitespace-nowrap select-none relative bg-gray-50',
                                                header.column.getCanSort() && 'cursor-pointer hover:bg-gray-100'
                                            )}
                                            onClick={header.column.getToggleSortingHandler()}
                                        >
                                            <div className="flex items-center gap-0.5">
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {{
                                                    asc: '↑',
                                                    desc: '↓',
                                                }[header.column.getIsSorted() as string] ?? null}
                                            </div>
                                            {/* Column resize handle */}
                                            <div
                                                onMouseDown={header.getResizeHandler()}
                                                onTouchStart={header.getResizeHandler()}
                                                className={cn(
                                                    'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                                                    header.column.getIsResizing() && 'bg-blue-500'
                                                )}
                                                style={{ transform: 'translateX(50%)' }}
                                            />
                                        </th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        {/* Virtualized body */}
                        <tbody>
                            {paddingTop > 0 && (
                                <tr>
                                    <td
                                        colSpan={table.getVisibleLeafColumns().length}
                                        style={{ height: `${paddingTop}px`, padding: 0 }}
                                    />
                                </tr>
                            )}
                            {virtualRows.map((virtualRow) => {
                                const row = tableRows[virtualRow.index];
                                const rowClassName = getRowClassName(row.original);
                                return (
                                    <tr
                                        key={row.id}
                                        className={cn(rowClassName)}
                                        style={{ height: ROW_HEIGHT }}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <td
                                                key={cell.id}
                                                className="px-1 py-0.5 text-xs overflow-hidden text-ellipsis"
                                            >
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                            {paddingBottom > 0 && (
                                <tr>
                                    <td
                                        colSpan={table.getVisibleLeafColumns().length}
                                        style={{ height: `${paddingBottom}px`, padding: 0 }}
                                    />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        ),
        columnVisibilityDropdown: (
            <ColumnVisibilityDropdown
                visibleColumns={columnVisibility}
                onToggleColumn={handleToggleColumn}
                onResetAll={handleResetAll}
                columnIds={ALL_COLUMN_IDS as unknown as string[]}
                columnOrder={columnOrder}
                onReorderColumns={setColumnOrder}
                columnHeaders={{ ...DEFAULT_HEADERS, ...customHeaders }}
                isManager={isManager}
                onSaveAsDefaults={savePreferencesToServer}
            />
        ),
        statusLegend: <StatusLegend />,
        // Selection helpers
        selectedRows: Object.keys(rowSelection).filter(id => rowSelection[id]),
        clearSelection: () => setRowSelection({}),
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

export default OrdersTable;
