/**
 * OrdersTable - Main TanStack Table component for orders (monitoring dashboard)
 * Features: Virtualization, column reordering/resizing
 */

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    type SortingState,
    type Column,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../lib/utils';
import type { FlattenedOrderRow } from '../../../utils/orderHelpers';
import type { OrdersTableProps, DynamicColumnHandlers, OrdersTableContext } from './types';
import { buildAllColumns, getColumnsForView } from './columns';
import { useOrdersTableState } from './useOrdersTableState';
import { ROW_HEIGHT, DEFAULT_HEADERS, ALL_COLUMN_IDS } from './constants';
import { ColumnVisibilityDropdown } from './toolbar/ColumnVisibilityDropdown';

export function OrdersTable({
    rows,
    currentView = 'all',
    onViewOrder,
    onViewCustomer,
}: OrdersTableProps) {
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

    const [sorting, setSorting] = useState<SortingState>([]);
    const [scrollPos, setScrollPos] = useState({ x: 0, y: 0, xMax: 1, yMax: 1 });

    const [customHeaders, setCustomHeaders] = useState<Record<string, string>>(() => {
        if (typeof window === 'undefined') return {};
        const saved = localStorage.getItem('ordersTableHeaders');
        return saved ? JSON.parse(saved) : {};
    });

    const customHeadersRef = useRef(customHeaders);
    customHeadersRef.current = customHeaders;

    const getHeaderName = useCallback(
        (colId: string) => customHeadersRef.current[colId] || DEFAULT_HEADERS[colId] || colId,
        []
    );

    const setCustomHeader = useCallback((colId: string, headerName: string) => {
        setCustomHeaders((prev) => {
            const updated = { ...prev, [colId]: headerName };
            if (typeof window !== 'undefined') {
                localStorage.setItem('ordersTableHeaders', JSON.stringify(updated));
            }
            return updated;
        });
    }, []);

    // Dynamic handlers ref
    const handlersRef = useRef<DynamicColumnHandlers>({
        onViewOrder,
        onViewCustomer,
    });

    handlersRef.current = {
        onViewOrder,
        onViewCustomer,
    };

    // Build column context
    const columnContext = useMemo<OrdersTableContext>(() => ({
        getHeaderName,
        setCustomHeader,
        currentView,
        handlersRef,
    }), [getHeaderName, setCustomHeader, currentView]);

    const allColumns = useMemo(() => buildAllColumns(columnContext), [columnContext]);
    const columns = useMemo(
        () => getColumnsForView(allColumns, currentView),
        [allColumns, currentView]
    );

    const parentRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

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

    useEffect(() => {
        const el = parentRef.current;
        if (!el) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width - 16);
            }
        });
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        handleScroll();
    }, [handleScroll]);

    const table = useReactTable({
        data: rows,
        columns,
        state: {
            sorting,
            columnVisibility,
            columnOrder,
            columnSizing,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) => row.orderId,
        columnResizeMode: 'onChange',
    });

    const { rows: tableRows } = table.getRowModel();

    const virtualizer = useVirtualizer({
        count: tableRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 5,
    });

    const virtualRows = virtualizer.getVirtualItems();
    const totalHeight = virtualizer.getTotalSize();
    const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
    const paddingBottom = virtualRows.length > 0
        ? totalHeight - (virtualRows[virtualRows.length - 1]?.end || 0)
        : 0;

    const baseTableWidth = table.getVisibleLeafColumns().reduce((sum, col) => sum + col.getSize(), 0);
    const scaleFactor = containerWidth > baseTableWidth ? containerWidth / baseTableWidth : 1;
    const tableWidth = Math.max(baseTableWidth * scaleFactor, 900);

    const getScaledColumnWidth = useCallback((col: Column<FlattenedOrderRow, unknown>) => {
        return Math.round(col.getSize() * scaleFactor);
    }, [scaleFactor]);

    const verticalThumbHeight = Math.max(20, (1 / Math.max(1, totalHeight / (parentRef.current?.clientHeight || 400))) * 100);
    const verticalThumbTop = (scrollPos.y / scrollPos.yMax) * (100 - verticalThumbHeight);
    const horizontalThumbWidth = Math.max(20, (1 / Math.max(1, tableWidth / (parentRef.current?.clientWidth || 800))) * 100);
    const horizontalThumbLeft = (scrollPos.x / scrollPos.xMax) * (100 - horizontalThumbWidth);

    // Simple row styling for monitoring dashboard
    const getRowClassName = (row: FlattenedOrderRow): string => {
        if (row.lineStatus === 'cancelled') {
            return 'text-gray-400 line-through opacity-60';
        }
        if (row.rtoStatus || row.lineTrackingStatus?.includes('rto')) {
            return 'bg-orange-50/50';
        }
        return '';
    };

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
                        <colgroup>
                            {table.getVisibleLeafColumns().map((column) => (
                                <col key={column.id} style={{ width: getScaledColumnWidth(column) }} />
                            ))}
                        </colgroup>
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
                                                    asc: '\u2191',
                                                    desc: '\u2193',
                                                }[header.column.getIsSorted() as string] ?? null}
                                            </div>
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
                                const rowData = row.original;
                                const rowClassName = getRowClassName(rowData);
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
        hasUserCustomizations,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        isManager,
        savePreferencesToServer,
    };
}

export default OrdersTable;
